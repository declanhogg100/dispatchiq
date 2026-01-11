'use client';

import { useState, useEffect, useRef } from 'react';
import { Siren, Ambulance, Flame } from 'lucide-react';
import { Header } from '../components/Header';
import { AICall, AICallAction, TranscriptMessage, IncidentDetails, Urgency, SummaryResponsePayload } from '../types';

// localStorage key for persisting AI monitor state
const STORAGE_KEY = 'dispatchiq_ai_monitor';

export default function MonitorPage() {
  const [calls, setCalls] = useState<AICall[]>([]);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, { summary: string; recommendations: string[]; updatedAt: string }>>({});
  const [aiModeEnabled, setAiModeEnabled] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  
  // Derive selectedCall from calls array and selectedCallId
  const selectedCall = selectedCallId ? calls.find(c => c.callSid === selectedCallId) || null : null;

  // Load state from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        if (data.calls) {
          // Restore calls with proper date objects
          const restoredCalls = data.calls.map((call: AICall) => ({
            ...call,
            startedAt: new Date(call.startedAt),
            messages: call.messages.map(m => ({ ...m, timestamp: new Date(m.timestamp) })),
            actions: call.actions.map(a => ({ ...a, timestamp: new Date(a.timestamp) })),
          }));
          setCalls(restoredCalls);
        }
        if (data.selectedCallId) setSelectedCallId(data.selectedCallId);
        if (data.summaries) setSummaries(data.summaries);
        console.log('📦 Restored AI monitor state from localStorage');
      }
    } catch (e) {
      console.error('Failed to load AI monitor state:', e);
    }
    setIsInitialized(true);
  }, []);

  // Save state to localStorage whenever it changes
  useEffect(() => {
    if (!isInitialized) return;
    
    const state = {
      calls,
      selectedCallId,
      summaries,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [calls, selectedCallId, summaries, isInitialized]);

  // Connect to WebSocket for AI call updates
  useEffect(() => {
    // Resolve WS URL and force the AI Monitor path
    const resolveWsUrl = () => {
      try {
        let envUrl = process.env.NEXT_PUBLIC_WS_URL;
        if (envUrl) {
          // Convert http(s) -> ws(s) if needed
          if (envUrl.startsWith('http://')) envUrl = envUrl.replace('http://', 'ws://');
          if (envUrl.startsWith('https://')) envUrl = envUrl.replace('https://', 'wss://');
          // Ensure absolute URL. If it's relative, fall back to window-based URL
          const url = new URL(envUrl, typeof window !== 'undefined' ? window.location.href : 'http://localhost:3000');
          url.protocol = (typeof window !== 'undefined' && window.location.protocol === 'https:') ? 'wss:' : url.protocol;
          url.pathname = '/ai-monitor';
          return url.toString();
        }
        if (typeof window !== 'undefined') {
          const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
          const host = window.location.hostname;
          const port = (process.env.NEXT_PUBLIC_SERVER_PORT as string) || '3001';
          return `${proto}://${host}:${port}/ai-monitor`;
        }
      } catch (_) {}
      return 'ws://localhost:3001/ai-monitor';
    };

    const wsUrl = resolveWsUrl();
    console.log('🔌 Connecting to AI Monitor WebSocket:', wsUrl);
    
    let ws: WebSocket | null = null;
    let reconnectTimer: NodeJS.Timeout;

    const connect = () => {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('✅ Connected to AI Monitor WebSocket');
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Handle AI mode status update
          if (data.type === 'ai_mode_status') {
            setAiModeEnabled(data.aiModeEnabled);
          }
          
          // Handle AI call updates
          if (data.type === 'ai_call_update') {
            setCalls(prev => {
              const existing = prev.find(c => c.callSid === data.call.callSid);
              if (existing) {
                return prev.map(c => c.callSid === data.call.callSid ? data.call : c);
              }
              return [...prev, data.call];
            });
            // selectedCall is derived from calls, so no need to update separately
          }
          
          // Handle new AI call
          if (data.type === 'ai_call_started') {
            console.log('📞 New AI call started:', data.callSid, data.scenario);
            const newCall: AICall = {
              id: data.callSid,
              callSid: data.callSid,
              scenario: data.scenario || 'Live Emergency Call',
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
              startedAt: new Date(data.timestamp),
            };
            setCalls(prev => {
              // Avoid duplicates
              if (prev.some(c => c.callSid === data.callSid)) return prev;
              return [...prev, newCall];
            });
          }
          
          // Handle AI transcript (for real AI calls)
          if (data.type === 'ai_transcript') {
            setCalls(prev => prev.map(call => {
              if (call.callSid === data.call_sid) {
                // Avoid duplicate messages
                if (call.messages.some(m => m.id === data.id)) return call;
                const newMessage: TranscriptMessage = {
                  id: data.id,
                  sender: data.sender,
                  text: data.text,
                  timestamp: new Date(data.timestamp),
                  isPartial: data.is_partial,
                };
                return {
                  ...call,
                  messages: [...call.messages, newMessage],
                };
              }
              return call;
            }));
          }

          // Handle action required
          if (data.type === 'ai_action_required') {
            setCalls(prev => prev.map(call => {
              if (call.callSid === data.call_sid) {
                const newAction: AICallAction = {
                  id: data.action_id,
                  type: data.action_type,
                  description: data.description,
                  units: data.units,
                  location: data.location,
                  status: 'pending',
                  timestamp: new Date(),
                };
                return {
                  ...call,
                  status: 'pending_action',
                  actions: [...call.actions, newAction],
                };
              }
              return call;
            }));
          }

          // Handle AI analysis update
          if (data.type === 'ai_analysis') {
            setCalls(prev => prev.map(call => {
              if (call.callSid === data.call_sid) {
                return {
                  ...call,
                  incident: { ...call.incident, ...data.incident },
                  urgency: data.urgency || call.urgency,
                };
              }
              return call;
            }));
          }
          
          // Handle AI call ended
          if (data.type === 'ai_call_ended') {
            setCalls(prev => prev.map(call => {
              if (call.callSid === data.call_sid) {
                return { ...call, status: 'completed', endedAt: new Date() };
              }
              return call;
            }));
          }

        } catch (error) {
          console.error('❌ Error parsing WebSocket message:', error);
        }
      };

      ws.onerror = (event) => {
        // onerror has little detail in browsers; mark disconnected and let onclose drive reconnect
        setWsConnected(false);
        const maybeMsg = (event as any)?.message || (event as any)?.reason || '';
        console.warn(`⚠️ AI Monitor WebSocket error${maybeMsg ? `: ${maybeMsg}` : ''}`);
        try { ws?.close(); } catch {}
      };
      ws.onclose = () => {
        setWsConnected(false);
        reconnectTimer = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      if (ws) ws.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency - only connect once on mount

  // Toggle AI mode for real calls
  const toggleAIMode = async () => {
    try {
      const response = await fetch('/api/ai-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !aiModeEnabled }),
      });
      if (response.ok) {
        setAiModeEnabled(!aiModeEnabled);
      }
    } catch (error) {
      console.error('❌ Failed to toggle AI mode:', error);
    }
  };

  // Approve action
  const approveAction = async (callSid: string, actionId: string) => {
    setCalls(prev => prev.map(call => {
      if (call.callSid === callSid) {
        return {
          ...call,
          status: call.actions.filter(a => a.id !== actionId && a.status === 'pending').length > 0 
            ? 'pending_action' : 'active',
          actions: call.actions.map(a => 
            a.id === actionId ? { ...a, status: 'approved' as const } : a
          ),
        };
      }
      return call;
    }));
    
    // Notify backend
    await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callSid, actionId, decision: 'approved' }),
    });
  };

  // Clear completed calls
  const clearCompleted = () => {
    setCalls(prev => prev.filter(c => c.status !== 'completed'));
    if (selectedCall?.status === 'completed') setSelectedCallId(null);
  };

  const activeCalls = calls.filter(c => c.status !== 'completed');
  const pendingActionCalls = calls.filter(c => c.status === 'pending_action');
  const sortedCalls = [...calls].sort((a, b) => {
    const aInactive = a.status === 'completed' ? 1 : 0;
    const bInactive = b.status === 'completed' ? 1 : 0;
    if (aInactive !== bInactive) return aInactive - bInactive; // active/pending first
    const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0;
    const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0;
    return bTime - aTime; // newest first within group
  });

  return (
    <div className="flex h-screen w-full flex-col bg-background">
      <Header status={wsConnected ? 'connected' : 'disconnected'} />
      
      {/* Control Bar */}
      <div className="border-b border-border bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <h2 className="text-lg font-semibold text-foreground">AI Call Monitor</h2>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${activeCalls.length > 0 ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                <span className="text-muted-foreground">Active:</span>
                <span className="font-semibold text-foreground">{activeCalls.length}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${pendingActionCalls.length > 0 ? 'bg-amber-500' : 'bg-gray-400'}`} />
                <span className="text-muted-foreground">Pending Action:</span>
                <span className="font-semibold text-foreground">{pendingActionCalls.length}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-gray-400" />
                <span className="text-muted-foreground">Completed:</span>
                <span className="font-semibold text-foreground">{calls.filter(c => c.status === 'completed').length}</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {aiModeEnabled && (
              <div className="text-sm font-medium text-foreground">
                (408) 767-6841
              </div>
            )}
            <button
              onClick={toggleAIMode}
              className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                aiModeEnabled 
                  ? 'bg-primary text-primary-foreground shadow-md' 
                  : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
              }`}
            >
              AI Mode {aiModeEnabled ? 'ON' : 'OFF'}
            </button>
            
            {calls.some(c => c.status === 'completed') && (
              <>
                <div className="h-6 w-px bg-border" />
                <button
                  onClick={clearCompleted}
                  className="px-3 py-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-lg text-sm transition-colors"
                >
                  Clear Completed
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <main className="flex flex-1 gap-6 p-6 overflow-hidden">
        {/* Left: Call Grid */}
        <section className="flex w-1/2 min-w-[400px] flex-col gap-4">
          <div className="flex flex-col gap-2 overflow-y-auto">
            {calls.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full rounded-xl border border-border bg-card p-12 text-center">
                <svg className="w-16 h-16 text-muted-foreground mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                </svg>
                <p className="text-lg font-medium text-foreground mb-2">No AI Calls Active</p>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Click &quot;Simulate Calls&quot; to demo the AI system or enable &quot;AI Mode&quot; to route the next real call here
                </p>
              </div>
            ) : (
              sortedCalls.map((call) => (
                <CallCard 
                  key={call.callSid} 
                  call={call} 
                  isSelected={selectedCallId === call.callSid}
                  summary={summaries[call.callSid]}
                  onClick={() => setSelectedCallId(call.callSid)}
                />
              ))
            )}
          </div>
        </section>

        {/* Right: Call Details */}
        <section className="flex flex-1 flex-col gap-4 overflow-y-auto">
          {selectedCall ? (
            <CallDetails 
              call={selectedCall} 
              persistedSummary={summaries[selectedCall.callSid]}
              onPersistSummary={(callSid, payload) => {
                setSummaries(prev => ({ ...prev, [callSid]: payload }));
              }}
              onApproveAction={approveAction}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full rounded-xl border border-border bg-card p-12 text-center">
              <svg className="w-16 h-16 text-muted-foreground mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
              </svg>
              <p className="text-lg font-medium text-foreground">Select a call to view details</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

// Call Card Component
function CallCard({ call, isSelected, onClick, summary }: { 
  call: AICall; 
  isSelected: boolean;
  onClick: () => void;
  summary?: { summary: string; recommendations: string[]; updatedAt: string };
}) {
  const urgencyBadge = {
    Low: 'bg-green-100 text-green-800 border-green-200',
    Medium: 'bg-amber-100 text-amber-800 border-amber-200',
    Critical: 'bg-red-100 text-red-800 border-red-200',
  };

  const pendingActions = call.actions.filter(a => a.status === 'pending').length;

  return (
    <button
      onClick={onClick}
      className={`
        relative p-3 rounded-xl border bg-card text-left transition-all hover:shadow-md
        ${isSelected ? 'border-primary shadow-lg ring-2 ring-primary/20' : 'border-border hover:border-primary/50'}
        ${call.status === 'completed' ? 'opacity-60' : ''}
      `}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-foreground truncate">
            {call.incident.type || 'Emergency'}
            {call.startedAt && (
              <span className="text-muted-foreground font-normal">{/* space intentionally inline */}
                {' '}• {new Date(call.startedAt).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>
        <div className={`px-2 py-0.5 rounded text-xs font-medium border ${urgencyBadge[call.urgency]}`}>
          {call.urgency}
        </div>
      </div>

      {/* Key incident fields inline on the card */}
      <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs mb-1.5">
        <div className="truncate"><span className="text-muted-foreground">Location</span>{' '}
          <span className="text-foreground font-medium">{call.incident.location || '—'}</span>
        </div>
        <div className="truncate"><span className="text-muted-foreground">Type</span>{' '}
          <span className="text-foreground font-medium">{call.incident.type || '—'}</span>
        </div>
        <div className="truncate"><span className="text-muted-foreground">Injuries</span>{' '}
          <span className="text-foreground font-medium">{call.incident.injuries || '—'}</span>
        </div>
        <div className="truncate"><span className="text-muted-foreground">Threat Level</span>{' '}
          <span className="text-foreground font-medium">{call.incident.threatLevel || call.urgency || '—'}</span>
        </div>
        <div className="truncate"><span className="text-muted-foreground">People Count</span>{' '}
          <span className="text-foreground font-medium">{call.incident.peopleCount || '—'}</span>
        </div>
        <div className="truncate"><span className="text-muted-foreground">Caller Role</span>{' '}
          <span className="text-foreground font-medium">{call.incident.callerRole || '—'}</span>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className={`font-medium ${
          call.status === 'active' ? 'text-green-600' :
          call.status === 'pending_action' ? 'text-amber-600' : 'text-gray-600'
        }`}>
          {call.status === 'active' ? 'Active' : 
           call.status === 'pending_action' ? 'Pending Action' : 'Completed'}
        </span>
        {summary?.recommendations && summary.recommendations.length > 0 && (
          <RecommendedIcons recommendations={summary.recommendations} />
        )}
      </div>

      {pendingActions > 0 && (
        <div className="mt-1.5 px-1.5 py-0.5 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800 font-medium">
          {pendingActions} action{pendingActions > 1 ? 's' : ''} pending approval
        </div>
      )}
    </button>
  );
}

function RecommendedIcons({ recommendations }: { recommendations: string[] }) {
  const mapRecToType = (rec: string): 'police' | 'ambulance' | 'fire' | null => {
    const r = rec.toLowerCase();
    if (/(police|officer|cop|law|patrol|squad|unit)/.test(r)) return 'police';
    if (/(ambulance|ems|paramedic|medic|medical)/.test(r)) return 'ambulance';
    if (/(fire|flame|smoke|engine|firetruck|fire truck)/.test(r)) return 'fire';
    return null;
  };

  const types = Array.from(new Set(recommendations.map(mapRecToType).filter(Boolean))) as Array<'police'|'ambulance'|'fire'>;
  const items = types.slice(0, 3);

  return (
    <div className="flex items-center gap-1.5">
      {items.map((t, idx) => {
        const common = 'h-3.5 w-3.5';
        if (t === 'police') {
          return (
            <span key={idx} className="inline-flex items-center justify-center rounded-full border bg-blue-100 border-blue-200 text-blue-700 p-1" title="Police unit recommended">
              <Siren className={common} />
            </span>
          );
        }
        if (t === 'ambulance') {
          return (
            <span key={idx} className="inline-flex items-center justify-center rounded-full border bg-red-100 border-red-200 text-red-700 p-1" title="Ambulance recommended">
              <Ambulance className={common} />
            </span>
          );
        }
        return (
          <span key={idx} className="inline-flex items-center justify-center rounded-full border bg-amber-100 border-amber-200 text-amber-700 p-1" title="Fire engine recommended">
            <Flame className={common} />
          </span>
        );
      })}
    </div>
  );
}

// Call Details Component
function CallDetails({ call, onApproveAction, persistedSummary, onPersistSummary }: { 
  call: AICall; 
  onApproveAction: (callSid: string, actionId: string) => void;
  persistedSummary?: { summary: string; recommendations: string[]; updatedAt: string };
  onPersistSummary: (callSid: string, payload: { summary: string; recommendations: string[]; updatedAt: string }) => void;
}) {
  const pendingActions = call.actions.filter(a => a.status === 'pending');
  const approvedActions = call.actions.filter(a => a.status === 'approved');
  const transcriptBottomRef = useRef<HTMLDivElement>(null);
  const [summary, setSummary] = useState<{ loading: boolean; text: string; steps: string[]; error?: string }>({ 
    loading: !persistedSummary,
    text: persistedSummary?.summary || '',
    steps: persistedSummary?.recommendations || [],
  });
  const lastMessageCountRef = useRef<number>(0);

  // Auto-scroll transcript to bottom when new messages arrive
  useEffect(() => {
    transcriptBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [call.messages]);

  // Keep UI responsive: show previous summary while refreshing in background
  // Fetch AI summary using backend (Gemini). Only auto-refresh for non-completed calls.
  useEffect(() => {
    let aborted = false;
    const shouldRefetch = call.messages.length !== lastMessageCountRef.current;
    lastMessageCountRef.current = call.messages.length;

    // On first mount with no persisted summary, fetch. On message count changes and active/pending calls, refresh.
    const isCompleted = call.status === 'completed';
    const needsInitial = !summary.text;
    if (!needsInitial && (!shouldRefetch || isCompleted)) return;

    const fetchSummary = async () => {
      try {
        // Enter loading state but keep previous text/steps visible
        setSummary((s) => ({ ...s, loading: true, error: undefined }));
        const res = await fetch('/api/ai-summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: call.messages.map(m => ({ ...m, timestamp: m.timestamp.toString() })),
            incident: call.incident,
            urgency: call.urgency,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: SummaryResponsePayload = await res.json();
        if (aborted) return;
        const payload = { summary: data.summary, recommendations: data.recommendations || [], updatedAt: new Date().toISOString() };
        onPersistSummary(call.callSid, payload);
        setSummary({ loading: false, text: payload.summary, steps: payload.recommendations });
      } catch (e: any) {
        if (aborted) return;
        // Keep previous summary on error, but surface the error message.
        setSummary((s) => ({ ...s, loading: false, error: e?.message || 'Failed to load summary' }));
      }
    };

    fetchSummary();
    return () => { aborted = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.callSid, call.messages.length, call.status]);

  // Reset local summary state when switching calls or when a persisted summary appears
  useEffect(() => {
    lastMessageCountRef.current = call.messages.length;
    setSummary({
      loading: !persistedSummary,
      text: persistedSummary?.summary || '',
      steps: persistedSummary?.recommendations || [],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.callSid, persistedSummary?.updatedAt]);

  return (
    <div className="flex flex-col gap-6">
      {/* AI Summary */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="border-b border-border bg-muted/50 px-6 py-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-foreground">AI Summary</h3>
            <div className={`px-3 py-1 rounded-full text-sm font-bold ${
              call.urgency === 'Critical' ? 'bg-red-100 text-red-800 border border-red-200' :
              call.urgency === 'Medium' ? 'bg-amber-100 text-amber-800 border border-amber-200' : 
              'bg-green-100 text-green-800 border border-green-200'
            }`}>
              {call.urgency}
            </div>
          </div>
        </div>
        <div className="p-6 space-y-4">
          {summary.loading && !summary.text ? (
            <div className="text-sm text-muted-foreground">Generating summary…</div>
          ) : summary.error ? (
            <div className="text-sm text-red-700">{summary.error}</div>
          ) : (
            <>
              <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                {summary.text}
              </p>
              {summary.loading && summary.text && (
                <div className="text-xs text-muted-foreground">Updating…</div>
              )}
              {summary.steps.length > 0 && (
                <div>
                  <div className="text-sm font-semibold text-foreground mb-2">Recommended Next Steps</div>
                  <ul className="list-disc pl-5 space-y-1 text-sm text-foreground">
                    {summary.steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Pending Actions */}
      {pendingActions.length > 0 && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-6">
          <h3 className="text-base font-semibold text-amber-900 mb-4">Actions Requiring Approval</h3>
          <div className="space-y-3">
            {pendingActions.map(action => (
              <div key={action.id} className="p-4 bg-white border border-amber-200 rounded-lg">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="font-semibold text-foreground mb-2">{action.description}</div>
                    {action.units && (
                      <div className="text-sm text-muted-foreground">Units: {action.units}</div>
                    )}
                    {action.location && (
                      <div className="text-sm text-muted-foreground">Location: {action.location}</div>
                    )}
                  </div>
                  <button
                    onClick={() => onApproveAction(call.callSid, action.id)}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium text-sm transition-colors whitespace-nowrap"
                  >
                    Approve
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Approved Actions */}
      {approvedActions.length > 0 && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-6">
          <h3 className="text-base font-semibold text-green-900 mb-3">Approved Actions</h3>
          <div className="space-y-2">
            {approvedActions.map(action => (
              <div key={action.id} className="text-sm text-green-800">
                ✓ {action.description}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live Transcript */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="border-b border-border bg-muted/50 px-6 py-4">
          <h3 className="font-semibold text-foreground">Live Transcript</h3>
        </div>
        <div className="max-h-96 overflow-y-auto p-4 space-y-4">
          {call.messages.length === 0 ? (
            <div className="text-muted-foreground text-center py-8 text-sm italic">
              Waiting for conversation to begin...
            </div>
          ) : (
            <>
              {call.messages.map((msg) => (
                <div key={msg.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold uppercase tracking-wider ${
                      msg.sender === 'dispatcher' ? 'text-blue-600' : 'text-zinc-600'
                    }`}>
                      {msg.sender === 'dispatcher' ? 'AI Dispatcher' : 'Caller'}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                  <p className={`text-sm leading-relaxed text-foreground ${msg.isPartial ? 'opacity-70' : ''}`}>
                    {msg.text}
                  </p>
                </div>
              ))}
              <div ref={transcriptBottomRef} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
