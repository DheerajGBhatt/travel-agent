# Debugging Frontend Issues

## That Chrome Extension Error

**Error:** `Promised response from onMessage listener went out of scope`

**This is NOT from your chatbot!** It's from a browser extension (often ad blockers, password managers, or developer tools extensions).

**Ignore it** - it won't affect your chatbot.

---

## Find the Real Error

### Step 1: Open Browser Console Properly

1. Press `F12` (or `Cmd+Option+I` on Mac)
2. Click the **Console** tab
3. Click the **filter dropdown** (looks like a funnel icon)
4. **Uncheck** "Selected context only" or select "top" frame
5. Look for errors in RED with your app's code

### Step 2: Check Network Tab for WebSocket

1. In DevTools, click **Network** tab
2. Click **WS** filter (WebSocket)
3. Refresh the page
4. You should see a WebSocket connection attempt
5. Click on it to see:
   - **Status**: Should be "101 Switching Protocols" (green)
   - **Messages**: Should show chat messages flowing

**If you see:**
- ❌ **Status 403/404**: Wrong endpoint URL
- ❌ **Failed to connect**: Backend not running
- ❌ **No WebSocket requests**: Frontend not trying to connect

---

## Quick Diagnostic

Run this in your browser console (F12):

```javascript
// Check what endpoint the app is trying to use
console.log('WS Endpoint:', import.meta.env.VITE_WS_ENDPOINT);

// Try to connect manually
const ws = new WebSocket('wss://YOUR-ENDPOINT-HERE.execute-api.us-east-1.amazonaws.com/dev');
ws.onopen = () => console.log('✅ WebSocket CONNECTED');
ws.onerror = (e) => console.error('❌ WebSocket ERROR:', e);
ws.onclose = () => console.log('WebSocket closed');
```

---

## Common Real Errors

### 1. "WebSocket connection failed"

**Cause:** Backend not deployed or wrong endpoint

**Fix:**
```bash
# Deploy backend
cd backend
sam build && sam deploy

# Get the WebSocket endpoint from output
# Copy it to frontend/.env
```

### 2. "Failed to fetch" or CORS error

**Cause:** API Gateway not configured properly

**Fix:** Check backend template.yaml CORS settings

### 3. "401 Unauthorized" or "403 Forbidden"

**Cause:** Wrong API endpoint or missing authentication

**Fix:** Verify the WebSocket URL is correct

---

## Still Stuck?

### 1. Test Backend Directly

```bash
# Install wscat
npm install -g wscat

# Test WebSocket (replace with your actual endpoint)
wscat -c wss://YOUR-ID.execute-api.us-east-1.amazonaws.com/dev

# Send test message
> {"action":"chat","message":"test"}
```

Expected response:
```json
{"type":"start"}
{"type":"chunk","text":"Hello..."}
{"type":"end"}
```

### 2. Check Backend Logs

```bash
cd backend
sam logs --stack-name travel-chatbot-dev --tail
```

### 3. Verify Stack Exists

```bash
aws cloudformation list-stacks \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --query 'StackSummaries[?StackName==`travel-chatbot-dev`]' \
  --region us-east-1
```

---

## Screenshots to Share

If you need help, take screenshots of:

1. **Browser Console** (F12 → Console tab) - showing RED errors
2. **Network → WS tab** - showing WebSocket connection status
3. **Frontend .env file** - showing the endpoints you're using
4. **Terminal output** from `sam deploy` - showing the deployed endpoints

---

## Working Setup Should Show

✅ Browser console: Clean, no red errors (ignore extension warnings)
✅ Network → WS: Green "101 Switching Protocols"
✅ Chat window: Status shows "Online"
✅ Messages: Send and receive successfully
