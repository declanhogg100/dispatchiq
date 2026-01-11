import { NextResponse } from 'next/server';
import {
  SummaryRequestPayload,
  SummaryResponsePayload,
  TranscriptMessage,
  IncidentDetails,
  Urgency,
} from '@/app/types';

const GEMINI_MODEL = process.env.GEMINI_MODEL_ID ?? 'gemini-2.5-flash';

type IncomingMessage = Omit<TranscriptMessage, 'timestamp'> & { timestamp: string | Date };

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json()) as SummaryRequestPayload;
  const messages = normalizeMessages(body?.messages ?? []);
  const incident = body?.incident;
  const urgency = body?.urgency ?? 'Low';

  if (!incident) {
    return NextResponse.json({ error: 'Missing incident payload' }, { status: 400 });
  }

  try {
    const result = await runGeminiSummary(messages, incident, urgency);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Gemini summary failed; using heuristic fallback', error);
    return NextResponse.json(mockSummary(messages, incident, urgency));
  }
}

function normalizeMessages(messages: IncomingMessage[]): TranscriptMessage[] {
  return messages.map((m) => ({ ...m, timestamp: new Date(m.timestamp) }));
}

async function runGeminiSummary(
  messages: TranscriptMessage[],
  incident: IncidentDetails,
  urgency: Urgency,
): Promise<SummaryResponsePayload> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const fallback = mockSummary(messages, incident, urgency);
    fallback.rawModelText = 'GEMINI_API_KEY missing; using heuristic fallback.';
    return fallback;
  }

  const prompt = buildPrompt(messages, incident, urgency);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini HTTP error: ${response.status}`);
  }

  const data = await response.json();
  const modelText =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    data?.candidates?.[0]?.content?.parts?.[0]?.data ||
    '';

  const parsed = parseModelJson(modelText);
  if (!parsed) throw new Error('Unable to parse Gemini response for summary');
  return { ...parsed, rawModelText: modelText };
}

function buildPrompt(
  messages: TranscriptMessage[],
  incident: IncidentDetails,
  urgency: Urgency,
): string {
  const transcriptWindow = messages.slice(-12); // allow a bit more context for summarization
  const transcriptText = transcriptWindow
    .map((m) => `${m.sender === 'dispatcher' ? 'D' : 'C'}: ${m.text}`)
    .join('\n');

  return `Role: 911 AI dispatcher assistant.
Task: Write a concise summary (2-5 sentences) of what has happened so far in this call, then recommend next steps ONLY if there is sufficient information.

Return JSON only in the following format:
{
  "summary": "string",
  "recommendations": ["Dispatch an ambulance", "Send police unit"]
}

Guidelines:
- Summary should be neutral, factual, and actionable.
- If there's enough info (e.g., clear medical issue, fire, threat), include 1-3 imperative recommendations. If not, return an empty list.
- Use domain terms: ambulance, police unit, fire engine, rescue, etc., not generic wording.
- Do NOT include addresses or PII not explicitly stated.

Current structured state: ${JSON.stringify({ incident, urgency })}

Transcript (most recent first lines last):
${transcriptText}
`.trim();
}

function parseModelJson(text: string): Omit<SummaryResponsePayload, 'rawModelText'> | null {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  const candidate = match ? match[0] : text;
  try {
    const parsed = JSON.parse(candidate);
    const summary: string = parsed.summary ?? '';
    const recommendations: string[] = Array.isArray(parsed.recommendations)
      ? parsed.recommendations
      : [];
    if (!summary) return null;
    return { summary, recommendations };
  } catch (e) {
    console.error('Failed to JSON-parse summary output', e, text);
    return null;
  }
}

function mockSummary(
  messages: TranscriptMessage[],
  incident: IncidentDetails,
  urgency: Urgency,
): SummaryResponsePayload {
  const parts: string[] = [];
  const type = incident.type || 'Incident';
  const location = incident.location || 'unknown location';
  const injuries = incident.injuries || 'unspecified';
  const people = incident.peopleCount || 'unknown';
  const role = incident.callerRole || 'unknown role';
  const threat = incident.threatLevel || urgency || 'unknown';

  parts.push(`${type} at ${location}.`);
  parts.push(`Threat level ${threat}.`);
  parts.push(`Injuries: ${injuries}. People involved: ${people}. Caller role: ${role}.`);

  const recent = messages.slice(-3)
    .map((m) => `${m.sender === 'dispatcher' ? 'AI' : 'Caller'}: ${m.text}`)
    .join(' ');
  if (recent) parts.push(`Recent: ${recent}`);

  const txt = parts.join(' ');

  // very simple heuristics for recommendations
  const lower = `${type} ${injuries} ${messages.map(m => m.text).join(' ')}`.toLowerCase();
  const recs: string[] = [];
  if (/fire|smoke|flames|burn/.test(lower)) recs.push('Dispatch a fire engine');
  if (/gun|weapon|assault|threat|fight|robbery|police/.test(lower)) recs.push('Send a police unit');
  if (/unconscious|not breathing|heart|bleed|injur|medical|overdose|faint/.test(lower) || urgency === 'Critical') recs.push('Dispatch an ambulance');

  return { summary: txt, recommendations: recs };
}

