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
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { WebSocket as WSType } from 'ws';

// Environment variables
const PORT = process.env.PORT || 3001;
const PUBLIC_HOST = process.env.PUBLIC_HOST;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!DEEPGRAM_API_KEY) {
  console.error('❌ DEEPGRAM_API_KEY is required');
  process.exit(1);
}

if (!PUBLIC_HOST) {
  console.warn('⚠️  PUBLIC_HOST not set. Make sure to configure Twilio with your actual WebSocket URL.');
}

// Initialize Supabase (optional - will work without it but won't store data)
let supabase: ReturnType<typeof createSupabaseClient> | null = null;

if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
  supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  console.log('✅ Supabase client initialized');
} else {
  console.warn('⚠️  Supabase not configured. Transcripts will only appear in console.');
}

// Create Express app and HTTP server
const app = express();
const httpServer = createServer(app);

// Create WebSocket server for Twilio Media Streams with strict options
const wss = new WebSocketServer({ 
  noServer: true  // We'll handle the upgrade manually
});

// Create WebSocket server for Dashboard clients
const dashboardWss = new WebSocketServer({ 
  noServer: true
});

// Manual WebSocket upgrade handler
httpServer.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url!, `http://${request.headers.host}`).pathname;
  
  console.log(`🔄 WebSocket upgrade request for: ${pathname}`);

  if (pathname === '/twilio/media') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else if (pathname === '/dashboard') {
    dashboardWss.handleUpgrade(request, socket, head, (ws) => {
      dashboardWss.emit('connection', ws, request);
    });
  } else {
    console.log(`❌ Unknown WebSocket path: ${pathname}`);
    socket.destroy();
  }
});

// Store connected dashboard clients
const dashboardClients = new Set<WSType>();

// Handle dashboard WebSocket connections
dashboardWss.on('connection', (ws: WSType) => {
  console.log(`📱 Dashboard client connected (total: ${dashboardClients.size + 1})`);
  dashboardClients.add(ws);

  ws.on('close', () => {
    console.log(`📱 Dashboard client disconnected (remaining: ${dashboardClients.size - 1})`);
    dashboardClients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('❌ Dashboard WebSocket error:', error);
    dashboardClients.delete(ws);
  });
});

// Helper: Broadcast transcript to all dashboard clients
function broadcastToDashboard(data: any) {
  const message = JSON.stringify(data);
  let successCount = 0;
  let failCount = 0;
  
  dashboardClients.forEach((client) => {
    if (client.readyState === 1) { // 1 = OPEN
      try {
        client.send(message);
        successCount++;
      } catch (error) {
        console.error('❌ Failed to send to dashboard client:', error);
        failCount++;
      }
    } else {
      failCount++;
    }
  });
  
  console.log(`📡 Broadcast result: ${successCount} sent, ${failCount} failed, ${dashboardClients.size} total clients`);
}

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

// Store call IDs mapping (callSid -> database call_id)
const callIdMap = new Map<string, string>();

// Helper: Create call record in Supabase
async function createCallRecord(callSid: string, streamSid: string) {
  console.log(`💾 Attempting to create call record for ${callSid}...`);
  
  if (!supabase) {
    console.warn('⚠️  Supabase not available - skipping database insert');
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('calls')
      .insert({
        call_sid: callSid,
        stream_sid: streamSid,
        status: 'active'
      } as any)
      .select()
      .single();

    if (error) {
      console.error('❌ Supabase error details:', JSON.stringify(error, null, 2));
      throw error;
    }
    
    callIdMap.set(callSid, (data as any).id);
    console.log(`✅ Call record created successfully: ${(data as any).id}`);
    return (data as any).id;
  } catch (error) {
    console.error('❌ Error creating call record:', error);
    return null;
  }
}

// Helper: Store transcript in Supabase
async function storeTranscript(
  callSid: string,
  sender: 'caller' | 'dispatcher',
  text: string,
  isFinal: boolean,
  confidence?: number
) {
  // Always broadcast to dashboard clients immediately
  const transcriptData = {
    type: 'transcript',
    id: Date.now().toString() + Math.random(),
    call_sid: callSid,
    sender,
    text,
    is_final: isFinal,
    is_partial: !isFinal,
    confidence,
    timestamp: new Date().toISOString()
  };
  
  console.log(`📡 Broadcasting transcript to ${dashboardClients.size} dashboard client(s)`);
  broadcastToDashboard(transcriptData);

  // Also store in Supabase if configured
  if (!supabase) {
    console.warn('⚠️  Supabase not available - transcript not stored in DB');
    return;
  }

  try {
    const callId = callIdMap.get(callSid);
    
    console.log(`💾 Storing transcript for ${callSid} (call_id: ${callId}): "${text.substring(0, 30)}..."`);
    
    const { error } = await supabase
      .from('transcripts')
      .insert({
        call_id: callId,
        call_sid: callSid,
        sender,
        text,
        is_final: isFinal,
        is_partial: !isFinal,
        confidence
      } as any);

    if (error) {
      console.error('❌ Supabase error storing transcript:', JSON.stringify(error, null, 2));
      throw error;
    }
    
    console.log(`✅ Transcript stored successfully in DB`);
  } catch (error) {
    console.error('❌ Error storing transcript:', error);
  }
}

