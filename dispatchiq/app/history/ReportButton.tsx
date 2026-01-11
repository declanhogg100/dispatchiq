'use client';
import { useState, useEffect } from 'react';
import { FileText, Loader2, Download } from 'lucide-react';

interface ReportButtonProps {
    callId: string;
}

export function ReportButton({ callId }: ReportButtonProps) {
    const [existingReportUrl, setExistingReportUrl] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    
    const reportStorageUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/Reports/${callId}/report.pdf`;

    useEffect(() => {
        // Check if report exists
        fetch(reportStorageUrl, { method: 'HEAD' })
            .then(res => {
                if (res.ok) setExistingReportUrl(reportStorageUrl);
            })
            .catch(() => {});
    }, [reportStorageUrl]);

    const generateReport = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        setIsGenerating(true);
        try {
            const res = await fetch('/api/report?format=pdf', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ callId })
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
            
            setExistingReportUrl(reportStorageUrl);
        } catch (e) {
            console.error(e);
            alert('Failed to generate report');
        } finally {
            setIsGenerating(false);
        }
    };
    
    const download = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        window.open(existingReportUrl!, '_blank');
    }

    if (existingReportUrl) {
        return (
            <button
                onClick={download}
                className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-blue-600 hover:text-white h-9 w-9 text-blue-600"
                title="Download Report"
            >
                <Download className="h-4 w-4" />
                <span className="sr-only">Download Report</span>
            </button>
        );
    }

    return (
        <button
            onClick={generateReport}
            disabled={isGenerating}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background text-muted-foreground hover:bg-blue-600 hover:text-white h-9 w-9"
            title="Generate Report"
        >
            {isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
                <FileText className="h-4 w-4" />
            )}
            <span className="sr-only">Generate Report</span>
        </button>
    );
}

