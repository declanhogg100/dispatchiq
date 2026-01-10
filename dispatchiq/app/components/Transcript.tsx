import { TranscriptMessage } from '../types';
import { User, Phone } from 'lucide-react';
import { useEffect, useRef } from 'react';

// Simple utility since I didn't create utils.ts yet
function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ');
}

interface TranscriptProps {
  messages: TranscriptMessage[];
}

export function Transcript({ messages }: TranscriptProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border bg-muted/50 p-4">
        <h2 className="font-semibold flex items-center gap-2">
          <Phone className="h-4 w-4" />
          Live Transcript
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
              className={cn(
                "flex gap-3",
                msg.sender === 'dispatcher' ? "flex-row-reverse" : "flex-row"
              )}
            >
              <div className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
                msg.sender === 'dispatcher' ? "bg-blue-100 text-blue-700 border-blue-200" : "bg-zinc-100 text-zinc-700 border-zinc-200"
              )}>
                {msg.sender === 'dispatcher' ? "D" : "C"}
              </div>
              
              <div className={cn(
                "flex flex-col max-w-[80%] rounded-lg p-3 text-sm",
                msg.sender === 'dispatcher' 
                  ? "bg-blue-50 text-blue-900 rounded-tr-none" 
                  : "bg-zinc-50 text-zinc-900 rounded-tl-none"
              )}>
                <p className={cn(msg.isPartial && "opacity-70 animate-pulse")}>
                  {msg.text}
                </p>
                <span className="mt-1 text-[10px] opacity-50">
                  {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

