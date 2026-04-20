import { S3VectorsClient, QueryVectorsCommand } from '@aws-sdk/client-s3vectors';
import { z } from 'zod';
import { logger } from '../shared/logger.js';
import { embedText } from '../shared/embeddings.js';
import {
  dispatch,
  type ApiGatewayV2HttpEvent,
  type ApiGatewayV2HttpResponse,
  type BedrockActionGroupEvent,
  type BedrockActionGroupResponse,
  type Routes,
} from '../shared/responses.js';

const VECTOR_BUCKET_NAME = process.env.VECTOR_BUCKET_NAME ?? '';
const VECTOR_INDEX_NAME = process.env.VECTOR_INDEX_NAME ?? 'historical-cases';

const RagSearchInput = z.object({
  query: z.string().min(1).max(2000),
  bookingId: z.string().max(20).optional(),
  topK: z.coerce.number().int().min(1).max(20).optional(),
});

let s3v: S3VectorsClient | null = null;
function getS3v(): S3VectorsClient {
  s3v ??= new S3VectorsClient({});
  return s3v;
}

async function ragSearch(params: Record<string, string>) {
  const { query, bookingId, topK } = RagSearchInput.parse(params);
  const vector = await embedText(query);

  const filter = bookingId
    ? { booking_ids: { $in: [bookingId.toUpperCase()] } }
    : undefined;

  const res = await getS3v().send(
    new QueryVectorsCommand({
      vectorBucketName: VECTOR_BUCKET_NAME,
      indexName: VECTOR_INDEX_NAME,
      queryVector: { float32: vector },
      topK: topK ?? 5,
      returnMetadata: true,
      returnDistance: true,
      filter,
    }),
  );

  const results = (res.vectors ?? []).map((v) => ({
    key: v.key,
    distance: v.distance,
    text: (v.metadata as Record<string, unknown> | undefined)?.text ?? '',
    metadata: v.metadata,
  }));

  return { statusCode: 200, body: { success: true, data: { results: JSON.stringify(results) } } };
}

const routes: Routes = {
  '/rag/search': ragSearch,
};

export const handler = async (
  event: BedrockActionGroupEvent | ApiGatewayV2HttpEvent,
): Promise<BedrockActionGroupResponse | ApiGatewayV2HttpResponse> => {
  logger.info('rag-retrieval invoked');
  return dispatch(event, routes);
};
