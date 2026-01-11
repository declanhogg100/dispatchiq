import { AlertTriangle } from 'lucide-react';

type MissingKey = 'location' | 'type' | 'injuries' | 'threatLevel' | 'peopleCount' | 'callerRole';

interface CriticalBlindSpotsProps {
  missing: MissingKey[];
  loading?: boolean;
  inactive?: boolean;
  placeholder?: string;
}

const LABELS: Record<MissingKey, string> = {
  location: 'Exact location',
  type: 'Type of emergency',
  injuries: 'Breathing/injuries status',
  threatLevel: 'Immediate danger to caller',
  peopleCount: 'Number of people involved',
  callerRole: 'Caller role/relationship',
};

export function CriticalBlindSpots({ missing, loading, inactive, placeholder }: CriticalBlindSpotsProps) {
  const hasMissing = (missing?.length ?? 0) > 0;
  return (
    <div className="relative overflow-hidden rounded-xl border border-yellow-400 bg-yellow-100 p-6 text-yellow-900 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="h-5 w-5 text-yellow-800" />
        <span className="text-sm font-semibold uppercase tracking-wider">Critical Missing Information</span>
      </div>

      <div className="min-h-[3rem]">
        {inactive ? (
          <p className="text-sm text-yellow-900/80">
            {placeholder || 'No active call. Critical gaps will appear here.'}
          </p>
        ) : loading ? (
          <div className="flex gap-1">
            <div className="h-2 w-2 rounded-full bg-yellow-800/40 animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="h-2 w-2 rounded-full bg-yellow-800/40 animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="h-2 w-2 rounded-full bg-yellow-800/40 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        ) : hasMissing ? (
          <ul className="mt-1 space-y-1">
            {missing.map((key) => (
              <li key={key} className="flex items-center gap-2 text-sm">
                <span className="text-red-700">❌</span>
                <span className="font-medium">{LABELS[key]}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-base font-semibold text-green-800 flex items-center gap-2">
            <span>✅</span>
            <span>All critical info captured</span>
          </p>
        )}
      </div>

      <div className="absolute -right-6 -bottom-6 opacity-10 text-yellow-400">
        <AlertTriangle className="h-32 w-32" />
      </div>
    </div>
  );
}
