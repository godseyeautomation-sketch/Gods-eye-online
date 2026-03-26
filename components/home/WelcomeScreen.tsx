import React, { useState, useMemo } from 'react';
import { CHAT_MODELS, type ChatModelId, type SkillOption } from './ChatInput';

const CATEGORY_CHIPS = [
  { label: 'Create', icon: '✦' },
  { label: 'Brand', icon: '◎' },
  { label: 'Video', icon: '▶' },
  { label: 'Research', icon: '◈' },
  { label: 'Analyze', icon: '⬡' },
];

// ── Time-based greetings ──
const GREETINGS = {
  morning: [
    'Online and ready, {name}.',
    'Campaign engines warmed up, {name}.',
    'Marketing mode armed, {name}.',
    'All systems sharp, {name}.',
    'Your AI crew awaits orders, {name}.',
  ],
  afternoon: [
    'Online and ready, {name}.',
    'Campaign engines warmed up, {name}.',
    'Marketing mode armed, {name}.',
    'All systems sharp, {name}.',
    'Your AI crew awaits orders, {name}.',
  ],
  evening: [
    'Evening, {name}. Shall we make some noise?',
    'Fresh ideas loaded, {name}.',
    'After-hours, full power, {name}.',
    'Ready to outwork the agencies, {name}.',
    'Twilight\'s yours to command, {name}.',
  ],
  night: [
    'Night shift engaged, {name}.',
    'Algorithms are awake, {name}.',
    'Perfect hour to experiment, {name}.',
    'I\'ve got the grunt work, {name}.',
    'Let\'s turn ideas into impact, {name}.',
  ],
  midnight: [
    'Midnight builders win, {name}.',
    'Retainers asleep, your AI isn\'t, {name}.',
    'One prompt, big ripple, {name}.',
    'I\'ve prepped the launchpad, {name}.',
    'Midnight is our advantage, {name}.',
  ],
  lateNight: [
    'You\'re early for tomorrow, {name}.',
    'World offline, you online, {name}.',
    'Late nights build empires, {name}.',
    'Distribution is still running, {name}.',
    'Sunrise will find you ahead, {name}.',
  ],
};

const getGreeting = (name: string) => {
  const hour = new Date().getHours();
  let pool: string[];
  if (hour >= 5 && hour < 12) pool = GREETINGS.morning;
  else if (hour >= 12 && hour < 17) pool = GREETINGS.afternoon;
  else if (hour >= 17 && hour < 21) pool = GREETINGS.evening;
  else if (hour >= 21 && hour < 24) pool = GREETINGS.night;
  else if (hour === 0) pool = GREETINGS.midnight;
  else pool = GREETINGS.lateNight; // 1-4am

  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx].replace('{name}', name);
};

// Contextual suggestions based on time of day
const getSuggestions = () => {
  const hour = new Date().getHours();
  if (hour < 12) {
    return [
      'Create today\'s social media post for my brand',
      'What are the trending topics this morning?',
      'Generate a fresh product photo for my campaign',
    ];
  }
  if (hour < 17) {
    return [
      'Build this week\'s content calendar',
      'Analyze my brand\'s visual identity',
      'Create a short video for Instagram Reels',
    ];
  }
  return [
    'Plan tomorrow\'s content strategy',
    'Generate cinematic product shots',
    'Research competitor brands in my niche',
  ];
};

interface BrandProfile {
  id: string;
  name: string;
  logo_url?: string;
  tagline?: string;
  [key: string]: any;
}

interface Props {
  onSuggestionClick: (text: string) => void;
  userName?: string;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onFileUpload?: () => void;
  isLoading: boolean;
  fileInputRef?: React.RefObject<HTMLInputElement>;
  onFilesSelected?: (files: FileList) => void;
  attachedImages?: string[];
  onRemoveAttachment?: (index: number) => void;
  brands?: BrandProfile[];
  activeBrandId?: string | null;
  onBrandChange?: (id: string | null) => void;
  selectedModel?: ChatModelId;
  onModelChange?: (model: ChatModelId) => void;
  skills?: SkillOption[];
  onSkillSelect?: (slug: string) => void;
}

