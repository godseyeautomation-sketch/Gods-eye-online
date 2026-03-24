import React, { useState } from 'react';
import { supabase } from '../services/supabaseClient';

interface Props {
  userId: string;
  onComplete: () => void;
}

const ROLES = [
  { id: 'creator', label: 'Creator', icon: '🎨' },
  { id: 'brand_owner', label: 'Brand Owner', icon: '🏢' },
  { id: 'marketer', label: 'Marketer', icon: '📢' },
  { id: 'designer', label: 'Designer', icon: '✏️' },
  { id: 'photographer', label: 'Photographer', icon: '📷' },
  { id: 'agency_owner', label: 'Agency Owner', icon: '🏛️' },
  { id: 'other', label: 'Other', icon: '⚡' },
];

const VIBES = [
  { id: 'minimalist', label: 'Minimalist', desc: 'Clean, simple, whitespace' },
  { id: 'bold_vibrant', label: 'Bold & Vibrant', desc: 'Bright colors, high energy' },
  { id: 'cinematic', label: 'Cinematic', desc: 'Dramatic lighting, film-like' },
  { id: 'vintage', label: 'Vintage / Retro', desc: 'Nostalgic, warm tones' },
  { id: 'futuristic', label: 'Futuristic', desc: 'Neon, tech, sci-fi' },
  { id: 'organic', label: 'Organic / Natural', desc: 'Earthy, soft, nature-inspired' },
  { id: 'mixed', label: 'Mix of Everything', desc: 'Agency mode — adapts per brand' },
];

const USE_CASES = [
  { id: 'social_media', label: 'Social Media Posts' },
  { id: 'product_photos', label: 'Product Photography' },
  { id: 'brand_assets', label: 'Brand Assets' },
  { id: 'video_content', label: 'Video Content' },
  { id: 'marketing_campaigns', label: 'Marketing Campaigns' },
  { id: 'art_illustrations', label: 'Art & Illustrations' },
];

const INTERACTION_STYLES = [
  { id: 'quick', label: 'Quick & Direct', desc: 'Get straight to the point, less explanation' },
  { id: 'detailed', label: 'Detailed & Thorough', desc: 'Explain options, give context' },
  { id: 'experimental', label: 'Experimental & Surprising', desc: 'Try unexpected ideas, push boundaries' },
  { id: 'guided', label: 'Guide Me', desc: 'Step by step, help me decide' },
];

const PERSONALITY_PRESETS = [
  {
    id: 'professional',
    label: 'Professional',
    icon: '💼',
    desc: 'Concise, formal, business-appropriate',
    soul: 'Be concise and professional. No filler language. Deliver results efficiently with business-appropriate tone. Have clear opinions on creative direction. Prioritize quality and brand consistency.',
  },
  {
    id: 'friendly',
    label: 'Friendly Creative',
    icon: '😊',
    desc: 'Warm, conversational, encouraging',
    soul: 'Be warm, encouraging, and conversational. Celebrate creative wins. Ask follow-up questions to understand the vision. Use casual but smart language. Make the creative process feel fun and collaborative.',
  },
  {
    id: 'jarvis',
    label: 'Jarvis Mode',
    icon: '🤖',
    desc: 'Smart, proactive, anticipates needs',
    soul: 'Be like Jarvis — intelligent, proactive, and anticipatory. Execute tasks immediately without unnecessary confirmation. Suggest improvements before being asked. Be witty but efficient. Show competence through action, not words. Anticipate what the user needs next.',
  },
  {
    id: 'creative_director',
    label: 'Creative Director',
    icon: '🎬',
    desc: 'Opinionated, visionary, pushes boundaries',
    soul: 'Act as an elite creative director. Have strong opinions on design, composition, and visual storytelling. Push creative boundaries. Challenge conventional choices with better alternatives. Think in campaigns, not single assets. Always consider the bigger picture.',
  },
];

const TOTAL_STEPS = 5;

