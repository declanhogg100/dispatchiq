import { getServerSupabase } from '@/lib/supabase';
import { HistoryDetails } from './HistoryDetails';
import { IncidentDetails, TranscriptMessage, Urgency } from '@/app/types';
import { notFound } from 'next/navigation';
import { Header } from '@/app/components/Header';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CallDetailsPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = getServerSupabase();

  // Fetch Call, Incident
  const { data: call, error: callError } = await supabase
    .from('calls')
    .select(`
      *,
      incidents (*)
    `)
    .eq('id', id)
    .single();

  if (callError || !call) {
    notFound();
  }

  // Fetch Transcripts
  const { data: transcriptsData, error: transcriptError } = await supabase
    .from('transcripts')
    .select('*')
    .eq('call_id', id)
    .order('created_at', { ascending: true });

  if (transcriptError) {
    console.error('Error fetching transcripts:', transcriptError);
  }

  // Map Transcripts
  const transcripts: TranscriptMessage[] = (transcriptsData || []).map((t) => ({
    id: t.id,
    sender: t.sender as 'caller' | 'dispatcher',
    text: t.text,
    timestamp: new Date(t.created_at),
    isPartial: t.is_partial || false,
  }));

  // Map Incident
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const incidentRow = (call as any).incidents?.[0];
  
  const incident: IncidentDetails = {
    location: incidentRow?.location || null,
    type: incidentRow?.type || null,
    injuries: incidentRow?.injuries || null,
    threatLevel: incidentRow?.threat_level || null,
    peopleCount: incidentRow?.people_count || null,
    callerRole: incidentRow?.caller_role || null,
  };

  const urgency: Urgency = (incidentRow?.urgency as Urgency) || 'Low';

  return (
    <div className="flex h-screen w-full flex-col bg-background">
      <Header />
      <div className="flex-1 overflow-auto p-8">
        <div className="mx-auto max-w-7xl space-y-6">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
              <a href="/history" className="hover:text-foreground">History</a>
              <span>/</span>
              <span>{id}</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Call Details</h1>
            <p className="text-muted-foreground">
              {call.started_at ? new Date(call.started_at).toLocaleString() : 'Unknown Date'} • {call.status}
            </p>
          </div>

          <HistoryDetails 
            callId={id}
            initialIncident={incident}
            initialUrgency={urgency}
            initialTranscripts={transcripts}
            startedAt={call.started_at}
            endedAt={call.ended_at}
          />
        </div>
      </div>
    </div>
  );
}

