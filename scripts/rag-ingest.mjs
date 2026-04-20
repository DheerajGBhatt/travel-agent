#!/usr/bin/env node
/**
 * Offline ingestion: reads raw-data/batch_*.json, extracts Q&A pairs,
 * embeds via Titan v2, and writes vectors (with metadata) to S3 Vectors.
 *
 * Required env: VECTOR_BUCKET_NAME, VECTOR_INDEX_NAME, AWS_REGION
 * Optional:     EMBED_MODEL_ID (default amazon.titan-embed-text-v2:0)
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { S3VectorsClient, PutVectorsCommand } from '@aws-sdk/client-s3vectors';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RAW_DIR = join(ROOT, 'raw-data');

const VECTOR_BUCKET_NAME = process.env.VECTOR_BUCKET_NAME;
const VECTOR_INDEX_NAME = process.env.VECTOR_INDEX_NAME ?? 'historical-cases';
const EMBED_MODEL_ID = process.env.EMBED_MODEL_ID ?? 'amazon.titan-embed-text-v2:0';
const DIMENSIONS = 1024;
const PUT_BATCH = 100;

if (!VECTOR_BUCKET_NAME) {
  console.error('VECTOR_BUCKET_NAME is required');
  process.exit(1);
}

const BOOKING_ID_REGEX = /\b(?:FL|BK|HTL|CONF)\d{5,8}\b/g;

const bedrock = new BedrockRuntimeClient({});
const s3v = new S3VectorsClient({});

function extractBookingIds(text) {
  return [...new Set(text.toUpperCase().match(BOOKING_ID_REGEX) ?? [])];
}

function makePairs(messages) {
  const pairs = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const cur = messages[i];
    const next = messages[i + 1];
    if (cur.role === 'customer' && next.role === 'agent') {
      pairs.push({ question: cur.content, answer: next.content });
    }
  }
  return pairs;
}

async function embed(text) {
  const res = await bedrock.send(
    new InvokeModelCommand({
      modelId: EMBED_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({ inputText: text, dimensions: DIMENSIONS, normalize: true }),
    }),
  );
  const parsed = JSON.parse(new TextDecoder().decode(res.body));
  return parsed.embedding;
}

async function putBatch(vectors) {
  if (vectors.length === 0) return;
  await s3v.send(
    new PutVectorsCommand({
      vectorBucketName: VECTOR_BUCKET_NAME,
      indexName: VECTOR_INDEX_NAME,
      vectors,
    }),
  );
}

async function run() {
  const files = (await readdir(RAW_DIR)).filter((f) => /^batch_.*\.json$/.test(f));
  if (files.length === 0) {
    console.error('No batch_*.json files found in', RAW_DIR);
    process.exit(1);
  }

  let buffer = [];
  let totalPairs = 0;
  let totalConvs = 0;

  for (const file of files) {
    const raw = JSON.parse(await readFile(join(RAW_DIR, file), 'utf8'));
    for (const conv of raw.conversations ?? []) {
      totalConvs++;
      const messages = conv.messages ?? [];
      const fullText = messages.map((m) => m.content).join(' ');
      const convBookingIds = extractBookingIds(fullText);
      const pairs = makePairs(messages);

      for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        const pairText = `Q: ${pair.question}\nA: ${pair.answer}`;
        const pairBookingIds = extractBookingIds(pairText);
        const bookingIds = [...new Set([...convBookingIds, ...pairBookingIds])];
        const embedding = await embed(pairText);

        const key = `${conv.id}_pair_${String(i + 1).padStart(2, '0')}`;
        const metadata = {
          conversation_id: conv.id,
          category: conv.category ?? '',
          subcategory: conv.subcategory ?? '',
          issue_type: conv.issue_type ?? '',
          resolution_status: conv.resolution_status ?? '',
          sentiment: conv.sentiment ?? '',
          text: pairText.slice(0, 2000),
        };
        if (bookingIds.length > 0) metadata.booking_ids = bookingIds;
        buffer.push({ key, data: { float32: embedding }, metadata });
        totalPairs++;

        if (buffer.length >= PUT_BATCH) {
          await putBatch(buffer);
          console.log(`  flushed ${buffer.length} vectors (total ${totalPairs})`);
          buffer = [];
        }
      }
    }
  }

  await putBatch(buffer);
  console.log(`Done: ${totalPairs} pairs from ${totalConvs} conversations → ${VECTOR_BUCKET_NAME}/${VECTOR_INDEX_NAME}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
