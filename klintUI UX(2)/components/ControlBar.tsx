
import React, { useState, useRef, useEffect } from 'react';
import { 
  Sparkles, 
  ChevronRight,
  X,
  Check,
  Zap,
  Crown,
  Plus,
  Gem,
  Square,
  Monitor,
  Smartphone,
  RectangleHorizontal,
  RectangleVertical,
  PenTool,
  Image as ImageIcon,
  Loader2
} from 'lucide-react';
import { Button } from './Button';
import { MODELS, ASPECT_RATIOS } from '../constants';
import { GenerationConfig, ModelType } from '../types';

interface ControlBarProps {
  config: GenerationConfig;
  setConfig: React.Dispatch<React.SetStateAction<GenerationConfig>>;
  onGenerate: () => void;
  onEnterDrawMode: () => void;
  isGenerating: boolean;
  inputImages: string[];
  setInputImages: React.Dispatch<React.SetStateAction<string[]>>;
}

export const ControlBar: React.FC<ControlBarProps> = ({
  config,
  setConfig,
  onGenerate,
  onEnterDrawMode,
  isGenerating,
  inputImages,
  setInputImages
}) => {
  const [activePopup, setActivePopup] = useState<string | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        setActivePopup(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const togglePopup = (name: string) => {
    setActivePopup(activePopup === name ? null : name);
  };

  const handleModelSelect = (modelId: ModelType) => {
    setConfig(prev => ({ ...prev, model: modelId }));
    setActivePopup(null);
  };

  const handleRatioSelect = (ratio: string) => {
    setConfig(prev => ({ ...prev, aspectRatio: ratio }));
    setActivePopup(null);
  };

  const handleQualitySelect = (quality: '1K' | '2K' | '4K') => {
    setConfig(prev => ({ ...prev, quality }));
    setActivePopup(null);
  };

  const handleBatchSelect = (delta: number) => {
    setConfig(prev => {
        const newSize = Math.min(4, Math.max(1, prev.batchSize + delta));
        return { ...prev, batchSize: newSize };
    });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
        const files = Array.from(e.target.files) as File[];
        const newImages: string[] = [];
        
        for (const file of files) {
            const base64 = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target?.result as string);
                reader.readAsDataURL(file);
            });
            newImages.push(base64);
        }

        setInputImages(prev => [...prev, ...newImages]);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }
  };

  const triggerFileUpload = () => {
    fileInputRef.current?.click();
  };

  const removeInputImage = (index: number) => {
      setInputImages(prev => prev.filter((_, i) => i !== index));
  };

  const currentModel = MODELS.find(m => m.id === config.model) || MODELS[0];

  const getRatioIcon = (ratio: string) => {
      switch(ratio) {
          case '16:9': return <Monitor size={14} />;
          case '9:16': return <Smartphone size={14} />;
          case '4:3': return <RectangleHorizontal size={14} />;
          case '3:4': return <RectangleVertical size={14} />;
          case '1:1': return <Square size={14} />;
          default: return <Square size={14} />;
      }
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[92%] max-w-[900px] z-40">
      <div className="animate-slide-up w-full">
        <input 
          type="file" 
          multiple
          ref={fileInputRef} 
          className="hidden" 
          accept="image/*"
          onChange={handleFileSelect}
        />

        <div ref={popupRef} className="absolute bottom-full left-0 w-full pointer-events-none mb-3 z-50">
            <div className="relative w-full h-full pointer-events-auto">
              {activePopup === 'model' && (
                  <div className="absolute bottom-0 left-0 bg-panel/95 backdrop-blur-xl border border-border-base rounded-[24px] w-80 shadow-2xl overflow-hidden animate-scale-in origin-bottom-left">
                      <div className="flex justify-between items-center p-4 border-b border-border-base bg-surface/50">
                          <span className="text-xs font-bold uppercase tracking-wider text-text-secondary">Select model</span>
                          <button onClick={() => setActivePopup(null)} className="p-1 hover:bg-black/5 rounded-full"><X size={14} className="text-text-secondary hover:text-text-primary"/></button>
                      </div>
                      <div className="max-h-80 overflow-y-auto p-2 space-y-1">
                          {MODELS.map(model => (
                          <button
                              key={model.id}
                              onClick={() => handleModelSelect(model.id)}
                              className={`w-full text-left p-3 rounded-xl flex items-center gap-3 transition-all ${config.model === model.id ? 'bg-surface border border-brand/50' : 'hover:bg-surface border border-transparent'}`}
                          >
                              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${config.model === model.id ? 'bg-brand text-bg' : 'bg-surface text-text-secondary border border-border-base'}`}>
                              {model.premium ? <Crown size={18} /> : <Zap size={18} />}
                              </div>
                              <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                      <span className={`text-sm font-bold ${config.model === model.id ? 'text-text-primary' : 'text-text-secondary'}`}>{model.name}</span>
                                      {model.badge && <span className="text-[9px] bg-brand/20 text-brand px-1.5 py-0.5 rounded uppercase font-bold tracking-wider">{model.badge}</span>}
                                  </div>
                                  <div className="text-[10px] text-text-secondary mt-0.5 truncate">{model.description}</div>
                              </div>
                              {config.model === model.id && <Check size={14} className="text-brand" />}
                          </button>
                          ))}
                      </div>
                  </div>
              )}
               {activePopup === 'aspect' && (
                  <div className="absolute bottom-0 left-44 bg-panel/95 backdrop-blur-xl border border-border-base rounded-[20px] w-64 shadow-2xl animate-scale-in origin-bottom-left p-2">
                  <div className="text-[10px] font-bold uppercase text-text-secondary px-3 py-2">Aspect ratio</div>
                  {ASPECT_RATIOS.map(ratio => (
                      <button
                      key={ratio.value}
                      onClick={() => handleRatioSelect(ratio.value)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center justify-between text-xs font-medium transition-colors ${config.aspectRatio === ratio.value ? 'bg-surface text-text-primary shadow-sm' : 'text-text-secondary hover:bg-surface hover:text-text-primary'}`}
                      >
                      <span className="flex items-center gap-3">
                          <span className="w-5 flex justify-center">{getRatioIcon(ratio.value)}</span>
                          {ratio.label}
                      </span>
                      {config.aspectRatio === ratio.value && <Check size={12} className="text-brand" />}
                      </button>
                  ))}
                  </div>
              )}
              {activePopup === 'quality' && (
                  <div className="absolute bottom-0 left-64 bg-panel/95 backdrop-blur-xl border border-border-base rounded-[20px] w-40 shadow-2xl animate-scale-in origin-bottom-left p-2">
                  <div className="text-[10px] font-bold uppercase text-text-secondary px-3 py-2">Quality</div>
                  {['1K', '2K', '4K'].map((q) => (
                      <button
                      key={q}
                      onClick={() => handleQualitySelect(q as any)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center justify-between text-xs font-medium transition-colors ${config.quality === q ? 'bg-surface text-text-primary shadow-sm' : 'text-text-secondary hover:bg-surface hover:text-text-primary'}`}
                      >
                      <span className="flex items-center gap-2">{q}</span>
                      {config.quality === q && <Check size={12} className="text-brand" />}
                      </button>
                  ))}
                  </div>
              )}
            </div>
        </div>

        <div className="bg-panel/80 dark:bg-[#111]/90 backdrop-blur-2xl border border-black/5 dark:border-white/10 rounded-[32px] p-2 shadow-[0_20px_40px_-10px_rgba(0,0,0,0.3)] transition-shadow">
            <div className="flex flex-col gap-2">
                <div className="flex items-start px-2 pt-2 gap-3">
                    <div className="flex items-center gap-3 mt-1 overflow-visible scrollbar-hide max-w-[240px] pt-1.5 pr-1.5">
                        {inputImages.map((img, idx) => (
                            <div key={idx} className="relative group flex-shrink-0">
                                <div className="w-12 h-12 rounded-lg overflow-hidden border border-brand/50 shadow-sm bg-surface relative">
                                    <img src={img} alt={`Input ${idx}`} className="w-full h-full object-cover" />
                                    <div className="absolute top-0 right-0 bg-brand text-bg px-1 rounded-bl-lg text-[8px] font-black uppercase pointer-events-none">
                                        img {idx + 1}
                                    </div>
                                </div>
                                <button 
                                  onClick={(e) => {
                                      e.stopPropagation();
                                      removeInputImage(idx);
                                  }}
                                  className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg hover:scale-110 z-20"
                                >
                                    <X size={10} />
                                </button>
                            </div>
                        ))}

                        <button 
                          onClick={triggerFileUpload}
                          className="w-12 h-12 rounded-full bg-surface border border-border-base flex items-center justify-center text-text-secondary hover:text-text-primary hover:border-brand transition-all flex-shrink-0 group"
                          title="Add Reference Image"
                        >
                            <Plus size={20} className="group-hover:scale-110 transition-transform" />
                        </button>
                    </div>

                    <textarea 
                      value={config.prompt}
                      onChange={(e) => setConfig(prev => ({ ...prev, prompt: e.target.value }))}
                      placeholder={inputImages.length > 0 ? "e.g. Combine elements from img 1 and img 2..." : "Imagine something extraordinary..."} 
                      className="flex-1 bg-transparent text-text-primary placeholder-text-secondary/50 outline-none px-2 py-2 h-14 resize-none text-base font-medium leading-relaxed"
                      onKeyDown={(e) => {
                          if(e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              onGenerate();
                          }
                      }}
                    />
                    <div className="flex flex-col gap-1 items-end">
                        <Button 
                          onClick={onGenerate}
                          disabled={!config.prompt || isGenerating}
                          variant="primary"
                          className={`h-11 px-6 rounded-xl font-bold transition-all ${isGenerating ? 'opacity-80' : 'hover:scale-105'}`}
                        >
                            {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} fill="currentColor" />}
                            <span className="ml-2 uppercase tracking-widest text-xs">Generate</span>
                        </Button>
                        <span className="text-[9px] font-mono text-text-secondary uppercase opacity-60 mr-1">Nano Banana Pro (Gemini 3)</span>
                    </div>
                </div>

                <div className="flex items-center gap-2 bg-surface/50 rounded-[24px] p-1.5 overflow-x-auto scrollbar-hide">
                    <button 
                        onClick={() => togglePopup('model')}
                        className="h-9 pl-1 pr-3 rounded-full bg-panel border border-border-base flex items-center gap-2 hover:border-brand/50 hover:shadow-lg hover:shadow-brand/5 transition-all group whitespace-nowrap"
                    >
                        <div className="w-7 h-7 rounded-full bg-surface flex items-center justify-center text-brand group-hover:bg-brand group-hover:text-bg transition-colors">
                          <Zap size={14} fill="currentColor"/>
                        </div>
                        <span className="text-xs font-bold text-text-primary tracking-tight">{currentModel.name}</span>
                        <ChevronRight size={12} className="text-text-secondary" />
                    </button>
                    
                    <div className="w-px h-5 bg-border-base mx-1" />

                    <button onClick={() => togglePopup('aspect')} className="h-8 px-3 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-text-secondary hover:text-text-primary text-xs font-medium flex items-center gap-2 transition-colors whitespace-nowrap">
                        {getRatioIcon(config.aspectRatio)}
                        {config.aspectRatio}
                    </button>

                    <button onClick={() => togglePopup('quality')} className="h-8 px-3 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-text-secondary hover:text-text-primary text-xs font-medium flex items-center gap-2 transition-colors whitespace-nowrap">
                        <Gem size={14} className="text-brand"/>
                        {config.quality}
                    </button>

                    <button onClick={onEnterDrawMode} className="h-8 px-3 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-text-secondary hover:text-text-primary text-xs font-medium flex items-center gap-2 transition-colors whitespace-nowrap">
                        <PenTool size={14} />
                        Sketch
                    </button>

                    <div className="ml-auto flex items-center bg-panel rounded-lg border border-border-base h-8 px-1">
                        <button onClick={() => handleBatchSelect(-1)} className="w-6 h-full flex items-center justify-center text-text-secondary hover:text-text-primary">-</button>
                        <span className="text-xs font-mono font-medium text-text-primary w-6 text-center">{config.batchSize}</span>
                        <button onClick={() => handleBatchSelect(1)} className="w-6 h-full flex items-center justify-center text-text-secondary hover:text-text-primary">+</button>
                    </div>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};
