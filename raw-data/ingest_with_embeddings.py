import json
import glob
import os
import re
from typing import List, Dict, Any, Generator
from elasticsearch import Elasticsearch, helpers
from sentence_transformers import SentenceTransformer

# Configuration
ELASTIC_ENDPOINT = "https://travel-agency-e9513e.es.ap-southeast-1.aws.elastic.cloud:443"
ELASTIC_API_KEY = os.getenv("ELASTIC_API_KEY", "a3NQaWpac0JGUjlCNDVEZnVLVTU6bi1VWTlmLS0wOXJtdmFtMEhoUlc0UQ==")
INDEX_NAME = "travel-support-hybrid-qa"
DATA_PATH = "batch_*.json"

# Local embedding model configuration
# Options: 'all-MiniLM-L6-v2' (384-dim, fast), 'all-mpnet-base-v2' (768-dim, better quality)
EMBEDDING_MODEL = "all-MiniLM-L6-v2"
EMBEDDING_DIM = 384  # Dimension for all-MiniLM-L6-v2

# Initialize local embedding model
print(f"Loading embedding model: {EMBEDDING_MODEL}...")
embedding_model = SentenceTransformer(EMBEDDING_MODEL)
print(f"✓ Model loaded. Embedding dimension: {EMBEDDING_DIM}")

def get_es_client():
    """Initialize Elasticsearch client."""
    if not ELASTIC_API_KEY:
        print("Warning: ELASTIC_API_KEY not set.")
        return None

    return Elasticsearch(
        hosts=ELASTIC_ENDPOINT,
        api_key=ELASTIC_API_KEY
    )

def create_hybrid_index(es):
    """
    Creates index with mappings for Hybrid RRF search:
    - Dense vector for semantic search
    - Text fields with BM25 for keyword search
    - Keyword fields for exact booking ID matches
    """
    if not es:
        return

    mapping = {
        "mappings": {
            "properties": {
                # === Metadata Fields ===
                "conversation_id": {"type": "keyword"},
                "category": {"type": "keyword"},
                "subcategory": {"type": "keyword"},
                "issue_type": {"type": "keyword"},
                "resolution_status": {"type": "keyword"},
                "sentiment": {"type": "keyword"},
                "tags": {"type": "keyword"},
                "timestamp": {"type": "date"},

                # === Booking References (Exact Match) ===
                "booking_ids": {
                    "type": "keyword",  # Exact match for booking IDs
                    "normalizer": "lowercase_normalizer"
                },

                # === Message Pair Structure ===
                "question": {
                    "type": "text",
                    "analyzer": "english",
                    "fields": {
                        "keyword": {"type": "keyword"}
                    }
                },
                "answer": {
                    "type": "text",
                    "analyzer": "english"
                },
                "resolution_summary": {
                    "type": "text",
                    "analyzer": "english"
                },

                # === Combined Text for BM25 Search ===
                "combined_text": {
                    "type": "text",
                    "analyzer": "english"
                },

                # === Dense Vector for Semantic Search ===
                "vector": {
                    "type": "dense_vector",
                    "dims": EMBEDDING_DIM,
                    "index": True,
                    "similarity": "cosine"
                },

                # === Full Conversation (for context) ===
                "full_conversation": {
                    "type": "text",
                    "index": False  # Store but don't index
                },

                # === Message Metadata ===
                "message_index": {"type": "integer"},
                "total_messages": {"type": "integer"}
            }
        },
        "settings": {
            "analysis": {
                "normalizer": {
                    "lowercase_normalizer": {
                        "type": "custom",
                        "filter": ["lowercase"]
                    }
                }
            }
        }
    }

    if es.indices.exists(index=INDEX_NAME):
        print(f"Deleting existing index: {INDEX_NAME}")
        es.indices.delete(index=INDEX_NAME)

    es.indices.create(index=INDEX_NAME, body=mapping)
    print(f"Created hybrid index: {INDEX_NAME}")

