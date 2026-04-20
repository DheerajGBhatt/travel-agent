# Hybrid RRF Search with Message-Pair Ingestion

## Overview

This script implements **Hybrid Search with Reciprocal Rank Fusion (RRF)** for Elasticsearch, combining:

1. **Semantic Search** - Dense vector embeddings (Local `sentence-transformers` models)
2. **Keyword Search** - BM25 full-text search
3. **Exact Match** - Booking ID lookups using keyword fields

**No API keys required!** All embeddings are generated locally.

The data structure uses **Message-Pair + Summary** format for precise Q&A retrieval.

## Features

### 1. Hybrid RRF Search
- **Dense Vector Search**: Semantic similarity using cosine similarity on 384-dim embeddings (default)
- **BM25 Keyword Search**: Full-text search on questions, answers, and summaries
- **Booking ID Exact Match**: Filter by exact booking references (FL234567, BK445678, etc.)
- **Combined Scoring**: Script score combines semantic and keyword relevance
- **Local Models**: Uses sentence-transformers (no API keys needed)

### 2. Message-Pair Structure
Each conversation is split into Q&A pairs:
```json
{
  "conversation_id": "conv_flight_001",
  "question": "Hi, I tried booking a flight but payment failed...",
  "answer": "I'm sorry to hear about this issue. Let me check...",
  "resolution_summary": "Payment hold released, rebooking successful",
  "booking_ids": ["FL234567", "FL987234"],
  "vector": [0.123, -0.456, ...],
  "combined_text": "Issue: payment_failed ... Question: ... Answer: ..."
}
```

### 3. Booking ID Extraction
Automatically extracts booking references from conversations:
- Pattern matching: `FL123456`, `BK445678`, `HTL789012`
- Context patterns: "Booking ref: XXXXX", "Confirmation: XXXXX"
- Normalized to uppercase for exact matching

## Setup

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Configure Environment Variables
```bash
export ELASTIC_API_KEY="your-elastic-api-key"
# No OpenAI key needed - uses local embeddings!
```

### 3. Update Configuration (if needed)
Edit `ingest_with_embeddings.py`:
```python
ELASTIC_ENDPOINT = "https://your-cluster.es.region.aws.elastic.cloud:443"
INDEX_NAME = "travel-support-hybrid-qa"
EMBEDDING_MODEL = "all-MiniLM-L6-v2"  # Local model
EMBEDDING_DIM = 384
```

## Usage

### Run Ingestion
```bash
python ingest_with_embeddings.py
```

This will:
1. Create/recreate the hybrid index with proper mappings
2. Process all `batch_*.json` files
3. Extract message pairs from conversations
4. Generate embeddings for each pair
5. Index documents with vector + text fields
6. Run example searches to verify

### Output
```
Loading embedding model: all-MiniLM-L6-v2...
✓ Model loaded. Embedding dimension: 384

Starting data ingestion with LOCAL embeddings...
Deleting existing index: travel-support-hybrid-qa
Created hybrid index: travel-support-hybrid-qa

Indexing documents with embeddings...
Processed 10 documents...
Processed 20 documents...
...
✓ Indexed 247 documents

=== EXAMPLE HYBRID SEARCHES ===
...
```

## Index Schema

### Key Fields

| Field | Type | Purpose |
|-------|------|---------|
| `vector` | `dense_vector` | 384-dim semantic embeddings (local model) |
| `combined_text` | `text` | BM25 keyword search (English analyzer) |
| `question` | `text` | Customer question with keyword subfield |
| `answer` | `text` | Agent response |
| `booking_ids` | `keyword` | Exact match booking references |
| `resolution_summary` | `text` | Issue resolution description |
| `issue_type` | `keyword` | Structured issue classification |
| `category` / `subcategory` | `keyword` | Filtering fields |

## Query Examples

### 1. Semantic Search (Natural Language)
```python
query = "I was charged but didn't receive confirmation"
# Matches similar issues even with different wording
```

### 2. Exact Booking ID
```python
query = "flight booking issue"
booking_id = "FL234567"
# Filters to specific booking reference
```

### 3. Hybrid Query (in Elasticsearch)
```json
{
  "query": {
    "bool": {
      "should": [
        {
          "script_score": {
            "query": {"match_all": {}},
            "script": {
              "source": "cosineSimilarity(params.query_vector, 'vector') + 1.0",
              "params": {"query_vector": [0.123, ...]}
            }
          }
        },
        {
          "multi_match": {
            "query": "payment failed",
            "fields": ["combined_text^2", "question^3", "answer", "resolution_summary"]
          }
        }
      ],
      "filter": [
        {"term": {"booking_ids": "FL234567"}}
      ]
    }
  }
}
```

## Advantages

### Message-Pair Structure
✓ **Precise Q&A Matching**: Each customer question is paired with the exact agent answer
✓ **Better Context**: Questions and answers are indexed separately for targeted search
✓ **Resolution Included**: Summary provides quick overview of the solution
✓ **Scalable**: Multiple pairs per conversation enable granular retrieval

### Hybrid RRF Approach
✓ **Semantic Understanding**: Finds conceptually similar issues even with different wording
✓ **Exact Match**: Quickly retrieves specific booking references
✓ **Keyword Fallback**: BM25 ensures important terms are matched
✓ **Combined Ranking**: Script score merges semantic + keyword relevance

### Booking ID Extraction
✓ **Automatic Extraction**: No manual annotation needed
✓ **Pattern Flexibility**: Handles various booking ID formats
✓ **Case Insensitive**: Normalized for reliable matching
✓ **Multi-reference Support**: Captures all booking IDs in a conversation

## Customization

### Change Embedding Model
```python
# Better quality (slower, larger)
EMBEDDING_MODEL = "all-mpnet-base-v2"  # 768 dimensions
EMBEDDING_DIM = 768

# Multilingual support
EMBEDDING_MODEL = "paraphrase-multilingual-MiniLM-L12-v2"
EMBEDDING_DIM = 384

# See LOCAL_EMBEDDINGS_GUIDE.md for more options
```

### Adjust Field Boosting
```python
"fields": [
    "combined_text^2",  # Boost combined text 2x
    "question^3",       # Boost questions 3x
    "answer",           # Default boost
    "resolution_summary"
]
```

### Add More Booking ID Patterns
```python
patterns = [
    r'\b(FL|BK|HTL|CONF)\d{5,8}\b',
    r'PNR:\s*([A-Z0-9]{6})',  # Add PNR format
    # Add more patterns...
]
```

## Troubleshooting

### No embeddings generated / Model fails to load
- Check internet connection (first-time download)
- Model caches in `~/.cache/torch/sentence_transformers/`
- Try: `pip install --upgrade sentence-transformers torch`
- Script falls back to zero vectors if model fails

### Booking IDs not extracted
- Check regex patterns in `extract_booking_ids()`
- Verify booking ID formats in your data
- Add custom patterns as needed

### Poor search results
- Adjust field boosting in hybrid query
- Tune vector similarity threshold
- Check analyzer settings (English vs. standard)

## Performance Tips

1. **Batch Processing**: Script processes 50 docs per bulk request
2. **Embedding Caching**: Consider caching embeddings for identical texts
3. **Index Shards**: Adjust `number_of_shards` based on data size
4. **Async Embeddings**: Use async OpenAI client for faster processing

## Next Steps

1. **Implement RRF Function**: Use Elasticsearch's native RRF (ES 8.9+)
2. **Add Reranking**: Cross-encoder for final ranking
3. **Fine-tune Embeddings**: Domain-specific embedding model
4. **A/B Testing**: Compare hybrid vs. pure semantic search