export const OnboardingQuestionnaire: React.FC<Props> = ({ userId, onComplete }) => {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [vibes, setVibes] = useState<string[]>([]);
  const [useCases, setUseCases] = useState<string[]>([]);
  const [interaction, setInteraction] = useState('');
  const [personalityPreset, setPersonalityPreset] = useState('');
  const [customSoul, setCustomSoul] = useState('');

  const toggleVibe = (id: string) => {
    setVibes(prev =>
      prev.includes(id) ? prev.filter(v => v !== id) : prev.length < 2 ? [...prev, id] : [prev[1], id]
    );
  };

  const toggleUseCase = (id: string) => {
    setUseCases(prev =>
      prev.includes(id) ? prev.filter(u => u !== id) : [...prev, id]
    );
  };

  const canProceed = () => {
    switch (step) {
      case 0: return name.trim().length > 0 && role;
      case 1: return vibes.length > 0;
      case 2: return useCases.length > 0;
      case 3: return interaction;
      case 4: return personalityPreset; // soul step
      default: return false;
    }
  };

  const getSoulText = () => {
    if (customSoul.trim()) return customSoul.trim();
    const preset = PERSONALITY_PRESETS.find(p => p.id === personalityPreset);
    return preset?.soul || '';
  };

  const handleComplete = async () => {
    setSaving(true);
    const personality = {
      name: name.trim(),
      role,
      vibes,
      use_cases: useCases,
      interaction_style: interaction,
      personality_preset: personalityPreset,
      soul: getSoulText(),
    };

    // Always save to localStorage as reliable fallback
    localStorage.setItem(`godseye_personality_${userId}`, JSON.stringify(personality));
    localStorage.setItem(`godseye_onboarding_done_${userId}`, 'true');

    try {
      const { error } = await supabase.from('profiles').update({
        personality,
        onboarding_completed: true,
        full_name: name.trim(),
      }).eq('id', userId);

      if (error) {
        console.warn('[Onboarding] Supabase save failed (columns may not exist yet):', error.message);
        await supabase.from('profiles').update({
          full_name: name.trim(),
        }).eq('id', userId);
      }
    } catch (err) {
      console.error('[Onboarding] Save error:', err);
    }

    onComplete();
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-bg flex items-center justify-center overflow-y-auto">
      <div className="w-full max-w-lg mx-auto px-6 py-12">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-brand flex items-center justify-center">
              <svg className="w-5 h-5 text-bg" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            <span className="text-lg font-bold text-text-primary">Gods Eye Studio</span>
          </div>
          <p className="text-sm text-text-secondary">Let's personalize your creative experience</p>
        </div>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === step ? 'w-8 bg-brand' : i < step ? 'w-4 bg-brand/40' : 'w-4 bg-white/10'
              }`}
            />
          ))}
        </div>

        {/* Step 0: Who are you */}
        {step === 0 && (
          <div className="space-y-6 animate-fade-in">
            <div>
              <h2 className="text-xl font-bold text-text-primary mb-1">Who are you?</h2>
              <p className="text-sm text-text-secondary">So we can tailor your creative studio</p>
            </div>

            <div>
              <label className="block text-xs text-text-secondary mb-2 uppercase tracking-widest">Your name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Enter your name"
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-text-primary placeholder:text-text-secondary/30 focus:outline-none focus:border-brand/40 text-[15px]"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs text-text-secondary mb-3 uppercase tracking-widest">Your role</label>
              <div className="grid grid-cols-2 gap-2">
                {ROLES.map(r => (
                  <button
                    key={r.id}
                    onClick={() => setRole(r.id)}
                    className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border text-left transition-all ${
                      role === r.id
                        ? 'border-brand bg-brand/10 text-brand'
                        : 'border-white/5 bg-white/[0.02] text-text-primary hover:bg-white/[0.05] hover:border-white/10'
                    }`}
                  >
                    <span className="text-lg">{r.icon}</span>
                    <span className="text-sm font-medium">{r.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 1: Creative vibe */}
        {step === 1 && (
          <div className="space-y-6 animate-fade-in">
            <div>
              <h2 className="text-xl font-bold text-text-primary mb-1">What's your creative vibe?</h2>
              <p className="text-sm text-text-secondary">Pick up to 2 styles that resonate with you</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {VIBES.map(v => (
                <button
                  key={v.id}
                  onClick={() => toggleVibe(v.id)}
                  className={`flex flex-col px-4 py-3.5 rounded-xl border text-left transition-all ${
                    vibes.includes(v.id)
                      ? 'border-brand bg-brand/10'
                      : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/10'
                  }`}
                >
                  <span className={`text-sm font-semibold ${vibes.includes(v.id) ? 'text-brand' : 'text-text-primary'}`}>
                    {v.label}
                  </span>
                  <span className="text-[11px] text-text-secondary mt-0.5">{v.desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: What will you create */}
        {step === 2 && (
          <div className="space-y-6 animate-fade-in">
            <div>
              <h2 className="text-xl font-bold text-text-primary mb-1">What will you create?</h2>
              <p className="text-sm text-text-secondary">Select all that apply</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {USE_CASES.map(u => (
                <button
                  key={u.id}
                  onClick={() => toggleUseCase(u.id)}
                  className={`px-4 py-3 rounded-xl border text-left text-sm font-medium transition-all ${
                    useCases.includes(u.id)
                      ? 'border-brand bg-brand/10 text-brand'
                      : 'border-white/5 bg-white/[0.02] text-text-primary hover:bg-white/[0.05] hover:border-white/10'
                  }`}
                >
                  {u.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: Interaction style */}
        {step === 3 && (
          <div className="space-y-6 animate-fade-in">
            <div>
              <h2 className="text-xl font-bold text-text-primary mb-1">How should I work with you?</h2>
              <p className="text-sm text-text-secondary">Choose your preferred interaction style</p>
            </div>

            <div className="space-y-2">
              {INTERACTION_STYLES.map(s => (
                <button
                  key={s.id}
                  onClick={() => setInteraction(s.id)}
                  className={`w-full flex flex-col px-4 py-3.5 rounded-xl border text-left transition-all ${
                    interaction === s.id
                      ? 'border-brand bg-brand/10'
                      : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/10'
                  }`}
                >
                  <span className={`text-sm font-semibold ${interaction === s.id ? 'text-brand' : 'text-text-primary'}`}>
                    {s.label}
                  </span>
                  <span className="text-[11px] text-text-secondary mt-0.5">{s.desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 4: AI Soul / Personality */}
        {step === 4 && (
          <div className="space-y-6 animate-fade-in">
            <div>
              <h2 className="text-xl font-bold text-text-primary mb-1">Give your AI a soul</h2>
              <p className="text-sm text-text-secondary">Choose a personality preset or write your own</p>
            </div>

            <div className="space-y-2">
              {PERSONALITY_PRESETS.map(p => (
                <button
                  key={p.id}
                  onClick={() => { setPersonalityPreset(p.id); setCustomSoul(''); }}
                  className={`w-full flex items-start gap-3 px-4 py-3.5 rounded-xl border text-left transition-all ${
                    personalityPreset === p.id && !customSoul
                      ? 'border-brand bg-brand/10'
                      : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/10'
                  }`}
                >
                  <span className="text-xl mt-0.5">{p.icon}</span>
                  <div>
                    <span className={`text-sm font-semibold block ${personalityPreset === p.id && !customSoul ? 'text-brand' : 'text-text-primary'}`}>
                      {p.label}
                    </span>
                    <span className="text-[11px] text-text-secondary">{p.desc}</span>
                  </div>
                </button>
              ))}
            </div>

            {/* Custom soul */}
            <div>
              <label className="block text-xs text-text-secondary mb-2 uppercase tracking-widest">
                Or write your own soul ✍️
              </label>
              <textarea
                value={customSoul}
                onChange={e => { setCustomSoul(e.target.value); if (e.target.value.trim()) setPersonalityPreset('custom'); }}
                placeholder="e.g. Be my creative partner who thinks in campaigns. Always suggest 3 options. Push boundaries but respect brand guidelines. Be witty but never cheesy..."
                rows={3}
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-text-primary placeholder:text-text-secondary/20 focus:outline-none focus:border-brand/40 text-[13px] resize-none"
              />
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-8">
          {step > 0 ? (
            <button
              onClick={() => setStep(step - 1)}
              className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              Back
            </button>
          ) : (
            <div />
          )}

          {step < TOTAL_STEPS - 1 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={!canProceed()}
              className="px-6 py-2.5 rounded-xl bg-brand text-bg text-sm font-bold hover:brightness-110 active:scale-95 transition-all disabled:opacity-30 disabled:pointer-events-none"
            >
              Continue
            </button>
          ) : (
            <button
              onClick={handleComplete}
              disabled={!canProceed() || saving}
              className="px-6 py-2.5 rounded-xl bg-brand text-bg text-sm font-bold hover:brightness-110 active:scale-95 transition-all disabled:opacity-30 disabled:pointer-events-none"
            >
              {saving ? 'Setting up...' : 'Start Creating'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
