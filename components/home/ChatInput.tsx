import React, { useRef, useEffect, useState } from 'react';

export const CHAT_MODELS = [
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', badge: 'NEW', isLocal: false },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3.0 Flash', badge: 'NEW', isLocal: false },
  { id: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash Lite', badge: '', isLocal: false },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', badge: '', isLocal: false },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', badge: 'PRO', isLocal: false },
  { id: 'kimi-k2.5', name: 'Kimi K2.5', badge: 'NEW', isLocal: false },
] as const;

export type ChatModelId = typeof CHAT_MODELS[number]['id'];

export interface SkillOption { slug: string; name: string; icon: string; is_agent: boolean; }
export interface BrandOption { id: string; name: string; }

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onFileUpload?: () => void;
  disabled?: boolean;
  placeholder?: string;
  attachedImages?: string[];
  onRemoveAttachment?: (index: number) => void;
  fileInputRef?: React.RefObject<HTMLInputElement>;
  onFilesSelected?: (files: FileList) => void;
  selectedModel?: ChatModelId;
  onModelChange?: (model: ChatModelId) => void;
  skills?: SkillOption[];
  onSkillSelect?: (slug: string) => void;
  brands?: BrandOption[];
  selectedBrand?: string | null;
  onBrandChange?: (brandId: string | null) => void;
}

