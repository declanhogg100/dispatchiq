import { MessageCircleQuestion } from 'lucide-react';

interface NextQuestionProps {
  question: string | null;
  loading?: boolean;
}

export function NextQuestion({ question, loading }: NextQuestionProps) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-blue-300 bg-blue-200 p-6 text-blue-900 shadow-sm">
      <div className="flex items-center gap-2 text-blue-900 mb-2">
        <MessageCircleQuestion className="h-5 w-5 text-blue-800" />
        <span className="text-sm font-semibold uppercase tracking-wider">Next Best Question</span>
      </div>
      
      <div className="min-h-[3rem] flex items-center">
        {loading ? (
            <div className="flex gap-1">
                <div className="h-2 w-2 rounded-full bg-white/50 animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="h-2 w-2 rounded-full bg-white/50 animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="h-2 w-2 rounded-full bg-white/50 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
        ) : (
            <p className="text-2xl font-bold leading-tight md:text-3xl">
                {question || "Listen for more context..."}
            </p>
        )}
      </div>

      {/* Background decoration */}
      <div className="absolute -right-6 -bottom-6 opacity-10 text-blue-300">
        <MessageCircleQuestion className="h-32 w-32" />
      </div>
    </div>
  );
}
