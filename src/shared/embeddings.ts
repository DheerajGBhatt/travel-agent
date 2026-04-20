import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const EMBED_MODEL_ID = process.env.EMBED_MODEL_ID ?? 'amazon.titan-embed-text-v2:0';
const DIMENSIONS = 1024;

let client: BedrockRuntimeClient | null = null;
function getClient(): BedrockRuntimeClient {
  client ??= new BedrockRuntimeClient({});
  return client;
}

export async function embedText(text: string): Promise<number[]> {
  const body = JSON.stringify({
    inputText: text,
    dimensions: DIMENSIONS,
    normalize: true,
  });
  const res = await getClient().send(
    new InvokeModelCommand({
      modelId: EMBED_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body,
    }),
  );
  const parsed = JSON.parse(new TextDecoder().decode(res.body)) as { embedding: number[] };
  return parsed.embedding;
}
