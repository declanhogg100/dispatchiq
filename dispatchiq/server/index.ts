// Load environment variables from .env.local or .env
import { config } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';

// Try .env.local first (Next.js convention), then fall back to .env
const envLocalPath = resolve(process.cwd(), '.env.local');
const envPath = resolve(process.cwd(), '.env');

if (existsSync(envLocalPath)) {
  config({ path: envLocalPath });
  console.log('📝 Loaded environment from .env.local');
} else if (existsSync(envPath)) {
  config({ path: envPath });
  console.log('📝 Loaded environment from .env');
} else {
  console.warn('⚠️  No .env.local or .env file found');
}

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import type { WebSocket as WSType } from 'ws';

// Environment variables
const PORT = process.env.PORT || 3001;
const PUBLIC_HOST = process.env.PUBLIC_HOST;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;

if (!DEEPGRAM_API_KEY) {
  console.error('❌ DEEPGRAM_API_KEY is required');
  process.exit(1);
}

if (!PUBLIC_HOST) {
  console.warn('⚠️  PUBLIC_HOST not set. Make sure to configure Twilio with your actual WebSocket URL.');
}

// Create Express app and HTTP server
const app = express();
const httpServer = createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server: httpServer, path: '/twilio/media' });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Types for Twilio Media Streams
interface TwilioStartMessage {
  event: 'start';
  sequenceNumber: string;
  start: {
    streamSid: string;
    accountSid: string;
    callSid: string;
    tracks: string[];
    mediaFormat: {
      encoding: string;
      sampleRate: number;
      channels: number;
    };
  };
  streamSid: string;
}

interface TwilioMediaMessage {
  event: 'media';
  sequenceNumber: string;
  media: {
    track: string;
    chunk: string;
    timestamp: string;
    payload: string;
  };
  streamSid: string;
}

interface TwilioStopMessage {
  event: 'stop';
  sequenceNumber: string;
  stop: {
    accountSid: string;
    callSid: string;
  };
  streamSid: string;
}

type TwilioMessage = TwilioStartMessage | TwilioMediaMessage | TwilioStopMessage;

// Store active Deepgram connections per call
const activeConnections = new Map<string, any>();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Twilio Voice Webhook - Returns TwiML to start media stream
// Handles both GET (for browser testing) and POST (from Twilio)
app.all('/twilio/voice', (req, res) => {
  console.log(`📞 Incoming ${req.method} request to /twilio/voice`);
  
  const websocketUrl = PUBLIC_HOST 
    ? `wss://${PUBLIC_HOST}/twilio/media`
    : `wss://YOUR_NGROK_URL_HERE/twilio/media`;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="${websocketUrl}" />
  </Start>
  <Say voice="alice">911, what is your emergency?</Say>
  <Pause length="60"/>
</Response>`;

  // Set Content-Type explicitly
  res.set('Content-Type', 'text/xml');
  res.send(twiml);
  
  console.log('✅ TwiML response sent with WebSocket URL:', websocketUrl);
});

// WebSocket handler for Twilio Media Streams
wss.on('connection', (ws: WSType, req) => {
  console.log('🔌 Twilio WebSocket connected from:', req.socket.remoteAddress);
  console.log('   Path:', req.url);
  console.log('   Headers:', req.headers);
  
  let callSid: string | null = null;
  let deepgramConnection: any = null;

  ws.on('message', async (message: Buffer) => {
    try {
      const msg: TwilioMessage = JSON.parse(message.toString());
      
      console.log('📨 Received Twilio event:', msg.event);

      switch (msg.event) {
        case 'start':
          callSid = msg.start.callSid;
          console.log(`🚨 Call started: ${callSid}`);
          console.log(`   Stream SID: ${msg.start.streamSid}`);
          console.log(`   Media format: ${msg.start.mediaFormat.encoding} @ ${msg.start.mediaFormat.sampleRate}Hz`);

          // Initialize Deepgram connection
          deepgramConnection = await initDeepgramConnection(callSid);
          activeConnections.set(callSid, deepgramConnection);
          break;

        case 'media':
          // Forward audio to Deepgram
          if (deepgramConnection && msg.media.payload) {
            const audioBuffer = Buffer.from(msg.media.payload, 'base64');
            deepgramConnection.send(audioBuffer);
          }
          break;

        case 'stop':
          console.log(`🛑 Call ended: ${msg.stop.callSid}`);
          
          // Clean up Deepgram connection
          if (deepgramConnection) {
            deepgramConnection.finish();
            if (callSid) {
              activeConnections.delete(callSid);
            }
          }
          break;

        default:
          console.log('📨 Unknown Twilio event:', msg);
      }
    } catch (error) {
      console.error('❌ Error processing Twilio message:', error);
    }
  });

  ws.on('close', () => {
    console.log('🔌 Twilio WebSocket disconnected');
    
    // Clean up if connection closes unexpectedly
    if (deepgramConnection) {
      deepgramConnection.finish();
      if (callSid) {
        activeConnections.delete(callSid);
      }
    }
  });

  ws.on('error', (error) => {
    console.error('❌ Twilio WebSocket error:', error);
  });
});

// Initialize Deepgram live transcription for a call
async function initDeepgramConnection(callSid: string) {
  console.log(`🎤 Initializing Deepgram for call: ${callSid}`);

  const deepgram = createClient(DEEPGRAM_API_KEY);

  const connection = deepgram.listen.live({
    encoding: 'mulaw',
    sample_rate: 8000,
    channels: 1,
    punctuate: true,
    interim_results: true,
    smart_format: true,
    model: 'nova-2',
  });

  // Handle transcript events
  connection.on(LiveTranscriptionEvents.Open, () => {
    console.log(`✅ Deepgram connection opened for call: ${callSid}`);
  });

  connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
    const transcript = data.channel?.alternatives?.[0]?.transcript;
    
    if (!transcript) return;

    const isFinal = data.is_final;
    const speaker = data.channel?.alternatives?.[0]?.words?.[0]?.speaker;

    if (isFinal) {
      console.log(`\n📝 [FINAL] Call ${callSid}: "${transcript}"`);
      // TODO: Send this to Gemini for processing
      // TODO: Store in Supabase
    } else {
      // Partial transcript - can be useful for real-time UI updates
      console.log(`⏳ [PARTIAL] Call ${callSid}: "${transcript}"`);
    }
  });

  connection.on(LiveTranscriptionEvents.Error, (error: any) => {
    console.error(`❌ Deepgram error for call ${callSid}:`, error);
  });

  connection.on(LiveTranscriptionEvents.Close, () => {
    console.log(`🔌 Deepgram connection closed for call: ${callSid}`);
  });

  return connection;
}

// Start server
httpServer.listen(PORT, () => {
  console.log('\n🚨 DispatchIQ Server');
  console.log('================================');
  console.log(`✅ HTTP Server: http://localhost:${PORT}`);
  console.log(`✅ WebSocket: ws://localhost:${PORT}/twilio/media`);
  console.log(`✅ Health check: http://localhost:${PORT}/health`);
  console.log('\n📞 Twilio webhook URL: POST http://localhost:${PORT}/twilio/voice');
  console.log('🔌 Active connections: 0\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, closing server...');
  
  // Close all Deepgram connections
  activeConnections.forEach((connection, callSid) => {
    console.log(`Closing Deepgram connection for call: ${callSid}`);
    connection.finish();
  });
  activeConnections.clear();

  httpServer.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
