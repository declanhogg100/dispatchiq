import { NextResponse } from 'next/server';
import {
  AnalysisRequestPayload,
  AnalysisResponsePayload,
  IncidentDetails,
  TranscriptMessage,
  Urgency,
} from '@/app/types';

const GEMINI_MODEL = process.env.GEMINI_MODEL_ID ?? 'gemini-2.5-flash';
const REQUIRED_FIELDS: (keyof IncidentDetails)[] = [
  'location',
  'type',
  'injuries',
  'threatLevel',
  'peopleCount',
  'callerRole',
];

type IncomingMessage = Omit<TranscriptMessage, 'timestamp'> & {
  timestamp: string | Date;
};

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json()) as AnalysisRequestPayload;
  const messages = normalizeMessages(body?.messages ?? []);
  const incident = body?.incident;
  const urgency = body?.urgency ?? 'Low';

  if (!incident) {
    return NextResponse.json({ error: 'Missing incident payload' }, { status: 400 });
  }

  try {
    const result = await runGeminiAnalysis(messages, incident, urgency);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Gemini analysis failed; falling back to heuristic output', error);
    return NextResponse.json(mockAnalysis(messages, incident, urgency));
  }
}

function normalizeMessages(messages: IncomingMessage[]): TranscriptMessage[] {
  return messages.map((msg) => ({
    ...msg,
    timestamp: new Date(msg.timestamp),
  }));
}

async function runGeminiAnalysis(
  messages: TranscriptMessage[],
  incident: IncidentDetails,
  urgency: Urgency,
): Promise<AnalysisResponsePayload> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      ...mockAnalysis(messages, incident, urgency),
      rawModelText: 'GEMINI_API_KEY missing; using heuristic fallback.',
    };
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
  if (!parsed) {
    throw new Error('Unable to parse Gemini response');
  }

  return { ...parsed, rawModelText: modelText };
}

function buildPrompt(
  messages: TranscriptMessage[],
  incident: IncidentDetails,
  urgency: Urgency,
): string {
  const transcriptWindow = messages.slice(-20);
  const transcriptText = transcriptWindow
    .map(
      (msg) =>
        `${msg.sender === 'dispatcher' ? 'DISPATCHER' : 'CALLER'}: ${msg.text}`,
    )
    .join('\n');

  const missing = REQUIRED_FIELDS.filter((key) => !incident[key]);

  return `
You are an emergency dispatch copilot. Maintain a structured incident state as JSON only.
Rules:
- Always return valid JSON, no code fences.
- Provide concise updates only for fields that changed.
- Respect dispatcher overrides (do not contradict provided values).
- Suggest exactly one next_question that fills the highest-priority missing info.
- urgency must be one of: Low, Medium, Critical.

Current structured state:
${JSON.stringify(incident, null, 2)}
Current urgency: ${urgency}
Missing required fields (in priority order): ${missing.join(', ') || 'none'}

Transcript (latest first):
${transcriptText}

Respond with:
{
  "updates": { "field": "new value", "urgency": "Low|Medium|Critical" },
  "missing": ["field names still unknown"],
  "next_question": "one short dispatcher-style question"
}
  `.trim();
}

function parseModelJson(
  text: string,
): Omit<AnalysisResponsePayload, 'rawModelText'> | null {
  if (!text) return null;

  // Try to extract the first JSON object from the response.
  const match = text.match(/\{[\s\S]*\}/);
  const candidate = match ? match[0] : text;

  try {
    const parsed = JSON.parse(candidate);
    const updates = parsed.updates ?? {};
    const nextQuestion = parsed.next_question ?? parsed.nextQuestion ?? null;

    return {
      updates,
      missing: parsed.missing ?? [],
      nextQuestion,
    };
  } catch (error) {
    console.error('Failed to JSON-parse model output', error, text);
    return null;
  }
}

function mockAnalysis(
  messages: TranscriptMessage[],
  incident: IncidentDetails,
  urgency: Urgency,
): AnalysisResponsePayload {
  const lastCallerMsg = [...messages]
    .reverse()
    .find((msg) => msg.sender === 'caller');

  const text = lastCallerMsg?.text?.toLowerCase() ?? '';
  const updates: Partial<IncidentDetails & { urgency: Urgency }> = {};

  if (!incident.type && /fire|smoke|burning/.test(text)) updates.type = 'Fire';
  if (!incident.type && /gun|weapon|shots/.test(text)) updates.type = 'Police';
  if (!incident.injuries && /hurt|injur|bleed/.test(text))
    updates.injuries = 'Reported';

  const missing = REQUIRED_FIELDS.filter(
    (key) => !(incident as any)[key] && !(updates as any)[key],
  );

  let derivedUrgency: Urgency = urgency;
  if (/unconscious|not breathing|shots|gun|bleeding/.test(text)) {
    derivedUrgency = 'Critical';
  } else if (/fire|smoke/.test(text)) {
    derivedUrgency = 'Medium';
  }
  if (derivedUrgency !== urgency) {
    updates.urgency = derivedUrgency;
  }

  const nextQuestion =
    missing.includes('location')
      ? 'What is the exact address of the emergency?'
      : missing.includes('peopleCount')
        ? 'How many people are involved or nearby?'
        : missing.includes('threatLevel')
          ? 'Do you feel there is any immediate danger right now?'
          : 'Stay on the line. Are you and everyone nearby in a safe place?';

  return {
    updates,
    missing,
    nextQuestion,
  };
}