export const WelcomeScreen: React.FC<Props> = ({
  onSuggestionClick,
  userName,
  inputValue,
  onInputChange,
  onSend,
  onFileUpload,
  isLoading,
  fileInputRef,
  onFilesSelected,
  attachedImages = [],
  onRemoveAttachment,
  brands = [],
  activeBrandId,
  onBrandChange,
  selectedModel = 'gemini-3-flash-preview',
  onModelChange,
  skills = [],
  onSkillSelect,
}) => {
  const displayName = userName && !userName.includes('@') ? userName.split(' ')[0] : 'Creator';

  // Memoize greeting so it doesn't change on every render
  const greeting = useMemo(() => getGreeting(displayName), [displayName]);
  const suggestions = getSuggestions();

  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showBrandPicker, setShowBrandPicker] = useState(false);
  const [showSkillPicker, setShowSkillPicker] = useState(false);

  const currentModel = CHAT_MODELS.find(m => m.id === selectedModel);
  const activeBrand = brands.find(b => b.id === activeBrandId);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isLoading && inputValue.trim()) onSend();
    }
  };

  const handleCategoryClick = (label: string) => {
    const prompts: Record<string, string> = {
      'Create': 'Generate a stunning product photo',
      'Brand': 'Scan my brand website and extract its DNA',
      'Video': 'Create a 5-second cinematic video clip',
      'Research': 'Search the web for the latest AI trends',
      'Analyze': 'Analyze this image and describe what you see',
    };
    onSuggestionClick(prompts[label] || label);
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6">
      {/* Greeting — shifted slightly left with pr to appear centered with the sparkle icon */}
      <div className="mb-8 w-full max-w-2xl">
        <h1 className="text-4xl lg:text-5xl font-medium text-text-primary/80 tracking-tight flex items-center gap-3">
          <span className="text-brand text-3xl">✦</span>
          {greeting}
        </h1>
      </div>

      {/* Central input box */}
      <div className="w-full max-w-2xl">
        <div className="rounded-2xl border border-border-base bg-surface focus-within:border-brand/30 transition-colors">
          {/* Attached images preview */}
          {attachedImages.length > 0 && (
            <div className="flex gap-2 px-4 pt-3">
              {attachedImages.map((img, i) => (
                <div key={i} className="relative group">
                  <img src={img} alt="" className="w-16 h-16 rounded-lg object-cover border border-border-base" />
                  <button
                    onClick={() => onRemoveAttachment?.(i)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Textarea */}
          <textarea
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Gods Eye anything..."
            disabled={isLoading}
            rows={2}
            className="w-full resize-none bg-transparent px-5 pt-4 pb-2 text-[15px] text-text-primary placeholder:text-text-secondary/30 focus:outline-none disabled:opacity-50"
          />

          {/* Bottom toolbar — brand, skills, model selector */}
          <div className="flex items-center justify-between px-3 pb-3">
            <div className="flex items-center gap-1.5">
              {/* File upload */}
              <button
                onClick={onFileUpload}
                className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-black/5 dark:bg-white/5 text-text-secondary hover:text-text-primary transition-colors"
                title="Attach image"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </button>

              {/* Brand selector */}
              {brands.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => setShowBrandPicker(!showBrandPicker)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                      activeBrand
                        ? 'bg-brand/10 text-brand border-brand/20'
                        : 'bg-black/5 dark:bg-white/5 text-text-secondary border-transparent hover:border-border-base'
                    }`}
                  >
                    <span className="text-[10px]">◎</span>
                    {activeBrand ? activeBrand.name : 'Brand'}
                  </button>
                  {showBrandPicker && (
                    <div className="absolute bottom-full left-0 mb-2 w-48 bg-panel border border-border-base rounded-xl shadow-2xl overflow-hidden z-50">
                      <div className="p-1">
                        <button
                          onClick={() => { onBrandChange?.(null); setShowBrandPicker(false); }}
                          className={`w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-black/5 dark:hover:bg-white/5 transition-colors ${!activeBrandId ? 'text-brand' : 'text-text-secondary'}`}
                        >
                          No brand
                        </button>
                        {brands.map(b => (
                          <button
                            key={b.id}
                            onClick={() => { onBrandChange?.(b.id); setShowBrandPicker(false); }}
                            className={`w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-black/5 dark:hover:bg-white/5 transition-colors ${activeBrandId === b.id ? 'text-brand' : 'text-text-primary'}`}
                          >
                            {b.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Skills selector */}
              {skills.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => setShowSkillPicker(!showSkillPicker)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-black/5 dark:bg-white/5 text-text-secondary hover:text-text-primary border border-transparent hover:border-border-base transition-all"
                  >
                    <span className="text-[10px]">⬡</span>
                    Skills
                  </button>
                  {showSkillPicker && (
                    <div className="absolute bottom-full left-0 mb-2 w-56 bg-panel border border-border-base rounded-xl shadow-2xl overflow-hidden z-50 max-h-64 overflow-y-auto">
                      <div className="p-1">
                        {skills.map(s => (
                          <button
                            key={s.slug}
                            onClick={() => { onSkillSelect?.(s.slug); setShowSkillPicker(false); }}
                            className="w-full text-left px-3 py-2 rounded-lg text-sm text-text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-colors flex items-center gap-2"
                          >
                            <span>{s.icon || '⬡'}</span>
                            {s.name}
                            {s.is_agent && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-400 font-bold">AGENT</span>}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Model selector */}
              <div className="relative">
                <button
                  onClick={() => setShowModelPicker(!showModelPicker)}
                  className="flex items-center gap-1.5 text-xs text-text-secondary/60 hover:text-text-secondary transition-colors"
                >
                  <span className="text-[10px]">✦</span>
                  {currentModel?.name || 'Gemini 3.0 Flash'}
                  {currentModel?.badge && (
                    <span className={`text-[8px] font-bold px-1 py-0.5 rounded-full ${
                      currentModel.badge === 'NEW' ? 'bg-brand/20 text-brand' :
                      currentModel.badge === 'PRO' ? 'bg-purple-500/20 text-purple-400' :
                      'bg-black/10 dark:bg-white/10 text-text-secondary'
                    }`}>
                      {currentModel.badge}
                    </span>
                  )}
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showModelPicker && (
                  <div className="absolute bottom-full right-0 mb-2 w-52 bg-panel border border-border-base rounded-xl shadow-2xl overflow-hidden z-50">
                    <div className="px-3 py-2 border-b border-black/5 dark:border-white/5">
                      <p className="text-[9px] text-text-secondary/40 font-medium uppercase tracking-widest">Chat Model</p>
                    </div>
                    <div className="p-1">
                      {CHAT_MODELS.map(model => (
                        <button
                          key={model.id}
                          onClick={() => { onModelChange?.(model.id); setShowModelPicker(false); }}
                          className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-colors ${
                            selectedModel === model.id ? 'bg-brand/10' : ''
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            {selectedModel === model.id && <div className="w-1.5 h-1.5 rounded-full bg-brand flex-shrink-0" />}
                            <span className={`text-sm ${selectedModel === model.id ? 'text-brand font-medium' : 'text-text-primary'}`}>
                              {model.name}
                            </span>
                          </div>
                          {model.badge && (
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                              model.badge === 'NEW' ? 'bg-brand/20 text-brand' :
                              model.badge === 'PRO' ? 'bg-purple-500/20 text-purple-400' :
                              'bg-black/10 dark:bg-white/10 text-text-secondary'
                            }`}>
                              {model.badge}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {inputValue.trim() && (
                <button
                  onClick={onSend}
                  disabled={isLoading}
                  className="p-2 rounded-lg bg-brand text-bg hover:brightness-110 active:scale-95 transition-all disabled:opacity-30"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Category chips */}
        <div className="flex items-center justify-center gap-2 mt-4">
          {CATEGORY_CHIPS.map((chip) => (
            <button
              key={chip.label}
              onClick={() => handleCategoryClick(chip.label)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-border-base bg-surface/30 hover:bg-surface hover:border-brand/20 text-sm text-text-secondary hover:text-text-primary transition-all"
            >
              <span className="text-xs">{chip.icon}</span>
              {chip.label}
            </button>
          ))}
        </div>

        {/* Contextual suggestions */}
        <div className="mt-6 space-y-2 max-w-lg mx-auto">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => onSuggestionClick(s)}
              className="w-full text-left px-4 py-2.5 rounded-xl border border-transparent hover:border-border-base hover:bg-black/[0.03] dark:hover:bg-white/[0.03] text-sm text-text-secondary/60 hover:text-text-secondary transition-all"
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && onFilesSelected?.(e.target.files)}
      />
    </div>
  );
};
