#!/bin/bash
# Script to get the deployed API endpoints and update .env file

STACK_NAME="travel-chatbot-dev"

echo "Fetching endpoints from CloudFormation stack: $STACK_NAME"
echo ""

# Get WebSocket endpoint
WS_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --query 'Stacks[0].Outputs[?OutputKey==`WebSocketEndpoint`].OutputValue' \
  --output text 2>/dev/null)

# Get REST API endpoint
API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --query 'Stacks[0].Outputs[?OutputKey==`RestApiEndpoint`].OutputValue' \
  --output text 2>/dev/null)

if [ -z "$WS_ENDPOINT" ] || [ -z "$API_ENDPOINT" ]; then
  echo "❌ ERROR: Could not retrieve endpoints from CloudFormation"
  echo ""
  echo "Possible reasons:"
  echo "1. Stack '$STACK_NAME' is not deployed"
  echo "2. AWS CLI is not configured"
  echo "3. You don't have permissions to access CloudFormation"
  echo ""
  echo "To deploy the backend:"
  echo "  cd ../backend"
  echo "  sam build && sam deploy"
  exit 1
fi

echo "✅ Found endpoints:"
echo "  WebSocket: $WS_ENDPOINT"
echo "  REST API:  $API_ENDPOINT"
echo ""

# Update .env file
cat > .env << EOF
# WebSocket endpoint for real-time chat
VITE_WS_ENDPOINT=$WS_ENDPOINT

# REST API endpoint (if needed)
VITE_API_ENDPOINT=$API_ENDPOINT
EOF

echo "✅ Updated .env file"
echo ""
echo "Next steps:"
echo "1. Run: npm run dev"
echo "2. Open: http://localhost:5173"
