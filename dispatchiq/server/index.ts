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
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { WebSocket as WSType } from 'ws';

// Environment variables
const PORT = process.env.PORT || 3001;
const PUBLIC_HOST = process.env.PUBLIC_HOST;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// OpenAI Realtime API config
// Try these model names if one doesn't work:
//   gpt-4o-realtime-preview-2024-12-17  (older, but widely available)
//   gpt-4o-realtime-preview             (latest preview)
//   gpt-4o-mini-realtime-preview-2024-12-17  (cheaper, might have wider access)
const OPENAI_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17';
const OPENAI_REALTIME_URL = `wss://api.openai.com/v1/realtime?model=${OPENAI_MODEL}`;
const VOICE = process.env.OPENAI_VOICE || 'alloy'; // Options: alloy, echo, shimmer (avoid fable, onyx, nova with Twilio)

if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY is required');
  process.exit(1);
}

console.log(`🤖 OpenAI Realtime Model: ${OPENAI_MODEL}`);
console.log(`   If you get "model not found" errors, try setting OPENAI_REALTIME_MODEL in .env.local`);

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
  if (successCount > 0 || failCount > 0) {
    console.log(`📡 Broadcast: ${successCount} sent, ${failCount} failed (${elapsed}ms)`);
  }
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

// Store call IDs mapping (callSid -> database call_id)
const callIdMap = new Map<string, string>();

// Simple state tracking per call
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

// Store active OpenAI connections per call
interface CallSession {
  twilioWs: WSType;
  openaiWs: WebSocket;
  streamSid: string;
  callSid: string;
}
const callSessionMap = new Map<string, CallSession>();

