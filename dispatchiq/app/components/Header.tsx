import { Radio, History, LayoutDashboard, Bot } from 'lucide-react';
import Link from 'next/link';

interface HeaderProps {
  status?: 'connected' | 'disconnected' | 'listening';
}

export function Header({ status }: HeaderProps) {
  return (
    <header className="flex h-16 w-full items-center justify-between border-b border-border bg-card px-6">
      <div className="flex items-center gap-6">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80">
          <Radio className="h-6 w-6 text-red-500 animate-pulse" />
          <h1 className="text-xl font-bold tracking-tight text-foreground">SignalOne</h1>
        </Link>
        
        <nav className="flex items-center gap-4 text-sm font-medium">
          <Link href="/" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
            <LayoutDashboard className="h-4 w-4" />
            Live Dashboard
          </Link>
          <Link href="/monitor" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
            <Bot className="h-4 w-4" />
            AI Monitor
          </Link>
          <Link href="/history" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
            <History className="h-4 w-4" />
            Call History
          </Link>
        </nav>
      </div>
      
      {status && (
        <div className="flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-sm font-medium">
          <div className={`h-2 w-2 rounded-full ${status === 'listening' ? 'bg-red-500 animate-pulse' : 'bg-gray-400'}`} />
          <span className="uppercase text-muted-foreground">
              {status === 'listening' ? 'Live Call' : 'Standby'}
          </span>
        </div>
      )}
    </header>
  );
}
