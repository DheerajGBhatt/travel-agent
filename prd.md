Here is the restructured Product Requirements Document (PRD), optimized for ingestion by an AI coding assistant like Claude Code. It focuses on unambiguous directives, clear system boundaries, defined data flows, and explicit acceptance criteria.

***

# PRD: Secure Serverless Travel AI Assistant (v2)

## 1. Project Overview
**Objective:** Deploy a GenAI-driven, highly-reasoning travel agent capable of automating complex, multi-leg flight rescheduling and international booking cancellations while strictly adhering to corporate policy and data privacy standards. 
**Context:** Transitioning from a high-touch human support model to a high-performance RAG layer built on historical, human-resolved cases to reduce operational overhead.

## 2. Technology Stack & Architecture
* **LLM Reasoning Engine:** Anthropic Claude 4.x Sonnet (via Amazon Bedrock). Chosen for elite agentic performance and low latency.
* **PII Security Layer:** Amazon Bedrock Guardrails.
* **Vector Store (RAG):** Amazon S3 Vectors (via Amazon Bedrock Knowledge Bases).
* **Transactional Database:** Amazon RDS for PostgreSQL.
* **Frontend:** React Web Portal.
* **Backend Compute:** AWS Lambda (Action Groups).

## 3. Core System Components & Requirements

### 3.1 PII Masking & Security (Bedrock Guardrails)
**Directive:** The AI model must NEVER ingest or output raw sensitive data. The security layer acts as a bidirectional middleware interceptor.
* **Inbound Redaction Rule:** Intercept user prompts and redact PII before reaching the LLM. 
    * *Example:* `"My name is Bhargav and my email is test@example.com"` $\rightarrow$ `"My name is [NAME] and my email is [EMAIL_ADDRESS]"`.
* **Outbound Masking Rule:** Intercept LLM responses and mask any database-retrieved PII before delivery to the React frontend.
* **Required PII Filter Categories:**
    * *Identifiers:* Name, Email, SSN, Passport Number.
    * *Financial:* Credit Card Number, Bank Account Number.
    * *Custom (Regex):* Booking Reference IDs.

### 3.2 RAG Implementation (S3 Vectors)
**Directive:** Implement a serverless vector retrieval system bypassing dedicated cluster management (e.g., OpenSearch) for POC scale.
* **Data Source:** Standard S3 bucket containing historical human-resolved complaints formatted as JSON.
* **Indexing:** Utilize Amazon Bedrock Knowledge Bases to sync JSON files to an S3 Vector Index.
* **Retrieval:** Agent must query the S3 Vector Bucket directly to retrieve historical context and policy guidelines.

### 3.3 Transactional Database (RDS PostgreSQL)
**Directive:** Maintain live system state for interactive demonstrations.
* **Data Stored:** Live booking data, flight statuses, and user profiles.
* **Access Pattern:** Queried and updated exclusively via Lambda Action Groups triggered by the LLM tool-calling capabilities.

## 4. Execution Workflow (State Machine)
The system must follow this sequential data flow for every user interaction:

1.  **Input:** User submits a natural language query via the React Web Portal.
2.  **Sanitization (Pre-processing):** Bedrock Guardrail scans the prompt, detects PII, and applies redaction masks.
3.  **Intent & Reasoning:** The sanitized prompt is passed to Claude 4.x Sonnet. The model evaluates the intent (e.g., `Flight_Reschedule`, `Cancel_Booking`).
4.  **RAG Context Retrieval:** If policy context is needed (e.g., "How do we handle Oman Air layover changes?"), the model queries the S3 Vector store.
5.  **Tool Calling:** The model triggers a designated Lambda Action Group to fetch or mutate state in the PostgreSQL RDS instance (e.g., fetching a booking, executing a cancellation).
6.  **Response Generation:** The model synthesizes the context, DB state, and resolution into a natural language response.
7.  **Validation (Post-processing):** Bedrock Guardrail performs a final scan of the generated response to ensure zero PII leakage.
8.  **Output:** The safe response is returned to the React Web Portal.

## 5. Acceptance Criteria (POC Success Metrics)
* [ ] **Zero PII Leakage:** 0% incidence rate of sensitive entities appearing in system logs, model intermediate reasoning steps, or final frontend outputs.
* [ ] **Vector Retrieval Latency:** S3 Vector retrieval via Bedrock Knowledge Bases must execute in $< 500\text{ms}$.
* [ ] **Transactional Reliability:** The AI Agent must demonstrate a 100% success rate when intentionally updating a booking record in the RDS PostgreSQL database via Lambda Action Groups.