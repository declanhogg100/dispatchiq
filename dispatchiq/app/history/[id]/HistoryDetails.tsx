'use client';

import { useState, useEffect } from 'react';
import { IncidentDetails, TranscriptMessage, Urgency } from '@/app/types';
import { IncidentState } from '@/app/components/IncidentState';
import { Transcript } from '@/app/components/Transcript';
import { FileText, Loader2, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface HistoryDetailsProps {
  callId: string;
  initialIncident: IncidentDetails;
  initialUrgency: Urgency;
  initialTranscripts: TranscriptMessage[];
  startedAt: string | null;
  endedAt: string | null;
}

export function HistoryDetails({ 
  callId, 
  initialIncident, 
  initialUrgency, 
  initialTranscripts,
  startedAt,
  endedAt
}: HistoryDetailsProps) {
  const [incident, setIncident] = useState(initialIncident);
  const [urgency, setUrgency] = useState(initialUrgency);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [existingReportUrl, setExistingReportUrl] = useState<string | null>(null);

  const reportStorageUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/Reports/${callId}/report.pdf`;

  useEffect(() => {
    // Check if report exists
    fetch(reportStorageUrl, { method: 'HEAD' })
      .then(res => {
        if (res.ok) setExistingReportUrl(reportStorageUrl);
      })
      .catch(console.error);
  }, [reportStorageUrl]);

  const handleDetailsUpdate = (updates: Partial<IncidentDetails>) => {
    setIncident(prev => ({ ...prev, ...updates }));
  };

  const handleUrgencyUpdate = (newUrgency: Urgency) => {
    setUrgency(newUrgency);
  };
  
  const saveChanges = async () => {
    setIsSaving(true);
    
    if (!supabase) {
        alert('Supabase client not initialized');
        setIsSaving(false);
        return;
    }

    const { error } = await supabase
      .from('incidents')
      .update({
        location: incident.location,
        type: incident.type,
        injuries: incident.injuries,
        threat_level: incident.threatLevel,
        people_count: incident.peopleCount,
        caller_role: incident.callerRole,
        urgency: urgency
      })
      .eq('call_id', callId);

    setIsSaving(false);
    if (error) {
        alert('Failed to save changes');
        console.error(error);
    }
  };

  const generateReport = async () => {
    setIsGenerating(true);
    try {
      const res = await fetch('/api/report?format=pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: initialTranscripts,
          incident,
          urgency,
          callId,
          startedAt,
          endedAt
        })
      });

      if (!res.ok) throw new Error('Report generation failed');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report-${callId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
      
      // Update state to show we now have a report
      setExistingReportUrl(reportStorageUrl);
    } catch (e) {
      console.error(e);
      alert('Failed to generate report');
    } finally {
      setIsGenerating(false);
    }
  };
  
  const downloadExisting = () => {
    window.open(existingReportUrl!, '_blank');
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-12rem)]">
        {/* Left: Transcript */}
        <div className="lg:col-span-1 h-full min-h-[400px]">
            <Transcript messages={initialTranscripts} title="Call Transcript" />
        </div>

        {/* Right: Details & Actions */}
        <div className="lg:col-span-2 flex flex-col gap-6 h-full overflow-y-auto pr-2">
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
                <div className="mb-6 flex items-center justify-between">
                    <h2 className="text-xl font-semibold">Incident Report</h2>
                    <div className="flex gap-2">
                        <button 
                            onClick={saveChanges}
                            disabled={isSaving}
                            className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2"
                        >
                            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Save Changes
                        </button>
                        
                        {existingReportUrl ? (
                           <>
                            <button 
                                onClick={downloadExisting}
                                className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2"
                            >
                                <FileText className="mr-2 h-4 w-4" />
                                Download PDF
                            </button>
                            <button 
                                onClick={generateReport}
                                disabled={isGenerating}
                                className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2"
                            >
                                {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Regenerate'}
                            </button>
                           </>
                        ) : (
                            <button 
                                onClick={generateReport}
                                disabled={isGenerating}
                                className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2"
                            >
                                {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                                Generate PDF
                            </button>
                        )}
                    </div>
                </div>
                
                <IncidentState 
                    details={incident} 
                    urgency={urgency} 
                    isEditable={true}
                    onDetailsUpdate={handleDetailsUpdate}
                    onUrgencyUpdate={handleUrgencyUpdate}
                />
            </div>
        </div>
    </div>
  );
}

