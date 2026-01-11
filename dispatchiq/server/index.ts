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
import { WebSocketServer, WebSocket } from 'ws';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { WebSocket as WSType } from 'ws';

// Environment variables
const PORT = process.env.PORT || 3001;
const PUBLIC_HOST = process.env.PUBLIC_HOST;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const AURA_VOICE = process.env.AURA_VOICE || 'aura-asteria-en'; // default to known working voice
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOICE_MODE = (process.env.VOICE_MODE || 'ai').toLowerCase(); // 'ai' | 'dispatcher'

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
  const startTime = Date.now();
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
  
  const elapsed = Date.now() - startTime;
  console.log(`📡 Broadcast: ${successCount} sent, ${failCount} failed (${elapsed}ms)`);
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

// Simple state tracking per call for LLM + TTS
type Urgency = 'Low' | 'Medium' | 'Critical';
interface IncidentDetails {
  location: string | null;
  type: string | null;
  injuries: string | null;
  threatLevel: string | null;
  peopleCount: string | null;
  callerRole: string | null;
}
interface TranscriptMessage {
  id: string;
  sender: 'caller' | 'dispatcher';
  text: string;
  timestamp: Date;
  isPartial?: boolean;
}
interface CallState {
  messages: TranscriptMessage[];
  incident: IncidentDetails;
  urgency: Urgency;
  nextQuestion: string | null;
}
const callStateMap = new Map<string, CallState>();
const callSessionMap = new Map<
  string,
  { ws: WSType; streamSid: string; tts?: WebSocket; speaking?: boolean; outSeq?: number; canSpeak?: boolean }
>();

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
  const broadcastStartTime = Date.now();
  
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
  
  broadcastToDashboard(transcriptData);
  const broadcastElapsed = Date.now() - broadcastStartTime;

  // Also store in Supabase if configured
  if (!supabase) {
    console.log(`   ⏱️  Broadcast only: ${broadcastElapsed}ms (no DB)`);
    return;
  }

  try {
    const dbStartTime = Date.now();
    const callId = callIdMap.get(callSid);
    
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
    
    const dbElapsed = Date.now() - dbStartTime;
    console.log(`   ⏱️  Broadcast: ${broadcastElapsed}ms, DB: ${dbElapsed}ms`);
  } catch (error) {
    console.error('❌ Error storing transcript:', error);
  }
}

// Helper: End call record
async function endCallRecord(callSid: string) {
  if (!supabase) return;

  try {
    const { error } = await (supabase as any)
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

  // Your dispatcher phone number (optional)
  const DISPATCHER_PHONE = process.env.DISPATCHER_PHONE;

  // Determine routing mode: prefer query param for quick overrides; fall back to env
  const requestedMode = (typeof req.query?.mode === 'string' ? (req.query.mode as string) : VOICE_MODE).toLowerCase();
  const isDispatcherMode = requestedMode === 'dispatcher' && !!DISPATCHER_PHONE;
  console.log(`🎛️  Voice mode selected: ${requestedMode}${isDispatcherMode ? ' (dispatcher)' : ' (ai)'}${DISPATCHER_PHONE ? '' : ' [no DISPATCHER_PHONE set]'}`);

  let twiml;

  if (isDispatcherMode) {
    // DISPATCHER MODE: Ring dispatcher and stream audio for logging/assist
    console.log('📱 Dispatcher mode: Call will ring', DISPATCHER_PHONE);
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${websocketUrl}" track="both_tracks" />
  </Connect>
  <Dial>${DISPATCHER_PHONE}</Dial>
  <Pause length="3600"/>
</Response>`;
  } else {
    // AI AGENT MODE: Caller talks to AI via our server
    // Use <Connect><Stream> for BIDIRECTIONAL audio - this allows us to send TTS back to caller
    // Note: <Connect> is inherently bidirectional - no track attribute needed (or use inbound_track)
    // Note: <Connect> pauses TwiML execution until stream disconnects, so no <Pause> needed
    // The initial greeting will be spoken via TTS through the WebSocket
    console.log('🤖 AI mode: Caller will interact with AI agent (bidirectional stream)');
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${websocketUrl}" />
  </Connect>
</Response>`;
  }

  // Set Content-Type explicitly
  res.set('Content-Type', 'text/xml');
  res.send(twiml);
  
  console.log('✅ TwiML response sent with WebSocket URL:', websocketUrl);
});

