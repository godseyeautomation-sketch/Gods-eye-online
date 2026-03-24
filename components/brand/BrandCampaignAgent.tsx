import React, { useState, useRef } from 'react';
import { X, Upload, ChevronRight } from 'lucide-react';

export interface AgentAnswers {
  referenceUrl: string;
  referenceImages: string[];
  campaignGoal: string;
  targetAudience: string;
  targetCountry: string;
  postCount: 15 | 30 | 90;
}

interface Props {
  brandName: string;
  onComplete: (answers: AgentAnswers) => void;
  onClose: () => void;
}

const COUNTRIES = [
  'India', 'United States', 'United Kingdom', 'UAE', 'Saudi Arabia',
  'Canada', 'Australia', 'Germany', 'France', 'Singapore',
  'Malaysia', 'Nigeria', 'South Africa', 'Brazil', 'Philippines',
];

const POST_OPTIONS: { count: 15 | 30 | 90; label: string; sub: string; breakdown: string }[] = [
  { count: 15, label: '15 Creatives', sub: '~3 weeks', breakdown: '6 Posts · 6 Stories · 3 Reels' },
  { count: 30, label: '30 Creatives', sub: '1 month', breakdown: '12 Posts · 11 Stories · 7 Reels' },
  { count: 90, label: '90 Creatives', sub: 'Full month · Max', breakdown: '30 Posts · 30 Stories · 30 Reels' },
];

const STEPS = [
  {
    icon: '🎨',
    question: 'Do you like the design style of any brand?',
    sub: 'Share their website link or upload inspiration images — we\'ll study the aesthetic and match it to your campaign.',
  },
  {
    icon: '🎯',
    question: 'What is this campaign for?',
    sub: 'What do you want to achieve this month? (product launch, festive sale, brand awareness, seasonal push…)',
  },
  {
    icon: '👥',
    question: 'Who is your target audience?',
    sub: 'Describe using Meta Advantage+ (Andromeda) categories — age, interests, behaviours, life events, purchase habits.',
  },
  {
    icon: '🌍',
    question: 'Which country are you targeting?',
    sub: 'We\'ll automatically add relevant festivals, public holidays, and cultural moments for that geography.',
  },
  {
    icon: '✨',
    question: 'How many creatives this month?',
    sub: 'We\'ll smartly divide them across posts, stories, and reels — spread evenly over the month.',
  },
];

