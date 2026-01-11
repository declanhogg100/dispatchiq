import { NextResponse } from 'next/server';
import {
  IncidentDetails,
  ReportRequestPayload,
  ReportResponsePayload,
  TranscriptMessage,
  Urgency,
} from '@/app/types';
import { createClient } from '@supabase/supabase-js';

const GEMINI_MODEL = process.env.GEMINI_MODEL_ID ?? 'gemini-2.5-flash';
const MAX_TRANSCRIPT_WINDOW = 100; // larger window for post-call summary
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REPORT_BUCKET =
  process.env.SUPABASE_REPORT_BUCKET || process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'Reports';
const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

interface ReportContent {
  header: {
    agency?: string;
    incident_id?: string;
    call_type?: string;
    priority?: string;
    received_utc?: string;
    received_local?: string;
    duration_seconds?: string | number;
    dispatcher_id?: string;
    recording_id?: string;
  };
  incident_summary?: string;
  key_details?: { label: string; value: string }[];
  timeline?: { time: string; event: string }[];
  dispatcher_actions?: string[];
  outcome?: string;
  ai_disclosure?: string;
  attachments?: {
    audio_reference?: string;
    transcript_reference?: string;
    model?: string;
    generated_at?: string;
  };
}

type IncomingMessage = Omit<TranscriptMessage, 'timestamp'> & {
  timestamp: string | Date;
};

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json()) as ReportRequestPayload;
  const messages = normalizeMessages(body?.messages ?? []);
  const incident = body?.incident;
  const urgency = body?.urgency ?? 'Low';
  const format =
    (req.url && new URL(req.url).searchParams.get('format')) || 'json';

  if (!incident) {
    return NextResponse.json({ error: 'Missing incident payload' }, { status: 400 });
  }

  try {
    const { report, rawModelText } = await runGeminiReport(
      messages,
      incident,
      urgency,
      body,
    );

    const pdfBuffer = await renderPdf(report);
    const uploadResult = await uploadPdf(pdfBuffer, body);

    if (format === 'pdf') {
      const body = pdfBuffer as unknown as BodyInit;
      return new NextResponse(body, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="dispatch-report.pdf"`,
          ...(uploadResult.publicUrl
            ? { 'x-report-url': uploadResult.publicUrl }
            : {}),
        },
      });
    }

    return NextResponse.json({
      report: JSON.stringify(report, null, 2),
      rawModelText,
      storagePath: uploadResult.path,
      publicUrl: uploadResult.publicUrl,
    } satisfies ReportResponsePayload);
  } catch (error) {
    console.error('Gemini report failed', error);
    return NextResponse.json(
      {
        report:
          'Report generation failed. Please retry after verifying GEMINI_API_KEY and GEMINI_MODEL_ID.',
      } satisfies ReportResponsePayload,
      { status: 500 },
    );
  }
}

function normalizeMessages(messages: IncomingMessage[]): TranscriptMessage[] {
  return messages.map((msg) => ({
    ...msg,
    timestamp: new Date(msg.timestamp),
  }));
}

async function runGeminiReport(
  messages: TranscriptMessage[],
  incident: IncidentDetails,
  urgency: Urgency,
  meta: ReportRequestPayload,
): Promise<{ report: ReportContent; rawModelText?: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY missing');
  }

  const prompt = buildPrompt(messages, incident, urgency, meta);

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
    throw new Error('Unable to parse Gemini response for report');
  }

  return { report: parsed, rawModelText: modelText };
}

function buildPrompt(
  messages: TranscriptMessage[],
  incident: IncidentDetails,
  urgency: Urgency,
  meta: ReportRequestPayload,
): string {
  const transcriptWindow = messages.slice(-MAX_TRANSCRIPT_WINDOW);
  const transcriptText = transcriptWindow
    .map((msg) => {
      const time = msg.timestamp ? new Date(msg.timestamp).toISOString() : '';
      const speaker = msg.sender === 'dispatcher' ? 'DISPATCHER' : 'CALLER';
      return `[${time}] ${speaker}: ${msg.text}`;
    })
    .join('\n');

  const startedAt = meta.startedAt || (messages[0]?.timestamp ? new Date(messages[0].timestamp).toISOString() : '');
  const endedAt = meta.endedAt || (messages[messages.length - 1]?.timestamp ? new Date(messages[messages.length - 1].timestamp).toISOString() : '');

  return `
You are generating a concise dispatch call report. Output JSON only (no code fences).
Tone: neutral, factual, legally careful. Do not invent details. If unknown, say "Not available".

Required JSON shape:
{
  "header": {
    "agency": "DispatchIQ",
    "incident_id": "<callId or generated>",
    "call_type": "<Medical|Fire|Police|Other|Unknown>",
    "priority": "<Low|Medium|High|Critical>",
    "received_utc": "<ISO8601 or 'Not available'>",
    "received_local": "<if provided>",
    "duration_seconds": "<number or 'Not available'>",
    "dispatcher_id": "<dispatcherId or 'Not available'>",
    "recording_id": "<recordingUrl or 'Not available'>"
  },
  "incident_summary": "1-2 sentences summary.",
  "key_details": [
    {"label":"Location","value":"<address or 'Not available'>"},
    {"label":"Caller relationship","value":"..."},
    {"label":"People involved","value":"..."},
    {"label":"Immediate threats","value":"..."},
    {"label":"Medical symptoms / incident indicators","value":"..."},
    {"label":"Environmental factors","value":"..."}
  ],
  "timeline": [
    {"time":"<ISO8601 or relative>", "event":"Call received"},
    {"time":"...", "event":"Classification / dispatch / instructions / notable answers"},
    {"time":"${endedAt || 'Not available'}", "event":"Call ended"}
  ],
  "dispatcher_actions": ["instruction or action", "..."],
  "outcome": "If unknown, say 'Final outcome not available at time of report.'",
  "ai_disclosure": "This report was generated with AI assistance based on call audio and system metadata. The dispatcher remains responsible for accuracy and review.",
  "attachments": {
    "audio_reference": "<recordingUrl or 'Not available'>",
    "transcript_reference": "Transcript available in system",
    "model": "${GEMINI_MODEL}",
    "generated_at": "<ISO8601 now>"
  }
}

Context:
- Current structured state: ${JSON.stringify(incident, null, 2)}
- Urgency: ${urgency}
- Metadata: ${JSON.stringify({
    callId: meta.callId || 'Not provided',
    dispatcherId: meta.dispatcherId || 'Not provided',
    callType: meta.callType || 'Not provided',
    startedAt,
    endedAt,
    recordingUrl: meta.recordingUrl || 'Not provided',
  })}

Transcript:
${transcriptText}

Return ONLY the JSON object above.
  `.trim();
}

function parseModelJson(text: string): ReportContent | null {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  const candidate = match ? match[0] : text;
  try {
    const parsed = JSON.parse(candidate);
    return parsed as ReportContent;
  } catch (error) {
    console.error('Failed to JSON-parse model output for report', error, text);
    return null;
  }
}

async function renderPdf(report: ReportContent): Promise<Buffer> {
  // Dynamically load pdfkit (standalone build) to avoid build-time bundling issues
  const { default: PDFDocument } = await import('pdfkit/js/pdfkit.standalone.js');

  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    // Header
    doc.fontSize(18).text('DispatchIQ Incident Report', { align: 'center' });
    doc.moveDown(1);

    const h = report.header || {};
    doc.fontSize(12);
    doc.text(`Agency: ${h.agency || 'DispatchIQ'}`);
    doc.text(`Incident ID: ${h.incident_id || 'Not available'}`);
    doc.text(`Call Type: ${h.call_type || 'Unknown'}`);
    doc.text(`Priority: ${h.priority || 'Unknown'}`);
    doc.text(`Received (UTC): ${h.received_utc || 'Not available'}`);
    doc.text(`Received (Local): ${h.received_local || 'Not available'}`);
    doc.text(`Duration (s): ${h.duration_seconds || 'Not available'}`);
    doc.text(`Dispatcher ID: ${h.dispatcher_id || 'Not available'}`);
    doc.text(`Recording ID: ${h.recording_id || 'Not available'}`);

    doc.moveDown(1);
    doc.fontSize(14).text('Incident Summary', { underline: true });
    doc.fontSize(12).text(report.incident_summary || 'Not available');

    // Key details
    if (report.key_details?.length) {
      doc.moveDown(1);
      doc.fontSize(14).text('Key Details', { underline: true });
      doc.fontSize(12);
      report.key_details.forEach((item) => {
        doc.text(`• ${item.label}: ${item.value || 'Not available'}`);
      });
    }

    // Timeline
    if (report.timeline?.length) {
      doc.moveDown(1);
      doc.fontSize(14).text('Timeline', { underline: true });
      doc.fontSize(12);
      report.timeline.forEach((item) => {
        doc.text(`${item.time || 'N/A'} — ${item.event || ''}`);
      });
    }

    // Dispatcher actions
    if (report.dispatcher_actions?.length) {
      doc.moveDown(1);
      doc.fontSize(14).text('Dispatcher Actions & Instructions', { underline: true });
      doc.fontSize(12);
      report.dispatcher_actions.forEach((action) => {
        doc.text(`• ${action}`);
      });
    }

    // Outcome
    doc.moveDown(1);
    doc.fontSize(14).text('Outcome / Resolution', { underline: true });
    doc.fontSize(12).text(
      report.outcome || 'Final outcome not available at time of report.',
    );

    // Disclosure
    doc.moveDown(1);
    doc.fontSize(10).fillColor('gray');
    doc.text(
      report.ai_disclosure ||
        'This report was generated with AI assistance based on call audio and system metadata. The dispatcher remains responsible for accuracy and review.',
      { align: 'left' },
    );

    // Attachments/meta
    if (report.attachments) {
      doc.moveDown(1);
      doc.fillColor('black').fontSize(12);
      doc.fontSize(14).text('Attachments & Metadata', { underline: true });
      doc.fontSize(12);
      doc.text(
        `Audio reference: ${report.attachments.audio_reference || 'Not available'}`,
      );
      doc.text(
        `Transcript reference: ${
          report.attachments.transcript_reference || 'Not available'
        }`,
      );
      doc.text(`Model: ${report.attachments.model || 'Not available'}`);
      doc.text(
        `Generated at: ${report.attachments.generated_at || 'Not available'}`,
      );
    }

    doc.end();
  });
}

async function uploadPdf(
  pdfBuffer: Buffer,
  meta: ReportRequestPayload,
): Promise<{ path?: string; publicUrl: string | null }> {
  if (!supabase) {
    return { path: undefined, publicUrl: null };
  }

  const callId = (meta.callId || 'call').replace(/\s+/g, '-');
  const filePath = `${callId}/${Date.now()}.pdf`;

  const { error } = await supabase.storage
    .from(REPORT_BUCKET)
    .upload(filePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (error) {
    console.error('Supabase upload failed', error);
    return { path: undefined, publicUrl: null };
  }

  const { data } = supabase.storage.from(REPORT_BUCKET).getPublicUrl(filePath);
  return { path: filePath, publicUrl: data?.publicUrl ?? null };
}
