import { getServerSupabase } from '@/lib/supabase';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { ReportButton } from './ReportButton';
import { DeleteCallButton } from './DeleteCallButton';
import { Header } from '../components/Header';

export const dynamic = 'force-dynamic';

function formatDate(dateString: string | null) {
  if (!dateString) return 'Unknown';
  return new Date(dateString).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default async function HistoryPage() {
  const supabase = getServerSupabase();
  
  // Fetch calls with incidents
  const { data: calls, error } = await supabase
    .from('calls')
    .select(`
      *,
      incidents (*)
    `)
    .order('started_at', { ascending: false });

  if (error) {
    return <div className="p-8 text-red-500">Error loading history: {error.message}</div>;
  }

  return (
    <div className="flex h-screen w-full flex-col bg-background">
      <Header />
      <div className="flex-1 overflow-auto p-8">
        <div className="mx-auto max-w-6xl space-y-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Call History</h1>
            <p className="text-muted-foreground">Review past emergency calls and generate reports.</p>
          </div>

        <div className="rounded-md border bg-card">
          <div className="relative w-full overflow-auto">
            <table className="w-full caption-bottom text-sm">
              <thead className="[&_tr]:border-b">
                <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Date</th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Type</th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Location</th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Incident Level</th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Threat Details</th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Duration</th>
                  <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {calls && calls.map((call) => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const incident = (call as any).incidents?.[0]; // Assuming one incident per call
                  const duration = call.ended_at && call.started_at 
                    ? Math.round((new Date(call.ended_at).getTime() - new Date(call.started_at).getTime()) / 1000) + 's'
                    : '-';
                  
                  return (
                    <tr key={call.id} className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                      <td className="p-4 align-middle font-medium">
                        {formatDate(call.started_at)}
                      </td>
                      <td className="p-4 align-middle">
                        <span className="font-medium">{incident?.type || 'Unknown'}</span>
                      </td>
                      <td className="p-4 align-middle text-muted-foreground">
                        {incident?.location || 'Unknown'}
                      </td>
                      <td className="p-4 align-middle">
                        {incident?.urgency ? (
                          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${
                            incident.urgency === 'Critical' 
                              ? 'bg-red-100 text-red-800' 
                              : incident.urgency === 'Medium'
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-green-100 text-green-800'
                          }`}>
                            {incident.urgency}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Unknown</span>
                        )}
                      </td>
                      <td className="p-4 align-middle text-muted-foreground">
                        {incident?.threat_level || '-'}
                      </td>
                      <td className="p-4 align-middle text-muted-foreground">{duration}</td>
                      <td className="p-4 align-middle text-right">
                        <div className="flex items-center justify-end gap-2">
                          <ReportButton callId={call.id} />
                          <DeleteCallButton callId={call.id} />
                          <Link 
                            href={`/history/${call.id}`}
                            className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-9 px-3"
                          >
                            View Details <ChevronRight className="ml-1 h-4 w-4" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {(!calls || calls.length === 0) && (
                <div className="p-8 text-center text-muted-foreground">
                    No calls found.
                </div>
            )}
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}