export const BrandCampaignAgent: React.FC<Props> = ({ brandName, onComplete, onClose }) => {
  const [step, setStep] = useState(0);
  const [refUrl, setRefUrl] = useState('');
  const [refImages, setRefImages] = useState<string[]>([]);
  const [campaignGoal, setCampaignGoal] = useState('');
  const [audience, setAudience] = useState('');
  const [country, setCountry] = useState('');
  const [customCountry, setCustomCountry] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    Promise.all(
      files.map(
        f =>
          new Promise<string>((res, rej) => {
            const r = new FileReader();
            r.onload = ev => res(ev.target!.result as string);
            r.onerror = rej;
            r.readAsDataURL(f);
          })
      )
    ).then(urls => setRefImages(prev => [...prev, ...urls].slice(0, 4)));
    e.target.value = '';
  };

  const effectiveCountry = country || customCountry;

  const canNext = () => {
    if (step === 0) return true;
    if (step === 1) return campaignGoal.trim().length > 3;
    if (step === 2) return audience.trim().length > 3;
    if (step === 3) return effectiveCountry.trim().length > 0;
    return false;
  };

  const complete = (postCount: 15 | 30 | 90) => {
    onComplete({
      referenceUrl: refUrl,
      referenceImages: refImages,
      campaignGoal,
      targetAudience: audience,
      targetCountry: effectiveCountry,
      postCount,
    });
  };

  const s = STEPS[step];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="bg-panel border border-border rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-brand mb-0.5">Campaign Planner</p>
            <h2 className="text-sm font-bold text-text-primary">{brandName}</h2>
          </div>
          <div className="flex items-center gap-3">
            {/* Progress dots */}
            <div className="flex gap-1.5 items-center">
              {STEPS.map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === step ? 'w-5 bg-brand' : i < step ? 'w-1.5 bg-brand/40' : 'w-1.5 bg-border'
                  }`}
                />
              ))}
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-6">
          <div className="text-4xl mb-4">{s.icon}</div>
          <h3 className="text-xl font-bold text-text-primary mb-1">{s.question}</h3>
          <p className="text-sm text-text-secondary mb-6 leading-relaxed">{s.sub}</p>

          {/* Step 0 — Reference brand */}
          {step === 0 && (
            <div className="space-y-3">
              <input
                type="url"
                placeholder="Brand website URL (e.g. https://nike.com)"
                value={refUrl}
                onChange={e => setRefUrl(e.target.value)}
                className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-brand transition-colors"
              />
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-text-secondary">or</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleUpload} />
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full border-2 border-dashed border-border rounded-xl py-5 flex flex-col items-center gap-2 text-text-secondary hover:border-brand hover:text-brand transition-all"
              >
                <Upload size={22} />
                <span className="text-sm font-medium">Upload inspiration images</span>
                <span className="text-xs opacity-60">PNG, JPG, WEBP — up to 4</span>
              </button>
              {refImages.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {refImages.map((img, i) => (
                    <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-border">
                      <img src={img} alt="" className="w-full h-full object-cover" />
                      <button
                        onClick={() => setRefImages(prev => prev.filter((_, j) => j !== i))}
                        className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 flex items-center justify-center text-white leading-none"
                        style={{ fontSize: 11 }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 1 — Campaign goal */}
          {step === 1 && (
            <textarea
              rows={4}
              autoFocus
              placeholder="e.g. We're launching our Summer Collection with a 20% early-bird sale. Goal: drive website traffic and Instagram conversions."
              value={campaignGoal}
              onChange={e => setCampaignGoal(e.target.value)}
              className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-brand resize-none transition-colors"
            />
          )}

          {/* Step 2 — Target audience */}
          {step === 2 && (
            <div className="space-y-3">
              <textarea
                rows={4}
                autoFocus
                placeholder="e.g. Women 25-40, interested in fashion, wellness, travel. Life event: new homeowners. Engaged online shoppers who browse on mobile."
                value={audience}
                onChange={e => setAudience(e.target.value)}
                className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-brand resize-none transition-colors"
              />
              <div className="bg-brand/5 border border-brand/20 rounded-xl px-4 py-3">
                <p className="text-[11px] text-text-secondary leading-relaxed">
                  <span className="text-brand font-semibold">Meta Advantage+ tip: </span>
                  Include age range, interests, behaviours, life events (new parents, recently moved), and purchase habits for best AI targeting alignment.
                </p>
              </div>
            </div>
          )}

          {/* Step 3 — Country */}
          {step === 3 && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {COUNTRIES.map(c => (
                  <button
                    key={c}
                    onClick={() => { setCountry(c); setCustomCountry(''); }}
                    className={`py-2 px-3 rounded-xl text-xs font-medium border transition-all text-left truncate ${
                      country === c
                        ? 'bg-brand/10 border-brand text-brand'
                        : 'bg-surface border-border text-text-secondary hover:border-brand/40 hover:text-text-primary'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <input
                type="text"
                placeholder="Type another country…"
                value={customCountry}
                onChange={e => { setCustomCountry(e.target.value); setCountry(''); }}
                className="w-full bg-surface border border-border rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-brand transition-colors"
              />
            </div>
          )}

          {/* Step 4 — Post count (clicking selects and immediately completes) */}
          {step === 4 && (
            <div className="space-y-3">
              {POST_OPTIONS.map(opt => (
                <button
                  key={opt.count}
                  onClick={() => complete(opt.count)}
                  className="w-full bg-surface border border-border hover:border-brand hover:bg-brand/5 rounded-xl p-4 text-left transition-all group"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-bold text-base text-text-primary group-hover:text-brand transition-colors">
                        {opt.label}
                      </div>
                      <div className="text-xs text-text-secondary mt-0.5">
                        {opt.sub} · {opt.breakdown}
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-text-secondary group-hover:text-brand transition-colors flex-shrink-0" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer nav — not shown on last step (clicking an option completes) */}
        {step < 4 && (
          <div className="px-6 pb-6 flex items-center justify-between">
            {step > 0 ? (
              <button
                onClick={() => setStep(s => s - 1)}
                className="text-sm text-text-secondary hover:text-text-primary transition-colors"
              >
                ← Back
              </button>
            ) : (
              <div />
            )}
            <button
              onClick={() => setStep(s => s + 1)}
              disabled={!canNext()}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                canNext()
                  ? 'bg-brand text-bg hover:opacity-90'
                  : 'bg-surface border border-border text-text-secondary cursor-not-allowed opacity-50'
              }`}
            >
              {step === 0 ? 'Next (skip if none)' : 'Next'} <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
