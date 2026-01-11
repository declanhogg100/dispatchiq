import { IncidentDetails, Urgency } from '../types';
import { MapPin, AlertTriangle, Users, Stethoscope, UserCircle, ShieldAlert } from 'lucide-react';

interface IncidentStateProps {
  details: IncidentDetails;
  urgency: Urgency;
  isEditable?: boolean;
  onDetailsUpdate?: (updates: Partial<IncidentDetails>) => void;
  onUrgencyUpdate?: (urgency: Urgency) => void;
}

function Field({ 
  label, 
  value, 
  icon: Icon, 
  critical = false,
  isEditable = false,
  onChange
}: { 
  label: string; 
  value: string | null; 
  icon: any; 
  critical?: boolean;
  isEditable?: boolean;
  onChange?: (val: string) => void;
}) {
  const isMissing = !value;
  
  return (
    <div className={`group flex flex-col gap-1 rounded-lg border p-3 transition-all ${
      isMissing && critical && !isEditable
        ? "border-red-200 bg-red-50/50" 
        : "border-border bg-card hover:bg-accent/5"
    }`}>
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      
      {isEditable ? (
        <input 
          type="text" 
          value={value || ""} 
          onChange={(e) => onChange?.(e.target.value)}
          className="w-full bg-transparent text-base font-semibold text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-0 border-b border-transparent focus:border-primary/50 transition-colors px-0 py-0"
          placeholder="Unknown"
        />
      ) : (
        <div className={`text-base font-semibold ${
          isMissing ? "italic text-muted-foreground/50" : "text-foreground"
        }`}>
          {value || "Unknown"}
        </div>
      )}
    </div>
  );
}

export function IncidentState({ details, urgency, isEditable = false, onDetailsUpdate, onUrgencyUpdate }: IncidentStateProps) {
  const urgencyColor = {
    Low: "bg-green-100 text-green-700 border-green-200",
    Medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
    Critical: "bg-red-100 text-red-700 border-red-200",
  }[urgency];

  return (
    <div className="flex flex-col gap-4">
      {/* Header with Urgency Badge */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Incident Details</h2>
        
        {isEditable ? (
          <select 
            value={urgency}
            onChange={(e) => onUrgencyUpdate?.(e.target.value as Urgency)}
            className={`appearance-none flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wide cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary/20 ${urgencyColor}`}
          >
            <option value="Low">Low Priority</option>
            <option value="Medium">Medium Priority</option>
            <option value="Critical">Critical Priority</option>
          </select>
        ) : (
          <div className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wide ${urgencyColor}`}>
            <div className={`h-2 w-2 rounded-full bg-current animate-pulse`} />
            {urgency} Priority
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Critical Fields (Full Width on mobile, maybe span 2 on desktop for Location) */}
        <div className="col-span-2">
            <Field 
              label="Location" 
              value={details.location} 
              icon={MapPin} 
              critical={true} 
              isEditable={isEditable}
              onChange={(val) => onDetailsUpdate?.({ location: val })}
            />
        </div>

        <Field 
          label="Type" 
          value={details.type} 
          icon={AlertTriangle} 
          critical={true}
          isEditable={isEditable}
          onChange={(val) => onDetailsUpdate?.({ type: val })}
        />
        
        <Field 
          label="Injuries" 
          value={details.injuries} 
          icon={Stethoscope} 
          isEditable={isEditable}
          onChange={(val) => onDetailsUpdate?.({ injuries: val })}
        />

        <Field 
          label="People Count" 
          value={details.peopleCount} 
          icon={Users} 
          isEditable={isEditable}
          onChange={(val) => onDetailsUpdate?.({ peopleCount: val })}
        />
        
        <Field 
          label="Caller Role" 
          value={details.callerRole} 
          icon={UserCircle} 
          isEditable={isEditable}
          onChange={(val) => onDetailsUpdate?.({ callerRole: val })}
        />
        
        <div className="col-span-2">
            <Field 
              label="Threat Level" 
              value={details.threatLevel} 
              icon={ShieldAlert} 
              isEditable={isEditable}
              onChange={(val) => onDetailsUpdate?.({ threatLevel: val })}
            />
        </div>
      </div>
    </div>
  );
}

