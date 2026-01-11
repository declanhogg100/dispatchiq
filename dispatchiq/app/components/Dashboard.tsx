'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './Header';
import { Transcript } from './Transcript';
import { IncidentState } from './IncidentState';
import { CriticalBlindSpots } from './CriticalBlindSpots';
import { MapPanel } from './MapPanel';
import {
  AnalysisResponsePayload,
  IncidentDetails,
  TranscriptMessage,
  Urgency,
  ReportResponsePayload,
} from '../types';


// localStorage key for persisting dashboard state
const STORAGE_KEY = 'dispatchiq_live_dashboard';

interface DashboardStorageState {
  messages: TranscriptMessage[];
  currentCallSid: string | null;
  incidentDetails: IncidentDetails;
  urgency: Urgency;
  nextQuestion: string | null;
  showReportButton: boolean;
  reportUrl: string | null;
  coords: { lat: number; lon: number } | null;
}

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
  const [missingKeys, setMissingKeys] = useState<(keyof IncidentDetails)[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const lastAnalyzedIdRef = useRef<string | null>(null);
  const endedCallSidRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const DEBOUNCE_MS = 350;
  const [report, setReport] = useState<string | null>(null);
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [showReportButton, setShowReportButton] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [etaMinutes, setEtaMinutes] = useState<number | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [routeGeometry, setRouteGeometry] = useState<any>(null);
  const [stationCoords, setStationCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Load state from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data: DashboardStorageState = JSON.parse(stored);
        if (data.messages) setMessages(data.messages.map(m => ({ ...m, timestamp: new Date(m.timestamp) })));
        if (data.currentCallSid) setCurrentCallSid(data.currentCallSid);
        if (data.incidentDetails) setIncidentDetails(data.incidentDetails);
        if (data.urgency) setUrgency(data.urgency);
        if (data.nextQuestion !== undefined) setNextQuestion(data.nextQuestion);
        if (data.showReportButton) setShowReportButton(data.showReportButton);
        if (data.reportUrl) setReportUrl(data.reportUrl);
        if (data.coords) setCoords(data.coords);
        console.log('📦 Restored dashboard state from localStorage');
      }
    } catch (e) {
      console.error('Failed to load dashboard state:', e);
    }
    setIsInitialized(true);
  }, []);

  // Save state to localStorage whenever it changes
  useEffect(() => {
    if (!isInitialized) return; // Don't save until we've loaded
    
    const state: DashboardStorageState = {
      messages,
      currentCallSid,
      incidentDetails,
      urgency,
      nextQuestion,
      showReportButton,
      reportUrl,
      coords,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [messages, currentCallSid, incidentDetails, urgency, nextQuestion, showReportButton, reportUrl, coords, isInitialized]);

  // Clear all call data and start fresh
  const clearCallData = useCallback(() => {
    setMessages([]);
    setCurrentCallSid(null);
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
    setMissingKeys([]);
    setShowReportButton(false);
    setReportUrl(null);
    setReport(null);
    setCoords(null);
    setRouteGeometry(null);
    setStationCoords(null);
    setEtaMinutes(null);
    endedCallSidRef.current = null;
    lastAnalyzedIdRef.current = null;
    localStorage.removeItem(STORAGE_KEY);
    console.log('🧹 Cleared all call data');
  }, []);

  // Subscribe to real-time transcripts via direct WebSocket connection to backend
  useEffect(() => {
    const resolveWsUrl = () => {
      let envUrl = process.env.NEXT_PUBLIC_WS_URL;
      if (envUrl && typeof window !== 'undefined') {
        // Prevent mixed-content: upgrade ws -> wss when the page is https
        if (window.location.protocol === 'https:' && envUrl.startsWith('ws://')) {
          envUrl = envUrl.replace('ws://', 'wss://');
        }
        return envUrl;
      }
      if (typeof window !== 'undefined') {
        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const host = window.location.hostname;
        const port = (process.env.NEXT_PUBLIC_SERVER_PORT as string) || '3001';
        return `${proto}://${host}:${port}/dashboard`;
      }
      return 'ws://localhost:3001/dashboard';
    };

    const wsUrl = resolveWsUrl();
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

                // Handle new call started
                if (data.type === 'call_started') {
                    console.log('📞 New call started:', data.call_sid);
                    setCurrentCallSid(data.call_sid);
                    setStatus('listening');
                    setShowReportButton(false);
                    setReportUrl(null);
                    setReport(null);
                    endedCallSidRef.current = null;
                }

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
                } else if (data.type === 'analysis') {
                    // Trust server-side analysis when available (works even without client API keys)
                    console.log('[Map] WS analysis update received', data);
                    if (data.incident) {
                        setIncidentDetails((prev) => ({ ...prev, ...data.incident }));
                    }
                    if (data.urgency) {
                        setUrgency(data.urgency);
                    }
                    if (typeof data.nextQuestion !== 'undefined') {
                        setNextQuestion(data.nextQuestion);
                    }
                    if (Array.isArray(data.missing)) {
                        setMissingKeys(data.missing);
                    }
                } else if (data.type === 'geo' || data.type === 'location_update') {
                    // Server-pushed precise coordinates from phone API
                    console.log('[Map] ✅ WS geolocation update received:', data);
                    if (typeof data.lat === 'number' && typeof data.lon === 'number') {
                      console.log('[Map] Setting coords:', { lat: data.lat, lon: data.lon });
                      setCoords({ lat: data.lat, lon: data.lon });
                    } else {
                      console.warn('[Map] Invalid lat/lon in geo message:', data);
                    }
                    if (data.address) {
                      setIncidentDetails((prev) => ({ ...prev, location: data.address }));
                    }
                } else if (data.type === 'call_ended') {
                    console.log('🏁 Call ended, switching to standby');
                    endedCallSidRef.current = data.call_sid;
                    setStatus('connected');
                    setShowReportButton(true);
                    // Reset map-related state to stop further lookups and clear the map
                    setEtaMinutes(null);
                    setCoords(null);
                    // Clear blind-spot list for idle state
                    setMissingKeys([]);
                }
            } catch (error) {
                // Non-fatal: ignore malformed frames or heartbeat noise in dev
                console.warn('⚠️ Error parsing WebSocket message:', error);
            }
        };

        ws.onerror = (event) => {
            // Browser WebSocket onerror often lacks detail; mark disconnected and trigger reconnect via close
            const state = ws?.readyState;
            const maybeMsg = (event as any)?.message || (event as any)?.reason || '';
            console.warn(`⚠️ WebSocket error; state=${state}${maybeMsg ? `; message=${maybeMsg}` : ''}`);
            setStatus('disconnected');
            try { ws?.close(); } catch {}
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => {
                console.log('🔄 Reconnecting after error...');
                connect();
            }, 3000);
        };

        ws.onclose = (evt) => {
            console.log('🔌 Disconnected from backend WebSocket', { code: (evt as any)?.code, reason: (evt as any)?.reason });
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
      const { updates, nextQuestion: suggestedQuestion, missing } = data;

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
      if (Array.isArray(missing)) {
        setMissingKeys(missing as any);
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

  // Fetch ETA when location or precise coords change (only during active call)
  useEffect(() => {
    const fetchEta = async () => {
      if (status !== 'listening' || !currentCallSid) {
        console.log('[Map] Skipping ETA; no active call', { status, currentCallSid });
        return;
      }
      // Prefer precise coordinates if available
      if (coords?.lat && coords?.lon) {
        console.log('[Map] 📍 Fetching ETA by coords', coords);
        try {
          const res = await fetch(`/api/police-eta?lat=${coords.lat}&lon=${coords.lon}`);
          console.log('[Map] ETA response status:', res.status);
          if (!res.ok) {
            const errorText = await res.text();
            console.warn('[Map] ⚠️ ETA-by-coords non-OK', res.status, errorText);
            return;
          }
          const data = await res.json();
          console.log('[Map] ✅ ETA data received:', data);
          setEtaMinutes(data.etaMinutes ?? null);
          if (data.routeGeometry) {
            setRouteGeometry(JSON.parse(data.routeGeometry));
          }
          if (data.station) {
            setStationCoords({ lat: data.station.lat, lon: data.station.lon });
          }
        } catch (error) {
          console.error('[Map] ❌ ETA-by-coords failed', error);
        }
        return;
      }

      // Otherwise, geocode from address
      if (!incidentDetails.location) {
        console.log('[Map] No location/address yet; skipping ETA');
        setEtaMinutes(null);
        setCoords(null);
        setRouteGeometry(null);
        setStationCoords(null);
        return;
      }
      console.log('[Map] 🔍 Fetching ETA by address', incidentDetails.location);
      try {
        const res = await fetch(`/api/police-eta?address=${encodeURIComponent(incidentDetails.location)}`);
        console.log('[Map] ETA response status:', res.status);
        if (!res.ok) { 
          const errorText = await res.text();
          console.warn('[Map] ⚠️ ETA-by-address non-OK', res.status, errorText);
          return; 
        }
        const data = await res.json();
        console.log('[Map] ✅ ETA data received:', data);
        setEtaMinutes(data.etaMinutes ?? null);
        if (data.lat && data.lon) {
          setCoords({ lat: data.lat, lon: data.lon });
        }
        if (data.routeGeometry) {
          setRouteGeometry(JSON.parse(data.routeGeometry));
        }
        if (data.station) {
          setStationCoords({ lat: data.station.lat, lon: data.station.lon });
        }
      } catch (error) {
        console.error('[Map] ❌ ETA-by-address failed', error);
      }
    };
    fetchEta();
  }, [incidentDetails.location, coords?.lat, coords?.lon, status, currentCallSid]);

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
            
            {/* Top: Critical Blind Spots */}
            <div className="w-full">
                <CriticalBlindSpots 
                  missing={missingKeys as any}
                  loading={isAnalyzing}
                  inactive={status !== 'listening' || !currentCallSid}
                  placeholder={'No active call. Critical gaps will appear here.'}
                />
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

            {/* Map + ETA */}
            <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <MapPanel
                lat={coords?.lat ?? null}
                lon={coords?.lon ?? null}
                etaMinutes={etaMinutes}
                address={incidentDetails.location}
                routeGeometry={routeGeometry}
                stationLat={stationCoords?.lat ?? null}
                stationLon={stationCoords?.lon ?? null}
              />
            </div>

            {/* Report Generation Button (pops up when call ends) */}
            {showReportButton && (
                <div className="w-full rounded-xl border-2 border-primary bg-primary/10 p-6 flex flex-col items-center justify-center gap-3 animate-in fade-in slide-in-from-top-4">
                    <h3 className="text-lg font-semibold text-primary">Call Ended</h3>
                    <p className="text-sm text-muted-foreground text-center">
                        The call has concluded. Generate a comprehensive PDF report including transcript and incident details.
                    </p>
                    <div className="flex gap-3">
                        <button
                            onClick={handleGenerateReport}
                            disabled={isGeneratingReport}
                            className="rounded-full bg-primary px-8 py-3 text-base font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 shadow-lg hover:shadow-xl transition-all"
                        >
                            {isGeneratingReport ? 'Generating Report...' : 'Generate PDF Report'}
                        </button>
                        <button
                            onClick={clearCallData}
                            className="rounded-full bg-secondary px-6 py-3 text-base font-medium text-secondary-foreground hover:bg-secondary/80 shadow-md transition-all"
                        >
                            Clear & New Call
                        </button>
                    </div>
                </div>
            )}

            {/* Success State: Download Link */}
            {reportUrl && (
                <div className="w-full rounded-xl border border-green-200 bg-green-50 p-4 flex items-center justify-between gap-4 animate-in fade-in">
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center text-green-600">
                            ✓
                        </div>
                        <div>
                            <h4 className="font-semibold text-green-900">Report Ready</h4>
                            <p className="text-xs text-green-700">Saved to Database</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <a 
                            href={reportUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="rounded-md bg-white border border-green-200 px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-50 shadow-sm"
                        >
                            Download PDF
                        </a>
                        <button
                            onClick={clearCallData}
                            className="rounded-md bg-white border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 shadow-sm"
                        >
                            New Call
                        </button>
                    </div>
                </div>
            )}

        </section>
      </main>
    </div>
  );
}