// System prompt for the 911 dispatcher AI
const SYSTEM_INSTRUCTIONS = `You are a calm, professional 911 emergency dispatcher AI assistant. Your job is to help gather critical information from callers in distress.

CRITICAL GUIDELINES:
1. Stay calm and speak clearly at all times
2. Ask ONE question at a time - never multiple questions
3. Prioritize gathering: location, nature of emergency, injuries, number of people involved, any immediate threats
4. Use short, direct questions like a real dispatcher
5. Show empathy but stay focused on getting information
6. If the caller is in immediate danger, prioritize their safety first
7. Confirm critical details by repeating them back
8. Keep responses brief - no more than 1-2 sentences

START by saying: "911, what is your emergency?"

After getting initial information, prioritize asking about:
- Exact address or location
- Type of emergency (medical, fire, police)
- Are there any injuries?
- Is anyone in immediate danger?
- How many people are involved?`;

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
app.all('/twilio/voice', (req, res) => {
  console.log(`📞 Incoming ${req.method} request to /twilio/voice`);
  
  const websocketUrl = PUBLIC_HOST 
    ? `wss://${PUBLIC_HOST}/twilio/media`
    : `wss://YOUR_NGROK_URL_HERE/twilio/media`;

  // AI Agent mode - bidirectional audio via <Connect><Stream>
  console.log('🤖 AI mode: Caller will interact with OpenAI Realtime API (bidirectional stream)');
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${websocketUrl}" />
  </Connect>
</Response>`;

  res.set('Content-Type', 'text/xml');
  res.send(twiml);
  
  console.log('✅ TwiML response sent with WebSocket URL:', websocketUrl);
});

// Connect to OpenAI Realtime API
function connectToOpenAI(callSid: string, streamSid: string, twilioWs: WSType): WebSocket {
  console.log(`🔌 Connecting to OpenAI Realtime API for call: ${callSid}`);
  console.log(`   URL: ${OPENAI_REALTIME_URL}`);
  
  const openaiWs = new WebSocket(OPENAI_REALTIME_URL, {
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'OpenAI-Beta': 'realtime=v1'
    }
  });

  openaiWs.on('open', () => {
    console.log(`✅ OpenAI Realtime connection opened for call: ${callSid}`);
    
    // Configure the session - must match Twilio's mulaw format
    const sessionConfig = {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: SYSTEM_INSTRUCTIONS,
        voice: VOICE,
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        input_audio_transcription: {
          model: 'whisper-1'
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 700
        }
      }
    };
    
    console.log(`📤 Sending session config:`, JSON.stringify(sessionConfig.session, null, 2));
    openaiWs.send(JSON.stringify(sessionConfig));

    // Send initial greeting by creating a conversation item first
    setTimeout(() => {
      // Method 1: Create a user message to trigger AI response
      const conversationItem = {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: '[Call connected - greet the caller]'
            }
          ]
        }
      };
      openaiWs.send(JSON.stringify(conversationItem));
      console.log(`📤 Sent conversation item to trigger greeting`);

      // Then request a response
      setTimeout(() => {
        const responseCreate = {
          type: 'response.create'
        };
        openaiWs.send(JSON.stringify(responseCreate));
        console.log(`📤 Requested response from OpenAI`);
      }, 100);
    }, 300);
  });

  openaiWs.on('message', (data: Buffer) => {
    try {
      const event = JSON.parse(data.toString());
      handleOpenAIEvent(callSid, streamSid, twilioWs, event);
    } catch (error) {
      console.error('❌ Error parsing OpenAI message:', error);
    }
  });

  openaiWs.on('close', (code, reason) => {
    console.log(`🔌 OpenAI connection closed for ${callSid}: ${code} - ${reason}`);
  });

  openaiWs.on('error', (error) => {
    console.error(`❌ OpenAI WebSocket error for ${callSid}:`, error);
  });

  return openaiWs;
}

// Handle events from OpenAI Realtime API
function handleOpenAIEvent(callSid: string, streamSid: string, twilioWs: WSType, event: any) {
  const eventType = event.type;
  
  switch (eventType) {
    case 'session.created':
      console.log(`✅ OpenAI session created for ${callSid}`);
      break;

    case 'session.updated':
      console.log(`✅ OpenAI session updated for ${callSid}`);
      break;

    case 'response.audio.delta':
      // Stream audio back to Twilio
      if (event.delta) {
        // Track audio chunks for debugging
        const session = callSessionMap.get(callSid);
        if (session) {
          (session as any).audioChunksSent = ((session as any).audioChunksSent || 0) + 1;
          if ((session as any).audioChunksSent === 1) {
            console.log(`🔊 First audio chunk received from OpenAI for ${callSid}`);
          } else if ((session as any).audioChunksSent % 50 === 0) {
            console.log(`🔊 Audio chunks sent to Twilio: ${(session as any).audioChunksSent}`);
          }
        }

        const audioMessage = {
          event: 'media',
          streamSid: streamSid,
          media: {
            payload: event.delta // Already base64 encoded g711_ulaw
          }
        };
        
        if (twilioWs.readyState === WebSocket.OPEN) {
          twilioWs.send(JSON.stringify(audioMessage));
        } else {
          console.warn(`⚠️  Twilio WebSocket not open (state: ${twilioWs.readyState})`);
        }
      }
      break;

    case 'response.audio_transcript.delta':
      // AI's response transcript (partial)
      if (event.delta) {
        console.log(`🤖 AI speaking (partial): ${event.delta}`);
      }
      break;

    case 'response.audio_transcript.done':
      // AI's complete response transcript
      if (event.transcript) {
        console.log(`🤖 AI spoke: "${event.transcript}"`);
        void storeTranscript(callSid, 'dispatcher', event.transcript, true);
        
        // Update call state
        const state = callStateMap.get(callSid);
        if (state) {
          state.messages.push({
            id: Date.now().toString(),
            sender: 'dispatcher',
            text: event.transcript,
            timestamp: new Date(),
            isPartial: false
          });
        }
      }
      break;

    case 'conversation.item.input_audio_transcription.completed':
      // Caller's speech transcript (what they said)
      if (event.transcript) {
        console.log(`📝 Caller said: "${event.transcript}"`);
        void storeTranscript(callSid, 'caller', event.transcript, true);
        
        // Update call state and trigger analysis
        const state = callStateMap.get(callSid);
        if (state) {
          state.messages.push({
            id: Date.now().toString(),
            sender: 'caller',
            text: event.transcript,
            timestamp: new Date(),
            isPartial: false
          });
          
          // Run analysis in background (doesn't block audio)
          void analyzeAndBroadcast(callSid, state);
        }
      }
      break;

    case 'input_audio_buffer.speech_started':
      console.log(`🎤 Caller started speaking (${callSid})`);
      break;

    case 'input_audio_buffer.speech_stopped':
      console.log(`🎤 Caller stopped speaking (${callSid})`);
      break;

    case 'response.done':
      console.log(`✅ OpenAI response complete for ${callSid}`);
      // Log if the response had no output
      if (event.response?.output?.length === 0) {
        console.warn(`⚠️  Response had no output items`);
      }
      if (event.response?.status === 'failed') {
        console.error(`❌ Response failed:`, event.response?.status_details);
      }
      break;

    case 'response.output_item.added':
      console.log(`📦 Output item added: ${event.item?.type}`);
      break;

    case 'response.content_part.added':
      console.log(`📄 Content part added: ${event.part?.type}`);
      break;

    case 'conversation.item.input_audio_transcription.failed':
      // Log the actual error for transcription failures
      console.error(`❌ Transcription failed for ${callSid}:`, JSON.stringify(event.error || event, null, 2));
      break;

    case 'error':
      console.error(`❌ OpenAI error for ${callSid}:`, JSON.stringify(event.error || event, null, 2));
      break;

    default:
      // Log other events at debug level (but not audio deltas which are too frequent)
      if (eventType !== 'response.audio.delta') {
        console.log(`📨 OpenAI event (${callSid}): ${eventType}`);
        // Log full event for debugging
        if (eventType.includes('failed') || eventType.includes('error')) {
          console.log(`   Full event:`, JSON.stringify(event, null, 2));
        }
      }
  }
}

// WebSocket handler for Twilio Media Streams
wss.on('connection', (ws: WSType, req) => {
  console.log('🔌 Twilio WebSocket connected from:', req.socket.remoteAddress);
  
  let callSid: string | null = null;
  let streamSid: string | null = null;
  let openaiWs: WebSocket | null = null;
  let messageCount = 0;
  let audioPacketCount = 0;

  ws.on('message', async (message: Buffer) => {
    messageCount++;
    
    try {
      const msg: TwilioMessage = JSON.parse(message.toString());

      switch (msg.event) {
        case 'start':
          callSid = msg.start.callSid;
          streamSid = msg.start.streamSid;
          console.log(`🚨 Call started: ${callSid}`);
          console.log(`   Stream SID: ${streamSid}`);
          console.log(`   Media format: ${msg.start.mediaFormat.encoding} @ ${msg.start.mediaFormat.sampleRate}Hz`);

          // Create call record in Supabase
          await createCallRecord(callSid, streamSid);

          // Initialize call state
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

          // Connect to OpenAI Realtime API
          openaiWs = connectToOpenAI(callSid, streamSid, ws);
          callSessionMap.set(callSid, {
            twilioWs: ws,
            openaiWs: openaiWs,
            streamSid: streamSid,
            callSid: callSid
          });
          break;

        case 'media':
          // Forward audio to OpenAI
          if (openaiWs && openaiWs.readyState === WebSocket.OPEN && msg.media.payload) {
            audioPacketCount++;
            
            // Log every 100 packets
            if (audioPacketCount % 100 === 0) {
              console.log(`🎵 Audio packets forwarded to OpenAI: ${audioPacketCount}`);
            }
            
            // Send audio to OpenAI (already base64 encoded mulaw from Twilio)
            const audioAppend = {
              type: 'input_audio_buffer.append',
              audio: msg.media.payload
            };
            openaiWs.send(JSON.stringify(audioAppend));
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
          
          // Clean up OpenAI connection
          const session = callSessionMap.get(msg.stop.callSid);
          if (session?.openaiWs) {
            session.openaiWs.close();
          }
          callSessionMap.delete(msg.stop.callSid);

          // Generate final report
          const finalState = callStateMap.get(msg.stop.callSid);
          if (finalState) {
            void generateReport(msg.stop.callSid, finalState);
          }
          callStateMap.delete(msg.stop.callSid);
          break;

        default:
          console.log('📨 Unknown Twilio event:', (msg as any).event);
      }
    } catch (error) {
      console.error('❌ Error processing Twilio message:', error);
    }
  });

  ws.on('close', () => {
    console.log('🔌 Twilio WebSocket disconnected');
    
    // Clean up OpenAI connection
    if (callSid) {
      const session = callSessionMap.get(callSid);
      if (session?.openaiWs) {
        session.openaiWs.close();
      }
      callSessionMap.delete(callSid);
    }
  });

  ws.on('error', (error) => {
    console.error('❌ Twilio WebSocket error:', error);
    
    // Clean up on error
    if (callSid) {
      const session = callSessionMap.get(callSid);
      if (session?.openaiWs) {
        session.openaiWs.close();
      }
      callSessionMap.delete(callSid);
    }
  });
});

// Call Gemini analysis via Next API and broadcast updates
// This runs in background - doesn't block the voice conversation!
async function analyzeAndBroadcast(callSid: string, state: CallState) {
  const analysisStart = Date.now();
  console.log(`🔍 Starting background analysis for ${callSid}...`);
  
  try {
    const response = await fetch('http://localhost:3000/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: state.messages,
        incident: state.incident,
        urgency: state.urgency,
        callSid: callSid
      }),
    });
    
    if (!response.ok) {
      console.error(`❌ Analysis HTTP error ${response.status}`);
      return;
    }
    
    const data = await response.json();
    const analysisTime = Date.now() - analysisStart;
    console.log(`🧠 Analysis complete (${analysisTime}ms) for ${callSid}`);

    const { updates, nextQuestion } = data;
    if (updates) {
      const { urgency, ...fields } = updates;
      if (urgency) state.urgency = urgency as Urgency;
      state.incident = { ...state.incident, ...fields };
    }
    if (nextQuestion !== undefined) {
      state.nextQuestion = nextQuestion;
    }

    // Broadcast analysis results to dashboard
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
  console.log('\n🚨 SignalOne Server (OpenAI Realtime API)');
  console.log('==========================================');
  console.log(`✅ HTTP Server: http://localhost:${PORT}`);
  console.log(`✅ WebSocket: ws://localhost:${PORT}/twilio/media`);
  console.log(`✅ Dashboard: ws://localhost:${PORT}/dashboard`);
  console.log(`✅ Health check: http://localhost:${PORT}/health`);
  console.log('\n📞 Twilio webhook URL: POST http://localhost:${PORT}/twilio/voice');
  console.log(`🎙️  Voice: ${VOICE}`);
  console.log('🔌 Active connections: 0\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, closing server...');
  
  // Close all OpenAI connections
  callSessionMap.forEach((session, callSid) => {
    console.log(`Closing OpenAI connection for call: ${callSid}`);
    session.openaiWs.close();
  });
  callSessionMap.clear();

  httpServer.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
