import { Radio } from 'lucide-react';

interface HeaderProps {
  status: 'connected' | 'disconnected' | 'listening';
}

export function Header({ status }: HeaderProps) {
  return (
    <header className="flex h-16 w-full items-center justify-between border-b border-border bg-card px-6">
      <div className="flex items-center gap-2">
        <Radio className="h-6 w-6 text-red-500 animate-pulse" />
        <h1 className="text-xl font-bold tracking-tight text-foreground">SignalOne</h1>
      </div>
      
      <div className="flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-sm font-medium">
        <div className={`h-2 w-2 rounded-full ${status === 'listening' ? 'bg-red-500 animate-pulse' : 'bg-gray-400'}`} />
        <span className="uppercase text-muted-foreground">
            {status === 'listening' ? 'Live Call' : 'Standby'}
        </span>
      </div>
    </header>
  );
}

