# Travel Agency Agent — API Reference

Two surfaces:

1. **Chat WebSocket API** — client transport for the React frontend (API Gateway WebSocket).
2. **Actions HTTP API** — REST API (API Gateway HTTP API v2) fronting the action-group Lambdas (`bookings`, `flights`, `users`). The same Lambdas are also invoked internally by the Bedrock Agent during chat orchestration.

Backed by **Neon Postgres**.

---

## 1. Chat WebSocket API

**Endpoint:** `wss://{apiId}.execute-api.{region}.amazonaws.com/{EnvName}`
(Stack output `WebSocketEndpoint` → frontend `.env` as `VITE_WS_ENDPOINT`.)

**Auth:** none on `$connect` (dev). Add an API Gateway authorizer before production.
**Route selection:** `$request.body.action`
**Routes:** `$connect`, `$disconnect`, `chat`

### Client → server (`chat` route)

```json
{
  "action": "chat",
  "message": "What's the status of flight 42?",
  "sessionId": "sess-abc123"
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `action` | string | yes | must be `"chat"` |
| `message` | string | yes | 1–4000 chars |
| `sessionId` | string | no | 1–100 chars. If omitted, server generates one and returns it in the `start` frame. |

### Server → client frames

Each frame is a single JSON object sent over the socket (`frontend/src/types/chat.ts`).

| Frame | Shape | When |
|---|---|---|
| `start` | `{ "type": "start", "sessionId": "sess-..." }` | Turn begins. |
| `chunk` | `{ "type": "chunk", "text": "..." }` | Streamed as the agent generates tokens. |
| `tool_use` | `{ "type": "tool_use", "tool": "bookings-actions" }` | Bedrock invokes an action group. |
| `end` | `{ "type": "end" }` | Successful completion. |
| `error` | `{ "type": "error", "error": "message" }` | Validation or Bedrock error. No `end` follows. |

### Session behavior

- Connection state (`connectionId`, `connectedAt`) stored in `travel-{env}-ws-connections` (DynamoDB, 2h TTL).
- Each turn persisted to `travel-{env}-conversations` (30-day TTL) with redacted prompt, assembled response, and actions called.
- `userId` defaults to the WebSocket `connectionId` when not provided.

---

## 2. Actions HTTP API

**Base URL:** `https://{apiId}.execute-api.{region}.amazonaws.com/{EnvName}`
(Stack output `ActionsHttpApiEndpoint`.)

**Auth:** none (dev). Add a JWT authorizer before production.
**Content-Type:** `application/json` on all requests.

All routes return the standard envelope:

```json
{ "success": true,  "data":  { ... } }
{ "success": false, "error": { "code": "ERROR_CODE", "message": "..." } }
```

The same Lambdas also serve Bedrock Agent action-group invocations (same business logic, Bedrock event shape instead of HTTP).

### 2.1 Bookings

#### `POST /bookings/get`
| Field | Type | Required | Constraints |
|---|---|---|---|
| `bookingRef` | string | yes | `^[A-Z0-9]{6}$` |

#### `POST /bookings/cancel`
| Field | Type | Required | Constraints |
|---|---|---|---|
| `bookingId` | integer | yes | positive |
| `reason` | string | no | ≤500 chars |

#### `POST /bookings/reschedule`
| Field | Type | Required | Constraints |
|---|---|---|---|
| `bookingId` | integer | yes | positive |
| `oldSegmentId` | integer | yes | positive |
| `newFlightId` | integer | yes | positive |
| `reason` | string | no | ≤500 chars |

### 2.2 Flights

#### `POST /flights/status`
| Field | Type | Required | Constraints |
|---|---|---|---|
| `flightId` | integer | yes | positive |

#### `POST /flights/search`
| Field | Type | Required | Constraints |
|---|---|---|---|
| `origin` | string | yes | IATA (3 uppercase letters) |
| `destination` | string | yes | IATA (3 uppercase letters) |
| `afterIso` | string | yes | ISO-8601 datetime |

### 2.3 Users

#### `POST /users/profile`
| Field | Type | Required | Constraints |
|---|---|---|---|
| `userUuid` | string | yes | UUID |

---

## Error codes

| Code | Meaning |
|---|---|
| `BAD_REQUEST` | Input failed validation. |
| `NOT_FOUND` | Booking / flight / user not found. |
| `INVALID_STATE` | Operation not allowed in current state (e.g., already cancelled). |
| `VALIDATION_ERROR` | Action-group input failed schema check. |
| `UNKNOWN_PATH` | Path not handled by the Lambda. |
| `INTERNAL_ERROR` | Unhandled Lambda exception. |

## Stack outputs

| Output | Purpose |
|---|---|
| `WebSocketEndpoint` | `wss://...` — frontend `VITE_WS_ENDPOINT` |
| `ActionsHttpApiEndpoint` | HTTP API base URL for REST calls |
| `AgentId`, `AgentAliasId` | Bedrock Agent identifiers |
| `ConversationsTableName` | DynamoDB table for turn history |
| `KnowledgeBaseId` | Bedrock Knowledge Base id |

## Environment

Action-group Lambdas require:
- `DATABASE_URL` — Neon connection string, supplied at deploy time via the `NeonDatabaseUrl` CloudFormation parameter (`NoEcho`).
