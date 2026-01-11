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
import { createClient as createDeepgramClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import type { WebSocket as WSType } from 'ws';

// Environment variables
const PORT = process.env.PORT || 3001;
const PUBLIC_HOST = process.env.PUBLIC_HOST;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DISPATCHER_PHONE = process.env.DISPATCHER_PHONE;

// OpenAI Realtime API config (only used for AI Agent mode)
const OPENAI_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17';
const OPENAI_REALTIME_URL = `wss://api.openai.com/v1/realtime?model=${OPENAI_MODEL}`;
const VOICE = process.env.OPENAI_VOICE || 'alloy';

// Validate required API keys
if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY is required for AI Agent mode');
  process.exit(1);
}

if (!DEEPGRAM_API_KEY) {
  console.error('❌ DEEPGRAM_API_KEY is required for human dispatcher transcription');
  process.exit(1);
}

console.log(`🤖 OpenAI Realtime Model: ${OPENAI_MODEL} (for AI Agent mode)`);
console.log(`🎤 Deepgram enabled (for human dispatcher transcription)`);

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

// Create WebSocket server for Dashboard clients (human dispatcher)
const dashboardWss = new WebSocketServer({ 
  noServer: true
});

// Create WebSocket server for AI Monitor clients
const aiMonitorWss = new WebSocketServer({ 
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
  } else if (pathname === '/ai-monitor') {
    aiMonitorWss.handleUpgrade(request, socket, head, (ws) => {
      aiMonitorWss.emit('connection', ws, request);
    });
  } else {
    console.log(`❌ Unknown WebSocket path: ${pathname}`);
    socket.destroy();
  }
});

// Store connected dashboard clients (human dispatcher)
const dashboardClients = new Set<WSType>();

// Store connected AI monitor clients
const aiMonitorClients = new Set<WSType>();

// Handle dashboard WebSocket connections (human dispatcher)
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

// Handle AI monitor WebSocket connections
aiMonitorWss.on('connection', (ws: WSType) => {
  console.log(`🖥️  AI Monitor client connected (total: ${aiMonitorClients.size + 1})`);
  aiMonitorClients.add(ws);

  // Send current AI mode status
  ws.send(JSON.stringify({ type: 'ai_mode_status', aiModeEnabled }));

  // Send all active AI calls
  aiCallsMap.forEach((call) => {
    ws.send(JSON.stringify({ type: 'ai_call_update', call }));
  });

  ws.on('close', () => {
    console.log(`🖥️  AI Monitor client disconnected (remaining: ${aiMonitorClients.size - 1})`);
    aiMonitorClients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('❌ AI Monitor WebSocket error:', error);
    aiMonitorClients.delete(ws);
  });
});

// Helper: Broadcast to all human dispatcher dashboard clients
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
    console.log(`📡 Dashboard broadcast: ${successCount} sent, ${failCount} failed (${elapsed}ms)`);
  }
}

// Helper: Broadcast to all AI monitor clients
function broadcastToAiMonitor(data: any) {
  const startTime = Date.now();
  const message = JSON.stringify(data);
  let successCount = 0;
  let failCount = 0;
  
  aiMonitorClients.forEach((client) => {
    if (client.readyState === 1) { // 1 = OPEN
      try {
        client.send(message);
        successCount++;
      } catch (error) {
        console.error('❌ Failed to send to AI monitor client:', error);
        failCount++;
      }
    } else {
      failCount++;
    }
  });
  
  const elapsed = Date.now() - startTime;
  if (successCount > 0 || failCount > 0) {
    console.log(`🖥️  AI Monitor broadcast: ${successCount} sent, ${failCount} failed (${elapsed}ms)`);
  }
}

