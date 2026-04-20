#!/usr/bin/env python3
"""
Quick test script to verify local embeddings are working correctly.
Run this before the full ingestion to check your setup.
"""

import sys
from sentence_transformers import SentenceTransformer
import torch

def test_embeddings():
    print("="*80)
    print("Testing Local Embeddings Setup")
    print("="*80)

    # Check PyTorch and CUDA
    print(f"\n✓ PyTorch version: {torch.__version__}")
    print(f"✓ CUDA available: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"✓ CUDA device: {torch.cuda.get_device_name(0)}")

    # Load model
    print(f"\nLoading model: all-MiniLM-L6-v2...")
    try:
        model = SentenceTransformer('all-MiniLM-L6-v2')
        print(f"✓ Model loaded successfully")
        print(f"✓ Embedding dimension: {model.get_sentence_embedding_dimension()}")
    except Exception as e:
        print(f"✗ Error loading model: {e}")
        sys.exit(1)

    # Test encoding
    print("\nTesting embedding generation...")
    test_texts = [
        "I tried to book a flight but the payment failed",
        "My booking confirmation email never arrived",
        "I need to cancel my hotel reservation"
    ]

    try:
        embeddings = model.encode(test_texts, show_progress_bar=False)
        print(f"✓ Generated {len(embeddings)} embeddings")
        print(f"✓ Embedding shape: {embeddings.shape}")
        print(f"✓ Sample embedding (first 5 dims): {embeddings[0][:5]}")
    except Exception as e:
        print(f"✗ Error generating embeddings: {e}")
        sys.exit(1)

    # Test similarity
    print("\nTesting semantic similarity...")
    from numpy import dot
    from numpy.linalg import norm

    def cosine_similarity(a, b):
        return dot(a, b) / (norm(a) * norm(b))

    sim1 = cosine_similarity(embeddings[0], embeddings[1])
    sim2 = cosine_similarity(embeddings[0], embeddings[2])

    print(f"✓ Similarity between text 1 & 2: {sim1:.4f}")
    print(f"✓ Similarity between text 1 & 3: {sim2:.4f}")
    print(f"✓ Texts 1 & 2 are more similar: {sim1 > sim2}")

    # Performance test
    print("\nPerformance test (100 encodings)...")
    import time

    test_batch = ["Sample text for performance testing"] * 100
    start = time.time()
    model.encode(test_batch, show_progress_bar=False)
    elapsed = time.time() - start

    print(f"✓ Encoded 100 texts in {elapsed:.2f}s")
    print(f"✓ Speed: {100/elapsed:.1f} docs/second")

    print("\n" + "="*80)
    print("✅ All tests passed! Your setup is ready.")
    print("="*80)
    print("\nYou can now run: python ingest_with_embeddings.py")

if __name__ == "__main__":
    test_embeddings()
