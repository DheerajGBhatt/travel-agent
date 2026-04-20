import json
import glob
import os
import re
from typing import List, Dict, Any, Generator
from elasticsearch import Elasticsearch, helpers
import boto3
from botocore.exceptions import ClientError

# Configuration
ELASTIC_ENDPOINT = "https://travel-agency-e9513e.es.ap-southeast-1.aws.elastic.cloud:443"
ELASTIC_API_KEY = os.getenv("ELASTIC_API_KEY", "a3NQaWpac0JGUjlCNDVEZnVLVTU6bi1VWTlmLS0wOXJtdmFtMEhoUlc0UQ==")
INDEX_NAME = "travel-support-titan-embeddings"
DATA_PATH = "batch_*.json"

# AWS Bedrock Configuration
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
TITAN_MODEL_ID = "amazon.titan-embed-text-v2:0"
EMBEDDING_DIM = 1024  # Titan v2 default dimension (can be 256, 512, or 1024)

# Initialize AWS Bedrock client
print(f"Initializing AWS Bedrock client in region: {AWS_REGION}...")
try:
    bedrock_runtime = boto3.client(
        service_name='bedrock-runtime',
        region_name=AWS_REGION
    )
    print(f"✓ AWS Bedrock client initialized")
    print(f"✓ Using model: {TITAN_MODEL_ID}")
    print(f"✓ Embedding dimension: {EMBEDDING_DIM}")
except Exception as e:
    print(f"⚠ Warning: Could not initialize Bedrock client: {e}")
    bedrock_runtime = None

def get_es_client():
    """Initialize Elasticsearch client with proper error handling."""
    if not ELASTIC_API_KEY:
        print("ERROR: ELASTIC_API_KEY not set.")
        return None

    try:
        es = Elasticsearch(
            hosts=ELASTIC_ENDPOINT,
            api_key=ELASTIC_API_KEY,
            request_timeout=30,
            max_retries=3,
            retry_on_timeout=True
        )
        # Test connection
        es.info()
        print("✓ Connected to Elasticsearch")
        return es
    except Exception as e:
        print(f"ERROR connecting to Elasticsearch: {e}")
        return None

def get_titan_embedding(text: str, dimension: int = EMBEDDING_DIM) -> List[float]:
    """
    Generate embeddings using AWS Bedrock Titan model.

    Args:
        text: Input text to embed
        dimension: Output dimension (256, 512, or 1024 for Titan v2)

    Returns:
        List of float values representing the embedding vector
    """
    if not bedrock_runtime:
        print("⚠ Bedrock client not available, returning zero vector")
        return [0.0] * dimension

    try:
        # Prepare request body for Titan Embed v2
        request_body = {
            "inputText": text,
            "dimensions": dimension,
            "normalize": True  # Normalize embeddings for cosine similarity
        }

        # Invoke Bedrock model
        response = bedrock_runtime.invoke_model(
            modelId=TITAN_MODEL_ID,
            body=json.dumps(request_body),
            contentType="application/json",
            accept="application/json"
        )

        # Parse response
        response_body = json.loads(response['body'].read())
        embedding = response_body.get('embedding', [])

        if not embedding:
            print(f"⚠ Empty embedding received for text: {text[:50]}...")
            return [0.0] * dimension

        return embedding

    except ClientError as e:
        print(f"⚠ AWS Bedrock error: {e}")
        return [0.0] * dimension
    except Exception as e:
        print(f"⚠ Error generating embedding: {e}")
        return [0.0] * dimension

