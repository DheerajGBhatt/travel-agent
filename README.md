# Travel Agency Agent

Serverless AI travel assistant built with Amazon Bedrock Agents, AWS SAM, Neon Postgres, and S3 Vectors. The agent helps users search flights, book tickets, manage existing bookings (cancel/reschedule), check flight statuses, and answer questions using historical support case context via RAG.

## Architecture

```
                         WebSocket API
                              |
                         [chat-ws Lambda]
                              |
                     Amazon Bedrock Agent
                     (Claude Sonnet 4.5)
                              |
              +---------------+---------------+
              |               |               |               |
        [bookings]      [flights]       [users]         [rag-retrieval]
         Lambda           Lambda         Lambda            Lambda
              |               |               |               |
              +-------+-------+               |         S3 Vectors
                      |                        |        (historical cases)
                 Neon Postgres                 |
           (flights, bookings, users)          |
                                          Titan Embed v2
```

### Components

| Component | Description |
|-----------|-------------|
| **chat-ws** | WebSocket Lambda handling frontend connections, streaming Bedrock agent responses to the React UI |
| **bookings-actions** | Action group Lambda for booking flights, looking up bookings by PNR, cancelling, and rescheduling |
| **flights-actions** | Action group Lambda for flight status checks and alternate flight search |
| **users-actions** | Action group Lambda for user profile lookup |
| **rag-retrieval** | Action group Lambda for semantic search over historical resolved support cases using S3 Vectors + Titan embeddings |
| **Bedrock Guardrail** | 5-layer guardrail: content filters, topic denial, word filters, PII protection, contextual grounding |

## Tech Stack

- **Runtime**: Node.js 20 (ARM64)
- **IaC**: AWS SAM (CloudFormation)
- **AI**: Amazon Bedrock Agents + Claude Sonnet 4.5
- **Database**: Neon Postgres (Drizzle ORM)
- **Vector Store**: S3 Vectors (cosine similarity, 1024-dim float32)
- **Embeddings**: Amazon Titan Embed Text v2
- **Frontend**: React + Vite + TypeScript
- **Observability**: Lambda Powertools Logger + X-Ray Tracing

## Project Structure

```
travel-agency-agent/
├── src/
│   ├── bookings-actions/     # Book, get, cancel, reschedule flights
│   │   └── index.ts
│   ├── flights-actions/      # Flight status + alternate search
│   │   └── index.ts
│   ├── users-actions/        # User profile lookup
│   │   └── index.ts
│   ├── rag-retrieval/        # Semantic search over historical cases
│   │   └── index.ts
│   ├── chat-ws/              # WebSocket handler for frontend
│   │   └── index.ts
│   └── shared/               # Shared utilities
│       ├── db.ts             # Neon Postgres connection (Drizzle)
│       ├── schema.ts         # Drizzle table definitions
│       ├── schemas.ts        # Zod input validation schemas
│       ├── responses.ts      # Bedrock + API Gateway response helpers
│       ├── logger.ts         # Powertools Logger
│       └── embeddings.ts     # Titan embedding client
├── frontend/                 # React + Vite chat UI
│   └── src/
│       ├── components/       # ChatWindow, MessageList, MessageInput
│       ├── hooks/            # useChat WebSocket hook
│       ├── services/         # WebSocket service
│       └── types/            # TypeScript interfaces
├── db/
│   └── migrations/           # Drizzle migrations
├── raw-data/                 # Seed data (flights, hotels JSON)
├── scripts/
│   └── rag-ingest.mjs        # Ingest historical cases into S3 Vectors
├── template.yaml             # SAM template (all infra)
├── samconfig.toml            # SAM deployment config
├── deploy.sh                 # Deploy script
├── drizzle.config.ts         # Drizzle Kit config
└── package.json
```

## Prerequisites

- Node.js 20+
- AWS SAM CLI
- AWS CLI (configured with appropriate permissions)
- A Neon Postgres database
- Bedrock model access enabled for Claude Sonnet 4.5 and Titan Embed Text v2

## Setup

### 1. Install dependencies

```bash
npm install
cd frontend && npm install && cd ..
```

### 2. Configure Neon database

Set your Neon connection string. Run migrations:

```bash
export DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"
npx drizzle-kit push
```

### 3. Deploy backend

```bash
./deploy.sh
```

This runs `sam build` and `sam deploy` with the parameters in `samconfig.toml`. The `NeonDatabaseUrl` is passed as a parameter override.

After deploy, update the Bedrock agent alias to point to the latest prepared version:

```bash
aws bedrock-agent update-agent-alias \
  --agent-id <AGENT_ID> \
  --agent-alias-id <ALIAS_ID> \
  --agent-alias-name live \
  --routing-configuration '[{"agentVersion": "<LATEST_VERSION>"}]'
```

### 4. Ingest RAG data

```bash
node scripts/rag-ingest.mjs
```

### 5. Start frontend

```bash
cd frontend
echo "VITE_WS_ENDPOINT=wss://<api-id>.execute-api.<region>.amazonaws.com/dev" > .env
npm run dev
```

The WebSocket endpoint is in the SAM stack outputs (`WebSocketEndpoint`).

## Agent Capabilities

| Action | Route | Description |
|--------|-------|-------------|
| Book flight | `POST /bookings/create` | Create a booking for a flight + seat class |
| Get booking | `POST /bookings/get` | Look up a booking by PNR reference |
| Cancel booking | `POST /bookings/cancel` | Cancel an active booking |
| Reschedule booking | `POST /bookings/reschedule` | Move a booking to a different flight |
| Flight status | `POST /flights/status` | Get current status of a flight |
| Search flights | `POST /flights/search` | Search scheduled flights between airports after a date |
| User profile | `POST /users/profile` | Get user profile by id |
| RAG search | `POST /rag/search` | Semantic search over historical support cases |

## Guardrails

The agent is protected by a 5-layer Bedrock Guardrail:

| Layer | Type | What it does |
|-------|------|-------------|
| 1 | **Content Filters** | Blocks prompt injection, insults, hate speech, sexual content, violence, misconduct |
| 2 | **Topic Denial** | Rejects non-travel topics, competitor platform requests, system manipulation attempts |
| 3 | **Word Filters** | Blocks fraud terms (e.g. "refund hack", "bypass payment") + managed profanity |
| 4 | **PII Protection** | Blocks SSN, credit cards, bank accounts, PINs; anonymizes passport numbers |
| 5 | **Contextual Grounding** | Prevents hallucinated flight info with grounding (0.7) and relevance (0.7) thresholds |

## Database Schema

```
users ──< flight_bookings >── flights ──< airlines
                │                       ──< airports (departure)
                │                       ──< airports (arrival)
                ├──< flight_passengers
                └──< booking_modifications
```

Key tables: `users`, `airlines`, `airports`, `flights`, `flight_bookings`, `flight_passengers`, `booking_modifications`.

## Stack Outputs

| Output | Description |
|--------|-------------|
| `WebSocketEndpoint` | WebSocket URL for the React frontend (`VITE_WS_ENDPOINT`) |
| `ActionsHttpApiEndpoint` | HTTP API base URL for action group endpoints |
| `AgentId` | Bedrock Agent ID |
| `AgentAliasId` | Bedrock Agent Alias ID |
| `VectorIndexArn` | S3 Vectors index ARN |
| `VectorBucketName` | S3 Vectors bucket name |
| `ConversationsTableName` | DynamoDB conversation history table |
