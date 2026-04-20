# Travel Agency Agent — Backend Design Spec

**Date:** 2026-04-13
**Status:** Draft for implementation
**Source PRD:** `prd.md` (Secure Serverless Travel AI Assistant v2)

---

## 1. Goals

Deploy a serverless GenAI travel agent that:
- Automates multi-leg flight rescheduling and cancellations.
- Enforces zero PII leakage via Bedrock Guardrails (bidirectional).
- Retrieves policy/historical context via S3 Vectors RAG.
- Mutates booking state in RDS PostgreSQL via Bedrock Agent action groups.
- Streams responses to a React portal with sub-second time-to-first-token.

POC scope only. **Out of scope:** auth, multi-region, payment integration, real airline APIs, WAF, CMK encryption, secret rotation.

---

## 2. High-level Topology

```
React Portal
    │ (HTTPS, streaming)
    ▼
Lambda Function URL (chat-api)  ──► Bedrock Agent (streaming InvokeAgent)
    │                                   │
    │                                   ├─► Guardrail (in/out PII redaction)
    │                                   ├─► Knowledge Base (S3 Vectors) ── S3 (historical JSON)
    │                                   └─► Action Group Lambdas
    │                                            │
    │                                            ▼
    │                                      RDS Proxy ──► RDS PostgreSQL
    ▼
DynamoDB (conversation history + agent traces, keyed by sessionId)
```

Single AWS account, single region. Anonymous `userId` (uuid) issued by frontend on first visit, persisted in localStorage, sent with every request.

---

## 3. Components

### 3.1 `chat-api` Lambda (Function URL, response streaming)
- Receives `{ sessionId, userId, message }`.
- Calls `BedrockAgentRuntimeClient.invokeAgent({ agentId, agentAliasId, sessionId, inputText, enableTrace: true })`.
- Streams `chunk.bytes` to client via `awslambda.streamifyResponse`.
- After stream ends, async-writes the turn (redacted prompt, response, trace summary) to DynamoDB.
- Function URL config: `AuthType: NONE`, `InvokeMode: RESPONSE_STREAM`. Public URL is an accepted POC risk.

### 3.2 Bedrock Agent (managed)
- Foundation model: Anthropic Claude Sonnet 4.x via Bedrock.
- Guardrail attached at the agent level (covers input + output per PRD §3.1).
- PII filter categories: `NAME`, `EMAIL`, `US_SSN`, `US_PASSPORT_NUMBER`, `CREDIT_DEBIT_CARD_NUMBER`, `US_BANK_ACCOUNT_NUMBER`.
- Custom regex: booking reference `^[A-Z0-9]{6}$` (PNR pattern).
- Inbound action: `ANONYMIZE`. Outbound action: `ANONYMIZE` (block on hard-fail categories).
- Knowledge Base associated for RAG.
- Action groups declared with OpenAPI 3 schemas.

### 3.3 Knowledge Base (S3 Vectors)
- Data source: `s3://travel-kb-{env}/historical-cases/*.json`.
- Embeddings: Titan Text Embeddings v2.
- Vector store: Amazon S3 Vectors index.
- Sync: on-demand `StartIngestionJob` for POC; EventBridge S3-event trigger optional later.

### 3.4 Action Group Lambdas
One Lambda per logical group; Middy + Powertools Logger + Zod; structured `{ success, data | error }` responses.

| Group | Operations |
|---|---|
| `bookings-actions` | `getBooking`, `cancelBooking`, `rescheduleBooking` |
| `flights-actions` | `getFlightStatus`, `searchAlternateFlights` |
| `users-actions`   | `getUserProfile` |

All connect to RDS via **RDS Proxy** with IAM auth (no DB password in Lambda env).

### 3.5 Conversation store — DynamoDB `conversations` table
- PK: `sessionId` (S). SK: `turnTimestamp` (S, ISO8601).
- Attributes: `userId`, `redactedPrompt`, `agentResponse`, `traceSummary`, `actionsCalled` (list).
- TTL: 30 days.
- GSI: `userId-turnTimestamp-index` for per-user history lookups.

### 3.6 RDS PostgreSQL
- `db.t4g.medium`, single-AZ for POC, 7-day PITR.
- RDS Proxy in front; IAM auth; admin secret in Secrets Manager (no rotation for POC).
- Schema in §5 below.

---