// Helper: Update and broadcast AI call to monitor
function updateAiCall(callSid: string, updates: Partial<AIMonitorCall>) {
  const existingCall = aiCallsMap.get(callSid);
  if (existingCall) {
    Object.assign(existingCall, updates);
    broadcastToAiMonitor({ type: 'ai_call_update', call: existingCall });
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

// AI Mode flag - when true, next real call goes to AI monitor instead of live dashboard
let aiModeEnabled = false;

// Store active AI simulation calls
interface AISimulationCall {
  callSid: string;
  scenario: string;
  personality: string;
  context: string;
  messages: TranscriptMessage[];
  incident: IncidentDetails;
  urgency: Urgency;
  actions: AICallAction[];
  status: 'active' | 'completed' | 'pending_action';
  startedAt: Date;
}

interface AICallAction {
  id: string;
  type: 'dispatch' | 'escalate' | 'transfer' | 'info';
  description: string;
  units?: string;
  location?: string;
  status: 'pending' | 'approved' | 'rejected';
  timestamp: Date;
}

const aiSimulationCalls = new Map<string, AISimulationCall>();

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
  isAiMode: boolean;  // Track if this call is in AI mode (routed to AI monitor)
}
const callStateMap = new Map<string, CallState>();
// Track last geocoded address per call to avoid duplicate lookups
const lastGeocodedAddress = new Map<string, string>();

// Store active OpenAI connections per call (AI Agent mode only)
interface CallSession {
  twilioWs: WSType;
  openaiWs: WebSocket;
  streamSid: string;
  callSid: string;
  isAiMode: boolean;  // Track if this call is in AI mode
}
const callSessionMap = new Map<string, CallSession>();

// Store active Deepgram connections per call (Human Dispatcher mode only)
const deepgramConnectionMap = new Map<string, any>();

// Store active real AI calls for the AI monitor (real Twilio calls when AI mode is ON)
interface AIMonitorCall {
  callSid: string;
  scenario: string;
  status: 'active' | 'completed' | 'pending_action';
  urgency: Urgency;
  incident: IncidentDetails;
  messages: TranscriptMessage[];
  actions: AICallAction[];
  startedAt: Date;
  isRealCall: boolean;  // True for real Twilio calls, false for simulations
}
const aiCallsMap = new Map<string, AIMonitorCall>();

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

// Helper: Store transcript in Supabase and broadcast to appropriate dashboard
async function storeTranscript(
  callSid: string,
  sender: 'caller' | 'dispatcher',
  text: string,
  isFinal: boolean,
  confidence?: number
) {
  const broadcastStartTime = Date.now();
  
  // Check if this call is in AI mode
  const callState = callStateMap.get(callSid);
  const isAiMode = callState?.isAiMode ?? false;
  
  // Prepare transcript data
  const transcriptData = {
    type: isAiMode ? 'ai_transcript' : 'transcript',
    id: Date.now().toString() + Math.random(),
    call_sid: callSid,
    sender,
    text,
    is_final: isFinal,
    is_partial: !isFinal,
    confidence,
    timestamp: new Date().toISOString()
  };
  
  // Route to appropriate dashboard based on AI mode
  if (isAiMode) {
    // Update AI monitor call with new message
    const aiCall = aiCallsMap.get(callSid);
    if (aiCall && isFinal) {
      const newMessage: TranscriptMessage = {
        id: transcriptData.id,
        sender,
        text,
        timestamp: new Date(),
        isPartial: false,
      };
      aiCall.messages.push(newMessage);
      
      // Broadcast update to AI monitor
      broadcastToAiMonitor({ type: 'ai_call_update', call: aiCall });
    }
  } else {
    // Broadcast to human dispatcher dashboard
  broadcastToDashboard(transcriptData);
  }
  
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

// ===== AI MODE & SIMULATION ENDPOINTS =====

// Get/Set AI Mode
app.get('/api/ai-mode', (req, res) => {
  res.json({ aiModeEnabled });
});

app.post('/api/ai-mode', (req, res) => {
  const { enabled } = req.body;
  aiModeEnabled = Boolean(enabled);
  console.log(`🤖 AI Mode ${aiModeEnabled ? 'ENABLED' : 'DISABLED'}`);
  res.json({ success: true, aiModeEnabled });
});

// Handle action approval
app.post('/api/action', (req, res) => {
  const { callSid, actionId, decision } = req.body;
  
  const simCall = aiSimulationCalls.get(callSid);
  if (simCall) {
    const action = simCall.actions.find(a => a.id === actionId);
    if (action) {
      action.status = decision as 'approved' | 'rejected';
      console.log(`✅ Action ${actionId} ${decision} for ${callSid}`);
      
      // Update status if no more pending actions
      const pendingCount = simCall.actions.filter(a => a.status === 'pending').length;
      if (pendingCount === 0) {
        simCall.status = 'active';
      }
      
      // Broadcast update
      broadcastAICallUpdate(simCall);
    }
  }
  
  res.json({ success: true });
});

// Start simulation
app.post('/api/simulate', async (req, res) => {
  const { scenarios } = req.body;
  
  if (!scenarios || !Array.isArray(scenarios)) {
    return res.status(400).json({ error: 'Missing scenarios array' });
  }
  
  console.log(`\n🎬 Starting simulation with ${scenarios.length} calls...`);
  
  // Start each simulation with a slight delay between them
  scenarios.forEach((scenario: any, index: number) => {
    setTimeout(() => {
      void runAISimulation(scenario);
    }, index * 500); // Stagger start by 500ms
  });
  
  res.json({ success: true, started: scenarios.length });
});

// Broadcast AI call update to dashboard
function broadcastAICallUpdate(call: AISimulationCall) {
  broadcastToDashboard({
    type: 'ai_call_update',
    call: {
      id: call.callSid,
      callSid: call.callSid,
      scenario: call.scenario,
      status: call.status,
      urgency: call.urgency,
      incident: call.incident,
      messages: call.messages,
      actions: call.actions,
      startedAt: call.startedAt,
    }
  });
}

// Run a single AI simulation (AI dispatcher talking to AI caller)
async function runAISimulation(scenario: {
  name: string;
  personality: string;
  initialMessage: string;
  context: string;
}) {
  const callSid = `SIM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  
  console.log(`\n📞 Starting simulation: ${scenario.name} (${callSid})`);
  
  // Initialize simulation call
  const simCall: AISimulationCall = {
    callSid,
    scenario: scenario.name,
    personality: scenario.personality,
    context: scenario.context,
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
    actions: [],
    status: 'active',
    startedAt: new Date(),
  };
  
  aiSimulationCalls.set(callSid, simCall);
  
  // Broadcast call started
  broadcastToDashboard({
    type: 'ai_call_started',
    callSid,
    scenario: scenario.name,
    timestamp: new Date().toISOString(),
  });
  
  // Conversation history for context
  const conversationHistory: { role: 'caller' | 'dispatcher'; content: string }[] = [];
  
  // Start with dispatcher greeting
  const dispatcherGreeting = "911, what is your emergency?";
  addMessageToSimCall(simCall, 'dispatcher', dispatcherGreeting);
  conversationHistory.push({ role: 'dispatcher', content: dispatcherGreeting });
  
  // Then caller's initial message
  await sleep(1500);
  addMessageToSimCall(simCall, 'caller', scenario.initialMessage);
  conversationHistory.push({ role: 'caller', content: scenario.initialMessage });
  
  // Run analysis on initial message
  await runSimulationAnalysis(simCall);
  
  // Conversation loop (max 8 exchanges)
  for (let turn = 0; turn < 8; turn++) {
    await sleep(2000 + Math.random() * 1000);
    
    // Generate dispatcher response
    const dispatcherResponse = await generateDispatcherResponse(conversationHistory, simCall);
    if (!dispatcherResponse) break;
    
    addMessageToSimCall(simCall, 'dispatcher', dispatcherResponse);
    conversationHistory.push({ role: 'dispatcher', content: dispatcherResponse });
    
    // Check for dispatch actions in the response
    detectAndCreateActions(simCall, dispatcherResponse);
    
    await sleep(1500 + Math.random() * 1000);
    
    // Generate caller response
    const callerResponse = await generateCallerResponse(conversationHistory, scenario, simCall);
    if (!callerResponse || callerResponse.toLowerCase().includes('end call') || callerResponse.toLowerCase().includes('thank you')) {
      // Caller ending call
      addMessageToSimCall(simCall, 'caller', callerResponse || "Okay, thank you.");
              break;
            }

    addMessageToSimCall(simCall, 'caller', callerResponse);
    conversationHistory.push({ role: 'caller', content: callerResponse });
    
    // Run analysis
    await runSimulationAnalysis(simCall);
  }
  
  // End simulation
  await sleep(1000);
  simCall.status = 'completed';
  broadcastAICallUpdate(simCall);
  
  console.log(`✅ Simulation ended: ${scenario.name} (${callSid})`);
}

// Add message to simulation call and broadcast
function addMessageToSimCall(simCall: AISimulationCall, sender: 'caller' | 'dispatcher', text: string) {
  const message: TranscriptMessage = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sender,
    text,
    timestamp: new Date(),
    isPartial: false,
  };
  
  simCall.messages.push(message);
  
  // Broadcast transcript
          broadcastToDashboard({
    type: 'ai_transcript',
    id: message.id,
    call_sid: simCall.callSid,
    sender,
    text,
    is_final: true,
    is_partial: false,
    timestamp: message.timestamp.toISOString(),
  });
  
  console.log(`   ${sender === 'caller' ? '👤' : '🤖'} ${sender}: "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`);
}

// Generate dispatcher response using OpenAI Chat API
async function generateDispatcherResponse(
  history: { role: 'caller' | 'dispatcher'; content: string }[],
  simCall: AISimulationCall
): Promise<string | null> {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a professional 911 dispatcher. Be calm, direct, and gather critical information efficiently.
Ask ONE question at a time. Keep responses under 2 sentences.
Current incident info: ${JSON.stringify(simCall.incident)}
Missing info to gather: location, type of emergency, injuries, threat level, people count.

When you have enough information to dispatch help, say something like "I'm dispatching [units] to [location]" or "Help is on the way".`
          },
          ...history.map(h => ({
            role: h.role === 'dispatcher' ? 'assistant' : 'user',
            content: h.content
          }))
        ],
        max_tokens: 100,
        temperature: 0.7,
      }),
    });
    
    const data = await response.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (error) {
    console.error('Error generating dispatcher response:', error);
    return "Can you tell me exactly where you are?";
  }
}

// Generate caller response using OpenAI Chat API
async function generateCallerResponse(
  history: { role: 'caller' | 'dispatcher'; content: string }[],
  scenario: { name: string; personality: string; context: string },
  simCall: AISimulationCall
): Promise<string | null> {
  try {
    const turnCount = history.filter(h => h.role === 'caller').length;
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a ${scenario.personality} 911 caller experiencing: ${scenario.context}
Respond naturally to the dispatcher's questions. Be ${scenario.personality}.
Gradually provide information when asked. Make up realistic details for location, injuries, etc.
Keep responses under 2 sentences. After ${turnCount > 5 ? '1-2 more exchanges' : '4-6 exchanges'}, thank them and end the call.
${turnCount > 6 ? 'This is the end of the call - thank them and hang up.' : ''}`
          },
          ...history.map(h => ({
            role: h.role === 'caller' ? 'assistant' : 'user',
            content: h.content
          }))
        ],
        max_tokens: 80,
        temperature: 0.8,
      }),
    });
    
    const data = await response.json();
    return data.choices?.[0]?.message?.content || null;
    } catch (error) {
    console.error('Error generating caller response:', error);
    return null;
  }
}

