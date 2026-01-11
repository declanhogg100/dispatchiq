'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './Header';
import { Transcript } from './Transcript';
import { IncidentState } from './IncidentState';
import { NextQuestion } from './NextQuestion';
import {
  AnalysisResponsePayload,
  IncidentDetails,
  TranscriptMessage,
  Urgency,
  ReportResponsePayload,
} from '../types';


export default function Dashboard() {
  const [status, setStatus] = useState<'connected' | 'disconnected' | 'listening'>('connected');
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [currentCallSid, setCurrentCallSid] = useState<string | null>(null);
  const [incidentDetails, setIncidentDetails] = useState<IncidentDetails>({
    location: null,
    type: null,
    injuries: null,
    threatLevel: null,
    peopleCount: null,
    callerRole: null,
  });
  const [urgency, setUrgency] = useState<Urgency>('Low');
  const [nextQuestion, setNextQuestion] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const lastAnalyzedIdRef = useRef<string | null>(null);
  const endedCallSidRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const DEBOUNCE_MS = 350;
  const [report, setReport] = useState<string | null>(null);
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [showReportButton, setShowReportButton] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

  // Subscribe to real-time transcripts via direct WebSocket connection to backend
  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001/dashboard';
    console.log('🔌 Connecting to backend WebSocket:', wsUrl);
    
    let ws: WebSocket | null = null;
    let reconnectTimer: NodeJS.Timeout;

    const connect = () => {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('✅ Connected to backend WebSocket');
            setStatus('connected');
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data.type === 'transcript') {
                    const message: TranscriptMessage = {
                        id: data.id,
                        sender: data.sender as 'caller' | 'dispatcher',
                        text: data.text,
                        timestamp: new Date(data.timestamp),
                        isPartial: data.is_partial
                    };

                    setMessages((prev) => {
                        // Avoid duplicates
                        if (prev.some(m => m.id === message.id)) return prev;
                        return [...prev, message];
                    });
                    
                    // If this transcript belongs to the call that just ended, don't switch back to listening
                    if (data.call_sid === endedCallSidRef.current) {
                        // Do nothing to status
                    } else {
                        // New call or ongoing call
                        if (currentCallSid !== data.call_sid) {
                            setCurrentCallSid(data.call_sid);
                        }
                        endedCallSidRef.current = null; // Reset
                        setStatus('listening');
                        setShowReportButton(false);
                        setReportUrl(null);
                        setReport(null);
                    }
                } else if (data.type === 'call_ended') {
                    console.log('🏁 Call ended, switching to standby');
                    endedCallSidRef.current = data.call_sid;
                    setStatus('connected');
                    setShowReportButton(true);
                }
            } catch (error) {
                console.error('❌ Error parsing WebSocket message:', error);
            }
        };

        ws.onerror = (error) => {
            console.error('❌ WebSocket error:', error);
            setStatus('disconnected');
        };

        ws.onclose = () => {
            console.log('🔌 Disconnected from backend WebSocket');
            setStatus('disconnected');
            
            // Try to reconnect after 3 seconds
            reconnectTimer = setTimeout(() => {
                console.log('🔄 Attempting to reconnect...');
                connect();
            }, 3000);
        };
    };

    connect();

    return () => {
      console.log('🔌 Cleaning up WebSocket connection...');
      if (ws) ws.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  const callAnalysisApi = useCallback(async () => {
    const latestMessage = messages[messages.length - 1];
    if (!latestMessage || latestMessage.isPartial) return;
    if (lastAnalyzedIdRef.current === latestMessage.id) return;

    setIsAnalyzing(true);
    lastAnalyzedIdRef.current = latestMessage.id;

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          incident: incidentDetails,
          urgency,
          callSid: currentCallSid,
        }),
      });

      if (!response.ok) {
        throw new Error(`Analysis request failed: ${response.status}`);
      }

      const data = (await response.json()) as AnalysisResponsePayload;
      const { updates, nextQuestion: suggestedQuestion } = data;

      if (updates) {
        const { urgency: updatedUrgency, ...fields } = updates;
        if (updatedUrgency) setUrgency(updatedUrgency);
        if (Object.keys(fields).length > 0) {
          setIncidentDetails((prev) => ({ ...prev, ...fields }));
        }
      }

      if (suggestedQuestion !== undefined) {
        setNextQuestion(suggestedQuestion);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsAnalyzing(false);
    }
  }, [incidentDetails, messages, urgency, currentCallSid]);

  const handleGenerateReport = async () => {
    setIsGeneratingReport(true);
    try {
      const response = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          incident: incidentDetails,
          urgency,
          callId: `call-${Date.now()}`,
        }),
      });
      if (response.ok) {
        const data = (await response.json()) as ReportResponsePayload;
        setReport(data.report);
        if (data.publicUrl) {
            setReportUrl(data.publicUrl);
        }
      } else {
        setReport('Report generation failed.');
      }
    } catch (err) {
      console.error(err);
      setReport('Report generation failed.');
    } finally {
      setIsGeneratingReport(false);
      setShowReportButton(false);
    }
  };


  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      callAnalysisApi();
    }, DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [messages, callAnalysisApi]);

  return (
    <div className="flex h-screen w-full flex-col bg-background">
      <Header status={status} />
      
      <main className="flex flex-1 gap-6 p-6 overflow-hidden">
        {/* Left Column: Transcript */}
        <section className="flex w-1/3 min-w-[350px] flex-col gap-4">
            <Transcript messages={messages} />
        </section>

        {/* Right Column: Intelligence */}
        <section className="flex flex-1 flex-col gap-6 overflow-y-auto pr-2">
            
            {/* Top: Next Best Question (Hero) */}
            <div className="w-full">
                <NextQuestion question={nextQuestion} loading={isAnalyzing || (status === 'listening' && !nextQuestion)} />
            </div>

            {/* Middle: Incident State */}
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
                <IncidentState 
                  details={incidentDetails} 
                  urgency={urgency}
                  isEditable={showReportButton}
                  onDetailsUpdate={(updates) => setIncidentDetails(prev => ({ ...prev, ...updates }))}
                  onUrgencyUpdate={(newUrgency) => setUrgency(newUrgency)}
                />
            </div>

            {/* Report Generation Button (pops up when call ends) */}
            {showReportButton && (
                <div className="w-full rounded-xl border-2 border-primary bg-primary/10 p-6 flex flex-col items-center justify-center gap-3 animate-in fade-in slide-in-from-top-4">
                    <h3 className="text-lg font-semibold text-primary">Call Ended</h3>
                    <p className="text-sm text-muted-foreground text-center">
                        The call has concluded. Generate a comprehensive PDF report including transcript and incident details.
                    </p>
                    <button
                        onClick={handleGenerateReport}
                        disabled={isGeneratingReport}
                        className="rounded-full bg-primary px-8 py-3 text-base font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 shadow-lg hover:shadow-xl transition-all"
                    >
                        {isGeneratingReport ? 'Generating Report...' : '📄 Generate & Save PDF Report'}
                    </button>
                </div>
            )}

            {/* Success State: Download Link */}
            {reportUrl && (
                <div className="w-full rounded-xl border border-green-200 bg-green-50 p-4 flex items-center justify-between gap-4 animate-in fade-in">
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center text-green-600">
                            📄
                        </div>
                        <div>
                            <h4 className="font-semibold text-green-900">Report Ready</h4>
                            <p className="text-xs text-green-700">Saved to Database</p>
                        </div>
                    </div>
                    <a 
                        href={reportUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="rounded-md bg-white border border-green-200 px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-50 shadow-sm"
                    >
                        Download PDF
                    </a>
                </div>
            )}

        </section>
      </main>
    </div>
  );
}