def extract_booking_ids(text: str) -> List[str]:
    """
    Extract booking IDs from text using common patterns:
    - FL123456, BK123456, HTL123456
    - Booking ref: XXXXX
    - Reference: XXXXX
    """
    patterns = [
        r'\b(FL|BK|HTL|HOTEL|FLIGHT)\d{5,8}\b',
        r'(?:booking|confirmation|reference)(?:\s+(?:ref|number|#|no\.?|num))?\s*:?\s*([A-Z0-9]{6,10})\b'
    ]

    booking_ids = []
    for pattern in patterns:
        matches = re.findall(pattern, text, re.IGNORECASE)
        booking_ids.extend([''.join(m) if isinstance(m, tuple) else m for m in matches])

    return list(set([bid.upper() for bid in booking_ids]))

def get_embedding(text: str) -> List[float]:
    """Generate embedding using local SentenceTransformer model."""
    try:
        # SentenceTransformer returns numpy array, convert to list
        embedding = embedding_model.encode(text, convert_to_tensor=False)
        return embedding.tolist()
    except Exception as e:
        print(f"Error generating embedding: {e}")
        return [0.0] * EMBEDDING_DIM

def get_embeddings_batch(texts: List[str], batch_size: int = 32) -> List[List[float]]:
    """
    Generate embeddings for multiple texts at once (faster).
    Useful for batch processing large datasets.
    """
    try:
        embeddings = embedding_model.encode(
            texts,
            batch_size=batch_size,
            show_progress_bar=True,
            convert_to_tensor=False,
            normalize_embeddings=False
        )
        return embeddings.tolist()
    except Exception as e:
        print(f"Error generating batch embeddings: {e}")
        return [[0.0] * EMBEDDING_DIM] * len(texts)