export const ChatInput: React.FC<Props> = ({
  value,
  onChange,
  onSend,
  onFileUpload,
  disabled = false,
  placeholder = 'Type / for skills',
  attachedImages = [],
  onRemoveAttachment,
  fileInputRef,
  onFilesSelected,
  selectedModel = 'gemini-2.5-flash',
  onModelChange,
  skills = [],
  onSkillSelect,
  brands = [],
  selectedBrand = null,
  onBrandChange,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [showBrandPicker, setShowBrandPicker] = useState(false);
  const [showSkillsPicker, setShowSkillsPicker] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);
  const brandRef = useRef<HTMLDivElement>(null);
  const skillsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [value]);

  // Close picker on outside click
  useEffect(() => {
    if (!showModelPicker) return;
    const handleClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showModelPicker]);

  // Close skills picker on outside click
  useEffect(() => {
    if (!showSkillsPicker) return;
    const handleClick = (e: MouseEvent) => {
      if (skillsRef.current && !skillsRef.current.contains(e.target as Node)) {
        setShowSkillsPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showSkillsPicker]);

  // Detect / typing for slash commands
  const handleInputChange = (newValue: string) => {
    onChange(newValue);
    if (newValue === '/' || (newValue.startsWith('/') && !newValue.includes(' '))) {
      setShowSlashMenu(true);
      setSlashFilter(newValue.slice(1).toLowerCase());
    } else {
      setShowSlashMenu(false);
    }
  };

  const filteredSkills = skills.filter(s =>
    s.slug.includes(slashFilter) || s.name.toLowerCase().includes(slashFilter)
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setShowSlashMenu(false); return; }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (showSlashMenu && filteredSkills.length > 0) {
        const skill = filteredSkills[0];
        setShowSlashMenu(false);
        onChange('');
        setTimeout(() => onSkillSelect?.(skill.slug), 10);
        return;
      }
      if (!disabled && value.trim()) onSend();
    }
  };

  const currentModel = CHAT_MODELS.find(m => m.id === selectedModel) || CHAT_MODELS[2];

  return (
    <div className="flex-shrink-0 px-4 pb-4 pt-2">
      <div className="max-w-3xl mx-auto">
        <div className="relative rounded-2xl border border-border-base bg-white dark:bg-[#111] focus-within:border-brand/30 transition-colors">
          {/* Attached images */}
          {attachedImages.length > 0 && (
            <div className="flex gap-2 px-4 pt-3">
              {attachedImages.map((img, i) => (
                <div key={i} className="relative group">
                  <img src={img} alt="" className="w-14 h-14 rounded-lg object-cover border border-border-base" />
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

          {/* Slash command dropdown */}
          {showSlashMenu && (
            <div className="absolute bottom-full left-0 right-0 mb-1 mx-4 rounded-xl border border-border-base bg-white dark:bg-[#1a1a1a] shadow-2xl overflow-hidden z-50 max-h-[240px] overflow-y-auto">
              <div className="px-3 py-2 border-b border-border-base">
                <p className="text-[10px] text-text-secondary/50 font-medium uppercase tracking-widest">Skills & Agents</p>
              </div>
              {filteredSkills.length === 0 ? (
                <div className="px-3 py-3 text-center text-xs text-text-secondary/40">
                  {skills.length === 0 ? 'Loading skills...' : 'No matching skills'}
                </div>
              ) : filteredSkills.map((skill, idx) => (
                <button
                  key={`${skill.slug}-${idx}`}
                  onMouseDown={(e) => {
                    e.preventDefault(); // prevent blur
                    setShowSlashMenu(false);
                    onChange(''); // clear the /slash text first
                    setTimeout(() => onSkillSelect?.(skill.slug), 10);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors"
                >
                  <span className="text-base">{skill.icon}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-text-primary block">{skill.name}</span>
                    <span className="text-[10px] text-text-secondary/40 font-mono">/{skill.slug}</span>
                  </div>
                  {skill.is_agent && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-brand/15 text-brand">AGENT</span>
                  )}
                </button>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={2}
            className="w-full resize-none bg-transparent px-5 pt-4 pb-2 text-[16px] leading-relaxed text-text-primary placeholder:text-text-secondary/30 focus:outline-none disabled:opacity-50 min-h-[56px]"
          />

          <div className="flex items-center justify-between px-3 pb-2.5">
            <div className="flex items-center gap-1">
              <button
                onClick={onFileUpload}
                className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/5 text-text-secondary hover:text-text-primary transition-colors"
                title="Attach image"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </button>

              {/* Brand Selector */}
              {brands.length > 0 && (
                <div className="relative" ref={brandRef}>
                  <button
                    onClick={() => setShowBrandPicker(!showBrandPicker)}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs transition-colors ${
                      selectedBrand ? 'bg-brand/10 text-brand border border-brand/20' : 'hover:bg-zinc-100 dark:hover:bg-white/5 text-text-secondary/50'
                    }`}
                    title="Select brand context"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                    <span className="max-w-[80px] truncate">
                      {selectedBrand ? brands.find(b => b.id === selectedBrand)?.name || 'Brand' : 'Brand'}
                    </span>
                  </button>
                  {showBrandPicker && (
                    <div className="absolute bottom-full left-0 mb-2 w-48 rounded-xl border border-border-base bg-white dark:bg-[#1a1a1a] shadow-2xl overflow-hidden z-50">
                      <div className="px-3 py-2 border-b border-border-base">
                        <p className="text-[10px] text-text-secondary/50 font-medium uppercase tracking-widest">Brand Context</p>
                      </div>
                      <button
                        onClick={() => { onBrandChange?.(null); setShowBrandPicker(false); }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-white/5 text-sm ${!selectedBrand ? 'text-brand' : 'text-text-secondary'}`}
                      >
                        None (general)
                      </button>
                      {brands.map(b => (
                        <button
                          key={b.id}
                          onClick={() => { onBrandChange?.(b.id); setShowBrandPicker(false); }}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-white/5 text-sm ${selectedBrand === b.id ? 'text-brand font-medium' : 'text-text-primary'}`}
                        >
                          {selectedBrand === b.id && <div className="w-1.5 h-1.5 rounded-full bg-brand" />}
                          {b.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Skills Picker Button */}
              {skills.length > 0 && (
                <div className="relative" ref={skillsRef}>
                  <button
                    onClick={() => setShowSkillsPicker(!showSkillsPicker)}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs transition-colors ${
                      showSkillsPicker ? 'bg-brand/10 text-brand border border-brand/20' : 'hover:bg-zinc-100 dark:hover:bg-white/5 text-text-secondary/50'
                    }`}
                    title="Skills & Agents"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5" />
                    </svg>
                    <span>Skills</span>
                  </button>
                  {showSkillsPicker && (
                    <div className="absolute bottom-full left-0 mb-2 w-56 rounded-xl border border-border-base bg-white dark:bg-[#1a1a1a] shadow-2xl overflow-hidden z-50 max-h-[280px] overflow-y-auto">
                      <div className="px-3 py-2 border-b border-border-base">
                        <p className="text-[10px] text-text-secondary/50 font-medium uppercase tracking-widest">Activate a Skill</p>
                      </div>
                      {skills.map((skill, idx) => (
                        <button
                          key={`picker-${skill.slug}-${idx}`}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setShowSkillsPicker(false);
                            onSkillSelect?.(skill.slug);
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors"
                        >
                          <span className="text-sm">{skill.icon}</span>
                          <div className="flex-1 min-w-0">
                            <span className="text-[13px] text-text-primary block">{skill.name}</span>
                          </div>
                          {skill.is_agent && (
                            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-brand/15 text-brand">AGENT</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Model Selector */}
              <div className="relative" ref={pickerRef}>
                <button
                  onClick={() => setShowModelPicker(!showModelPicker)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors group"
                >
                  <svg className="w-3.5 h-3.5 text-text-secondary/50 group-hover:text-brand transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                  </svg>
                  <span className="text-xs text-text-secondary/50 group-hover:text-text-secondary transition-colors select-none">
                    {currentModel.name}
                  </span>
                  {currentModel.badge && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                      currentModel.badge === 'NEW' ? 'bg-brand/20 text-brand' :
                      currentModel.badge === 'PRO' ? 'bg-purple-500/20 text-purple-400' :
                      'bg-white/10 text-text-secondary'
                    }`}>
                      {currentModel.badge}
                    </span>
                  )}
                  <svg className={`w-3 h-3 text-text-secondary/30 transition-transform ${showModelPicker ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>

                {/* Dropdown */}
                {showModelPicker && (
                  <div className="absolute bottom-full right-0 mb-2 w-56 rounded-xl border border-border-base bg-white dark:bg-[#1a1a1a] shadow-2xl overflow-hidden z-50">
                    <div className="px-3 py-2 border-b border-border-base">
                      <p className="text-[10px] text-text-secondary/50 font-medium uppercase tracking-widest">Chat Model</p>
                    </div>
                    <div className="py-1">
                      {CHAT_MODELS.filter(m => !m.isLocal).map((model) => (
                        <button
                          key={model.id}
                          onClick={() => {
                            onModelChange?.(model.id);
                            setShowModelPicker(false);
                          }}
                          className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors ${
                            selectedModel === model.id ? 'bg-brand/10' : ''
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            {selectedModel === model.id && (
                              <div className="w-1.5 h-1.5 rounded-full bg-brand flex-shrink-0" />
                            )}
                            <span className={`text-sm ${selectedModel === model.id ? 'text-brand font-medium' : 'text-text-primary'}`}>
                              {model.name}
                            </span>
                          </div>
                          {model.badge && (
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                              model.badge === 'NEW' ? 'bg-brand/20 text-brand' :
                              model.badge === 'PRO' ? 'bg-purple-500/20 text-purple-400' :
                              'bg-white/10 text-text-secondary'
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

              {value.trim() && (
                <button
                  onClick={onSend}
                  disabled={disabled}
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
