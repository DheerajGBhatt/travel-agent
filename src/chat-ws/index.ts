import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  GoneException,
} from '@aws-sdk/client-apigatewaymanagementapi';
import {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import { logger } from '../shared/logger.js';

const AGENT_ID = process.env.BEDROCK_AGENT_ID ?? '';
const AGENT_ALIAS_ID = process.env.BEDROCK_AGENT_ALIAS_ID ?? '';
const REGION = process.env.AWS_REGION ?? 'us-east-1';
const CONVERSATIONS_TABLE = process.env.CONVERSATIONS_TABLE ?? 'conversations';
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE ?? 'ws-connections';

const bedrock = new BedrockAgentRuntimeClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

const ChatPayloadSchema = z.object({
  action: z.literal('chat'),
  message: z.string().min(1).max(4000),
  sessionId: z.string().min(1).max(100).optional(),
  userId: z.string().min(1).max(50),
});

interface WsEvent {
  requestContext: {
    routeKey: string;
    connectionId: string;
    domainName: string;
    stage: string;
  };
  body?: string;
}

type WsOutbound =
  | { type: 'start'; sessionId: string }
  | { type: 'chunk'; text: string }
  | { type: 'tool_use'; tool: string }
  | { type: 'end' }
  | { type: 'error'; error: string };

function newSessionId(): string {
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function makeManagementClient(event: WsEvent): ApiGatewayManagementApiClient {
  const endpoint = `https://${event.requestContext.domainName}/${event.requestContext.stage}`;
  return new ApiGatewayManagementApiClient({ region: REGION, endpoint });
}

async function post(
  client: ApiGatewayManagementApiClient,
  connectionId: string,
  payload: WsOutbound,
): Promise<void> {
  try {
    await client.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(JSON.stringify(payload)),
      }),
    );
  } catch (error) {
    if (error instanceof GoneException) {
      logger.info('Connection gone, removing', { connectionId });
      await ddb.send(new DeleteCommand({ TableName: CONNECTIONS_TABLE, Key: { connectionId } }));
      return;
    }
    throw error;
  }
}

async function handleConnect(event: WsEvent): Promise<{ statusCode: number }> {
  await ddb.send(
    new PutCommand({
      TableName: CONNECTIONS_TABLE,
      Item: {
        connectionId: event.requestContext.connectionId,
        connectedAt: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + 60 * 60 * 2,
      },
    }),
  );
  return { statusCode: 200 };
}

async function handleDisconnect(event: WsEvent): Promise<{ statusCode: number }> {
  await ddb.send(
    new DeleteCommand({
      TableName: CONNECTIONS_TABLE,
      Key: { connectionId: event.requestContext.connectionId },
    }),
  );
  return { statusCode: 200 };
}

async function persistTurn(args: {
  sessionId: string;
  userId: string;
  prompt: string;
  response: string;
  actionsCalled: string[];
}): Promise<void> {
  try {
    await ddb.send(
      new PutCommand({
        TableName: CONVERSATIONS_TABLE,
        Item: {
          sessionId: args.sessionId,
          turnTimestamp: new Date().toISOString(),
          userId: args.userId,
          redactedPrompt: args.prompt,
          agentResponse: args.response,
          actionsCalled: args.actionsCalled,
          ttl: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
        },
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to persist turn', { error: message, sessionId: args.sessionId });
  }
}

async function handleChat(event: WsEvent): Promise<{ statusCode: number }> {
  const connectionId = event.requestContext.connectionId;
  const client = makeManagementClient(event);

  let parsed: z.infer<typeof ChatPayloadSchema>;
  try {
    const raw = event.body ? JSON.parse(event.body) : {};
    parsed = ChatPayloadSchema.parse(raw);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Bad request';
    await post(client, connectionId, { type: 'error', error: msg });
    return { statusCode: 400 };
  }

  const sessionId = parsed.sessionId ?? newSessionId();
  const userId = parsed.userId;
  logger.appendKeys({ sessionId, connectionId });

  await post(client, connectionId, { type: 'start', sessionId });

  let assembled = '';
  const actionsCalled: string[] = [];

  try {
    const response = await bedrock.send(
      new InvokeAgentCommand({
        agentId: AGENT_ID,
        agentAliasId: AGENT_ALIAS_ID,
        sessionId,
        inputText: parsed.message,
        enableTrace: true,
        sessionState: {
          sessionAttributes: { userId },
        },
      }),
    );
    if (!response.completion) {
      throw new Error('No completion stream returned');
    }
    for await (const chunk of response.completion) {
      if (chunk.chunk?.bytes) {
        const text = Buffer.from(chunk.chunk.bytes).toString('utf8');
        assembled += text;
        await post(client, connectionId, { type: 'chunk', text });
      }
      const ag =
        chunk.trace?.trace?.orchestrationTrace?.invocationInput?.actionGroupInvocationInput;
      if (ag?.actionGroupName) {
        actionsCalled.push(ag.actionGroupName);
        await post(client, connectionId, { type: 'tool_use', tool: ag.actionGroupName });
      }
    }
    await post(client, connectionId, { type: 'end' });
  } catch (error) {
    console.log(error, 'error');
    const errMsg = error instanceof Error ? error.message : 'Agent invocation failed';
    logger.error('Bedrock agent error', { error: errMsg });
    await post(client, connectionId, { type: 'error', error: errMsg });
    return { statusCode: 500 };
  }

  await persistTurn({ sessionId, userId, prompt: parsed.message, response: assembled, actionsCalled });
  return { statusCode: 200 };
}

export const handler = async (event: WsEvent): Promise<{ statusCode: number }> => {
  const route = event.requestContext.routeKey;
  logger.info('WS event', { route, connectionId: event.requestContext.connectionId });
  switch (route) {
    case '$connect':
      return handleConnect(event);
    case '$disconnect':
      return handleDisconnect(event);
    case 'chat':
      return handleChat(event);
    default:
      return { statusCode: 400 };
  }
};