## 4. Request Data Flow

Example: *"Cancel booking ABC123, my email is x@y.com"*

1. React POSTs `{sessionId, userId, message}` to Lambda Function URL.
2. `chat-api` calls `InvokeAgent` (streaming, `enableTrace=true`).
3. Guardrail (inbound) redacts → `"Cancel booking [BOOKING_REF], my email is [EMAIL]"`.
4. Claude Sonnet 4.x reasons → needs policy → queries KB.
5. KB returns top-k chunks from S3 Vectors.
6. Model calls `bookings-actions.getBooking({bookingRef})`.
7. Action Lambda → RDS Proxy → `SELECT ... WHERE booking_ref = $1`.
8. Model calls `cancelBooking({bookingId})`:
   ```sql
   BEGIN;
     UPDATE bookings SET booking_status='cancelled', updated_at=NOW()
       WHERE booking_id=$1 RETURNING *;
     INSERT INTO cancellations(booking_id, cancelled_at, cancel_reason)
       VALUES ($1, NOW(), $2);
   COMMIT;
   ```
9. Model synthesizes natural-language response.
10. Guardrail (outbound) re-scans response, masks any PII before chunks leave Bedrock.
11. `chat-api` streams chunks to React; on `end`, async-writes turn to DynamoDB.

### Error handling
- Action Lambda failures return `{success:false, error:{code, message}}`; Bedrock surfaces to model.
- `InvokeAgent` failures → Function URL returns `{success:false, error}` and writes a failed-turn record to DynamoDB.
- All Lambdas: Powertools Logger with `sessionId` correlation id; X-Ray tracing on.

---

## 5. PostgreSQL Schema (3NF)

```sql
CREATE TABLE users (
  user_id        SERIAL PRIMARY KEY,
  user_uuid      VARCHAR(36) UNIQUE NOT NULL,
  user_name      VARCHAR(100) NOT NULL,
  user_email     VARCHAR(150) UNIQUE NOT NULL,
  user_phone     VARCHAR(30),
  user_passport  VARCHAR(30),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE flights (
  flight_id           SERIAL PRIMARY KEY,
  flight_number       VARCHAR(10) NOT NULL,
  flight_carrier      VARCHAR(50) NOT NULL,
  flight_origin       VARCHAR(3)  NOT NULL,
  flight_destination  VARCHAR(3)  NOT NULL,
  flight_depart_at    TIMESTAMPTZ NOT NULL,
  flight_arrive_at    TIMESTAMPTZ NOT NULL,
  flight_status       VARCHAR(20) NOT NULL DEFAULT 'scheduled'
    CHECK (flight_status IN ('scheduled','delayed','cancelled','departed','arrived')),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_flights_number_depart UNIQUE (flight_number, flight_depart_at)
);

CREATE TABLE bookings (
  booking_id        SERIAL PRIMARY KEY,
  booking_ref       VARCHAR(10) UNIQUE NOT NULL,
  user_id           INT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  booking_status    VARCHAR(20) NOT NULL DEFAULT 'confirmed'
    CHECK (booking_status IN ('confirmed','cancelled','rescheduled','completed')),
  booking_total     NUMERIC(12,2) NOT NULL CHECK (booking_total >= 0),
  booking_currency  VARCHAR(3) NOT NULL DEFAULT 'USD',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE booking_segments (
  segment_id        SERIAL PRIMARY KEY,
  booking_id        INT NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
  flight_id         INT NOT NULL REFERENCES flights(flight_id) ON DELETE RESTRICT,
  segment_order     INT NOT NULL CHECK (segment_order > 0),
  segment_seat      VARCHAR(5),
  segment_status    VARCHAR(20) NOT NULL DEFAULT 'confirmed'
    CHECK (segment_status IN ('confirmed','cancelled','rescheduled')),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_booking_segments UNIQUE (booking_id, segment_order)
);

CREATE TABLE cancellations (
  cancellation_id   SERIAL PRIMARY KEY,
  booking_id        INT NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
  cancelled_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancel_reason     VARCHAR(500),
  refund_amount     NUMERIC(12,2) CHECK (refund_amount >= 0),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE reschedules (
  reschedule_id        SERIAL PRIMARY KEY,
  booking_id           INT NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
  old_segment_id       INT NOT NULL REFERENCES booking_segments(segment_id) ON DELETE RESTRICT,
  new_segment_id       INT NOT NULL REFERENCES booking_segments(segment_id) ON DELETE RESTRICT,
  rescheduled_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reschedule_reason    VARCHAR(500),
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email             ON users(user_email);
CREATE INDEX idx_bookings_user           ON bookings(user_id);
CREATE INDEX idx_bookings_status         ON bookings(booking_status);
CREATE INDEX idx_segments_booking        ON booking_segments(booking_id);
CREATE INDEX idx_segments_flight         ON booking_segments(flight_id);
CREATE INDEX idx_flights_route_depart    ON flights(flight_origin, flight_destination, flight_depart_at);
CREATE INDEX idx_cancellations_booking   ON cancellations(booking_id);
CREATE INDEX idx_reschedules_booking     ON reschedules(booking_id);
```

