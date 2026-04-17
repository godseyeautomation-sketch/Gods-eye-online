import React, { useState } from 'react';
import { X, Sparkles, ArrowRight, Plus } from 'lucide-react';
import type { BrandProfile, SocialPlatform } from '../../types/brand.types';
import { SOCIAL_PLATFORMS } from '../../types/brand.types';

interface Props {
  brand: BrandProfile;
  /** Prefilled from Scout's report weakness_data.target_audience */
  scoutAudience?: string;
  onComplete: (campaign: {
    duration_days: 15 | 30 | 45;
    target_audience: string;
    campaign_goals: string;
    themes: string[];
    platforms: SocialPlatform[];
  }) => void;
  onCancel: () => void;
}

const DURATION_OPTIONS: (15 | 30 | 45)[] = [15, 30, 45];

// Visible platforms shown in the picker (subset of all SocialPlatform values)
const PLATFORM_PICKER: SocialPlatform[] = [
  'instagram',
  'tiktok',
  'facebook',
  'linkedin',
  'youtube',
  'x',
  'pinterest',
  'threads',
];

const platformLabel = (p: SocialPlatform): string => {
  const found = SOCIAL_PLATFORMS.find(s => s.key === p);
  return found ? found.label : p;
};

export const PriyaQuestionnaire: React.FC<Props> = ({ brand, scoutAudience, onComplete, onCancel }) => {
  const [duration, setDuration] = useState<15 | 30 | 45>(30);
  const [audience, setAudience] = useState(scoutAudience || brand.audience || '');
  const [goals, setGoals] = useState('');
  const [themes, setThemes] = useState<string[]>(brand.aesthetic || []);
  const [newTheme, setNewTheme] = useState('');

  // Infer available platforms from brand handles
  const availablePlatforms: SocialPlatform[] = [];
  if (brand.instagram_handle) availablePlatforms.push('instagram');
  if (brand.tiktok_handle) availablePlatforms.push('tiktok');
  if (brand.facebook_url) availablePlatforms.push('facebook');
  if (brand.youtube_handle) availablePlatforms.push('youtube');
  if (brand.linkedin_handle) availablePlatforms.push('linkedin');
  if (brand.x_handle) availablePlatforms.push('x');
  if (brand.pinterest_handle) availablePlatforms.push('pinterest');
  if (brand.threads_handle) availablePlatforms.push('threads');
  // If no handles, default to instagram
  const defaultPlatforms: SocialPlatform[] =
    availablePlatforms.length > 0 ? availablePlatforms.slice(0, 3) : ['instagram' as SocialPlatform];

  const [selectedPlatforms, setSelectedPlatforms] = useState<SocialPlatform[]>(defaultPlatforms);

  const togglePlatform = (p: SocialPlatform) => {
    setSelectedPlatforms(prev => (prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]));
  };

  const addTheme = () => {
    const t = newTheme.trim();
    if (!t) return;
    if (themes.includes(t)) {
      setNewTheme('');
      return;
    }
    setThemes([...themes, t]);
    setNewTheme('');
  };

  const removeTheme = (t: string) => {
    setThemes(themes.filter(x => x !== t));
  };

  const handleThemeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTheme();
    }
  };

  const canSubmit = audience.trim() && goals.trim() && selectedPlatforms.length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onComplete({
      duration_days: duration,
      target_audience: audience.trim(),
      campaign_goals: goals.trim(),
      themes,
      platforms: selectedPlatforms,
    });
  };

  const sectionLabel = 'text-[10px] uppercase tracking-[0.15em] text-text-secondary/40 font-bold';
  const inputBase =
    'w-full px-3 py-2.5 rounded-xl bg-surface border border-white/[0.06] text-text-primary text-sm placeholder-text-secondary/40 focus:outline-none focus:border-brand/40 transition-colors';

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-panel border border-white/[0.08] rounded-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5 shadow-2xl">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand/15 border border-brand/30 flex items-center justify-center flex-shrink-0">
            <Sparkles size={16} className="text-brand" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-text-primary text-base leading-tight">
              Campaign Setup <span className="text-text-secondary/60 font-medium">— Priya</span>
            </h2>
            <p className="text-xs text-text-secondary mt-1 leading-relaxed">
              Based on Scout's research, let's plan your campaign. Priya will generate calendars for each platform.
            </p>
          </div>
          <button
            onClick={onCancel}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface transition-colors flex-shrink-0"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Duration */}
        <div className="space-y-2">
          <div className={sectionLabel}>Duration</div>
          <div className="grid grid-cols-3 gap-2">
            {DURATION_OPTIONS.map(d => {
              const active = duration === d;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDuration(d)}
                  className={`py-2.5 rounded-xl text-sm font-semibold transition-all border ${
                    active
                      ? 'bg-brand text-bg border-brand shadow-[0_0_0_3px_rgba(255,255,255,0.02)]'
                      : 'bg-surface border-white/[0.06] text-text-primary hover:border-white/[0.12]'
                  }`}
                >
                  {d} days
                </button>
              );
            })}
          </div>
        </div>

        {/* Target Audience */}
        <div className="space-y-2">
          <div className={sectionLabel}>Target Audience</div>
          <textarea
            value={audience}
            onChange={e => setAudience(e.target.value)}
            rows={3}
            placeholder="Men aged 25–40, US-based, fitness enthusiasts…"
            className={`${inputBase} resize-none`}
          />
        </div>

        {/* Campaign Goals */}
        <div className="space-y-2">
          <div className={sectionLabel}>Campaign Goals</div>
          <textarea
            value={goals}
            onChange={e => setGoals(e.target.value)}
            rows={3}
            placeholder="Brand awareness, trust building, positioning as premium…"
            className={`${inputBase} resize-none`}
          />
        </div>

        {/* Themes & Mood */}
        <div className="space-y-2">
          <div className={sectionLabel}>Themes & Mood</div>
          <div className="flex flex-wrap gap-1.5">
            {themes.map(t => (
              <span
                key={t}
                className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full bg-brand/10 border border-brand/30 text-brand text-xs font-medium"
              >
                {t}
                <button
                  type="button"
                  onClick={() => removeTheme(t)}
                  className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-brand/25 transition-colors"
                  aria-label={`Remove ${t}`}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={newTheme}
              onChange={e => setNewTheme(e.target.value)}
              onKeyDown={handleThemeKeyDown}
              placeholder="+ Add theme…"
              className={inputBase}
            />
            <button
              type="button"
              onClick={addTheme}
              disabled={!newTheme.trim()}
              className="px-3 rounded-xl bg-surface border border-white/[0.06] text-text-primary text-xs font-semibold hover:border-white/[0.12] disabled:opacity-30 disabled:pointer-events-none transition-colors flex items-center gap-1"
            >
              <Plus size={12} />
              Add
            </button>
          </div>
        </div>

        {/* Target Platforms */}
        <div className="space-y-2">
          <div className={sectionLabel}>Target Platforms</div>
          <div className="grid grid-cols-4 gap-2">
            {PLATFORM_PICKER.map(p => {
              const active = selectedPlatforms.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePlatform(p)}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs font-semibold transition-all border ${
                    active
                      ? 'bg-brand/15 border-brand/40 text-brand'
                      : 'bg-surface border-white/[0.06] text-text-secondary hover:text-text-primary hover:border-white/[0.12]'
                  }`}
                >
                  <span
                    className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${
                      active ? 'bg-brand border-brand' : 'border-white/20'
                    }`}
                  >
                    {active && (
                      <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                        <path d="M2 5.5L4 7.5L8 3" stroke="#000" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span className="truncate">{platformLabel(p)}</span>
                </button>
              );
            })}
          </div>
          {selectedPlatforms.length === 0 && (
            <p className="text-[10px] text-red-400/80">Select at least one platform</p>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-white/[0.06]" />

        {/* Footer actions */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-2.5 rounded-xl bg-transparent border border-white/[0.08] text-text-secondary text-sm font-semibold hover:text-text-primary hover:border-white/[0.16] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex-1 bg-brand text-bg font-bold py-2.5 rounded-xl disabled:opacity-30 disabled:pointer-events-none hover:opacity-90 transition-opacity flex items-center justify-center gap-2 text-sm"
          >
            <Sparkles size={14} />
            Generate
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};
