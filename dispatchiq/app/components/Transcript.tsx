import { TranscriptMessage } from '../types';
import { User, Phone } from 'lucide-react';
import { useEffect, useRef } from 'react';

// Simple utility since I didn't create utils.ts yet
function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ');
}

interface TranscriptProps {
  messages: TranscriptMessage[];
  title?: string;
}

export function Transcript({ messages, title = "Live Transcript" }: TranscriptProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border bg-muted/50 p-4">
        <h2 className="font-semibold flex items-center gap-2">
          <Phone className="h-4 w-4" />
          {title}
        </h2>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm italic">
            Waiting for call...
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className="flex flex-col gap-1"
            >
              <div className="flex items-center gap-2">
                <span className={cn(
                  "text-xs font-bold uppercase tracking-wider",
                  msg.sender === 'dispatcher' ? "text-blue-600" : "text-zinc-600" // Distinct colors for names
                )}>
                  {msg.sender === 'dispatcher' ? "Dispatcher" : "Caller"}
                </span>
                <span className="text-[10px] text-muted-foreground font-mono">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
              
              <p className={cn(
                "text-sm leading-relaxed text-foreground",
                msg.isPartial && "opacity-70"
              )}>
                {msg.text}
              </p>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

