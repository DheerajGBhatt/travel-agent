# Travel Support Data Ingestion - Hybrid RRF Search

Ingest travel support conversations into Elasticsearch with **Hybrid RRF search** (semantic + keyword) using **local embeddings** (no API keys needed).

## 🚀 Quick Start

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

On first run, the embedding model (~80MB) will download automatically.

### 2. Test Setup (Optional)
```bash
python test_embeddings.py
```

Expected output:
```
✓ Model loaded successfully
✓ Embedding dimension: 384
✓ Generated 3 embeddings
✅ All tests passed!
```

### 3. Set Elasticsearch Credentials
```bash
export ELASTIC_API_KEY="your-api-key"
```

Or edit the script directly:
```python
ELASTIC_API_KEY = "your-api-key"
```

### 4. Run Ingestion
```bash
python ingest_with_embeddings.py
```

This will:
- Load local embedding model (all-MiniLM-L6-v2)
- Create hybrid search index
- Process all `batch_*.json` files
- Extract Q&A pairs with embeddings
- Index into Elasticsearch

Expected output:
```
Loading embedding model: all-MiniLM-L6-v2...
✓ Model loaded. Embedding dimension: 384

Created hybrid index: travel-support-hybrid-qa
Found 10 files to process.
✓ Indexed 247 documents

=== Hybrid Search Results ===
```

## 🎯 Features

### ✅ Hybrid RRF Search
- **Semantic Search**: Dense vectors (384-dim) using local model
- **Keyword Search**: BM25 full-text search
- **Exact Match**: Booking ID filtering (FL234567, BK445678, etc.)

### ✅ Message-Pair Structure
Each conversation → Multiple Q&A documents:
```json
{
  "question": "Customer's question",
  "answer": "Agent's response",
  "resolution_summary": "Issue resolution",
  "booking_ids": ["FL234567"],
  "vector": [0.123, -0.456, ...],
  "combined_text": "Full context for search"
}
```

### ✅ Local Embeddings (No API Keys!)
- Uses `sentence-transformers` library
- Runs on CPU or GPU
- Free and private
- Works offline after initial download

## 📁 Files

| File | Purpose |
|------|---------|
| `ingest_with_embeddings.py` | Main ingestion script |
| `test_embeddings.py` | Test your setup before running |
| `requirements.txt` | Python dependencies |
| `HYBRID_SEARCH_GUIDE.md` | Detailed usage guide |
| `LOCAL_EMBEDDINGS_GUIDE.md` | Embedding models & performance |

## ⚙️ Configuration

Edit `ingest_with_embeddings.py`:

### Change Embedding Model
```python
# Default: Fast and good quality
EMBEDDING_MODEL = "all-MiniLM-L6-v2"
EMBEDDING_DIM = 384

# Better quality (slower)
EMBEDDING_MODEL = "all-mpnet-base-v2"
EMBEDDING_DIM = 768

# Multilingual support
EMBEDDING_MODEL = "paraphrase-multilingual-MiniLM-L12-v2"
EMBEDDING_DIM = 384
```

### Change Index Name
```python
INDEX_NAME = "travel-support-hybrid-qa"
```

### Change Data Path
```python
DATA_PATH = "batch_*.json"  # Glob pattern
```

## 🔍 Search Examples

The script includes example searches demonstrating:

1. **Semantic Query**: "I was charged but didn't receive confirmation"
2. **Booking ID Filter**: Search for specific booking "FL234567"
3. **Combined**: Natural language + exact match

## 📊 Model Comparison

| Model | Dimensions | Speed | Quality | Size |
|-------|-----------|-------|---------|------|
| all-MiniLM-L6-v2 (default) | 384 | ⚡⚡⚡ | ⭐⭐⭐ | 80MB |
| all-mpnet-base-v2 | 768 | ⚡⚡ | ⭐⭐⭐⭐ | 420MB |
| paraphrase-multilingual | 384 | ⚡⚡ | ⭐⭐⭐ | 420MB |

See `LOCAL_EMBEDDINGS_GUIDE.md` for details.

## 🐛 Troubleshooting

### Model download fails
```bash
# Check internet connection, model downloads from Hugging Face
# Cached in: ~/.cache/torch/sentence_transformers/
```

### Out of memory
```python
# Use smaller model
EMBEDDING_MODEL = "all-MiniLM-L6-v2"
```

### Slow processing
```bash
# Use GPU acceleration (if available)
pip install torch --index-url https://download.pytorch.org/whl/cu118
```

### Elasticsearch connection fails
```bash
# Check API key
export ELASTIC_API_KEY="your-key"

# Test connection
curl -X GET "YOUR_ENDPOINT/_cluster/health" \
  -H "Authorization: ApiKey YOUR_API_KEY"
```

## 📚 Documentation

- `HYBRID_SEARCH_GUIDE.md` - Complete usage guide with query examples
- `LOCAL_EMBEDDINGS_GUIDE.md` - Model options, GPU setup, performance tuning

## 🎓 How It Works

1. **Load Model**: Downloads sentence-transformer model (~80MB)
2. **Process Files**: Reads all `batch_*.json` files
3. **Extract Pairs**: Splits conversations into Q&A pairs
4. **Generate Embeddings**: Creates 384-dim vectors for each pair
5. **Extract IDs**: Finds booking references (FL123456, etc.)
6. **Index**: Bulk inserts into Elasticsearch with vector + text
7. **Search**: Combines semantic (vector) + keyword (BM25) + exact match

## ⚡ Performance

- **CPU**: ~50-100 docs/second
- **GPU**: ~200-500 docs/second
- **Batch size**: 32 (configurable)
- **Memory**: ~2GB RAM for default model

## 🔐 Privacy & Security

✅ All processing happens locally
✅ No data sent to external APIs
✅ No API keys required for embeddings
✅ Models cached locally after download

## 📝 License

See parent project for license information.

## 🤝 Contributing

For issues or improvements, see the main repository.

---

**Ready to go?**
```bash
python test_embeddings.py    # Verify setup
python ingest_with_embeddings.py  # Run ingestion
```
