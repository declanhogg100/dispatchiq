'use client';

import { useState, useEffect } from 'react';
import { Header } from '../components/Header';
import { AICall, AICallAction, TranscriptMessage, IncidentDetails, Urgency } from '../types';

export default function MonitorPage() {
  const [calls, setCalls] = useState<AICall[]>([]);
  const [selectedCall, setSelectedCall] = useState<AICall | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [aiModeEnabled, setAiModeEnabled] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);

  // Connect to WebSocket for AI call updates
  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001/dashboard';
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
          
          // Handle AI call updates
          if (data.type === 'ai_call_update') {
            setCalls(prev => {
              const existing = prev.find(c => c.callSid === data.call.callSid);
              if (existing) {
                return prev.map(c => c.callSid === data.call.callSid ? data.call : c);
              }
              return [...prev, data.call];
            });
            
            // Update selected call if it matches
            if (selectedCall?.callSid === data.call.callSid) {
              setSelectedCall(data.call);
            }
          }
          
          // Handle new AI call
          if (data.type === 'ai_call_started') {
            const newCall: AICall = {
              id: data.callSid,
              callSid: data.callSid,
              scenario: data.scenario || 'Unknown Emergency',
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
            setCalls(prev => [...prev, newCall]);
          }
          
          // Handle AI transcript (for real AI calls)
          if (data.type === 'ai_transcript') {
            setCalls(prev => prev.map(call => {
              if (call.callSid === data.call_sid) {
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

      ws.onerror = () => setWsConnected(false);
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
  }, [selectedCall?.callSid]);

  // Start simulation
  const startSimulation = async (numCalls: number) => {
    setIsSimulating(true);
    try {
      const response = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numCalls }),
      });
      if (!response.ok) throw new Error('Failed to start simulation');
      console.log('✅ Simulation started');
    } catch (error) {
      console.error('❌ Failed to start simulation:', error);
    }
  };

  // Toggle AI mode for next real call
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
    if (selectedCall?.status === 'completed') setSelectedCall(null);
  };

  const activeCalls = calls.filter(c => c.status !== 'completed');
  const pendingActionCalls = calls.filter(c => c.status === 'pending_action');

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
            
            <div className="h-6 w-px bg-border" />
            
            <button
              onClick={() => startSimulation(5)}
              disabled={isSimulating}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              Simulate 5 Calls
            </button>
            <button
              onClick={() => startSimulation(10)}
              disabled={isSimulating}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              Simulate 10 Calls
            </button>
            
            {calls.some(c => c.status === 'completed') && (
              <button
                onClick={clearCompleted}
                className="px-3 py-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-lg text-sm transition-colors"
              >
                Clear Completed
              </button>
            )}
          </div>
        </div>
      </div>

      <main className="flex flex-1 gap-6 p-6 overflow-hidden">
        {/* Left: Call Grid */}
        <section className="flex w-1/2 min-w-[400px] flex-col gap-4">
          <div className="flex flex-col gap-3 overflow-y-auto">
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
              calls.map((call) => (
                <CallCard 
                  key={call.callSid} 
                  call={call} 
                  isSelected={selectedCall?.callSid === call.callSid}
                  onClick={() => setSelectedCall(call)}
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
function CallCard({ call, isSelected, onClick }: { 
  call: AICall; 
  isSelected: boolean;
  onClick: () => void;
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
        relative p-4 rounded-xl border bg-card text-left transition-all hover:shadow-md
        ${isSelected ? 'border-primary shadow-lg ring-2 ring-primary/20' : 'border-border hover:border-primary/50'}
        ${call.status === 'completed' ? 'opacity-60' : ''}
      `}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-foreground mb-1 truncate">{call.scenario}</div>
          <div className="text-xs text-muted-foreground font-mono">
            {call.callSid.slice(0, 16)}...
          </div>
        </div>
        <div className={`px-2 py-1 rounded text-xs font-medium border ${urgencyBadge[call.urgency]}`}>
          {call.urgency}
        </div>
      </div>

      {call.incident.location && (
        <div className="text-sm text-foreground mb-2 truncate">
          <span className="text-muted-foreground">Location:</span> {call.incident.location}
        </div>
      )}

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {call.messages.length} messages
        </span>
        <span className={`font-medium ${
          call.status === 'active' ? 'text-green-600' :
          call.status === 'pending_action' ? 'text-amber-600' : 'text-gray-600'
        }`}>
          {call.status === 'active' ? 'Active' : 
           call.status === 'pending_action' ? 'Pending Action' : 'Completed'}
        </span>
      </div>

      {pendingActions > 0 && (
        <div className="mt-2 px-2 py-1 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800 font-medium">
          {pendingActions} action{pendingActions > 1 ? 's' : ''} pending approval
        </div>
      )}
    </button>
  );
}

// Call Details Component
function CallDetails({ call, onApproveAction }: { 
  call: AICall; 
  onApproveAction: (callSid: string, actionId: string) => void;
}) {
  const pendingActions = call.actions.filter(a => a.status === 'pending');
  const approvedActions = call.actions.filter(a => a.status === 'approved');

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-foreground mb-1">{call.scenario}</h2>
            <p className="text-sm text-muted-foreground font-mono">{call.callSid}</p>
          </div>
          <div className={`px-3 py-1 rounded-full text-sm font-bold ${
            call.urgency === 'Critical' ? 'bg-red-100 text-red-800 border border-red-200' :
            call.urgency === 'Medium' ? 'bg-amber-100 text-amber-800 border border-amber-200' : 
            'bg-green-100 text-green-800 border border-green-200'
          }`}>
            {call.urgency}
          </div>
        </div>

        {/* Incident Details Grid */}
        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-1">Location</div>
            <div className="text-sm font-medium text-foreground">{call.incident.location || '—'}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-1">Type</div>
            <div className="text-sm font-medium text-foreground">{call.incident.type || '—'}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-1">Injuries</div>
            <div className="text-sm font-medium text-foreground">{call.incident.injuries || '—'}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-1">Threat Level</div>
            <div className="text-sm font-medium text-foreground">{call.incident.threatLevel || '—'}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-1">People Count</div>
            <div className="text-sm font-medium text-foreground">{call.incident.peopleCount || '—'}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-1">Caller Role</div>
            <div className="text-sm font-medium text-foreground">{call.incident.callerRole || '—'}</div>
          </div>
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
      <div className="rounded-xl border border-border bg-card p-6">
        <h3 className="text-base font-semibold text-foreground mb-4">Live Transcript</h3>
        <div className="max-h-96 overflow-y-auto space-y-3 bg-secondary/30 rounded-lg p-4">
          {call.messages.length === 0 ? (
            <div className="text-muted-foreground text-center py-8 text-sm">
              Waiting for conversation to begin...
            </div>
          ) : (
            call.messages.map((msg) => (
              <div 
                key={msg.id} 
                className={`p-3 rounded-lg ${
                  msg.sender === 'caller' 
                    ? 'bg-muted/50' 
                    : 'bg-primary/10 border border-primary/20'
                }`}
              >
                <div className="text-xs uppercase tracking-wide font-medium text-muted-foreground mb-1">
                  {msg.sender === 'caller' ? 'Caller' : 'AI Dispatcher'}
                </div>
                <div className="text-sm text-foreground">{msg.text}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

