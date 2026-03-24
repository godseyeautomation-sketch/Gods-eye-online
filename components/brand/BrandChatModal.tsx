import React, { useState, useRef, useEffect } from 'react';
import { X, Send, Wand2, Loader2, Calendar, MessageCircle } from 'lucide-react';
import { BrandProfile, ContentSlot, ContentFormat } from '../../types/brand.types';
import { chatPlannerTurn, generateMonthPlan, upsertSlot } from '../../services/brandService';

interface Props {
  brand: BrandProfile;
  userId: string;
  year: number;
  month: number;
  onDone: (newSlots: ContentSlot[]) => void;
  onClose: () => void;
}

interface Message {
  role: 'assistant' | 'user';
  text: string;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const BrandChatModal: React.FC<Props> = ({ brand, userId, year, month, onDone, onClose }) => {
  const monthName = MONTH_NAMES[month - 1];
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      text: `Hey! Let's plan your **${monthName} ${year}** content for **${brand.name}**. 🎯\n\nWhat's your main focus or direction for this month? (e.g. a product launch, seasonal campaign, brand awareness, a specific theme…)`,
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const userTurnCount = messages.filter(m => m.role === 'user').length;
  const readyToGenerate = userTurnCount >= 2;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const buildHistory = (msgs: Message[], newUserText?: string) => {
    const history: Array<{ role: 'user' | 'model'; text: string }> = [];

    // Skip the first assistant greeting — it's baked into system context
    const restMsgs = msgs.slice(1);

    for (const msg of restMsgs) {
      history.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        text: msg.text,
      });
    }

    if (newUserText) {
      history.push({ role: 'user', text: newUserText });
    }

    return history;
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading || generating) return;

    setInput('');
    setError(null);
    const newMessages: Message[] = [...messages, { role: 'user', text }];
    setMessages(newMessages);
    setLoading(true);

    try {
      const history = buildHistory(messages, text);
      const reply = await chatPlannerTurn(brand, monthName, year, history);
      setMessages([...newMessages, { role: 'assistant', text: reply }]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateCalendar = async () => {
    setGenerating(true);
    setError(null);

    try {
      // Build conversation context string
      const context = messages
        .map(m => `${m.role === 'assistant' ? 'Planner' : 'Client'}: ${m.text}`)
        .join('\n\n');

      setGenerationStatus('Crafting your content plan…');
      const plan = await generateMonthPlan(brand, year, month, context);

      if (plan.length === 0) throw new Error('No content ideas were generated. Please try again.');

      setGenerationStatus(`Saving ${plan.length} content ideas to your calendar…`);
      const savedSlots: ContentSlot[] = [];

      // Save in parallel batches of 5
      const batchSize = 5;
      for (let i = 0; i < plan.length; i += batchSize) {
        const batch = plan.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map(item =>
            upsertSlot(userId, brand.id, item.date, item.format, {
              idea: item.idea,
              status: 'ideated',
            })
          )
        );
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value) savedSlots.push(r.value);
        }
        setGenerationStatus(`Saved ${Math.min(i + batchSize, plan.length)} / ${plan.length} ideas…`);
      }

      onDone(savedSlots);
    } catch (e: any) {
      setError(e.message);
      setGenerating(false);
      setGenerationStatus('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Simple markdown-like bold renderer
  const renderText = (text: string) => {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) =>
      part.startsWith('**') && part.endsWith('**')
        ? <strong key={i}>{part.slice(2, -2)}</strong>
        : part
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-2xl h-[600px] bg-panel border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-border flex-shrink-0">
          <div className="w-9 h-9 rounded-xl bg-brand/15 border border-brand/30 flex items-center justify-center">
            <MessageCircle size={16} className="text-brand" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-text-primary text-sm leading-none">Content Planner</h2>
            <p className="text-xs text-text-secondary mt-0.5">{monthName} {year} · {brand.name}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-line ${
                  msg.role === 'user'
                    ? 'bg-brand text-bg rounded-br-sm'
                    : 'bg-surface border border-border text-text-primary rounded-bl-sm'
                }`}
              >
                {renderText(msg.text)}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-surface border border-border px-4 py-2.5 rounded-2xl rounded-bl-sm flex items-center gap-2">
                <Loader2 size={14} className="animate-spin text-brand" />
                <span className="text-xs text-text-secondary">Thinking…</span>
              </div>
            </div>
          )}

          {error && (
            <div className="text-center">
              <span className="text-xs text-red-400 bg-red-950/40 border border-red-900/50 px-3 py-1.5 rounded-full">{error}</span>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Generate Calendar CTA — shows when ready */}
        {readyToGenerate && !generating && (
          <div className="px-4 pb-2 flex-shrink-0">
            <button
              onClick={handleGenerateCalendar}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-brand/10 border border-brand/40 text-brand text-sm font-bold hover:bg-brand/20 transition-colors"
            >
              <Calendar size={15} />
              Generate {monthName} Calendar
              <Wand2 size={13} className="opacity-70" />
            </button>
          </div>
        )}

        {/* Input area */}
        <div className="p-4 border-t border-border flex-shrink-0">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              className="flex-1 bg-surface border border-border rounded-xl px-3 py-2.5 text-text-primary text-sm placeholder-text-secondary focus:outline-none focus:border-brand transition-colors resize-none"
              placeholder="Type your message…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={loading || generating}
              style={{ maxHeight: 80 }}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || loading || generating}
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-brand text-bg disabled:opacity-40 disabled:pointer-events-none hover:opacity-90 transition-all flex-shrink-0"
            >
              <Send size={16} />
            </button>
          </div>
          {!readyToGenerate && (
            <p className="text-[10px] text-text-secondary mt-1.5 text-center">
              Answer {2 - userTurnCount} more question{2 - userTurnCount !== 1 ? 's' : ''} to unlock calendar generation
            </p>
          )}
        </div>
      </div>

      {/* Generating overlay */}
      {generating && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-panel border border-border rounded-2xl p-8 text-center max-w-sm w-full mx-4">
            <div className="w-16 h-16 rounded-2xl bg-brand/15 border border-brand/30 flex items-center justify-center mx-auto mb-4">
              <Wand2 size={28} className="text-brand animate-pulse" />
            </div>
            <h3 className="font-bold text-text-primary text-base mb-2">Building Your Calendar</h3>
            <p className="text-text-secondary text-sm mb-4">{generationStatus}</p>
            <div className="h-1.5 bg-surface rounded-full overflow-hidden">
              <div className="h-full bg-brand rounded-full animate-pulse w-2/3" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