3NF, ACID transactions on cancel/reschedule, FK `ON DELETE` set on every reference, CHECK constraints on enums, money in `NUMERIC`, dates in `TIMESTAMPTZ`.

---

## 6. Project Layout & IaC (AWS SAM)

```
travel-agency-agent/
├── template.yaml               # SAM root template
├── infra/
│   ├── network.yaml            # VPC, subnets, SGs
│   ├── data.yaml               # RDS Postgres, RDS Proxy, Secret, DynamoDB
│   ├── kb.yaml                 # S3 KB bucket, S3 Vector index, Bedrock KB
│   └── agent.yaml              # Bedrock Agent, Guardrail, action-group perms
├── src/
│   ├── chat-api/               # streaming Function URL handler
│   ├── bookings-actions/
│   ├── flights-actions/
│   ├── users-actions/
│   └── shared/
│       ├── logger.ts           # Powertools logger
│       ├── db.ts               # pg + RDS Proxy IAM token
│       └── schemas/            # Zod + OpenAPI per action group
├── db/migrations/              # numbered SQL migrations
├── seed/                       # sample bookings + historical-cases JSON
├── samconfig.toml
├── buildspec.yml               # sam build && sam deploy
├── tsconfig.json
└── package.json
```

- Lambdas built with `Metadata: BuildMethod: esbuild` for TS bundling.
- Bedrock Agent / Guardrail / KB declared via raw CFN: `AWS::Bedrock::Agent`, `AWS::Bedrock::Guardrail`, `AWS::Bedrock::KnowledgeBase`.
- Function URL: `FunctionUrlConfig: { AuthType: NONE, InvokeMode: RESPONSE_STREAM }`.
- Local dev: `sam local invoke` for action-group Lambdas; chat-api tested against deployed agent.
- CI: `sam build && sam deploy --no-confirm-changeset --no-fail-on-empty-changeset`.

---

## 7. Observability

- Powertools Logger with `serviceName` per Lambda; correlation id = `sessionId`.
- X-Ray enabled on all Lambdas + RDS Proxy.
- CloudWatch alarm: any Guardrail intervention event → SNS topic (audit trail).
- Action-group invocation counts + p95 latency dashboards in CloudWatch.

---

## 8. Testing

- **Unit:** Vitest per action handler, `pg` mocked.
- **Integration:** testcontainers Postgres, run handlers end-to-end against migrations + seed.
- **Smoke:** script that calls deployed Function URL with canned prompts and asserts:
  - No PII tokens (NAME, EMAIL, PNR regex) in transcript.
  - Cancellation prompt results in a `cancellations` row + `bookings.booking_status='cancelled'`.

---

## 9. Acceptance Criteria Mapping (PRD §5)

| PRD Criterion | How design satisfies it |
|---|---|
| Zero PII leakage | Guardrail attached at agent level (in + out); CloudWatch alarm on intervention; smoke test asserts redaction. |
| Vector retrieval < 500ms | S3 Vectors via Bedrock KB (managed), measured in CloudWatch X-Ray segments per turn. |
| 100% transactional reliability | All mutations wrapped in `BEGIN/COMMIT` with `RETURNING`; integration test covers cancel + reschedule paths. |

---

## 10. Risks Accepted for POC

- Function URL `AuthType: NONE` → public endpoint, no auth, no WAF. Mitigate via per-`userId` rate limit in chat-api Lambda if abuse observed.
- Single-AZ RDS, no secret rotation, AWS-managed KMS keys only.
- Manual KB ingestion (no auto-sync on S3 PUT).