def extract_message_pairs(conversation: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Extract question-answer pairs from conversation messages.
    Creates structured Q&A documents for precise retrieval.
    """
    messages = conversation.get("messages", [])
    pairs = []

    customer_msg = None
    for i, msg in enumerate(messages):
        if msg["role"] == "customer":
            customer_msg = msg
        elif msg["role"] == "agent" and customer_msg:
            # Create a Q&A pair
            pairs.append({
                "question": customer_msg["content"],
                "answer": msg["content"],
                "question_timestamp": customer_msg["timestamp"],
                "answer_timestamp": msg["timestamp"],
                "message_index": i // 2  # Approximate pair index
            })
            customer_msg = None  # Reset for next pair

    return pairs

def process_conversations() -> Generator[Dict[str, Any], None, None]:
    """
    Process conversations and yield documents for indexing.
    Each message pair becomes a separate document for better Q&A matching.
    """
    files = glob.glob(DATA_PATH)
    print(f"Found {len(files)} files to process.")

    doc_count = 0

    for file_path in files:
        with open(file_path, 'r') as f:
            try:
                data = json.load(f)
                conversations = data.get("conversations", [])

                for conv in conversations:
                    # Extract booking IDs from all messages
                    all_text = " ".join([m["content"] for m in conv["messages"]])
                    booking_ids = extract_booking_ids(all_text)

                    # Extract message pairs
                    message_pairs = extract_message_pairs(conv)

                    resolution_summary = conv.get("resolution_summary", "")

                    # Create a document for each Q&A pair
                    for idx, pair in enumerate(message_pairs):
                        # Combine text for embedding and BM25 search
                        combined_text = f"""
                        Issue: {conv.get('issue_type', 'Unknown')}
                        Category: {conv.get('category', '')} - {conv.get('subcategory', '')}
                        Question: {pair['question']}
                        Answer: {pair['answer']}
                        Resolution: {resolution_summary}
                        """.strip()

                        # Generate embedding
                        vector = get_embedding(combined_text)

                        doc = {
                            "_index": INDEX_NAME,
                            "_id": f"{conv['id']}_pair_{idx}",
                            "conversation_id": conv["id"],
                            "category": conv.get("category"),
                            "subcategory": conv.get("subcategory"),
                            "issue_type": conv.get("issue_type"),
                            "resolution_status": conv.get("resolution_status"),
                            "sentiment": conv.get("sentiment"),
                            "tags": conv.get("tags", []),
                            "booking_ids": booking_ids,
                            "question": pair["question"],
                            "answer": pair["answer"],
                            "resolution_summary": resolution_summary,
                            "combined_text": combined_text,
                            "vector": vector,
                            "full_conversation": json.dumps(conv["messages"]),
                            "message_index": pair["message_index"],
                            "total_messages": len(conv["messages"]),
                            "timestamp": pair["question_timestamp"]
                        }

                        doc_count += 1
                        if doc_count % 10 == 0:
                            print(f"Processed {doc_count} documents...")

                        yield doc

            except Exception as e:
                print(f"Error processing {file_path}: {e}")
                import traceback
                traceback.print_exc()

def hybrid_search_example(es, query: str, booking_id: str = None):
    """
    Example of Hybrid RRF search combining:
    1. Semantic search (dense vector)
    2. Keyword search (BM25)
    3. Exact booking ID match
    """
    if not es:
        print("No Elasticsearch client available.")
        return

    # Generate query embedding
    query_vector = get_embedding(query)

    # Build the hybrid search query
    search_body = {
        "query": {
            "bool": {
                "should": [
                    # Semantic search using kNN
                    {
                        "script_score": {
                            "query": {"match_all": {}},
                            "script": {
                                "source": "cosineSimilarity(params.query_vector, 'vector') + 1.0",
                                "params": {"query_vector": query_vector}
                            }
                        }
                    },
                    # BM25 keyword search on combined text
                    {
                        "multi_match": {
                            "query": query,
                            "fields": ["combined_text^2", "question^3", "answer", "resolution_summary"],
                            "type": "best_fields"
                        }
                    }
                ],
                "filter": []
            }
        },
        "size": 5
    }

    # Add exact booking ID filter if provided
    if booking_id:
        search_body["query"]["bool"]["filter"].append({
            "term": {"booking_ids": booking_id.upper()}
        })

    # Execute search
    response = es.search(index=INDEX_NAME, body=search_body)

    print(f"\n=== Hybrid Search Results for: '{query}' ===")
    if booking_id:
        print(f"Filtered by booking ID: {booking_id}")

    for hit in response["hits"]["hits"]:
        source = hit["_source"]
        print(f"\nScore: {hit['_score']:.2f}")
        print(f"Conversation ID: {source['conversation_id']}")
        print(f"Issue: {source['issue_type']}")
        print(f"Booking IDs: {', '.join(source['booking_ids'])}")
        print(f"Question: {source['question'][:100]}...")
        print(f"Answer: {source['answer'][:100]}...")
        print("-" * 80)

def main():
    """Main ingestion workflow."""
    print("\n" + "="*80)
    print("Starting data ingestion with LOCAL embeddings...")
    print(f"Embedding Model: {EMBEDDING_MODEL}")
    print(f"Embedding Dimension: {EMBEDDING_DIM}")
    print("="*80 + "\n")

    # Initialize ES client
    es = get_es_client()

    if not es:
        print("ERROR: Could not initialize Elasticsearch client.")
        return

    # Create index with hybrid search mappings
    create_hybrid_index(es)

    # Ingest documents
    print("\nIndexing documents with embeddings...")
    success, errors = helpers.bulk(es, process_conversations(), chunk_size=50, raise_on_error=False)
    print(f"\n✓ Indexed {success} documents")
    if errors:
        print(f"✗ Failed: {len(errors)} documents")

    # Refresh index
    es.indices.refresh(index=INDEX_NAME)

    # Show example searches
    print("\n" + "="*80)
    print("EXAMPLE HYBRID SEARCHES")
    print("="*80)

    # Example 1: Semantic query
    hybrid_search_example(es, "I was charged but didn't get my booking confirmation")

    # Example 2: Exact booking ID search
    hybrid_search_example(es, "flight booking issue", booking_id="FL234567")

    print("\n✓ Ingestion complete!")

if __name__ == "__main__":
    main()