def extract_booking_ids(text: str) -> List[str]:
    """
    Extract booking IDs from text using comprehensive patterns.
    Handles formats like: FL123456, BK445678, HTL789012, PNR:ABC123
    """
    patterns = [
        r'\b(FL|BK|HTL|HOTEL|FLIGHT|CONF|PNR)[:\s-]?(\d{5,8})\b',
        r'(?:booking|confirmation|reference)(?:\s+(?:ref|number|#|no\.?|num))?\s*:?\s*([A-Z0-9]{6,10})\b',
        r'\b([A-Z]{2}\d{6})\b'  # Two letters followed by 6 digits
    ]

    booking_ids = set()
    for pattern in patterns:
        matches = re.findall(pattern, text, re.IGNORECASE)
        for match in matches:
            if isinstance(match, tuple):
                booking_id = ''.join(match).strip(':- ')
            else:
                booking_id = match.strip(':- ')

            if booking_id and len(booking_id) >= 6:
                booking_ids.add(booking_id.upper())

    return sorted(list(booking_ids))

def create_titan_index(es):
    """
    Creates production-ready index with AWS Titan embeddings.

    Features:
    - copy_to semantic_search_text for unified search
    - Dense vectors from AWS Titan
    - BM25 keyword search
    - Exact booking ID matching
    """
    if not es:
        return

    mapping = {
        "mappings": {
            "properties": {
                # === Metadata Fields ===
                "conversation_id": {"type": "keyword"},
                "category": {
                    "type": "keyword",
                    "fields": {"text": {"type": "text"}}
                },
                "subcategory": {
                    "type": "keyword",
                    "fields": {"text": {"type": "text"}}
                },
                "issue_type": {
                    "type": "keyword",
                    "fields": {"text": {"type": "text"}}
                },
                "resolution_status": {"type": "keyword"},
                "sentiment": {"type": "keyword"},
                "tags": {"type": "keyword"},
                "timestamp": {"type": "date"},

                # === Booking References (Exact Match) ===
                "booking_ids": {
                    "type": "keyword",
                    "normalizer": "lowercase_normalizer"
                },

                # === Text Fields with copy_to ===
                "question": {
                    "type": "text",
                    "analyzer": "english",
                    "copy_to": "semantic_search_text",  # PRODUCTION: copy_to unified field
                    "fields": {
                        "keyword": {"type": "keyword", "ignore_above": 256}
                    }
                },
                "answer": {
                    "type": "text",
                    "analyzer": "english",
                    "copy_to": "semantic_search_text"  # PRODUCTION: copy_to unified field
                },
                "resolution_summary": {
                    "type": "text",
                    "analyzer": "english",
                    "copy_to": "semantic_search_text"  # PRODUCTION: copy_to unified field
                },

                # === Unified Semantic Search Text ===
                # Automatically populated via copy_to from question + answer + resolution_summary
                "semantic_search_text": {
                    "type": "text",
                    "analyzer": "english",
                    "index_options": "offsets",
                    "term_vector": "with_positions_offsets"
                },

                # === Combined Text (Explicit) ===
                "combined_text": {
                    "type": "text",
                    "analyzer": "english"
                },

                # === AWS Titan Embedding Vector ===
                "embedding_vector": {
                    "type": "dense_vector",
                    "dims": EMBEDDING_DIM,
                    "index": True,
                    "similarity": "cosine"
                },

                # === Message Context ===
                "message_index": {"type": "integer"},
                "total_messages": {"type": "integer"},

                # === Full Conversation (for LLM) ===
                "full_conversation": {
                    "type": "text",
                    "index": False
                }
            }
        },
        "settings": {
            "analysis": {
                "normalizer": {
                    "lowercase_normalizer": {
                        "type": "custom",
                        "filter": ["lowercase", "asciifolding"]
                    }
                }
            }
        }
    }

    try:
        if es.indices.exists(index=INDEX_NAME):
            print(f"⚠ Index {INDEX_NAME} exists. Deleting and recreating...")
            es.indices.delete(index=INDEX_NAME)

        es.indices.create(index=INDEX_NAME, body=mapping)
        print(f"✓ Created index: {INDEX_NAME}")
        print(f"✓ Configured copy_to: question/answer/resolution_summary → semantic_search_text")

    except Exception as e:
        print(f"ERROR creating index: {e}")
        raise