// Run analysis on simulation call
async function runSimulationAnalysis(simCall: AISimulationCall) {
  try {
    const response = await fetch('http://localhost:3000/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: simCall.messages,
        incident: simCall.incident,
        urgency: simCall.urgency,
        callSid: simCall.callSid,
      }),
    });
    
    if (!response.ok) return;
    
    const data = await response.json();
    
    if (data.updates) {
      const { urgency, ...fields } = data.updates;
      if (urgency) simCall.urgency = urgency;
      simCall.incident = { ...simCall.incident, ...fields };
    }
    
    // Broadcast analysis
    broadcastToDashboard({
      type: 'ai_analysis',
      call_sid: simCall.callSid,
      incident: simCall.incident,
      urgency: simCall.urgency,
    });
    
    broadcastAICallUpdate(simCall);
    } catch (error) {
    console.error('Error running simulation analysis:', error);
  }
}

// Detect dispatch actions from dispatcher response
function detectAndCreateActions(simCall: AISimulationCall, text: string) {
  const lowerText = text.toLowerCase();
  
  // Patterns to detect dispatch actions
  const dispatchPatterns = [
    /dispatch(?:ing)?\s+(\d+)?\s*(police|officer|unit|car|ambulance|fire|emt|paramedic|truck)/i,
    /send(?:ing)?\s+(\d+)?\s*(police|officer|unit|car|ambulance|fire|emt|paramedic|truck)/i,
    /(\d+)?\s*(police|ambulance|fire)\s+(?:unit|truck|car)s?\s+(?:are|is)\s+(?:on\s+(?:the|their)\s+way|en\s+route|dispatched)/i,
    /help\s+is\s+on\s+(?:the|its)\s+way/i,
  ];
  
  for (const pattern of dispatchPatterns) {
    const match = text.match(pattern);
    if (match) {
      const units = match[1] || '1';
      const type = match[2] || 'units';
      
      const action: AICallAction = {
        id: `action-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'dispatch',
        description: `Dispatch ${units} ${type} to incident location`,
        units: `${units} ${type}`,
        location: simCall.incident.location || 'Location pending',
        status: 'pending',
        timestamp: new Date(),
      };
      
      simCall.actions.push(action);
      simCall.status = 'pending_action';
      
      // Broadcast action required
      broadcastToDashboard({
        type: 'ai_action_required',
        call_sid: simCall.callSid,
        action_id: action.id,
        action_type: action.type,
        description: action.description,
        units: action.units,
        location: action.location,
      });
      
      console.log(`   ⚠️ ACTION REQUIRED: ${action.description}`);
      
      broadcastAICallUpdate(simCall);
      break; // Only one action per response
    }
  }
}

// Helper sleep function
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Twilio Voice Webhook - Returns TwiML based on AI mode
// AI Mode ON: Bidirectional stream to OpenAI for AI agent
// AI Mode OFF: Fork stream to Deepgram for transcription + dial human dispatcher
app.all('/twilio/voice', (req, res) => {
  console.log(`📞 Incoming ${req.method} request to /twilio/voice`);
  console.log(`   AI Mode: ${aiModeEnabled ? 'ON (AI Agent)' : 'OFF (Human Dispatcher)'}`);
  
  const websocketUrl = PUBLIC_HOST 
    ? `wss://${PUBLIC_HOST}/twilio/media`
    : `wss://YOUR_NGROK_URL_HERE/twilio/media`;
  
  let twiml: string;
  
  if (aiModeEnabled) {
    // AI Agent mode - bidirectional stream to OpenAI Realtime API
    console.log(`🤖 AI Mode: Connecting to OpenAI Realtime API`);
    console.log(`   Stream URL: ${websocketUrl}`);
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${websocketUrl}" />
  </Connect>
</Response>`;
  } else {
    // Human Dispatcher mode - fork stream for transcription + dial dispatcher
    if (!DISPATCHER_PHONE) {
      console.error('❌ DISPATCHER_PHONE not set - cannot route to human dispatcher');
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">I'm sorry, the dispatcher is currently unavailable. Please try again later.</Say>
</Response>`;
    } else {
      console.log(`👤 Human Mode: Dialing ${DISPATCHER_PHONE} + streaming to Deepgram`);
      console.log(`   Stream URL: ${websocketUrl}`);
      // <Start><Stream> forks the audio to our server for Deepgram transcription
      // <Dial> connects the caller to the human dispatcher
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="${websocketUrl}" />
  </Start>
  <Dial>${DISPATCHER_PHONE}</Dial>
</Response>`;
    }
  }

  res.set('Content-Type', 'text/xml');
  res.send(twiml);
  console.log('✅ TwiML response sent');
});

// Optional: Receive precise device geolocation from a mobile app and broadcast to dashboard
// POST /twilio/location { callSid, lat, lon, address? }
app.post('/twilio/location', express.json(), (req, res) => {
  try {
    const { callSid, lat, lon, address } = req.body || {};
    if (!callSid || typeof lat !== 'number' || typeof lon !== 'number') {
      return res.status(400).json({ error: 'callSid, lat, lon are required' });
    }

    console.log(`📍 Location update for ${callSid}:`, { lat, lon, address });

    // Update incident state if present
    const state = callStateMap.get(callSid);
    if (state && address) {
      state.incident.location = address;
    }

    // Broadcast to dashboard clients
    broadcastToDashboard({
      type: 'geo',
      call_sid: callSid,
      lat,
      lon,
      address: address || null,
      timestamp: new Date().toISOString(),
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error('❌ Error handling /twilio/location', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// Initialize Deepgram live transcription for human dispatcher calls
async function initDeepgramConnection(callSid: string) {
  console.log(`🎤 Initializing Deepgram for call: ${callSid}`);

  const deepgram = createDeepgramClient(DEEPGRAM_API_KEY!);

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

  connection.on(LiveTranscriptionEvents.Transcript, async (data: any) => {
    const transcript = data.channel?.alternatives?.[0]?.transcript;
    
    if (!transcript) return;

    const isFinal = data.is_final;
    const confidence = data.channel?.alternatives?.[0]?.confidence;

    if (isFinal) {
      console.log(`📝 [FINAL] Call ${callSid}: "${transcript}"`);
      
      // Store transcript and broadcast to human dashboard
      await storeTranscript(callSid, 'caller', transcript, true, confidence);
      
      // Update call state and trigger analysis
      const state = callStateMap.get(callSid);
      if (state) {
        state.messages.push({
          id: Date.now().toString(),
          sender: 'caller',
          text: transcript,
          timestamp: new Date(),
          isPartial: false
        });
        
        // Run analysis in background
        void analyzeAndBroadcast(callSid, state);
      }
    } else {
      // Partial transcript - useful for real-time UI updates
      console.log(`⏳ [PARTIAL] Call ${callSid}: "${transcript}"`);
      // Optionally broadcast partial transcripts for UI responsiveness
      // await storeTranscript(callSid, 'caller', transcript, false, confidence);
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

// Connect to OpenAI Realtime API (AI Agent mode only)
function connectToOpenAI(callSid: string, streamSid: string, twilioWs: WSType): WebSocket {
  console.log(`🤖 Connecting to OpenAI Realtime API for AI agent: ${callSid}`);
  console.log(`   URL: ${OPENAI_REALTIME_URL}`);
  
  const openaiWs = new WebSocket(OPENAI_REALTIME_URL, {
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'OpenAI-Beta': 'realtime=v1'
    }
  });

  openaiWs.on('open', () => {
    console.log(`✅ OpenAI Realtime connection opened for call: ${callSid}`);
    
    // Configure the session for AI agent mode
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
    
    console.log(`📤 Sending session config`);
    openaiWs.send(JSON.stringify(sessionConfig));

    // Send initial greeting
    setTimeout(() => {
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

// Handle events from OpenAI Realtime API (AI Agent mode only)
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
        const session = callSessionMap.get(callSid);
        
        // Track audio chunks for debugging
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
  let deepgramConnection: any = null;
  let messageCount = 0;
  let audioPacketCount = 0;
  let isThisCallAiMode = false;

  ws.on('message', async (message: Buffer) => {
    messageCount++;
    
    try {
      const msg: TwilioMessage = JSON.parse(message.toString());

      switch (msg.event) {
        case 'start':
          callSid = msg.start.callSid;
          streamSid = msg.start.streamSid;
          
          // Check if AI mode is enabled for this call
          isThisCallAiMode = aiModeEnabled;
          
          console.log(`🚨 Call started: ${callSid}`);
          console.log(`   Stream SID: ${streamSid}`);
          console.log(`   Media format: ${msg.start.mediaFormat.encoding} @ ${msg.start.mediaFormat.sampleRate}Hz`);
          console.log(`   Mode: ${isThisCallAiMode ? '🤖 AI Agent (OpenAI)' : '👤 Human Dispatcher (Deepgram)'}`);

          // Create call record in Supabase
          await createCallRecord(callSid, streamSid);

          // Initialize call state with AI mode flag
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
            isAiMode: isThisCallAiMode,
          });

          if (isThisCallAiMode) {
            // AI Agent mode - connect to OpenAI Realtime API
            const aiCall: AIMonitorCall = {
              callSid: callSid,
              scenario: 'Live Emergency Call',
              status: 'active',
              urgency: 'Low',
              incident: {
                location: null,
                type: null,
                injuries: null,
                threatLevel: null,
                peopleCount: null,
                callerRole: null,
              },
              messages: [],
              actions: [],
              startedAt: new Date(),
              isRealCall: true,
            };
            aiCallsMap.set(callSid, aiCall);
            
            // Broadcast new call to AI monitor
            broadcastToAiMonitor({ 
              type: 'ai_call_started', 
              callSid: callSid,
              scenario: 'Live Emergency Call',
              timestamp: new Date().toISOString(),
            });
            broadcastToAiMonitor({ type: 'ai_call_update', call: aiCall });
            
            console.log(`🖥️  New AI call added to monitor: ${callSid}`);

            // Connect to OpenAI Realtime API for AI agent
            openaiWs = connectToOpenAI(callSid, streamSid, ws);
            callSessionMap.set(callSid, {
              twilioWs: ws,
              openaiWs: openaiWs,
              streamSid: streamSid,
              callSid: callSid,
              isAiMode: true,
            });
          } else {
            // Human Dispatcher mode - connect to Deepgram for transcription
            deepgramConnection = await initDeepgramConnection(callSid);
            deepgramConnectionMap.set(callSid, deepgramConnection);
            
            // Notify the live dashboard that a call started
            broadcastToDashboard({
              type: 'call_started',
              call_sid: callSid,
              timestamp: new Date().toISOString(),
            });
            console.log(`📞 Human dispatcher call started: ${callSid}`);
          }
          break;

        case 'media':
          if (msg.media.payload) {
            audioPacketCount++;
            
            // Log every 100 packets
            if (audioPacketCount % 100 === 0) {
              console.log(`🎵 Audio packets forwarded: ${audioPacketCount} (${isThisCallAiMode ? 'OpenAI' : 'Deepgram'})`);
            }
            
            if (isThisCallAiMode) {
              // AI mode - forward audio to OpenAI
              if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
                const audioAppend = {
                  type: 'input_audio_buffer.append',
                  audio: msg.media.payload
                };
                openaiWs.send(JSON.stringify(audioAppend));
              }
            } else {
              // Human mode - forward audio to Deepgram
              if (deepgramConnection) {
                const audioBuffer = Buffer.from(msg.media.payload, 'base64');
                deepgramConnection.send(audioBuffer);
              }
            }
          }
          break;

        case 'stop':
          console.log(`🛑 Call ended: ${msg.stop.callSid}`);
          
          // Check if this was an AI mode call
          const endingCallState = callStateMap.get(msg.stop.callSid);
          const wasAiModeCall = endingCallState?.isAiMode ?? false;
          
          // End call record in Supabase
          await endCallRecord(msg.stop.callSid);

          if (wasAiModeCall) {
            // Update AI monitor call status
            const aiCall = aiCallsMap.get(msg.stop.callSid);
            if (aiCall) {
              aiCall.status = 'completed';
              broadcastToAiMonitor({ type: 'ai_call_update', call: aiCall });
              broadcastToAiMonitor({
                type: 'ai_call_ended',
                call_sid: msg.stop.callSid,
                timestamp: new Date().toISOString()
              });
            }
            console.log(`🖥️  AI call ended: ${msg.stop.callSid}`);
            
            // Clean up OpenAI connection
            const session = callSessionMap.get(msg.stop.callSid);
            if (session?.openaiWs) {
              session.openaiWs.close();
            }
            callSessionMap.delete(msg.stop.callSid);
            
            // Clean up AI call map (keep for 5 min for review)
            setTimeout(() => {
              aiCallsMap.delete(msg.stop.callSid);
            }, 5 * 60 * 1000);
          } else {
            // Broadcast to human dispatcher dashboard
            broadcastToDashboard({
              type: 'call_ended',
              call_sid: msg.stop.callSid,
              timestamp: new Date().toISOString()
            });
            
            // Clean up Deepgram connection
            const dgConn = deepgramConnectionMap.get(msg.stop.callSid);
            if (dgConn) {
              dgConn.finish();
              deepgramConnectionMap.delete(msg.stop.callSid);
            }
          }

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
    
    if (callSid) {
      if (isThisCallAiMode) {
        // Clean up OpenAI connection
        const session = callSessionMap.get(callSid);
        if (session?.openaiWs) {
          session.openaiWs.close();
        }
        callSessionMap.delete(callSid);
      } else {
        // Clean up Deepgram connection
        const dgConn = deepgramConnectionMap.get(callSid);
        if (dgConn) {
          dgConn.finish();
          deepgramConnectionMap.delete(callSid);
        }
      }
    }
  });

  ws.on('error', (error) => {
    console.error('❌ Twilio WebSocket error:', error);
    
    if (callSid) {
      if (isThisCallAiMode) {
        const session = callSessionMap.get(callSid);
        if (session?.openaiWs) {
          session.openaiWs.close();
        }
        callSessionMap.delete(callSid);
      } else {
        const dgConn = deepgramConnectionMap.get(callSid);
        if (dgConn) {
          dgConn.finish();
          deepgramConnectionMap.delete(callSid);
        }
      }
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

    // Route analysis to appropriate dashboard based on AI mode
    if (state.isAiMode) {
      // Update AI monitor call with new analysis
      const aiCall = aiCallsMap.get(callSid);
      if (aiCall) {
        aiCall.incident = state.incident;
        aiCall.urgency = state.urgency;
        broadcastToAiMonitor({ type: 'ai_call_update', call: aiCall });
        broadcastToAiMonitor({
          type: 'ai_analysis',
          call_sid: callSid,
          incident: state.incident,
          urgency: state.urgency,
        });
        }
      } else {
      // Broadcast analysis results to human dispatcher dashboard
    broadcastToDashboard({
      type: 'analysis',
      call_sid: callSid,
      incident: state.incident,
      urgency: state.urgency,
      nextQuestion: state.nextQuestion,
    });
    }

    // If we have a textual location, try geocoding server-side and push precise coords
    if (state.incident.location && !state.isAiMode) {
      // Only do geocoding for human dispatcher dashboard (AI monitor doesn't need map)
      const currentAddr = state.incident.location.trim();
      const last = lastGeocodedAddress.get(callSid);
      if (currentAddr && currentAddr !== last) {
        try {
          const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(currentAddr)}&addressdetails=0&limit=1`;
          const resp = await fetch(url, { headers: { 'User-Agent': 'dispatchiq/1.0 (map-geo)' } as any });
          if (resp.ok) {
            const arr = await resp.json();
            const item = Array.isArray(arr) && arr.length ? arr[0] : null;
            if (item?.lat && item?.lon) {
              const lat = parseFloat(item.lat);
              const lon = parseFloat(item.lon);
              if (Number.isFinite(lat) && Number.isFinite(lon)) {
                lastGeocodedAddress.set(callSid, currentAddr);
                console.log(`🗺️  Geocoded "${currentAddr}" →`, { lat, lon });
                broadcastToDashboard({
                  type: 'geo',
                  call_sid: callSid,
                  lat,
                  lon,
                  address: currentAddr,
                  source: 'server_geocode',
                  timestamp: new Date().toISOString(),
                });
              }
            }
          } else {
            console.warn(`⚠️  Geocode failed (${resp.status}) for address: ${currentAddr}`);
          }
        } catch (e) {
          console.warn('⚠️  Geocode error:', e);
        }
      }
    }
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
  console.log('\n🚨 DispatchIQ Server (OpenAI Realtime API)');
  console.log('==========================================');
  console.log(`✅ HTTP Server: http://localhost:${PORT}`);
  console.log(`✅ WebSocket (Twilio): ws://localhost:${PORT}/twilio/media`);
  console.log(`✅ WebSocket (Human Dashboard): ws://localhost:${PORT}/dashboard`);
  console.log(`✅ WebSocket (AI Monitor): ws://localhost:${PORT}/ai-monitor`);
  console.log(`✅ Health check: http://localhost:${PORT}/health`);
  console.log('\n📞 Twilio webhook URL: POST http://localhost:${PORT}/twilio/voice');
  console.log(`🎙️  Voice: ${VOICE}`);
  console.log(`🤖 AI Mode: ${aiModeEnabled ? 'ON' : 'OFF'} (toggle via POST /api/ai-mode)`);
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
