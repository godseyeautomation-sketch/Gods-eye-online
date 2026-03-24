
import React, { useState, useRef, useEffect } from 'react';
import { 
    Sparkles, 
    X, 
    Loader2,
    Download,
    Trash2,
    Film,
    Play,
    Maximize2,
    Volume2,
    Smartphone,
    Settings2,
    ArrowRight,
    ImageIcon,
    Layers,
    PlusSquare,
    Expand,
    ChevronDown,
    ArrowLeftRight,
    Monitor,
    Search,
    Grid,
    List,
    Heart,
    Plus
} from 'lucide-react';
import { VIDEO_MODELS, VIDEO_GEN_MODES, ASPECT_RATIOS } from '../constants';
import { generateVideo } from '../services/geminiService';

interface VideoHistoryItem {
    id: string;
    url: string;
    thumbnail: string;
    prompt: string;
    timestamp: number;
    duration: string;
    aspectRatio: string;
    resolution: string;
    model: string;
}

export const VideoPage: React.FC<{ initialImage?: string | null }> = ({ initialImage }) => {
  const [prompt, setPrompt] = useState('');
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isRatioMenuOpen, setIsRatioMenuOpen] = useState(false);
  
  const [selectedMode, setSelectedMode] = useState(VIDEO_GEN_MODES[0]);
  const [selectedModel, setSelectedModel] = useState(VIDEO_MODELS[0]);
  
  // Filter for Veo supported ratios only
  const videoRatios = ASPECT_RATIOS.filter(r => r.value === '16:9' || r.value === '9:16');
  const [selectedRatio, setSelectedRatio] = useState(videoRatios[1]); // Default Portrait
  
  const [outputsPerPrompt, setOutputsPerPrompt] = useState(1);
  
  const [startImage, setStartImage] = useState<string | null>(initialImage || null);
  const [endImage, setEndImage] = useState<string | null>(null);
  const [ingredients, setIngredients] = useState<string[]>([]);
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const [history, setHistory] = useState<VideoHistoryItem[]>(() => {
      const saved = localStorage.getItem('klint_video_history');
      return saved ? JSON.parse(saved) : [];
  });

  const modeMenuRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const ratioMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<'start' | 'end' | 'ingredient'>('start');

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) setIsModeMenuOpen(false);
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setIsSettingsOpen(false);
      if (ratioMenuRef.current && !ratioMenuRef.current.contains(e.target as Node)) setIsRatioMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
      localStorage.setItem('klint_video_history', JSON.stringify(history));
  }, [history]);

  const captureThumbnail = async (videoUrl: string): Promise<string> => {
      return new Promise((resolve) => {
          const video = document.createElement('video');
          video.src = videoUrl;
          video.crossOrigin = 'anonymous';
          video.muted = true;
          video.playsInline = true;
          video.preload = 'metadata';
          const timeoutId = setTimeout(() => {
              resolve('https://picsum.photos/400/225');
              video.remove();
          }, 8000);
          video.onloadedmetadata = () => { video.currentTime = 0.5; };
          video.onseeked = () => {
              clearTimeout(timeoutId);
              const canvas = document.createElement('canvas');
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              const ctx = canvas.getContext('2d');
              if (ctx && canvas.width > 0) {
                  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                  resolve(canvas.toDataURL('image/jpeg', 0.8));
              } else { resolve('https://picsum.photos/400/225'); }
              video.remove();
          };
          video.onerror = () => {
              clearTimeout(timeoutId);
              resolve('https://picsum.photos/400/225');
              video.remove();
          };
      });
  };

  const handleGenerate = async () => {
      if (isGenerating || !prompt) return;
      setIsGenerating(true);
      setGeneratedVideoUrl(null);
      setError(null);
      setIsModeMenuOpen(false);
      setIsSettingsOpen(false);

      try {
          const videoUrl = await generateVideo({
              prompt: prompt,
              model: selectedModel.id,
              startImage: startImage || (ingredients.length > 0 ? ingredients[0] : undefined),
              endImage: endImage || undefined,
              aspectRatio: selectedRatio.value as any,
              resolution: '1080p',
              duration: '4s'
          });
          
          setGeneratedVideoUrl(videoUrl);
          const thumbnail = await captureThumbnail(videoUrl);
          
          const newItem: VideoHistoryItem = {
              id: Date.now().toString(),
              url: videoUrl,
              thumbnail: thumbnail,
              prompt: prompt,
              timestamp: Date.now(),
              duration: '4s',
              aspectRatio: selectedRatio.value,
              resolution: '1080p',
              model: selectedModel.name
          };
          
          setHistory(prev => [newItem, ...prev]);
      } catch (e: any) {
          console.error(e);
          setError(e.message || "An error occurred during video generation.");
      } finally {
          setIsGenerating(false);
      }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.[0]) {
          const reader = new FileReader();
          reader.onload = (ev) => {
              const base64 = ev.target?.result as string;
              if (uploadTarget === 'start') setStartImage(base64);
              else if (uploadTarget === 'end') setEndImage(base64);
              else setIngredients(prev => [...prev, base64].slice(0, 3));
          };
          reader.readAsDataURL(e.target.files[0]);
      }
  };

  const triggerUpload = (target: 'start' | 'end' | 'ingredient') => {
      setUploadTarget(target);
      fileInputRef.current?.click();
  };

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] overflow-hidden font-sans relative w-full bg-bg text-text-primary">
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileSelect} />

      {/* Top Header Section */}
      <div className="flex items-center justify-between px-8 py-4 bg-bg/80 backdrop-blur-md z-40 border-b border-border-base">
          <div className="flex gap-1 bg-panel p-1 rounded-xl border border-border-base">
              <button className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-surface text-xs font-bold text-text-primary shadow-sm">
                  <Film size={14} /> Videos
              </button>
              <button className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold text-text-secondary hover:text-text-primary transition-colors">
                  <ImageIcon size={14} /> Images
              </button>
          </div>

          <div className="flex-1 max-w-xl mx-8 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary" size={16} />
              <input 
                type="text" 
                placeholder="Search for a clip" 
                className="w-full bg-panel border border-border-base rounded-xl py-2 pl-11 pr-4 text-xs font-medium focus:outline-none focus:border-brand/30 transition-all text-text-primary"
              />
          </div>

          <div className="flex items-center gap-3">
              <button className="p-2.5 bg-panel rounded-xl border border-border-base text-text-secondary hover:text-text-primary transition-all"><Grid size={18} /></button>
              <button className="p-2.5 bg-panel rounded-xl border border-border-base text-text-secondary hover:text-text-primary transition-all"><List size={18} /></button>
              <button className="p-2.5 bg-panel rounded-xl border border-border-base text-text-secondary hover:text-text-primary transition-all"><Heart size={18} /></button>
          </div>
      </div>

      {/* Main Preview */}
      <div className="flex-1 relative flex items-center justify-center p-8 overflow-hidden">
          <div className="w-full max-w-5xl h-full flex flex-col items-center justify-center relative">
              {isGenerating ? (
                  <div className="flex flex-col items-center animate-fade-in">
                      <div className="w-20 h-20 rounded-full border-2 border-brand border-t-transparent animate-spin mb-8"></div>
                      <h3 className="text-2xl font-black uppercase tracking-[0.2em] mb-2">Creating Video</h3>
                      <p className="text-text-secondary text-sm font-medium">Veo 3.1 is imagining your request...</p>
                  </div>
              ) : generatedVideoUrl ? (
                  <div className="relative h-full w-full max-w-[400px] flex items-center justify-center group shadow-2xl rounded-3xl overflow-hidden border border-border-base">
                      <video src={generatedVideoUrl} autoPlay loop className="h-full w-auto object-cover" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                           <div className="flex gap-4">
                               <button onClick={() => window.open(generatedVideoUrl)} className="w-14 h-14 bg-brand text-bg rounded-full flex items-center justify-center shadow-2xl hover:scale-110 transition-all"><Maximize2 size={24} /></button>
                               <button onClick={() => setGeneratedVideoUrl(null)} className="w-14 h-14 bg-red-600 text-white rounded-full flex items-center justify-center shadow-2xl hover:scale-110 transition-all"><X size={24} /></button>
                           </div>
                      </div>
                  </div>
              ) : (
                  <div className="flex flex-col items-center opacity-20">
                      <h1 className="text-2xl font-medium text-text-secondary">Type in the prompt box to start</h1>
                  </div>
              )}
          </div>
      </div>

      {/* Adaptive Command Bar */}
      <div className="w-full flex justify-center pb-12 px-6 z-50">
          <div className="w-full max-w-4xl relative">
              
              {/* Settings Popup */}
              {isSettingsOpen && (
                  <div 
                    ref={settingsRef}
                    className="absolute bottom-full mb-4 right-0 w-[420px] bg-panel border border-border-base rounded-[28px] p-6 shadow-2xl animate-scale-in origin-bottom-right z-50"
                  >
                      <div className="space-y-6">
                          <div className="space-y-2 relative">
                              <label className="text-[11px] text-text-secondary font-bold uppercase tracking-wide">Aspect Ratio</label>
                              <button 
                                onClick={() => setIsRatioMenuOpen(!isRatioMenuOpen)}
                                className="w-full flex items-center justify-between bg-surface border border-border-base rounded-xl px-4 py-3 text-sm font-bold text-text-primary"
                              >
                                  <div className="flex items-center gap-3">
                                      {selectedRatio.value === '16:9' ? <Monitor size={16}/> : <Smartphone size={16}/>}
                                      {selectedRatio.label}
                                  </div>
                                  <ChevronDown size={16} className="text-text-secondary" />
                              </button>
                              
                              {isRatioMenuOpen && (
                                <div ref={ratioMenuRef} className="absolute top-full left-0 w-full mt-2 bg-panel border border-border-base rounded-xl overflow-hidden shadow-2xl z-[60]">
                                    {videoRatios.map(r => (
                                        <button 
                                            key={r.value}
                                            onClick={() => { setSelectedRatio(r); setIsRatioMenuOpen(false); }}
                                            className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-bold transition-all ${selectedRatio.value === r.value ? 'bg-surface text-text-primary' : 'text-text-secondary hover:bg-surface hover:text-text-primary'}`}
                                        >
                                            {r.value === '16:9' ? <Monitor size={16}/> : <Smartphone size={16}/>}
                                            {r.label}
                                        </button>
                                    ))}
                                </div>
                              )}
                          </div>

                          <div className="space-y-2">
                              <label className="text-[11px] text-text-secondary font-bold uppercase tracking-wide">Outputs per prompt</label>
                              <select 
                                value={outputsPerPrompt} 
                                onChange={(e) => setOutputsPerPrompt(Number(e.target.value))}
                                className="w-full bg-surface border border-border-base rounded-xl px-4 py-3 text-sm font-bold text-text-primary appearance-none outline-none"
                              >
                                  <option value={1}>1</option>
                                  <option value={2}>2</option>
                                  <option value={4}>4</option>
                              </select>
                          </div>

                          <div className="space-y-2">
                              <label className="text-[11px] text-text-secondary font-bold uppercase tracking-wide">Model</label>
                              <select 
                                value={selectedModel.id} 
                                onChange={(e) => setSelectedModel(VIDEO_MODELS.find(m => m.id === e.target.value) || VIDEO_MODELS[0])}
                                className="w-full bg-surface border border-border-base rounded-xl px-4 py-3 text-sm font-bold text-text-primary appearance-none outline-none"
                              >
                                  {VIDEO_MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                              </select>
                          </div>

                          <div className="pt-4 border-t border-border-base flex items-center justify-between">
                              <span className="text-[11px] text-text-secondary font-medium italic">Each generation uses <span className="text-text-primary font-bold underline">20 credits</span></span>
                          </div>
                      </div>
                  </div>
              )}

              {/* Mode Menu */}
              {isModeMenuOpen && (
                <div 
                    ref={modeMenuRef}
                    className="absolute bottom-full mb-4 left-0 w-[280px] bg-panel border border-border-base rounded-[28px] overflow-hidden shadow-2xl animate-scale-in origin-bottom-left z-50 p-2"
                >
                    {VIDEO_GEN_MODES.map((mode) => (
                        <button
                            key={mode.id}
                            onClick={() => { setSelectedMode(mode); setIsModeMenuOpen(false); }}
                            className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all ${selectedMode.id === mode.id ? 'bg-surface text-text-primary' : 'text-text-secondary hover:bg-surface hover:text-text-primary'}`}
                        >
                            <div className={`${selectedMode.id === mode.id ? 'text-brand' : ''}`}>
                                {mode.id === 'text-to-video' && <Sparkles size={18} />}
                                {mode.id === 'frames-to-video' && <PlusSquare size={18} />}
                                {mode.id === 'ingredients-to-video' && <Layers size={18} />}
                                {mode.id === 'create-image' && <PlusSquare size={18} />}
                            </div>
                            <span className="text-sm font-bold tracking-tight">{mode.label}</span>
                            {selectedMode.id === mode.id && mode.id === 'text-to-video' && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-brand"></div>}
                        </button>
                    ))}
                </div>
              )}

              {/* Main Command Bar Container */}
              <div className="bg-panel/90 backdrop-blur-2xl border border-border-base rounded-[36px] p-2 shadow-2xl flex flex-col group transition-all duration-500 ring-1 ring-border-base focus-within:ring-brand/20">
                  
                  {/* Internal Toolbar */}
                  <div className="flex items-center justify-between px-4 pt-2 pb-1">
                      <div className="flex items-center gap-2">
                        <button 
                            onClick={() => setIsModeMenuOpen(!isModeMenuOpen)}
                            className="bg-surface hover:bg-border-base text-text-primary px-4 py-2 rounded-full flex items-center gap-2 text-xs font-bold transition-all shadow-sm"
                        >
                            {selectedMode.label}
                            <ChevronDown size={14} className="opacity-40" />
                        </button>
                      </div>

                      <div className="flex items-center gap-3">
                          <div className="flex items-center bg-surface rounded-full px-4 py-1.5 border border-border-base gap-2 group/mod hover:bg-border-base cursor-pointer transition-all">
                              <Volume2 size={14} className="text-text-secondary group-hover/mod:text-brand" />
                              <span className="text-[11px] font-bold text-text-primary">{selectedModel.name}</span>
                          </div>
                          
                          <div className="flex items-center bg-surface rounded-full px-4 py-1.5 border border-border-base gap-2">
                              {selectedRatio.value === '16:9' ? <Monitor size={14}/> : <Smartphone size={14}/>}
                              <span className="text-[11px] font-bold text-text-primary">x{outputsPerPrompt}</span>
                          </div>

                          <button 
                            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                            className={`w-9 h-9 flex items-center justify-center rounded-full border border-border-base transition-all ${isSettingsOpen ? 'bg-brand text-bg border-brand' : 'bg-surface text-text-secondary hover:text-text-primary'}`}
                          >
                              <Settings2 size={16} />
                          </button>
                      </div>
                  </div>

                  {/* Input Box and Prompt */}
                  <div className="px-5 pt-3 pb-1">
                      <textarea 
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder={selectedMode.placeholder}
                        className="w-full bg-transparent text-lg text-text-primary placeholder:text-text-secondary outline-none resize-none h-16 pt-1 leading-snug font-medium"
                      />
                  </div>

                  {/* Mode-specific Assets */}
                  <div className="flex items-center justify-between px-4 pb-3 pt-1">
                      <div className="flex items-center gap-4">
                        {selectedMode.id === 'frames-to-video' && (
                            <div className="flex items-center gap-3 animate-fade-in">
                                <button 
                                    onClick={() => triggerUpload('start')}
                                    className={`w-14 h-14 rounded-full border flex items-center justify-center transition-all overflow-hidden ${startImage ? 'border-brand/50' : 'bg-surface border-border-base text-text-secondary hover:border-brand/40'}`}
                                >
                                    {startImage ? <img src={startImage} className="w-full h-full object-cover"/> : <Plus size={24}/>}
                                </button>
                                <ArrowLeftRight size={18} className="text-text-secondary" />
                                <button 
                                    onClick={() => triggerUpload('end')}
                                    className={`w-14 h-14 rounded-full border flex items-center justify-center transition-all overflow-hidden ${endImage ? 'border-brand/50' : 'bg-surface border-border-base text-text-secondary hover:border-brand/40'}`}
                                >
                                    {endImage ? <img src={endImage} className="w-full h-full object-cover"/> : <Plus size={24}/>}
                                </button>
                            </div>
                        )}

                        {selectedMode.id === 'ingredients-to-video' && (
                            <div className="flex items-center gap-3 animate-fade-in">
                                {ingredients.map((img, idx) => (
                                    <div key={idx} className="relative group">
                                        <div className="w-14 h-14 rounded-full overflow-hidden border border-brand/40">
                                            <img src={img} className="w-full h-full object-cover" />
                                        </div>
                                        <button onClick={() => setIngredients(prev => prev.filter((_, i) => i !== idx))} className="absolute -top-1 -right-1 bg-red-600 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"><X size={10}/></button>
                                    </div>
                                ))}
                                {ingredients.length < 3 && (
                                    <button 
                                        onClick={() => triggerUpload('ingredient')}
                                        className="w-14 h-14 rounded-full bg-surface border border-border-base flex items-center justify-center text-text-secondary hover:border-brand/40 transition-all"
                                    >
                                        <Plus size={24} />
                                    </button>
                                )}
                            </div>
                        )}
                        
                        {selectedMode.id === 'create-image' && (
                            <button 
                                onClick={() => triggerUpload('start')}
                                className={`w-14 h-14 rounded-full border flex items-center justify-center transition-all overflow-hidden ${startImage ? 'border-brand/50' : 'bg-surface border-border-base text-text-secondary hover:border-brand/40'}`}
                            >
                                {startImage ? <img src={startImage} className="w-full h-full object-cover"/> : <Plus size={24}/>}
                            </button>
                        )}
                      </div>

                      <div className="flex items-center gap-6">
                        <button className="flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors">
                            <Expand size={18} />
                            <span className="text-xs font-bold uppercase tracking-widest">Expand</span>
                        </button>
                        
                        <button 
                            onClick={handleGenerate}
                            disabled={isGenerating || !prompt}
                            className={`w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-xl border border-border-base ${isGenerating ? 'bg-surface' : 'bg-surface hover:bg-brand hover:text-bg text-text-secondary'}`}
                        >
                            {isGenerating ? <Loader2 size={24} className="animate-spin" /> : <ArrowRight size={24} strokeWidth={2.5} />}
                        </button>
                      </div>
                  </div>
              </div>
          </div>
      </div>

      {error && (
          <div className="fixed bottom-36 left-1/2 -translate-x-1/2 bg-red-600 text-white px-6 py-3 rounded-full text-xs font-bold shadow-2xl flex items-center gap-3 animate-slide-up z-[70]">
              <X size={14} className="cursor-pointer" onClick={() => setError(null)} />
              {error}
          </div>
      )}
    </div>
  );
};
