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
} from '../types';

// Mock scenario: Reporting a fire
const MOCK_SCENARIO = [
  { delay: 1000, sender: 'dispatcher', text: "911, what is your emergency?" },
  { delay: 3500, sender: 'caller', text: "Hi, I think... I think my neighbor's house is on fire! I see smoke coming from the windows." },
  { delay: 1000, update: { type: 'Fire', threatLevel: 'Medium' } },
  { delay: 500, nextQuestion: "What is the address of the emergency?" },
  { delay: 4000, sender: 'dispatcher', text: "Okay, stay calm. What is the address?" },
  { delay: 3000, sender: 'caller', text: "It's 124 Maple Street. The one on the corner." },
  { delay: 1000, update: { location: '124 Maple Street' } },
  { delay: 500, nextQuestion: "Are there any people inside the house?" },
  { delay: 4000, sender: 'dispatcher', text: "124 Maple Street. Do you know if anyone is inside?" },
  { delay: 3500, sender: 'caller', text: "I don't know for sure, but I saw a car in the driveway. The Johnsons live there, they have two kids." },
  { delay: 1000, update: { peopleCount: 'Possible family of 4', urgency: 'Critical' } },
  { delay: 500, nextQuestion: "Do you see any flames, or just smoke?" },
  { delay: 4000, sender: 'dispatcher', text: "Okay, help is on the way. Do you see flames or just smoke?" },
  { delay: 3000, sender: 'caller', text: "Just black smoke right now, but it's getting really thick." },
  { delay: 500, nextQuestion: "Are you in a safe location?" },
];

export default function Dashboard() {
  const [status, setStatus] = useState<'connected' | 'disconnected' | 'listening'>('connected');
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
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
  const [isSimulationRunning, setIsSimulationRunning] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const lastAnalyzedIdRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const DEBOUNCE_MS = 350;

  // Subscribe to real-time transcripts via direct WebSocket connection to backend
  useEffect(() => {
    const wsUrl = 'ws://localhost:3001/dashboard';
    console.log('🔌 Connecting to backend WebSocket:', wsUrl);
    
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('✅ Connected to backend WebSocket');
      setStatus('connected');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('📨 Received from backend:', data);

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
          
          setStatus('listening');
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
    };

    return () => {
      console.log('🔌 Cleaning up WebSocket connection...');
      ws.close();
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
  }, [incidentDetails, messages, urgency]);

  const runSimulation = async () => {
    if (isSimulationRunning) return;
    setIsSimulationRunning(true);
    setStatus('listening');
    setMessages([]);
    setIncidentDetails({
        location: null,
        type: null,
        injuries: null,
        threatLevel: null,
        peopleCount: null,
        callerRole: null,
    });
    setUrgency('Low');
    setNextQuestion(null);
    lastAnalyzedIdRef.current = null;

    for (const step of MOCK_SCENARIO) {
      await new Promise(r => setTimeout(r, step.delay));
      
      // Handle messages
      if ('text' in step) {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          sender: step.sender as 'dispatcher' | 'caller',
          text: step.text!,
          timestamp: new Date(),
          isPartial: false
        }]);
      }

      // Handle updates
      if ('update' in step) {
        const update = step.update as any;
        if (update.urgency) setUrgency(update.urgency);
        setIncidentDetails(prev => ({ ...prev, ...update }));
      }

      // Handle next question
      if ('nextQuestion' in step) {
        setNextQuestion(step.nextQuestion!);
      }
    }
    
    setIsSimulationRunning(false);
    setStatus('connected');
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
                <IncidentState details={incidentDetails} urgency={urgency} />
            </div>

            {/* Bottom: Debug/Controls (for demo purposes) */}
            <div className="mt-auto rounded-xl border border-dashed border-border p-4 bg-muted/30">
                <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                        Demo Controls: Simulate a live emergency call flow.
                    </p>
                    <button 
                        onClick={runSimulation}
                        disabled={isSimulationRunning}
                        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                        {isSimulationRunning ? 'Simulation Running...' : 'Start Simulation'}
                    </button>
                </div>
            </div>
        </section>
      </main>
    </div>
  );
}