// WebSocket handler for Twilio Media Streams
wss.on('connection', (ws: WSType, req) => {
  console.log('🔌 Twilio WebSocket connected from:', req.socket.remoteAddress);
  console.log('   Path:', req.url);
  console.log('   Headers:', JSON.stringify(req.headers, null, 2));
  
  let callSid: string | null = null;
  let deepgramConnection: any = null;
  let messageCount = 0;
  let audioPacketCount = 0;
  let firstAudioPacketTime: number | null = null;
  let lastAudioPacketTime: number | null = null;

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
          console.log(`   Track config: ${msg.start.tracks?.join(', ') || 'inbound_track (default)'}`);

          // For demo purposes, ALWAYS use single-channel (caller only)
          // Even if Twilio sends both tracks, we'll ignore the dispatcher track
          // This gives us real-time performance since we only process 1 audio stream
          const isTwoWay = false; // Force single-channel for performance
          console.log(`   Mode: SINGLE-CHANNEL (caller only) for real-time performance`);
          console.log(`   ⚠️  Multichannel disabled to prevent lag`);

          // Create call record in Supabase
          await createCallRecord(callSid, msg.start.streamSid);

          // Track session and initial state
          const tracks = (msg.start.tracks || ['inbound']).map((t: string) => t.toLowerCase());
          // With <Connect><Stream>, we can ALWAYS send audio back (bidirectional by design)
          // The tracks array just shows what Twilio is sending TO us, not what we can send back
          // Force canSpeak=true since we're using <Connect> not <Start>
          const canSpeak = true;
          console.log(`   🔊 Bidirectional mode: tracks=[${tracks.join(', ')}], canSpeak=${canSpeak} (forced for <Connect>)`);
          callSessionMap.set(callSid, { ws, streamSid: msg.start.streamSid, canSpeak });
          callStateMap.set(callSid, {
            messages: [],
            incident: {
              location: null,
              type: null,
              injuries: null,
              threatLevel: null,
              peopleCount: null,
              callerRole: null,
            },
            urgency: 'Low',
            nextQuestion: null,
          });

          // Initialize Deepgram connection with correct channel configuration
          deepgramConnection = await initDeepgramConnection(callSid, isTwoWay);
          activeConnections.set(callSid, deepgramConnection);
          
          // Send initial greeting via TTS (since we're using bidirectional stream without <Say>)
          // Small delay to ensure WebSocket is fully established
          const currentCallSid = callSid; // Capture for closure
          setTimeout(() => {
            const session = callSessionMap.get(currentCallSid);
            if (session?.canSpeak) {
              console.log('🎙️ Sending initial greeting via TTS');
              void startAuraTts(currentCallSid, '911, what is your emergency? Please describe the situation.');
            }
          }, 500);
          break;

        case 'media':
          // Forward only inbound/caller audio to Deepgram
          if (deepgramConnection && msg.media.payload) {
            const track = (msg.media as any).track?.toLowerCase?.() || 'inbound';
            if (track !== 'inbound' && track !== 'inbound_track') {
              // Ignore outbound/media we generate ourselves or TwiML <Say>
              break;
            }

            audioPacketCount++;
            const now = Date.now();
            
            if (!firstAudioPacketTime) {
              firstAudioPacketTime = now;
              console.log(`🎵 First audio packet received`);
            }
            lastAudioPacketTime = now;
            
            // Log every 100 packets to track throughput
            if (audioPacketCount % 100 === 0) {
              const elapsed = (now - firstAudioPacketTime) / 1000;
              const packetsPerSec = audioPacketCount / elapsed;
              console.log(`🎵 Audio packets: ${audioPacketCount} (${packetsPerSec.toFixed(1)}/sec)`);
            }
            
            const audioBuffer = Buffer.from(msg.media.payload, 'base64');
            deepgramConnection.send(audioBuffer);
          }
          break;

        case 'stop':
          console.log(`🛑 Call ended: ${msg.stop.callSid}`);
          
          // End call record in Supabase
          await endCallRecord(msg.stop.callSid);

          // Broadcast call ended to dashboard
          broadcastToDashboard({
            type: 'call_ended',
            call_sid: msg.stop.callSid,
            timestamp: new Date().toISOString()
          });
          
          // Clean up Deepgram connection
          if (deepgramConnection) {
            deepgramConnection.finish();
            if (callSid) {
              activeConnections.delete(callSid);
            }
          }
          
          // Clean up TTS/session
          const session = callSessionMap.get(msg.stop.callSid);
          if (session?.tts) {
            try {
              if ((session.tts as any).readyState === WebSocket.OPEN) {
                (session.tts as any).close();
              }
            } catch {}
            session.tts = undefined as any;
          }
          callSessionMap.delete(msg.stop.callSid);

          // Generate final report (best-effort) then drop state
          const finalState = callStateMap.get(msg.stop.callSid);
          if (finalState) {
            void generateReport(msg.stop.callSid, finalState);
          }
          callStateMap.delete(msg.stop.callSid);
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
    if (callSid) {
      const session = callSessionMap.get(callSid);
      if (session?.tts) {
        try {
          if ((session.tts as any).readyState === WebSocket.OPEN) {
            (session.tts as any).close();
          }
        } catch {}
        session.tts = undefined as any;
      }
      callSessionMap.delete(callSid);
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
    if (callSid) {
      const session = callSessionMap.get(callSid);
      if (session?.tts) {
        try {
          if ((session.tts as any).readyState === WebSocket.OPEN) {
            (session.tts as any).close();
          }
        } catch {}
        session.tts = undefined as any;
      }
      callSessionMap.delete(callSid);
    }
  });
});