// Helper: End call record
async function endCallRecord(callSid: string) {
  if (!supabase) return;

  try {
    const { error } = await supabase
      .from('calls')
      .update({
        status: 'ended',
        ended_at: new Date().toISOString()
      } as any)
      .eq('call_sid', callSid);

    if (error) throw error;
    
    callIdMap.delete(callSid);
    console.log(`💾 Call ended: ${callSid}`);
  } catch (error) {
    console.error('❌ Error ending call record:', error);
  }
}

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

  // Your dispatcher phone number (the number that will receive the call)
  const DISPATCHER_PHONE = process.env.DISPATCHER_PHONE || '+1234567890'; // Change this!

  // TwiML that streams audio AND connects the call to dispatcher
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="${websocketUrl}" track="both_tracks" />
  </Start>
  <Dial>${DISPATCHER_PHONE}</Dial>
</Response>`;

  // Set Content-Type explicitly
  res.set('Content-Type', 'text/xml');
  res.send(twiml);
  
  console.log('✅ TwiML response sent with WebSocket URL:', websocketUrl);
  console.log('📱 Call will ring:', DISPATCHER_PHONE);
});

// WebSocket handler for Twilio Media Streams
wss.on('connection', (ws: WSType, req) => {
  console.log('🔌 Twilio WebSocket connected from:', req.socket.remoteAddress);
  console.log('   Path:', req.url);
  console.log('   Headers:', JSON.stringify(req.headers, null, 2));
  
  let callSid: string | null = null;
  let deepgramConnection: any = null;
  let messageCount = 0;

  ws.on('message', async (message: Buffer) => {
    messageCount++;
    
    try {
      const msg: TwilioMessage = JSON.parse(message.toString());
      

      switch (msg.event) {
        case 'start':
          callSid = msg.start.callSid;
          console.log(`🚨 Call started: ${callSid}`);
          console.log(`   Stream SID: ${msg.start.streamSid}`);
          console.log(`   Media format: ${msg.start.mediaFormat.encoding} @ ${msg.start.mediaFormat.sampleRate}Hz`);

          // Create call record in Supabase
          await createCallRecord(callSid, msg.start.streamSid);

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
          
          // End call record in Supabase
          await endCallRecord(msg.stop.callSid);
          
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
    
    // Clean up on error
    if (deepgramConnection) {
      deepgramConnection.finish();
      if (callSid) {
        activeConnections.delete(callSid);
      }
    }
  });
});

// Initialize Deepgram live transcription for a call
async function initDeepgramConnection(callSid: string) {
  console.log(`🎤 Initializing Deepgram for call: ${callSid}`);

  const deepgram = createClient(DEEPGRAM_API_KEY);

  const connection = deepgram.listen.live({
    encoding: 'mulaw',
    sample_rate: 8000,
    channels: 2,  // Changed to 2 for both_tracks (caller + dispatcher)
    punctuate: true,
    interim_results: true,
    smart_format: true,
    model: 'nova-2',
    multichannel: true,  // Enable multichannel transcription
  });

  // Handle transcript events
  connection.on(LiveTranscriptionEvents.Open, () => {
    console.log(`✅ Deepgram connection opened for call: ${callSid}`);
  });

  connection.on(LiveTranscriptionEvents.Transcript, async (data: any) => {
    // Debug: Log the entire data structure to understand what we're getting
    // console.log('🔍 Raw Deepgram data:', JSON.stringify(data).substring(0, 200) + '...');
    
    // With multichannel, Deepgram sends separate events for each channel
    // channel_index tells us which channel this is
    const channelIndex = data.channel_index?.[0]; // First element is the channel number
    const transcript = data.channel?.alternatives?.[0]?.transcript;
    const isFinal = data.is_final;
    const confidence = data.channel?.alternatives?.[0]?.confidence;
    
    // Skip if no transcript
    if (!transcript) {
      return;
    }
    
    // Channel 0 = Caller (inbound)
    // Channel 1 = Dispatcher (outbound)  
    const sender = channelIndex === 0 ? 'caller' : 'dispatcher';

    if (isFinal) {
      console.log(`\n📝 [FINAL] ${sender.toUpperCase()}: "${transcript}"`);
      console.log(`   Channel: ${channelIndex}, Confidence: ${confidence}`);
      
      // Store final transcript in Supabase
      await storeTranscript(callSid, sender, transcript, true, confidence);
    } else {
      // Partial transcript - can be useful for real-time UI updates
      console.log(`⏳ [PARTIAL] ${sender.toUpperCase()}: "${transcript}"`);
      
      // Optionally store partial transcripts (commented out to reduce DB writes)
      // await storeTranscript(callSid, sender, transcript, false, confidence);
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
