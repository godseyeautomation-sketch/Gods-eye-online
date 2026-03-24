import React from 'react';

const CATEGORY_CHIPS = [
  { label: 'Create', icon: '✦' },
  { label: 'Brand', icon: '◎' },
  { label: 'Video', icon: '▶' },
  { label: 'Research', icon: '◈' },
  { label: 'Analyze', icon: '⬡' },
];

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
}) => {
  const displayName = userName && !userName.includes('@') ? userName.split(' ')[0] : undefined;

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'Good morning';
    if (hour >= 12 && hour < 17) return 'Good afternoon';
    if (hour >= 17 && hour < 22) return 'Good evening';
    return 'Hello, night owl';
  };

  const greetingText = getGreeting();
  const isNightOwl = greetingText === 'Hello, night owl';
  // "Hello, night owl" stands alone or becomes "Hello, Bitan" at night
  const greeting = displayName
    ? (isNightOwl ? `Hello, ${displayName}` : `${greetingText}, ${displayName}`)
    : greetingText;
  const suggestions = getSuggestions();

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
      {/* Greeting */}
      <div className="mb-8 text-center">
        <h1 className="text-4xl lg:text-5xl font-medium text-text-primary/80 tracking-tight flex items-center justify-center gap-3">
          <span className="text-brand text-3xl">✦</span>
          {greeting}
        </h1>

        {/* Brand selector removed — handled conversationally inside chat */}
      </div>

      {/* Central input box */}
      <div className="w-full max-w-2xl">
        <div className="rounded-2xl border border-border-base bg-[#111] focus-within:border-brand/30 transition-colors">
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
                    ×
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

          {/* Bottom toolbar */}
          <div className="flex items-center justify-between px-3 pb-3">
            <button
              onClick={onFileUpload}
              className="p-2 rounded-lg hover:bg-white/5 text-text-secondary hover:text-text-primary transition-colors"
              title="Attach image"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>

            <div className="flex items-center gap-2">
              <span className="text-xs text-text-secondary/40 select-none">Gemini 3.0 Flash</span>
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
              className="w-full text-left px-4 py-2.5 rounded-xl border border-transparent hover:border-border-base hover:bg-white/[0.03] text-sm text-text-secondary/60 hover:text-text-secondary transition-all"
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