// Initialize Deepgram live transcription for a call
async function initDeepgramConnection(callSid: string, isTwoWay: boolean = false) {
  console.log(`🎤 Initializing Deepgram for call: ${callSid}`);
  console.log(`   Configuration: Mono (1 channel - caller only)`);

  const deepgram = createClient(DEEPGRAM_API_KEY);

  // Always use single-channel with optimal settings for real-time performance
  const deepgramConfig: any = {
    encoding: 'mulaw',
    sample_rate: 8000,
    channels: 1,  // Single channel = caller only
    punctuate: true,
    interim_results: true,  // Enable interim for live feel
    smart_format: true,
    model: 'nova-2-phonecall',  // Use accurate model since we're only processing 1 channel
    endpointing: 300,  // Aggressive endpointing (300ms silence = end of utterance)
  };

  // No multichannel needed - we only process caller audio
  const connection = deepgram.listen.live(deepgramConfig);

  // Keepalive for Deepgram connection
  const keepAliveInterval = setInterval(() => {
    if (connection.getReadyState() === 1) { // OPEN
      connection.keepAlive();
    }
  }, 3000);

  // Handle transcript events
  connection.on(LiveTranscriptionEvents.Open, () => {
    console.log(`✅ Deepgram connection opened for call: ${callSid}`);
  });

  // Track metadata for debugging
  connection.on(LiveTranscriptionEvents.Metadata, (data: any) => {
    console.log(`📊 Deepgram metadata for ${callSid}:`, {
      request_id: data.request_id,
      model_info: data.model_info,
      channels: data.channels
    });
  });

  connection.on(LiveTranscriptionEvents.Transcript, async (data: any) => {
    const receiveTime = Date.now();
    const transcript = data.channel?.alternatives?.[0]?.transcript;
    const isFinal = data.is_final;
    const confidence = data.channel?.alternatives?.[0]?.confidence;
    const duration = data.duration; // Audio duration from Deepgram
    const start = data.start; // Start time in audio stream
    
    // Skip if no transcript
    if (!transcript) {
      return;
    }
    
    // Always caller since we're in single-channel mode
    const sender: 'caller' | 'dispatcher' = 'caller';

    if (isFinal) {
      console.log(`\n📝 [FINAL] ${sender.toUpperCase()}: "${transcript}"`);
      console.log(`   Confidence: ${confidence}`);
      console.log(`   ⏱️  Audio duration: ${duration}s, Audio start: ${start}s`);
      
      const storeStartTime = Date.now();
      // Store final transcript
      await storeTranscript(callSid, sender, transcript, true, confidence);
      const storeEndTime = Date.now();
      
      console.log(`   ⏱️  Storage latency: ${storeEndTime - storeStartTime}ms`);
      console.log(`   ⏱️  Total processing time: ${storeEndTime - receiveTime}ms`);

      // Track and analyze latest transcript
      const state = callStateMap.get(callSid);
      if (state) {
        const msgObj: TranscriptMessage = {
          id: Date.now().toString(),
          sender,
          text: transcript,
          timestamp: new Date(),
          isPartial: false,
        };
        state.messages.push(msgObj);
        void analyzeAndBroadcast(callSid, state);
      }
    } else {
      // Partial transcript: use for barge-in detection while TTS is speaking
      const session = callSessionMap.get(callSid);
      if (session?.speaking && session.streamSid) {
        console.log('🛑 Barge-in detected from caller speech. Clearing TTS playback.');
        try { sendTwilioClear(session.ws, session.streamSid); } catch (e) { console.error('❌ Failed to send clear during barge-in:', e); }
        session.speaking = false;
        if (session.tts && (session.tts as any)?.abort) {
          try { (session.tts as any).abort(); } catch {}
          session.tts = undefined as any;
        }
      }
    }
  });

  connection.on(LiveTranscriptionEvents.Error, (error: any) => {
    console.error(`❌ Deepgram error for call ${callSid}:`, error);
  });

  connection.on(LiveTranscriptionEvents.Close, () => {
    console.log(`🔌 Deepgram connection closed for call: ${callSid}`);
    clearInterval(keepAliveInterval);
  });

  return connection;
}

