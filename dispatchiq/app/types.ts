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

