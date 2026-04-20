# Frontend Troubleshooting Guide

## Issue: Chatbot Not Working

### Quick Fix

1. **Get the correct API endpoints:**
   ```bash
   cd frontend
   ./get-endpoints.sh
   ```

2. **Start the frontend:**
   ```bash
   npm run dev
   ```

3. **Open in browser:**
   ```
   http://localhost:5173
   ```

---

## Common Issues

### 1. "Connecting..." - Never Connects

**Cause:** Missing or incorrect WebSocket endpoint in `.env` file

**Solution:**
```bash
# Run the helper script
./get-endpoints.sh

# Manually check the endpoint
aws cloudformation describe-stacks \
  --stack-name travel-chatbot-dev \
  --query 'Stacks[0].Outputs'
```

**Verify .env file:**
```bash
cat .env
```

Should look like:
```
VITE_WS_ENDPOINT=wss://xxxxx.execute-api.us-east-1.amazonaws.com/dev
VITE_API_ENDPOINT=https://xxxxx.execute-api.us-east-1.amazonaws.com/dev
```

---

### 2. Backend Not Deployed

**Error:** `Stack 'travel-chatbot-dev' does not exist`

**Solution:**
```bash
cd ../backend
sam build && sam deploy
```

---

### 3. WebSocket Connection Refused

**Cause:** Backend Lambda or API Gateway not working

**Check backend logs:**
```bash
sam logs --stack-name travel-chatbot-dev --tail
```

**Check API Gateway:**
```bash
aws apigatewayv2 get-apis --query 'Items[?Name==`travel-chatbot-websocket-dev`]'
```

---

### 4. CORS Errors

**Symptom:** Browser console shows CORS errors

**Solution:** The backend is configured for `Access-Control-Allow-Origin: *`

If still having issues, check:
1. Backend template.yaml CORS settings
2. API Gateway configuration
3. Lambda response headers

---

### 5. "Connection error occurred"

**Possible causes:**
1. Wrong WebSocket URL
2. API Gateway not deployed
3. Lambda function errors
4. Network/firewall blocking WebSocket

**Debug:**
1. Open browser DevTools (F12)
2. Go to Network tab
3. Filter by "WS" (WebSocket)
4. Look for connection attempts
5. Check error messages

---

### 6. Messages Not Sending

**Check:**
1. Is "Online" status showing? (top of chat window)
2. Browser console for errors (F12)
3. Backend CloudWatch logs

```bash
# Check Lambda logs
aws logs tail /aws/lambda/travel-chatbot-dev-WebSocketHandler --follow
```

---

## Development Commands

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Lint code
npm run lint
```

---

## Environment Variables

Frontend uses Vite, so env vars MUST be prefixed with `VITE_`:

```bash
VITE_WS_ENDPOINT=wss://xxxxx.execute-api.us-east-1.amazonaws.com/dev
VITE_API_ENDPOINT=https://xxxxx.execute-api.us-east-1.amazonaws.com/dev
```

**After changing .env:**
1. Stop the dev server (Ctrl+C)
2. Restart: `npm run dev`
3. Hard refresh browser (Ctrl+Shift+R or Cmd+Shift+R)

---

## Testing WebSocket Manually

Use `wscat` to test the WebSocket endpoint:

```bash
# Install wscat
npm install -g wscat

# Connect to WebSocket
wscat -c wss://xxxxx.execute-api.us-east-1.amazonaws.com/dev

# Send a message
> {"action": "chat", "message": "Hello"}
```

Expected response:
```json
{"type": "start", "sessionId": "..."}
{"type": "chunk", "text": "Hello! I'm..."}
{"type": "end"}
```

---

## Browser Compatibility

Supported browsers:
- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+

---

## Getting Help

If none of the above works:

1. **Check backend is deployed:**
   ```bash
   cd ../backend
   sam list stack-outputs --stack-name travel-chatbot-dev
   ```

2. **Verify WebSocket handler:**
   ```bash
   aws lambda get-function --function-name travel-chatbot-dev-WebSocketHandler
   ```

3. **Check Lambda errors:**
   ```bash
   aws logs tail /aws/lambda/travel-chatbot-dev-WebSocketHandler --since 10m
   ```

4. **Test backend health:**
   ```bash
   curl https://xxxxx.execute-api.us-east-1.amazonaws.com/dev/health
   ```
