# SignalOne - Twilio & Deepgram Integration

## Setup Instructions

### 1. Environment Variables

Create a `.env.local` file in the root directory with the following variables:

```bash
# Twilio Configuration
TWILIO_ACCOUNT_SID=your_account_sid_here
TWILIO_AUTH_TOKEN=your_auth_token_here

# Deepgram Configuration
DEEPGRAM_API_KEY=your_deepgram_api_key_here

# Gemini Configuration
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL_ID=gemini-2.5-flash

# Server Configuration
PORT=3001
PUBLIC_HOST=your_ngrok_or_public_url_here
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Start the Server

Run the dispatch server (handles Twilio calls and Deepgram transcription):

```bash
npm run dev:server
```

This will start the server on `http://localhost:3001`

### 4. Expose Server with ngrok

In a separate terminal, expose your local server to the internet:

```bash
ngrok http 3001
```

Copy the HTTPS forwarding URL (e.g., `https://abc123.ngrok.io`)

### 5. Configure Twilio

1. Go to your Twilio Console
2. Navigate to your phone number configuration
3. Under "A Call Comes In", set:
   - **HTTP Method**: `POST`
   - **URL**: `https://YOUR_NGROK_URL/twilio/voice`

4. Update your `.env.local` with your ngrok URL:
   ```bash
   PUBLIC_HOST=YOUR_NGROK_URL (without https://)
   ```

### 6. Test the Integration

1. Call your Twilio phone number
2. Watch the server console for:
   - ✅ Incoming call webhook
   - ✅ WebSocket connection established
   - ✅ Deepgram connection opened
   - ✅ Transcription logs (partial and final)

## Running Both Frontend and Backend

You'll need **two separate terminals**:

**Terminal 1 - Next.js Frontend:**
```bash
npm run dev
```

**Terminal 2 - Dispatch Server:**
```bash
npm run dev:server
```

## Architecture

```
Phone Call → Twilio → WebSocket → Server → Deepgram
                                     ↓
                                  Console Logs
                                  (Later: Gemini + Supabase)
```

## API Endpoints

### POST /twilio/voice
Twilio webhook endpoint that returns TwiML to start media streaming.

### WebSocket /twilio/media
WebSocket endpoint that receives real-time audio from Twilio and forwards it to Deepgram.

### GET /health
Health check endpoint.

## Troubleshooting

### No transcriptions appearing
- Check that DEEPGRAM_API_KEY is set correctly
- Verify audio is being received (look for "media" event logs)
- Ensure ngrok is running and URL is up to date in Twilio

### WebSocket not connecting
- Verify PUBLIC_HOST in .env.local matches your ngrok URL
- Check that the Twilio webhook URL uses your current ngrok URL
- Make sure server is running on the correct port

### Call connects but no audio
- Verify Twilio webhook responds with proper TwiML
- Check that `<Stream>` URL uses `wss://` (not `ws://`)
- Ensure ngrok HTTPS URL is used (not HTTP)

## Next Steps

- [ ] Integrate Gemini for AI analysis of transcripts
- [ ] Store transcripts in Supabase
- [ ] Connect to frontend dashboard with real-time updates
- [ ] Add incident state extraction
- [ ] Generate "next best question" suggestions

