# 🚨 SignalOne - Quick Start Guide

## ✅ What's Been Implemented

### Backend Server (`server/index.ts`)
- ✅ Express HTTP server with Twilio webhook endpoint
- ✅ WebSocket server for Twilio Media Streams
- ✅ Deepgram real-time transcription integration
- ✅ Call state management and cleanup
- ✅ Comprehensive logging

### Key Features
- **POST /twilio/voice** - Returns TwiML to start media streaming
- **WebSocket /twilio/media** - Receives audio and forwards to Deepgram
- **GET /health** - Health check endpoint
- **Real-time transcription** - Partial and final transcripts logged to console

## 🚀 Quick Start (3 Steps)

### 1. Configure Environment Variables
Create `.env.local` in the project root:

```bash
TWILIO_ACCOUNT_SID=your_account_sid_here
TWILIO_AUTH_TOKEN=your_auth_token_here
DEEPGRAM_API_KEY=your_deepgram_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here
PORT=3001
PUBLIC_HOST=your_ngrok_url_without_https
```

### 2. Start the Server
```bash
npm run dev:server
```

### 3. Expose with ngrok
```bash
ngrok http 3001
```

Then update Twilio webhook to: `https://YOUR_NGROK_URL/twilio/voice`

## 📝 Testing Checklist

1. ✅ Server starts without errors
2. ✅ Call your Twilio number
3. ✅ Console shows: "Incoming call webhook triggered"
4. ✅ Console shows: "Twilio WebSocket connected"
5. ✅ Console shows: "Deepgram connection opened"
6. ✅ Speak into phone
7. ✅ Console shows partial transcripts: `⏳ [PARTIAL]`
8. ✅ Console shows final transcripts: `📝 [FINAL]`
9. ✅ Hang up
10. ✅ Console shows: "Call ended"

## 📦 What's Included

```
dispatchiq/
├── server/
│   └── index.ts           # Complete Twilio + Deepgram server
├── package.json           # Updated with new scripts
├── SERVER_SETUP.md        # Detailed setup guide
└── QUICKSTART.md          # This file
```

## 🔧 npm Scripts

- `npm run dev` - Start Next.js frontend (port 3000)
- `npm run dev:server` - Start dispatch server with hot reload (port 3001)
- `npm run start:server` - Start dispatch server (production)

## 🎯 Next Steps (Not Yet Implemented)

1. **Gemini Integration** - Process final transcripts with AI
2. **Supabase Storage** - Store transcripts and incident state
3. **Frontend Dashboard** - Display real-time transcripts
4. **Structured Extraction** - Extract location, type, injuries, etc.
5. **Next Best Question** - AI-generated dispatcher prompts

## 💡 Pro Tips

- Keep ngrok running - the URL changes each restart
- Watch server logs for debugging
- Test with different types of emergency scenarios
- Partial transcripts update in real-time
- Final transcripts are more accurate

## 🆘 Common Issues

**No transcripts?**
- Check DEEPGRAM_API_KEY is valid
- Verify audio is arriving (look for "media" events)

**WebSocket won't connect?**
- Ensure PUBLIC_HOST matches your ngrok URL (without https://)
- Verify Twilio webhook uses wss:// not ws://

**Call connects but silence?**
- Check Twilio webhook URL is correct
- Make sure TwiML includes `<Stream>` before `<Say>`

---

## 📞 Architecture

```
Caller → Twilio Phone # → Webhook (/twilio/voice)
                              ↓
                         TwiML Response
                              ↓
                    WebSocket Stream (/twilio/media)
                              ↓
                         Server (Express + WS)
                              ↓
                         Deepgram API
                              ↓
                    Real-time Transcription
                              ↓
                        Console Logs
```

**Status**: ✅ Live call transcription working end-to-end

