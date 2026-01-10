# 🚀 Supabase Setup Guide for SignalOne

## Quick Overview

This guide will help you set up Supabase to store and stream live call transcripts to your frontend dashboard in real-time.

## Step 1: Create a Supabase Project

1. Go to [https://app.supabase.com/](https://app.supabase.com/)
2. Click **"New Project"**
3. Choose an organization (or create one)
4. Fill in:
   - **Project name**: `signalone` (or any name)
   - **Database password**: Save this somewhere safe
   - **Region**: Choose closest to you
5. Click **"Create new project"**
6. Wait 2-3 minutes for setup to complete

## Step 2: Run the Database Schema

1. In your Supabase project, click **"SQL Editor"** in the left sidebar
2. Click **"New query"**
3. Copy the contents of `supabase-schema.sql` from this project
4. Paste it into the SQL editor
5. Click **"Run"** (or press Cmd/Ctrl + Enter)
6. You should see: ✅ Success

This creates three tables:
- **calls** - Stores call sessions
- **transcripts** - Stores transcript messages (real-time synced)
- **incidents** - Stores incident details (for future use)

## Step 3: Enable Realtime for Transcripts

1. Go to **Database → Replication** in the left sidebar
2. Scroll down to find the **`transcripts`** table
3. Toggle the switch to **ENABLE** realtime for this table
4. The table should now show a green checkmark

## Step 4: Get Your API Keys

1. Go to **Project Settings** (gear icon in sidebar)
2. Click **API** in the left menu
3. You'll see:
   - **Project URL** (e.g., `https://abc123.supabase.co`)
   - **`anon` public** key (safe to use in frontend)
   - **`service_role`** key (⚠️ SECRET - only for backend)

## Step 5: Add to .env.local

Add these three variables to your `.env.local` file:

```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_Pd503_rryNNEgkiwRR1j3g_YaBoBNfy
SUPABASE_SERVICE_ROLE_KEY=sb_secret_17qvu6WLU2_mGJHyQMgBug_qhqYWKos
```

⚠️ **Important:** 
- `NEXT_PUBLIC_*` variables are exposed to the browser (safe for `anon` key)
- `SUPABASE_SERVICE_ROLE_KEY` stays on the server only (never expose this!)

## Step 6: Restart Everything

1. **Stop the dispatch server** (Ctrl+C in terminal)
2. **Restart it**: `npm run dev:server`
3. You should see:
   ```
   📝 Loaded environment from .env.local
   ✅ Supabase client initialized
   🚨 SignalOne Dispatch Server
   ```

## Step 7: Test the Integration

1. **Make a test call** to your Twilio number
2. **Speak into the phone**
3. **Watch multiple places**:
   - ✅ Server console: Should show transcript logs
   - ✅ Browser console: Should show "📨 New transcript" logs
   - ✅ **Frontend dashboard: Live transcript should update in real-time!** 🎉

## Step 8: Verify in Supabase Dashboard

1. Go to **Table Editor** in Supabase
2. Click on **`transcripts`** table
3. You should see rows appearing as you speak during the call
4. Click on **`calls`** table to see active call sessions

## Troubleshooting

### No transcripts appearing in frontend?

**Check 1: Is Supabase configured?**
```bash
# In browser console, you should see:
🔌 Subscribing to real-time transcripts...
📡 Supabase subscription status: SUBSCRIBED
```

**Check 2: Is realtime enabled?**
- Go to Database → Replication
- Verify `transcripts` table has realtime ENABLED

**Check 3: Are transcripts being stored?**
- Go to Table Editor → `transcripts`
- Make a call and see if rows appear
- If no rows, check server logs for errors

**Check 4: Check RLS policies**
- Go to Authentication → Policies
- Make sure the "Allow all operations" policies exist for all tables

### Transcripts delayed or not real-time?

- Check your browser network tab for WebSocket connections
- Look for `wss://` connection to Supabase
- If missing, verify `NEXT_PUBLIC_SUPABASE_URL` is set correctly

### "Supabase not configured" warning?

- Make sure all three env variables are set in `.env.local`
- Restart both Next.js and dispatch server after adding them
- Check for typos in variable names

## What Happens Now

```
Phone Call
    ↓
Twilio → Server → Deepgram (transcription)
    ↓
Server → Supabase (stores transcript)
    ↓
Supabase Realtime → Frontend Dashboard (instant update!)
    ↓
Live Transcript appears on screen 🎉
```

## Next Steps

- ✅ Transcripts now display live in the UI
- 🔜 Connect Gemini AI to process transcripts
- 🔜 Extract incident fields (location, type, etc.)
- 🔜 Generate "next best question" suggestions
- 🔜 Store incident state in Supabase

## Supabase Features You're Using

- ✅ **Postgres Database** - Storing structured data
- ✅ **Row Level Security** - Controlling access
- ✅ **Realtime** - WebSocket subscriptions for live updates
- 🔜 **Functions** - Server-side logic (optional future)

---

## Quick Reference

**Required Env Variables:**
```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

**Test Query (SQL Editor):**
```sql
-- See all transcripts
SELECT * FROM transcripts ORDER BY created_at DESC LIMIT 10;

-- See active calls
SELECT * FROM calls WHERE status = 'active';
```

**Reset Data (if needed):**
```sql
-- Clear all data (useful for testing)
TRUNCATE transcripts, calls, incidents RESTART IDENTITY CASCADE;
```

