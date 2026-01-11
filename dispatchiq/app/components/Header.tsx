import { Radio, History, LayoutDashboard, Bot } from 'lucide-react';
import Link from 'next/link';

interface HeaderProps {
  status?: 'connected' | 'disconnected' | 'listening';
}

export function Header({ status }: HeaderProps) {
  return (
    <header className="relative flex h-20 w-full items-center border-b border-border bg-card px-8">
      <div className="flex items-center gap-4 flex-shrink-0">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80">
          <Radio className="h-6 w-6 text-red-500 animate-pulse" />
          <h1 className="text-xl font-bold tracking-tight text-foreground">DispatchIQ</h1>
        </Link>
      </div>

      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <nav className="flex items-center gap-8 text-base font-semibold">
          <Link href="/" className="flex items-center gap-2 px-5 py-2 rounded-full border border-transparent hover:border-border hover:bg-secondary transition-colors">
            <LayoutDashboard className="h-5 w-5" />
            <span>Live Dashboard</span>
          </Link>
          <Link href="/monitor" className="flex items-center gap-2 px-5 py-2 rounded-full border border-transparent hover:border-border hover:bg-secondary transition-colors">
            <Bot className="h-5 w-5" />
            <span>AI Monitor</span>
          </Link>
          <Link href="/history" className="flex items-center gap-2 px-5 py-2 rounded-full border border-transparent hover:border-border hover:bg-secondary transition-colors">
            <History className="h-5 w-5" />
            <span>Call History</span>
          </Link>
        </nav>
      </div>
      
      {status && (
        <div className="ml-auto flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-sm font-medium flex-shrink-0">
          <div className={`h-2 w-2 rounded-full ${status === 'listening' ? 'bg-red-500 animate-pulse' : 'bg-gray-400'}`} />
          <span className="uppercase text-muted-foreground">
              {status === 'listening' ? 'Live Call' : 'Standby'}
          </span>
        </div>
      )}
    </header>
  );
}
