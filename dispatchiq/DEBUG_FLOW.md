# DispatchIQ - Live Transcript Flow Debug Guide

## How Data Flows (End-to-End)

```
Phone Call (Caller + Dispatcher)
    ↓
Twilio (streams audio via WebSocket)
    ↓
Server receives audio in "media" events
    ↓
Server forwards audio to Deepgram
    ↓
Deepgram transcribes (Channel 0 = Caller, Channel 1 = Dispatcher)
    ↓
Server receives transcript from Deepgram
    ↓
Server calls storeTranscript()
    ├─ Broadcast to Dashboard via WebSocket (/dashboard)
    └─ Store in Supabase (optional)
    ↓
Dashboard WebSocket receives message
    ↓
Dashboard updates React state (setMessages)
    ↓
Transcript component re-renders
    ↓
🎉 Transcript appears on screen!
```

## Potential Breaking Points

### 1. Deepgram Not Returning Transcripts
**Symptoms:**
- No logs like "📝 [FINAL] CALLER:" or "📝 [FINAL] DISPATCHER:"
- Audio is being received but nothing transcribed

**Causes:**
- Audio quality too low
- Background noise
- Speaking too quietly
- Multichannel audio format issue

### 2. storeTranscript() Not Broadcasting
**Symptoms:**
- Logs show "📝 [FINAL]" but nothing in UI
- No "📡 Broadcasting transcript to X dashboard client(s)" log

**Causes:**
- dashboardClients set is empty (no frontend connected)
- WebSocket closed/disconnected
- Error in broadcastToDashboard function

### 3. Dashboard Not Connected
**Symptoms:**
- Server shows "0 dashboard clients"
- Browser console shows connection errors
- No "✅ Connected to backend WebSocket" in browser console

**Causes:**
- Frontend not running
- WebSocket connection failed
- Wrong WebSocket URL (localhost vs actual host)

### 4. React State Not Updating
**Symptoms:**
- Browser console shows "📨 Received from backend"
- But UI doesn't update

**Causes:**
- Duplicate IDs (messages filtered out)
- React state update issue
- Component not re-rendering

## Debug Checklist

Run through this in order:

### Server-Side Checks

1. **Are transcripts being generated?**
   Look for: `📝 [FINAL] CALLER:` or `📝 [FINAL] DISPATCHER:`
   
   ❌ If NO: Problem is with Deepgram
   ✅ If YES: Move to next check

2. **Are transcripts being broadcast?**
   Look for: `📡 Broadcasting transcript to X dashboard client(s)`
   
   ❌ If shows "0 clients": Dashboard not connected
   ✅ If shows "1+ clients": Move to next check

3. **How many dashboard clients connected?**
   Look for: `📱 Dashboard client connected`
   
   Should see this when you open http://localhost:3000

### Frontend Checks

4. **Is frontend WebSocket connected?**
   Open browser console (F12), look for:
   ```
   🔌 Connecting to backend WebSocket: ws://localhost:3001/dashboard
   ✅ Connected to backend WebSocket
   ```
   
   ❌ If connection errors: Check if server is running
   ✅ If connected: Move to next check

5. **Are messages being received?**
   Look for in browser console:
   ```
   📨 Received from backend: { type: 'transcript', ... }
   ```
   
   ❌ If NO messages: Problem with broadcast
   ✅ If YES: Move to next check

6. **Are messages being added to state?**
   Check React DevTools or add console.log in Dashboard.tsx

## Common Issues & Fixes

### Issue 1: Multichannel Not Working

If you only see CALLER or only see DISPATCHER (not both):

**Problem:** Deepgram multichannel might not be parsing correctly

**Fix:** Check the channel structure in logs. Add this debug line:
```javascript
console.log('Deepgram data structure:', JSON.stringify(data, null, 2));
```

### Issue 2: Dashboard Disconnects

If dashboard keeps disconnecting:

**Problem:** WebSocket connection is unstable

**Symptoms:**
- Logs show: `📱 Dashboard client disconnected`
- Then reconnects
- Then disconnects again

**Fix:** Add reconnection logic in Dashboard.tsx

### Issue 3: Duplicate Messages Filtered Out

If transcripts appear in console but not UI:

**Problem:** The ID generation might create duplicates

**Current ID generation:**
```javascript
id: Date.now().toString() + Math.random()
```

**Issue:** If multiple transcripts arrive at the same millisecond, IDs could collide

### Issue 4: Messages Out of Order

If messages appear but in wrong order:

**Problem:** Async timing issues

**Fix:** Add sequence numbers or better timestamps

## Quick Diagnostic Commands

### 1. Check Server Logs
```bash
# In terminal where server is running
# Look for these patterns:
📝 [FINAL] CALLER:      ← Deepgram working
📡 Broadcasting to      ← Broadcast happening
📱 Dashboard client     ← Frontend connected
```

### 2. Check Browser Console
```bash
# Open DevTools (F12) → Console tab
# Look for:
✅ Connected to backend WebSocket
📨 Received from backend: ...
```

### 3. Check Network Tab
```bash
# DevTools → Network → WS (WebSockets)
# Should see connection to: ws://localhost:3001/dashboard
# Status should be "101 Switching Protocols"
# Messages should be flowing
```

## Most Likely Issue

Based on "very inconsistent", the most common causes are:

1. **Multichannel audio parsing** - Deepgram structure might be different than expected
2. **Dashboard disconnecting** - WebSocket connection drops intermittently
3. **Duplicate filtering** - Messages being filtered as duplicates

Let's add better logging to diagnose!