// --- LLM + TTS helpers ---

function sendTwilioMedia(session: { ws: WSType; streamSid: string }, payloadBase64: string) {
  // Check WebSocket state before sending
  const wsState = session.ws.readyState;
  if (wsState !== 1) { // 1 = OPEN
    console.error(`❌ Cannot send media: WebSocket not open (state: ${wsState})`);
    return;
  }
  
  // Twilio expects media messages with an incrementing chunk and timestamp
  const chunk = ((session as any).outSeq ?? 0) + 1;
  (session as any).outSeq = chunk;
  const timestamp = Date.now().toString();
  const message: any = {
    event: 'media',
    streamSid: session.streamSid,
    media: {
      payload: payloadBase64,
    },
  };
  try {
    session.ws.send(JSON.stringify(message));
    if (chunk === 1) {
      console.log('📤 Sent first outbound audio chunk to Twilio');
      console.log(`   StreamSid: ${session.streamSid}`);
      console.log(`   Payload size: ${payloadBase64.length} chars`);
    } else if (chunk % 50 === 0) {
      console.log(`📤 Outbound audio chunks sent: ${chunk}`);
    }
  } catch (error) {
    console.error('❌ Failed to send media to Twilio:', error);
  }
}

function sendTwilioClear(ws: WSType, streamSid: string) {
  try {
    ws.send(JSON.stringify({ event: 'clear', streamSid }));
  } catch (error) {
    console.error('❌ Failed to send clear to Twilio:', error);
  }
}