def extract_message_pairs(conversation: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Extract Q&A pairs from conversation messages."""
    messages = conversation.get("messages", [])
    pairs = []

    customer_msg = None
    for msg in messages:
        if msg["role"] == "customer":
            customer_msg = msg
        elif msg["role"] == "agent" and customer_msg:
            pairs.append({
                "question": customer_msg["content"],
                "answer": msg["content"],
                "question_timestamp": customer_msg["timestamp"],
                "answer_timestamp": msg["timestamp"],
                "message_index": len(pairs)
            })
            customer_msg = None

    return pairs

def process_conversations_with_titan() -> Generator[Dict[str, Any], None, None]:
    """
    Process conversations and generate embeddings using AWS Titan.
    Creates message-pair documents with proper copy_to configuration.
    """
    files = glob.glob(DATA_PATH)
    print(f"\nProcessing {len(files)} data files with AWS Titan embeddings...")

    doc_count = 0
    error_count = 0

    for file_path in files:
        try:
            with open(file_path, 'r') as f:
                data = json.load(f)
                conversations = data.get("conversations", [])

                for conv in conversations:
                    try:
                        # Extract booking IDs
                        all_text = " ".join([m["content"] for m in conv["messages"]])
                        booking_ids = extract_booking_ids(all_text)

                        # Extract message pairs
                        message_pairs = extract_message_pairs(conv)

                        if not message_pairs:
                            continue

                        resolution_summary = conv.get("resolution_summary", "")

                        # Create document for each Q&A pair
                        for pair in message_pairs:
                            # Build combined text for embedding
                            combined_text = f"""Category: {conv.get('category')} - {conv.get('subcategory')}
Issue: {conv.get('issue_type')}
Question: {pair['question']}
Answer: {pair['answer']}
Resolution: {resolution_summary}""".strip()

                            # Generate AWS Titan embedding
                            embedding_vector = get_titan_embedding(combined_text)

                            doc = {
                                "_index": INDEX_NAME,
                                "_id": f"{conv['id']}_pair_{pair['message_index']}",
                                "conversation_id": conv["id"],
                                "category": conv.get("category"),
                                "subcategory": conv.get("subcategory"),
                                "issue_type": conv.get("issue_type"),
                                "resolution_status": conv.get("resolution_status"),
                                "sentiment": conv.get("sentiment"),
                                "tags": conv.get("tags", []),
                                "timestamp": pair["question_timestamp"],
                                "booking_ids": booking_ids,

                                # Text fields (will auto copy_to semantic_search_text)
                                "question": pair["question"],
                                "answer": pair["answer"],
                                "resolution_summary": resolution_summary,

                                # Combined text for explicit searching
                                "combined_text": combined_text,

                                # AWS Titan embedding
                                "embedding_vector": embedding_vector,

                                # Message metadata
                                "message_index": pair["message_index"],
                                "total_messages": len(conv["messages"]),

                                # Full conversation for LLM context
                                "full_conversation": json.dumps(conv["messages"])
                            }

                            doc_count += 1
                            if doc_count % 25 == 0:
                                print(f"  Processed {doc_count} documents...")

                            yield doc

                    except Exception as e:
                        error_count += 1
                        print(f"⚠ Error processing conversation {conv.get('id')}: {e}")
                        continue

        except Exception as e:
            error_count += 1
            print(f"⚠ Error processing file {file_path}: {e}")

    print(f"\n✓ Processed {doc_count} documents")
    if error_count > 0:
        print(f"⚠ Encountered {error_count} errors")

def example_titan_search(es):
    """Demonstrate hybrid search with AWS Titan embeddings."""
    if not es:
        return

    print(f"\n{'='*80}")
    print("EXAMPLE HYBRID SEARCH (AWS Titan + BM25)")
    print(f"{'='*80}\n")

    query_text = "I was charged but didn't receive confirmation"
    print(f"Query: '{query_text}'\n")

    # Generate query embedding with Titan
    query_vector = get_titan_embedding(query_text)

    # Hybrid search
    search_body = {
        "size": 3,
        "query": {
            "bool": {
                "should": [
                    # Semantic search with Titan embeddings
                    {
                        "script_score": {
                            "query": {"match_all": {}},
                            "script": {
                                "source": "cosineSimilarity(params.query_vector, 'embedding_vector') + 1.0",
                                "params": {"query_vector": query_vector}
                            }
                        }
                    },
                    # BM25 on unified semantic_search_text (copy_to field)
                    {
                        "multi_match": {
                            "query": query_text,
                            "fields": [
                                "semantic_search_text^3",  # Unified field
                                "combined_text^2",
                                "question^1.5"
                            ],
                            "type": "best_fields"
                        }
                    }
                ]
            }
        },
        "_source": {
            "excludes": ["embedding_vector", "full_conversation"]
        }
    }

    try:
        response = es.search(index=INDEX_NAME, body=search_body)

        for i, hit in enumerate(response['hits']['hits'], 1):
            doc = hit['_source']
            print(f"Result {i} (Score: {hit['_score']:.2f})")
            print(f"  Conversation: {doc['conversation_id']}")
            print(f"  Issue: {doc['issue_type']}")
            print(f"  Booking IDs: {', '.join(doc.get('booking_ids', ['None']))}")
            print(f"  Question: {doc['question'][:80]}...")
            print(f"  Answer: {doc['answer'][:80]}...")
            print()

    except Exception as e:
        print(f"⚠ Error performing search: {e}")

def main():
    """Main ingestion workflow with AWS Titan embeddings."""
    print("\n" + "="*80)
    print("RAG INGESTION WITH AWS TITAN EMBEDDINGS")
    print("="*80)
    print(f"Embedding Model: {TITAN_MODEL_ID}")
    print(f"Embedding Dimension: {EMBEDDING_DIM}")
    print(f"AWS Region: {AWS_REGION}")
    print(f"Index Name: {INDEX_NAME}")
    print(f"Data Path: {DATA_PATH}")
    print("="*80 + "\n")

    # Check Bedrock availability
    if not bedrock_runtime:
        print("ERROR: AWS Bedrock client not initialized.")
        print("Please configure AWS credentials:")
        print("  - Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY")
        print("  - Or configure AWS CLI: aws configure")
        print("  - Or use IAM role if running on EC2/Lambda")
        return

    # Initialize Elasticsearch
    es = get_es_client()
    if not es:
        print("ERROR: Cannot proceed without Elasticsearch connection.")
        return

    # Create index with Titan embeddings support
    create_titan_index(es)

    # Process and index documents
    print("\nIndexing documents with AWS Titan embeddings...")
    try:
        success, errors = helpers.bulk(
            es,
            process_conversations_with_titan(),
            chunk_size=50,
            raise_on_error=False,
            request_timeout=60
        )
        print(f"\n✓ Successfully indexed {success} documents")

        if errors:
            print(f"⚠ {len(errors)} documents failed")

    except Exception as e:
        print(f"ERROR during bulk indexing: {e}")
        return

    # Refresh index
    try:
        es.indices.refresh(index=INDEX_NAME)
        print("✓ Index refreshed")
    except Exception as e:
        print(f"⚠ Error refreshing: {e}")

    # Show example search
    example_titan_search(es)

    print("\n" + "="*80)
    print("✅ INGESTION COMPLETE")
    print("="*80)
    print("\nFeatures:")
    print("  ✓ AWS Titan embeddings (1024-dim)")
    print("  ✓ copy_to semantic_search_text (question+answer+summary)")
    print("  ✓ Hybrid search (Titan vectors + BM25)")
    print("  ✓ Exact booking ID matching")
    print("  ✓ Message-pair Q&A structure")
    print()

if __name__ == "__main__":
    main()
