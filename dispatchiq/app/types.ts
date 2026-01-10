export type Urgency = 'Low' | 'Medium' | 'Critical';

export interface IncidentDetails {
  location: string | null;
  type: string | null;
  injuries: string | null;
  threatLevel: string | null;
  peopleCount: string | null;
  callerRole: string | null;
}

export interface TranscriptMessage {
  id: string;
  sender: 'caller' | 'dispatcher';
  text: string;
  timestamp: Date;
  isPartial?: boolean;
}

// Payload sent from the client to the analysis endpoint.
export interface AnalysisRequestPayload {
  messages: TranscriptMessage[];
  incident: IncidentDetails;
  urgency: Urgency;
}

// Structured response returned by the LLM-backed analysis endpoint.
export interface AnalysisResponsePayload {
  updates: Partial<IncidentDetails & { urgency: Urgency }>;
  missing: (keyof IncidentDetails)[];
  nextQuestion: string | null;
  rawModelText?: string;
}

// Report generation types
export interface ReportRequestPayload {
  messages: TranscriptMessage[];
  incident: IncidentDetails;
  urgency: Urgency;
  callId?: string;
  dispatcherId?: string;
  callType?: string;
  startedAt?: string;
  endedAt?: string;
  recordingUrl?: string;
}

export interface ReportResponsePayload {
  report: string; // JSON string pretty-printed
  rawModelText?: string;
  storagePath?: string;
  publicUrl?: string | null;
}