async function startAuraTts(callSid: string, text: string) {
  console.log(`🚀 Starting Aura TTS for ${callSid} with text: "${text}"`);
  const session = callSessionMap.get(callSid);
  if (!session) {
    console.error(`❌ No session found for ${callSid} in startAuraTts`);
    return;
  }

  // Abort any existing TTS stream for this call
  if (session.tts && (session.tts as any)?.abort) {
    try { (session.tts as any).abort(); } catch {}
    session.tts = undefined as any;
  }

  const controller = new AbortController();
  session.tts = controller as any;
  session.speaking = true;

  const ttsUrl = `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(AURA_VOICE)}&encoding=mulaw&sample_rate=8000`;
  try {
    const resp = await fetch(ttsUrl, {
      method: 'POST',
      headers: {
        Authorization: `Token ${DEEPGRAM_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'audio/mulaw',
      },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    } as any);

    if (!resp.ok || !resp.body) {
      console.error(`❌ Aura TTS HTTP error: ${resp.status} ${resp.statusText}`);
      session.speaking = false;
      session.tts = undefined as any;
      return;
    }

    console.log('🔊 TTS HTTP stream started');
    let loggedOnce = false;
    const reader: any = (resp.body as any).getReader ? (resp.body as any).getReader() : null;

    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
        const payload = buffer.toString('base64');
        sendTwilioMedia(session, payload);
        if (!loggedOnce) {
          console.log('🎵 Receiving TTS audio chunks from Deepgram (HTTP)...');
          loggedOnce = true;
        }
      }
    } else {
      // Node 18+ web streams are async iterable
      for await (const chunk of resp.body as any) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const payload = buffer.toString('base64');
        sendTwilioMedia(session, payload);
        if (!loggedOnce) {
          console.log('🎵 Receiving TTS audio chunks from Deepgram (HTTP)...');
          loggedOnce = true;
        }
      }
    }
  } catch (error) {
    if ((error as any).name === 'AbortError') {
      console.log('🛑 TTS HTTP stream aborted');
    } else {
      console.error('❌ Aura TTS HTTP error:', error);
    }
  } finally {
    const s = callSessionMap.get(callSid);
    if (s) {
      s.speaking = false;
      s.tts = undefined as any;
    }
  }
}

// Call Gemini analysis via Next API and broadcast updates
async function analyzeAndBroadcast(callSid: string, state: CallState) {
  console.log(`🔍 Starting analysis for ${callSid}...`);
  try {
    const response = await fetch('http://localhost:3000/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: state.messages,
        incident: state.incident,
        urgency: state.urgency,
      }),
    });
    if (!response.ok) {
      console.error(`❌ Analysis HTTP error ${response.status}`);
      return;
    }
    const data = await response.json();
    console.log(`🧠 Analysis result for ${callSid}:`, JSON.stringify(data, null, 2)); // Debug log

    const { updates, nextQuestion } = data;
    if (updates) {
      const { urgency, ...fields } = updates;
      if (urgency) state.urgency = urgency as Urgency;
      state.incident = { ...state.incident, ...fields };
    }
    if (nextQuestion !== undefined) {
      const prev = state.nextQuestion;
      state.nextQuestion = nextQuestion;
      
      console.log(`🤔 Question check: Prev="${prev}", New="${nextQuestion}"`);
      
      if (nextQuestion && nextQuestion !== prev) {
        const session = callSessionMap.get(callSid);
        if (session?.streamSid && session?.canSpeak) {
          console.log(`🤖 AI decided to speak: "${nextQuestion}"`);
          void startAuraTts(callSid, nextQuestion);
        } else {
          console.warn(`⚠️ Cannot speak: Media stream is inbound-only; skipping TTS for ${callSid}`);
        }
      } else {
          console.log('🤐 AI decided NOT to speak (question same or empty)');
      }
    }

    broadcastToDashboard({
      type: 'analysis',
      call_sid: callSid,
      incident: state.incident,
      urgency: state.urgency,
      nextQuestion: state.nextQuestion,
    });
  } catch (error) {
    console.error('❌ Error calling analysis API:', error);
  }
}

// Generate final report via Next API
async function generateReport(callSid: string, state: CallState) {
  try {
    const response = await fetch('http://localhost:3000/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: state.messages,
        incident: state.incident,
        urgency: state.urgency,
        callId: callSid,
        dispatcherId: 'auto',
        callType: state.incident.type || 'Unknown',
        startedAt: state.messages[0]?.timestamp,
        endedAt: state.messages[state.messages.length - 1]?.timestamp,
      }),
    });
    if (!response.ok) {
      console.error(`❌ Report HTTP error ${response.status}`);
      return;
    }
    const data = await response.json();
    broadcastToDashboard({
      type: 'report',
      call_sid: callSid,
      storagePath: data.storagePath,
      publicUrl: data.publicUrl,
    });
  } catch (error) {
    console.error('❌ Error generating report:', error);
  }
}

// Start server
httpServer.listen(Number(PORT), '0.0.0.0', () => {
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
