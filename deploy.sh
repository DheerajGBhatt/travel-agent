#!/usr/bin/env bash
set -euo pipefail

# Wrapper around `sam deploy` that injects the action-group OpenAPI schemas
# as parameter overrides (since SAM cannot read files directly into
# AWS::Bedrock::Agent ApiSchema.Payload).
#
# Required env vars:
#   ENV_NAME           e.g. dev
#   VPC_ID
#   PRIVATE_SUBNET_IDS comma-separated subnet ids
#   KB_BUCKET_NAME

sam build

sam deploy \
  --stack-name "travel-dev" \
  --no-confirm-changeset \
  --no-fail-on-empty-changeset \
  --capabilities CAPABILITY_IAM \
  --resolve-s3 \
  --parameter-overrides \
    EnvName="dev" \
    BedrockModelId="global.anthropic.claude-sonnet-4-5-20250929-v1:0" \
    FoundationModelId="anthropic.claude-sonnet-4-5-20250929-v1:0" \
    NeonDatabaseUrl=""
