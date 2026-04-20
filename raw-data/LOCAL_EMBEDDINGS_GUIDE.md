# Local Embeddings Setup Guide

## Overview

The script now uses **local embedding models** via `sentence-transformers` library. No API keys required!

## Available Models

### 1. all-MiniLM-L6-v2 (Default)
- **Dimension**: 384
- **Speed**: ⚡⚡⚡ Very Fast
- **Quality**: ⭐⭐⭐ Good
- **Size**: ~80MB
- **Best for**: Fast processing, large datasets, good balance

```python
EMBEDDING_MODEL = "all-MiniLM-L6-v2"
EMBEDDING_DIM = 384
```

### 2. all-mpnet-base-v2
- **Dimension**: 768
- **Speed**: ⚡⚡ Medium
- **Quality**: ⭐⭐⭐⭐ Excellent
- **Size**: ~420MB
- **Best for**: Better semantic understanding, higher quality results

```python
EMBEDDING_MODEL = "all-mpnet-base-v2"
EMBEDDING_DIM = 768
```

### 3. paraphrase-multilingual-MiniLM-L12-v2
- **Dimension**: 384
- **Speed**: ⚡⚡ Medium
- **Quality**: ⭐⭐⭐ Good
- **Size**: ~420MB
- **Best for**: Multilingual support (50+ languages)

```python
EMBEDDING_MODEL = "paraphrase-multilingual-MiniLM-L12-v2"
EMBEDDING_DIM = 384
```

### 4. all-distilroberta-v1
- **Dimension**: 768
- **Speed**: ⚡ Slower
- **Quality**: ⭐⭐⭐⭐ Excellent
- **Size**: ~290MB
- **Best for**: High-quality semantic search

```python
EMBEDDING_MODEL = "all-distilroberta-v1"
EMBEDDING_DIM = 768
```

## Setup

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

This will install:
- `sentence-transformers` - For local embeddings
- `torch` - Required by sentence-transformers
- `elasticsearch` - For indexing
- `numpy` - For array operations

### 2. First Run (Downloads Model)

```bash
python ingest_with_embeddings.py
```

On first run, the model will be automatically downloaded:
```
Loading embedding model: all-MiniLM-L6-v2...
Downloading: 100%|████████████| 80.0M/80.0M
✓ Model loaded. Embedding dimension: 384
```

Models are cached in `~/.cache/torch/sentence_transformers/`

### 3. Change Model (Optional)

Edit `ingest_with_embeddings.py`:

```python
# For better quality (slower)
EMBEDDING_MODEL = "all-mpnet-base-v2"
EMBEDDING_DIM = 768

# For multilingual support
EMBEDDING_MODEL = "paraphrase-multilingual-MiniLM-L12-v2"
EMBEDDING_DIM = 384
```

**Important**: Must update BOTH `EMBEDDING_MODEL` and `EMBEDDING_DIM`

## Performance Comparison

| Model | Dims | Speed (docs/sec)* | Quality Score | Size |
|-------|------|-------------------|---------------|------|
| all-MiniLM-L6-v2 | 384 | ~500 | 0.68 | 80MB |
| all-mpnet-base-v2 | 768 | ~200 | 0.71 | 420MB |
| paraphrase-multilingual | 384 | ~200 | 0.65 | 420MB |
| all-distilroberta-v1 | 768 | ~150 | 0.72 | 290MB |

*Approximate, depends on hardware

## Advantages of Local Embeddings

✅ **No API Keys**: No external dependencies or rate limits
✅ **Privacy**: Data never leaves your machine
✅ **Cost**: Completely free, no per-request charges
✅ **Offline**: Works without internet connection (after initial download)
✅ **Fast**: GPU acceleration supported (if available)
✅ **Consistent**: Same embeddings every time

## Hardware Requirements

### CPU Only (Minimum)
- RAM: 2GB+ for MiniLM, 4GB+ for larger models
- Speed: 50-100 docs/sec on modern CPU

### GPU (Recommended)
- VRAM: 2GB+
- Speed: 200-500+ docs/sec with CUDA
- To enable GPU: `pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118`

## GPU Acceleration

### Check GPU Availability
```python
import torch
print(f"CUDA available: {torch.cuda.is_available()}")
print(f"Device: {torch.device('cuda' if torch.cuda.is_available() else 'cpu')}")
```

### Force GPU Usage
```python
embedding_model = SentenceTransformer(EMBEDDING_MODEL, device='cuda')
```

### Force CPU Usage
```python
embedding_model = SentenceTransformer(EMBEDDING_MODEL, device='cpu')
```

## Batch Processing

For faster processing, encode in batches:

```python
def get_embeddings_batch(texts: List[str]) -> List[List[float]]:
    """Generate embeddings for multiple texts at once."""
    embeddings = embedding_model.encode(
        texts,
        batch_size=32,
        show_progress_bar=True,
        convert_to_tensor=False
    )
    return embeddings.tolist()
```

## Troubleshooting

### Issue: Model download fails
**Solution**: Check internet connection, try different mirror:
```python
os.environ['TORCH_HOME'] = '/path/to/cache'
```

### Issue: Out of memory
**Solution**: Use smaller model or reduce batch size:
```python
EMBEDDING_MODEL = "all-MiniLM-L6-v2"  # Smaller model
```

### Issue: Slow processing
**Solution**:
1. Use GPU if available
2. Switch to faster model (MiniLM)
3. Increase batch size
4. Pre-compute embeddings offline

### Issue: Poor search quality
**Solution**:
1. Try larger model (mpnet, distilroberta)
2. Tune BM25 vs semantic weights
3. Check if data is in English (use multilingual model if not)

## Migration from OpenAI

If you previously used OpenAI embeddings:

### Dimension Changes
- OpenAI `text-embedding-3-small`: 1536 dims
- Local `all-MiniLM-L6-v2`: 384 dims
- Local `all-mpnet-base-v2`: 768 dims

### Re-indexing Required
You must re-index all documents when changing embedding models:

```bash
# Script automatically deletes and recreates index
python ingest_with_embeddings.py
```

### Quality Comparison
- OpenAI models are generally higher quality
- Local models are 80-90% as effective for most use cases
- Local models are much faster and free

## Recommended Configuration

### For Production (Quality Priority)
```python
EMBEDDING_MODEL = "all-mpnet-base-v2"
EMBEDDING_DIM = 768
```

### For Development (Speed Priority)
```python
EMBEDDING_MODEL = "all-MiniLM-L6-v2"
EMBEDDING_DIM = 384
```

### For Multilingual
```python
EMBEDDING_MODEL = "paraphrase-multilingual-MiniLM-L12-v2"
EMBEDDING_DIM = 384
```

## Example Output

```bash
$ python ingest_with_embeddings.py

Loading embedding model: all-MiniLM-L6-v2...
✓ Model loaded. Embedding dimension: 384

================================================================================
Starting data ingestion with LOCAL embeddings...
Embedding Model: all-MiniLM-L6-v2
Embedding Dimension: 384
================================================================================

Deleting existing index: travel-support-hybrid-qa
Created hybrid index: travel-support-hybrid-qa

Indexing documents with embeddings...
Found 10 files to process.
Processed 10 documents...
Processed 20 documents...
...
✓ Indexed 247 documents

=== Hybrid Search Results ===
```

## Next Steps

1. ✅ Install dependencies
2. ✅ Run script (model downloads automatically)
3. ✅ Verify search results
4. 🔄 (Optional) Try different models for quality/speed trade-offs
5. 🚀 Integrate with your application
