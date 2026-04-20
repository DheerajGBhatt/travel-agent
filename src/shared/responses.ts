export interface SuccessResponse<T> {
  success: true;
  data: T;
}

export interface ErrorResponse {
  success: false;
  error: { code: string; message: string };
}

export function ok<T>(data: T): SuccessResponse<T> {
  return { success: true, data };
}

export function err(code: string, message: string): ErrorResponse {
  return { success: false, error: { code, message } };
}

export interface BedrockActionGroupEvent {
  messageVersion: string;
  agent: { name: string; id: string; alias: string; version: string };
  inputText: string;
  sessionId: string;
  actionGroup: string;
  apiPath: string;
  httpMethod: string;
  parameters?: Array<{ name: string; type: string; value: string }>;
  requestBody?: {
    content?: {
      'application/json'?: {
        properties: Array<{ name: string; type: string; value: string }>;
      };
    };
  };
  sessionAttributes?: Record<string, string>;
}

export interface BedrockActionGroupResponse {
  messageVersion: string;
  response: {
    actionGroup: string;
    apiPath: string;
    httpMethod: string;
    httpStatusCode: number;
    responseBody: { 'application/json': { body: string } };
  };
}

export function bedrockResponse(
  event: BedrockActionGroupEvent,
  statusCode: number,
  body: unknown,
): BedrockActionGroupResponse {
  return {
    messageVersion: event.messageVersion,
    response: {
      actionGroup: event.actionGroup,
      apiPath: event.apiPath,
      httpMethod: event.httpMethod,
      httpStatusCode: statusCode,
      responseBody: { 'application/json': { body: JSON.stringify(body) } },
    },
  };
}

export function extractParams(
  event: BedrockActionGroupEvent,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(event.sessionAttributes ?? {})) out[k] = v;
  for (const p of event.parameters ?? []) out[p.name] = p.value;
  for (const p of event.requestBody?.content?.['application/json']?.properties ?? []) {
    out[p.name] = p.value;
  }
  return out;
}

export interface ApiGatewayV2HttpEvent {
  version: '2.0';
  routeKey: string;
  rawPath: string;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: {
    http: { method: string; path: string };
  };
}

export interface ApiGatewayV2HttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export function isBedrockEvent(
  event: unknown,
): event is BedrockActionGroupEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    'messageVersion' in event &&
    'apiPath' in event
  );
}

export type RouteHandler = (
  params: Record<string, string>,
) => Promise<{ statusCode: number; body: unknown }>;

export type Routes = Record<string, RouteHandler>;

export async function dispatch(
  event: BedrockActionGroupEvent | ApiGatewayV2HttpEvent,
  routes: Routes,
): Promise<BedrockActionGroupResponse | ApiGatewayV2HttpResponse> {
  if (isBedrockEvent(event)) {
    const params = extractParams(event);
    try {
      const route = routes[event.apiPath];
      const result = route
        ? await route(params)
        : { statusCode: 404, body: err('UNKNOWN_PATH', event.apiPath) };
      return bedrockResponse(event, result.statusCode, result.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return bedrockResponse(event, 400, err('BAD_REQUEST', message));
    }
  }

  const path = event.requestContext.http.path;
  try {
    const parsed: unknown = event.body
      ? JSON.parse(
          event.isBase64Encoded
            ? Buffer.from(event.body, 'base64').toString('utf-8')
            : event.body,
        )
      : {};
    const params =
      parsed && typeof parsed === 'object'
        ? (Object.fromEntries(
            Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [
              k,
              typeof v === 'string' ? v : String(v),
            ]),
          ) as Record<string, string>)
        : {};
    const route = routes[path];
    const result = route
      ? await route(params)
      : { statusCode: 404, body: err('UNKNOWN_PATH', path) };
    return {
      statusCode: result.statusCode,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(result.body),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      statusCode: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(err('BAD_REQUEST', message)),
    };
  }
}
