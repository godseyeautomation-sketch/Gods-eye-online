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
  Loader2,
  Sun,
  Box,
  RotateCcw,
  Users,
  Camera,
  Bookmark,
  Trash,
  RotateCw,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';
import { Button } from './Button';
import { MODELS, ASPECT_RATIOS } from '../constants';
import {
  GenerationConfig,
  ModelType,
  Character,
  PerspectiveConfig,
  DEFAULT_PERSPECTIVE,
  buildPerspectiveText,
  isPerspectiveActive,
  ObjectOrientation,
  DEFAULT_OBJECT_ORIENTATION,
  isObjectOrientationActive,
  OBJECT_ORIENTATION_OPTIONS
} from '../types';
import { supabase } from '../services/supabaseClient';
import { useAuth } from '../context/AuthContext';

// --- Gemini-friendly presets ---
export const CAMERA_ANGLES = [
  { label: 'Eye Level', value: 'camera positioned at eye level, straight-on view', icon: '👁️' },
  { label: 'Low Angle', value: 'camera positioned low near the ground, looking upward at the subject', icon: '⬇️' },
  { label: "Bird's Eye", value: 'viewed from high above, looking straight down at the subject', icon: '🦅' },
  { label: 'Dutch Tilt', value: 'camera tilted sideways at a diagonal angle', icon: '↗️' },
  { label: "Worm's Eye", value: 'camera placed on the ground looking steeply upward', icon: '🪱' },
  { label: 'Overhead', value: 'directly above the subject, top-down flat-lay perspective', icon: '⬆️' },
];

export const SHOT_TYPES = [
  { label: 'Extreme\nClose', value: 'frame tightly around the face only, extreme detail', icon: '🔍' },
  { label: 'Close-Up', value: 'frame crops tightly around face and shoulders', icon: '📷' },
  { label: 'Medium', value: 'frame shows subject from waist up', icon: '🧍' },
  { label: 'Wide', value: 'full body visible with surrounding environment', icon: '🌅' },
  { label: 'Extreme\nWide', value: 'subject small in frame, vast environment visible all around', icon: '🌍' },
];

/** CSS 3D cube preview that reflects current rotation/tilt */
const Cube3D: React.FC<{ rotation: number; tilt: number }> = ({ rotation, tilt }) => {
  const rotY = rotation;
  const rotX = -tilt * 0.6;
  const face = (transform: string, opacity: number, showIcon = false) => (
    <div style={{
      position: 'absolute', width: 50, height: 50, top: 11, left: 11,
      transform, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: `rgba(138,255,0,${opacity * 0.15})`,
      border: `${showIcon ? 1.5 : 1}px solid rgba(138,255,0,${opacity * 0.7})`,
    }}>
      {showIcon && <Camera size={14} style={{ color: 'rgba(138,255,0,0.9)' }} />}
    </div>
  );
  return (
    <div style={{ width: 72, height: 72, perspective: 200 }}>
      <div style={{
        width: '100%', height: '100%', position: 'relative',
        transformStyle: 'preserve-3d',
        transform: `rotateX(${rotX - 20}deg) rotateY(${rotY}deg)`,
        transition: 'transform 0.15s ease-out',
      }}>
        {face('translateZ(25px)', 1, true)}
        {face('rotateY(180deg) translateZ(25px)', 0.4)}
        {face('rotateY(-90deg) translateZ(25px)', 0.6)}
        {face('rotateY(90deg) translateZ(25px)', 0.6)}
        {face('rotateX(90deg) translateZ(25px)', 0.8)}
        {face('rotateX(-90deg) translateZ(25px)', 0.3)}
      </div>
    </div>
  );
};

interface ControlBarProps {
  config: GenerationConfig;
  setConfig: React.Dispatch<React.SetStateAction<GenerationConfig>>;
  onGenerate: () => void;
  onEnterDrawMode: () => void;
  isGenerating: boolean;
  inputImages: string[];
  setInputImages: React.Dispatch<React.SetStateAction<string[]>>;
  // Perspective & Object — owned by parent (EditPage), passed down so generate stays single-fire
  perspective: PerspectiveConfig;
  setPerspective: React.Dispatch<React.SetStateAction<PerspectiveConfig>>;
  objectOrientation?: ObjectOrientation;
  setObjectOrientation?: React.Dispatch<React.SetStateAction<ObjectOrientation>>;

  // Brand Context (Global)
  brands?: any[];
  activeBrandId?: string | null;
  onSwitchBrand?: (brandId: string | null) => void;
}

export const ControlBar: React.FC<ControlBarProps> = ({
  config, setConfig, onGenerate, onEnterDrawMode,
  isGenerating, inputImages, setInputImages,
  perspective, setPerspective,
  objectOrientation = DEFAULT_OBJECT_ORIENTATION, setObjectOrientation,
  brands = [], activeBrandId = null, onSwitchBrand
}) => {
  const { user } = useAuth();
  const [activePopup, setActivePopup] = useState<string | null>(null);
  const [isDraggingCube, setIsDraggingCube] = useState(false);
  const [cubeDragStart, setCubeDragStart] = useState({ x: 0, y: 0 });
  const [cubeDragBase, setCubeDragBase] = useState({ rotation: 0, tilt: 0 });

  // Smart Entity Selectors
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

  // Fetch characters on mount
  useEffect(() => {
    if (!user) return;
    supabase
      .from('characters')
      .select('*, character_images(image_url)')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) {
          setCharacters(data.map((c: any) => ({
            id: c.id,
            name: c.name,
            thumbnail: c.thumbnail_url,
            images: c.character_images?.map((img: any) => img.image_url) || [],
          })));
        }
      });
  }, [user]);

  // Get active brand's products
  const activeBrandProducts = activeBrandId
    ? (brands.find(b => b.id === activeBrandId)?.products || [])
    : [];

  const handleSelectCharacter = (char: Character) => {
    if (selectedCharacterId === char.id) {
      setSelectedCharacterId(null);
      // Remove character images from inputImages
      setInputImages(prev => prev.filter(img => !char.images.slice(0, 3).includes(img)));
    } else {
      setSelectedCharacterId(char.id);
      setInputImages(prev => [...char.images.slice(0, 3), ...prev]);
    }
    setActivePopup(null);
  };

  const handleSelectProduct = (product: any) => {
    if (selectedProductId === product.id) {
      setSelectedProductId(null);
      setInputImages(prev => prev.filter(img => img !== product.imageDataUrl));
    } else {
      setSelectedProductId(product.id);
      if (product.imageDataUrl) {
        setInputImages(prev => [product.imageDataUrl, ...prev]);
      }
    }
    setActivePopup(null);
  };

  const popupRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [popupPosition, setPopupPosition] = useState({ bottom: 0, left: 0, width: 0 });
  const visualBarRef = useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    if (activePopup && visualBarRef.current) {
      const update = () => {
        const rect = visualBarRef.current?.getBoundingClientRect();
        if (rect) setPopupPosition({ bottom: window.innerHeight - rect.top + 16, left: rect.left, width: rect.width });
      };
      update();
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
  }, [activePopup, inputImages.length]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) setActivePopup(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Prompts Library state
  const [savedPrompts, setSavedPrompts] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('klint_saved_prompts');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Sync prompts to local storage
  useEffect(() => {
    try {
      localStorage.setItem('klint_saved_prompts', JSON.stringify(savedPrompts));
    } catch (e) {
      console.error("Failed to save prompts to local storage", e);
    }
  }, [savedPrompts]);

  const handleSavePrompt = () => {
    if (!config.prompt.trim()) return;
    setSavedPrompts(prev => {
      // Prevent exact duplicates and bring to front if already exists
      const filtered = prev.filter(p => p !== config.prompt.trim());
      return [config.prompt.trim(), ...filtered].slice(0, 20); // Keep max 20
    });
  };

  const handleRemovePrompt = (e: React.MouseEvent, promptToRemove: string) => {
    e.stopPropagation();
    setSavedPrompts(prev => prev.filter(p => p !== promptToRemove));
  };

  // Cube drag → rotation/tilt
  useEffect(() => {
    if (!isDraggingCube) return;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - cubeDragStart.x;
      const dy = e.clientY - cubeDragStart.y;
      setPerspective(prev => ({
        ...prev,
        rotation: Math.max(-180, Math.min(180, cubeDragBase.rotation + dx * 1.5)),
        tilt: Math.max(-60, Math.min(60, cubeDragBase.tilt - dy * 0.8)),
      }));
    };
    const onUp = () => setIsDraggingCube(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [isDraggingCube, cubeDragStart, cubeDragBase]);

  const togglePopup = (name: string) => setActivePopup(activePopup === name ? null : name);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      const files = Array.from(e.target.files) as File[];
      const newImages: string[] = [];
      for (const file of files) {
        const b64 = await new Promise<string>(res => { const r = new FileReader(); r.onload = ev => res(ev.target?.result as string); r.readAsDataURL(file); });
        newImages.push(b64);
      }
      setInputImages(prev => [...prev, ...newImages]);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const getRatioIcon = (ratio: string) => {
    switch (ratio) {
      case '16:9': return <Monitor size={14} />;
      case '9:16': return <Smartphone size={14} />;
      case '4:3': return <RectangleHorizontal size={14} />;
      case '3:4': return <RectangleVertical size={14} />;
      case '21:9': return <Monitor size={14} className="scale-x-125" />;
      case '9:21': return <Smartphone size={14} className="scale-y-125" />;
      case '3:2': return <RectangleHorizontal size={14} />;
      case '2:3': return <RectangleVertical size={14} />;
      case '4:5': return <RectangleVertical size={14} />;
      case '5:4': return <RectangleHorizontal size={14} />;
      default: return <Square size={14} />;
    }
  };

  const currentModel = MODELS.find(m => m.id === config.model) || MODELS[0];
  const perspActive = isPerspectiveActive(perspective);
  const perspText = buildPerspectiveText(perspective);

  // Model-specific filtering
  const modelAspectRatios = currentModel.supportedAspectRatios;
  const filteredAspectRatios = modelAspectRatios && modelAspectRatios.length > 0
    ? ASPECT_RATIOS.filter(r => modelAspectRatios.includes(r.value))
    : modelAspectRatios && modelAspectRatios.length === 0
      ? [] // empty array = no aspect ratio selector at all (Topaz, Qwen)
      : ASPECT_RATIOS; // undefined = show all (Gemini)
  const showAspectRatio = filteredAspectRatios.length > 0;
  const showQuality = currentModel.hasQuality !== false; // only Gemini models
  const showBatchSize = (currentModel.maxBatchSize ?? 4) > 0;
  const maxBatch = currentModel.maxBatchSize ?? 4;

  return (
    <div className="fixed bottom-6 inset-x-0 flex justify-center z-40 px-4 pointer-events-none">
      <div className="relative w-full max-w-[900px] pointer-events-auto">
        <input type="file" multiple ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileSelect} />

        {/* ── Popup container ── */}
        <div
          ref={popupRef}
          className="fixed px-0 pointer-events-none z-50"
          style={{ bottom: `${popupPosition.bottom}px`, left: `${popupPosition.left}px`, width: `${popupPosition.width}px` }}
        >
          <div className="relative w-full h-full pointer-events-auto">

            {/* Model popup */}
            {activePopup === 'model' && (
              <div className="absolute bottom-0 left-0 bg-white dark:bg-[#1a1a1a] border border-border-base rounded-[24px] w-80 shadow-2xl overflow-hidden animate-scale-in origin-bottom-left">
                <div className="flex justify-between items-center p-4 border-b border-border-base bg-surface/50">
                  <span className="text-xs font-bold uppercase tracking-wider text-text-secondary">Select model</span>
                  <button onClick={() => setActivePopup(null)} className="p-1 rounded-full"><X size={14} className="text-text-secondary" /></button>
                </div>
                <div className="max-h-80 overflow-y-auto p-2 space-y-1">
                  {MODELS.map(model => (
                    <button key={model.id} onClick={() => { setConfig(prev => ({ ...prev, model: model.id })); setActivePopup(null); }}
                      className={`w-full text-left p-3 rounded-xl flex items-center gap-3 transition-all ${config.model === model.id ? 'bg-surface border border-brand/50' : 'hover:bg-surface border border-transparent'}`}>
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

            {/* Aspect popup */}
            {activePopup === 'aspect' && showAspectRatio && (
              <div className="absolute bottom-0 left-44 bg-white dark:bg-[#1a1a1a] border border-border-base rounded-[20px] w-48 shadow-2xl animate-scale-in origin-bottom-left p-2">
                <div className="text-[10px] font-bold uppercase text-text-secondary px-3 py-2">Aspect ratio</div>
                {filteredAspectRatios.map(ratio => (
                  <button key={ratio.value} onClick={() => { setConfig(prev => ({ ...prev, aspectRatio: ratio.value })); setActivePopup(null); }}
                    className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center justify-between text-xs font-medium transition-colors ${config.aspectRatio === ratio.value ? 'bg-surface text-text-primary' : 'text-text-secondary hover:bg-surface hover:text-text-primary'}`}>
                    <span className="flex items-center gap-2">{getRatioIcon(ratio.value)}{ratio.label}</span>
                    {config.aspectRatio === ratio.value && <Check size={12} className="text-brand" />}
                  </button>
                ))}
              </div>
            )}

            {/* Brand Context popup */}
            {activePopup === 'brand' && onSwitchBrand && (
              <div className="absolute bottom-0 right-32 bg-white dark:bg-[#1a1a1a] border border-brand/30 rounded-[20px] w-64 shadow-2xl animate-scale-in origin-bottom-right p-2">
                <div className="text-[10px] font-bold uppercase text-brand px-3 py-2 tracking-widest flex items-center gap-2">
                  <Sparkles size={12} /> Inject Brand DNA
                </div>
                <div className="max-h-60 overflow-y-auto space-y-1 mt-1">
                  <button onClick={() => { onSwitchBrand(null); setActivePopup(null); }}
                    className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center justify-between text-xs font-medium transition-colors ${activeBrandId === null ? 'bg-surface text-text-primary' : 'text-text-secondary hover:bg-surface hover:text-text-primary'}`}>
                    <span>No Brand (Fresh Generation)</span>
                    {activeBrandId === null && <Check size={12} className="text-brand" />}
                  </button>
                  <div className="w-full h-px bg-border-base my-1" />
                  {brands.map(b => (
                    <button key={b.id} onClick={() => { onSwitchBrand(b.id); setActivePopup(null); }}
                      className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center justify-between text-xs font-semibold transition-colors ${activeBrandId === b.id ? 'bg-brand/10 text-brand border border-brand/30' : 'text-text-primary hover:bg-surface border border-transparent'}`}>
                      <span className="truncate pr-4">{b.name}</span>
                      {activeBrandId === b.id && <Check size={12} className="text-brand flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Character selector popup */}
            {activePopup === 'character' && (
              <div className="absolute bottom-0 right-48 bg-white dark:bg-[#1a1a1a] border border-border-base rounded-[20px] w-64 shadow-2xl animate-scale-in origin-bottom-right p-2">
                <div className="text-[10px] font-bold uppercase text-text-secondary px-3 py-2 tracking-widest flex items-center gap-2">
                  <Users size={12} /> Select Character
                </div>
                <div className="max-h-60 overflow-y-auto space-y-1 mt-1">
                  {characters.length === 0 ? (
                    <p className="text-[10px] text-text-secondary px-3 py-4 text-center">No characters yet. Create one in Characters.</p>
                  ) : characters.map(char => (
                    <button key={char.id} onClick={() => handleSelectCharacter(char)}
                      className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-2.5 text-xs font-semibold transition-colors ${selectedCharacterId === char.id ? 'bg-brand/10 text-brand border border-brand/30' : 'text-text-primary hover:bg-surface border border-transparent'}`}>
                      <img src={char.thumbnail} alt={char.name} className="w-7 h-7 rounded-full object-cover border border-white/10" />
                      <span className="truncate">{char.name}</span>
                      {selectedCharacterId === char.id && <Check size={12} className="text-brand ml-auto flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Product selector popup */}
            {activePopup === 'product' && activeBrandProducts.length > 0 && (
              <div className="absolute bottom-0 right-64 bg-white dark:bg-[#1a1a1a] border border-border-base rounded-[20px] w-64 shadow-2xl animate-scale-in origin-bottom-right p-2">
                <div className="text-[10px] font-bold uppercase text-text-secondary px-3 py-2 tracking-widest flex items-center gap-2">
                  📦 Select Product
                </div>
                <div className="max-h-60 overflow-y-auto space-y-1 mt-1">
                  {activeBrandProducts.map((product: any) => (
                    <button key={product.id} onClick={() => handleSelectProduct(product)}
                      className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-2.5 text-xs font-semibold transition-colors ${selectedProductId === product.id ? 'bg-brand/10 text-brand border border-brand/30' : 'text-text-primary hover:bg-surface border border-transparent'}`}>
                      {product.imageDataUrl && <img src={product.imageDataUrl} alt={product.name} className="w-7 h-7 rounded-lg object-cover border border-white/10" />}
                      <span className="truncate">{product.name}</span>
                      {selectedProductId === product.id && <Check size={12} className="text-brand ml-auto flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Quality popup */}
            {activePopup === 'quality' && (
              <div className="absolute bottom-0 left-64 bg-white dark:bg-[#1a1a1a] border border-border-base rounded-[20px] w-40 shadow-2xl animate-scale-in origin-bottom-left p-2">
                <div className="text-[10px] font-bold uppercase text-brand px-3 py-2">Quality</div>
                {(['1K', '2K', '4K'] as const).map(q => (
                  <button key={q} onClick={() => { setConfig(prev => ({ ...prev, quality: q })); setActivePopup(null); }}
                    className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center justify-between text-xs font-medium transition-colors ${config.quality === q ? 'bg-surface text-text-primary' : 'text-text-secondary hover:bg-surface hover:text-text-primary'}`}>
                    {q}
                    {config.quality === q && <Check size={12} className="text-brand" />}
                  </button>
                ))}
              </div>
            )}

            {/* Saved Prompts popup */}
            {activePopup === 'prompts' && (
              <div className="absolute bottom-0 left-[350px] bg-white dark:bg-[#1a1a1a] border border-border-base rounded-[24px] w-80 shadow-2xl overflow-hidden animate-scale-in origin-bottom-left">
                <div className="flex justify-between items-center p-4 border-b border-border-base bg-surface/50">
                  <span className="text-xs font-bold uppercase tracking-wider text-text-secondary flex items-center gap-2">
                    <Bookmark size={14} /> Saved Prompts
                  </span>
                  <button onClick={() => setActivePopup(null)} className="p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition-colors">
                    <X size={14} className="text-text-secondary" />
                  </button>
                </div>

                <div className="max-h-80 overflow-y-auto p-2">
                  {savedPrompts.length === 0 ? (
                    <div className="py-8 px-4 text-center">
                      <Bookmark size={24} className="mx-auto text-text-secondary/30 mb-2" />
                      <div className="text-xs text-text-secondary font-medium">No saved prompts yet</div>
                      <div className="text-[10px] text-text-secondary/60 mt-1">Click the bookmark icon in the input area to save your favorite prompts here.</div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {savedPrompts.map((p, idx) => (
                        <div key={idx} className="group relative w-full text-left p-2.5 rounded-xl flex items-start gap-2 hover:bg-surface border border-transparent hover:border-border-base transition-all cursor-pointer"
                          onClick={() => { setConfig(prev => ({ ...prev, prompt: p })); setActivePopup(null); }}>
                          <div className="flex-1 min-w-0 pr-6">
                            <p className="text-xs text-text-primary leading-relaxed line-clamp-3">{p}</p>
                          </div>
                          <button
                            onClick={(e) => handleRemovePrompt(e, p)}
                            className="absolute top-2.5 right-2 opacity-0 group-hover:opacity-100 p-1.5 rounded-md hover:bg-red-500/10 text-text-secondary hover:text-red-500 transition-all"
                            title="Remove prompt"
                          >
                            <Trash size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Object Orientation popup */}
            {activePopup === 'object-rotate' && (
              <div
                className="absolute bottom-0 left-[280px] bg-white dark:bg-[#1a1a1a] border border-border-base rounded-[24px] w-[320px] shadow-2xl animate-scale-in origin-bottom-left"
                style={{ bottom: `${popupPosition.bottom}px`, left: `${popupPosition.left}px`, width: `320px` }}
              >
                <div className="flex justify-between items-center p-4 border-b border-border-base bg-surface/50">
                  <div className="flex items-center gap-2">
                    <RotateCcw size={16} className="text-brand" />
                    <span className="text-xs font-bold uppercase tracking-wider text-text-primary">Rotate Object</span>
                  </div>
                  <button onClick={() => setActivePopup(null)} className="p-1 rounded-full bg-surface hover:bg-black/10 dark:hover:bg-white/10 transition-colors"><X size={14} className="text-text-secondary" /></button>
                </div>

                <div className="p-4 flex flex-col gap-3">
                  <div className="text-[10px] text-text-secondary leading-relaxed bg-brand/5 p-2.5 rounded-xl border border-brand/10">
                    <span className="font-bold text-brand">Pro Tip:</span> Draw your mask slightly larger than the original object to give the AI room to rotate the corners!
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-1">
                    {OBJECT_ORIENTATION_OPTIONS.map(opt => {
                      // Resolve icon component dynamically for simplicity in UI map
                      const Icon = opt.icon === 'RotateCcw' ? RotateCcw :
                        opt.icon === 'RotateCw' ? RotateCw :
                          opt.icon === 'ArrowDown' ? ArrowDown :
                            opt.icon === 'ArrowUp' ? ArrowUp :
                              opt.icon === 'ArrowUpRight' ? ArrowUpRight :
                                ArrowDownRight;

                      const isActive = objectOrientation.action === opt.value;

                      return (
                        <button
                          key={opt.value}
                          onClick={() => setObjectOrientation({ action: isActive ? '' : opt.value })}
                          className={`flex items-center gap-3 px-3 py-3 rounded-xl text-xs font-semibold transition-all border
                              ${isActive ? 'bg-brand/20 border-brand/60 text-brand shadow-sm' : 'bg-surface border-transparent text-text-secondary hover:border-brand/30 hover:text-text-primary'}`}
                        >
                          <Icon size={16} />
                          <span>{opt.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ✨ Perspective popup */}
            {activePopup === 'perspective' && (
              <div
                className="absolute bottom-0 right-0 bg-white dark:bg-[#1a1a1a] border border-brand/30 rounded-[24px] shadow-2xl animate-scale-in origin-bottom-right overflow-hidden"
                style={{ width: 380 }}
                onMouseDown={e => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-border-base/50">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-brand/20 flex items-center justify-center">
                      <Box size={14} className="text-brand" />
                    </div>
                    <span className="text-sm font-bold text-text-primary">Camera Perspective</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setPerspective(DEFAULT_PERSPECTIVE)}
                      className="text-[10px] text-text-secondary hover:text-brand flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-brand/10 transition-all font-bold uppercase tracking-wide">
                      <RotateCcw size={10} /> Reset
                    </button>
                    <button onClick={() => setActivePopup(null)} className="p-1.5 hover:bg-surface rounded-lg transition-colors">
                      <X size={14} className="text-text-secondary" />
                    </button>
                  </div>
                </div>

                <div className="p-5 space-y-5">
                  {/* Cube + sliders */}
                  <div className="flex items-center gap-4">
                    <div
                      className="flex-shrink-0 cursor-grab active:cursor-grabbing select-none"
                      onMouseDown={e => {
                        e.preventDefault();
                        setIsDraggingCube(true);
                        setCubeDragStart({ x: e.clientX, y: e.clientY });
                        setCubeDragBase({ rotation: perspective.rotation, tilt: perspective.tilt });
                      }}
                      title="Drag to rotate"
                    >
                      <Cube3D rotation={perspective.rotation} tilt={perspective.tilt} />
                      <div className="text-[9px] text-text-secondary text-center mt-1 font-mono">drag to rotate</div>
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-text-secondary font-medium">Rotation</span>
                        <span className="font-mono text-brand bg-brand/10 px-2 py-0.5 rounded-md">{Math.round(perspective.rotation)}°</span>
                      </div>
                      <input type="range" min={-180} max={180} step={1} value={perspective.rotation}
                        onChange={e => setPerspective(prev => ({ ...prev, rotation: Number(e.target.value) }))}
                        className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-brand bg-surface" />
                      <div className="flex items-center justify-between text-xs mt-2">
                        <span className="text-text-secondary font-medium">Tilt</span>
                        <span className="font-mono text-brand bg-brand/10 px-2 py-0.5 rounded-md">{Math.round(perspective.tilt)}°</span>
                      </div>
                      <input type="range" min={-60} max={60} step={1} value={perspective.tilt}
                        onChange={e => setPerspective(prev => ({ ...prev, tilt: Number(e.target.value) }))}
                        className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-brand bg-surface" />
                    </div>
                  </div>

                  {/* Camera Angle presets */}
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-text-secondary mb-2.5">Camera Angle</div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {CAMERA_ANGLES.map(a => (
                        <button key={a.value}
                          onClick={() => setPerspective(prev => ({ ...prev, cameraAngle: prev.cameraAngle === a.value ? '' : a.value }))}
                          className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl text-[10px] font-semibold transition-all border
                            ${perspective.cameraAngle === a.value ? 'bg-brand/20 border-brand/60 text-brand shadow-sm' : 'bg-surface/50 border-transparent text-text-secondary hover:border-brand/30 hover:text-text-primary'}`}>
                          <span className="text-base leading-none">{a.icon}</span>
                          <span className="leading-tight text-center">{a.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Shot Distance presets */}
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-text-secondary mb-2.5">Shot Distance</div>
                    <div className="grid grid-cols-5 gap-1">
                      {SHOT_TYPES.map(s => (
                        <button key={s.value}
                          onClick={() => setPerspective(prev => ({ ...prev, shotType: prev.shotType === s.value ? '' : s.value }))}
                          className={`flex flex-col items-center gap-1 px-1 py-2 rounded-xl text-[9px] font-semibold transition-all border
                            ${perspective.shotType === s.value ? 'bg-brand/20 border-brand/60 text-brand shadow-sm' : 'bg-surface/50 border-transparent text-text-secondary hover:border-brand/30 hover:text-text-primary'}`}>
                          <span className="text-sm leading-none">{s.icon}</span>
                          <span className="leading-tight text-center whitespace-pre-line">{s.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Subject Facing Camera toggle */}
                  <div
                    className={`flex items-center justify-between px-4 py-3 rounded-xl border cursor-pointer transition-all
                      ${perspective.facingCamera ? 'bg-brand/15 border-brand/50' : 'bg-surface/50 border-border-base/50 hover:border-brand/30'}`}
                    onClick={() => setPerspective(prev => ({ ...prev, facingCamera: !prev.facingCamera }))}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${perspective.facingCamera ? 'bg-brand text-bg' : 'bg-surface text-text-secondary'}`}>
                        <Users size={15} />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-text-primary">Subject Facing Camera</div>
                        <div className="text-[10px] text-text-secondary mt-0.5">Fix sideways / profile orientation</div>
                      </div>
                    </div>
                    <div className={`w-10 h-5 rounded-full relative transition-all ${perspective.facingCamera ? 'bg-brand' : 'bg-surface border border-border-base'}`}>
                      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${perspective.facingCamera ? 'left-5' : 'left-0.5'}`} />
                    </div>
                  </div>

                  {/* Injection preview */}
                  {perspActive && (
                    <div className="bg-brand/5 border border-brand/20 rounded-xl px-4 py-3">
                      <div className="text-[9px] font-bold uppercase text-brand tracking-widest mb-1">Will be added to prompt →</div>
                      <div className="text-[10px] text-text-secondary font-mono leading-relaxed italic">"{perspText}"</div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Main bar ── */}
        <div ref={visualBarRef} className="relative bg-white/90 dark:bg-[#111]/90 backdrop-blur-2xl border border-zinc-200 dark:border-white/10 rounded-[28px] p-1.5 shadow-[0_20px_40px_-10px_rgba(0,0,0,0.08)] dark:shadow-[0_20px_40px_-10px_rgba(0,0,0,0.3)]">
          <div className="flex flex-col gap-1.5">

            {/* Top row: images + textarea + generate */}
            <div className="flex items-start px-1.5 pt-1 gap-2.5">
              <div className="flex items-center gap-2.5 mt-0.5 overflow-visible scrollbar-hide max-w-[220px] pt-1 pr-1">
                {inputImages.map((img, idx) => (
                  <div key={idx} className="relative group flex-shrink-0">
                    <div className="w-10 h-10 rounded-lg overflow-hidden border border-brand/40 shadow-sm bg-surface relative">
                      <img src={img} alt={`Input ${idx}`} className="w-full h-full object-cover" />
                      <div className="absolute top-0 right-0 bg-brand text-bg px-1 rounded-bl-lg text-[7px] font-black uppercase pointer-events-none">img {idx + 1}</div>
                    </div>
                    <button onClick={e => { e.stopPropagation(); setInputImages(prev => prev.filter((_, i) => i !== idx)); }}
                      className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg hover:scale-110 z-20">
                      <X size={8} />
                    </button>
                  </div>
                ))}
                {/* Hide image upload for text-to-image-only models (e.g. Reve) */}
                {config.model !== ModelType.REVE && (
                  <button onClick={() => fileInputRef.current?.click()}
                    className="w-10 h-10 rounded-full bg-surface border border-border-base flex items-center justify-center text-text-secondary hover:text-text-primary hover:border-brand transition-all flex-shrink-0 group"
                    title="Add Reference Image">
                    <Plus size={18} className="group-hover:scale-110 transition-transform" />
                  </button>
                )}
              </div>

              <textarea
                value={config.prompt}
                onChange={e => setConfig(prev => ({ ...prev, prompt: e.target.value }))}
                placeholder={inputImages.length > 0 ? "e.g. Combine elements from img 1 and img 2..." : "Imagine something extraordinary..."}
                className="flex-1 bg-transparent text-text-primary placeholder-text-secondary/50 outline-none px-1 py-1.5 h-12 resize-none text-sm font-medium leading-relaxed"
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); onGenerate(); } }}
              />

              <button
                onClick={handleSavePrompt}
                disabled={!config.prompt.trim()}
                className={`h-12 w-10 flex items-center justify-center rounded-xl transition-all flex-shrink-0 disabled:opacity-30
                  ${savedPrompts.includes(config.prompt.trim()) ? 'text-brand' : 'hover:bg-surface text-text-secondary hover:text-text-primary'}`}
                title={savedPrompts.includes(config.prompt.trim()) ? "Prompt Saved" : "Save Prompt to Library"}
              >
                <Bookmark size={18} fill={savedPrompts.includes(config.prompt.trim()) ? "currentColor" : "none"} />
              </button>

              <button
                onClick={() => setConfig(prev => ({ ...prev, harmonize: !prev.harmonize }))}
                className={`h-12 w-12 flex items-center justify-center rounded-xl transition-all ${config.harmonize ? 'bg-brand/20 text-brand border border-brand/50' : 'hover:bg-surface text-text-secondary border border-transparent'}`}
                title="Match Lighting & Harmonize (Beta)"
              >
                <Sun size={20} strokeWidth={config.harmonize ? 2.5 : 2} className={config.harmonize ? 'animate-pulse-slow' : ''} />
              </button>

              <div className="flex flex-col gap-1 items-end">
                <Button onClick={onGenerate} disabled={!config.prompt || isGenerating} variant="primary"
                  className={`h-10 px-5 rounded-lg font-bold transition-all ${isGenerating ? 'opacity-80' : 'hover:scale-105'}`}>
                  {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} fill="currentColor" />}
                  <span className="ml-2 uppercase tracking-wide text-[10px]">Generate</span>
                </Button>
                <span className="text-[8px] font-mono text-text-secondary uppercase opacity-50 mr-1">{currentModel.name}</span>
              </div>
            </div>

            {/* Bottom chip row */}
            <div className="flex items-center gap-2 bg-surface/50 rounded-[24px] p-1.5 overflow-x-auto scrollbar-hide">
              <button onClick={() => togglePopup('model')}
                className="h-9 pl-1 pr-3 rounded-full bg-panel border border-border-base flex items-center gap-2 hover:border-brand/50 transition-all group whitespace-nowrap">
                <div className="w-7 h-7 rounded-full bg-surface flex items-center justify-center text-brand group-hover:bg-brand group-hover:text-bg transition-colors">
                  <Zap size={14} fill="currentColor" />
                </div>
                <span className="text-xs font-bold text-text-primary tracking-tight">{currentModel.name}</span>
                <ChevronRight size={12} className="text-text-secondary" />
              </button>

              <div className="w-px h-5 bg-border-base mx-1" />

              {showAspectRatio && (
                <button onClick={() => togglePopup('aspect')}
                  className="h-8 px-3 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-text-secondary hover:text-text-primary text-xs font-medium flex items-center gap-2 transition-colors whitespace-nowrap">
                  {getRatioIcon(config.aspectRatio)} {config.aspectRatio}
                </button>
              )}

              {showQuality && (
                <button onClick={() => togglePopup('quality')}
                  className="h-8 px-3 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-text-secondary hover:text-text-primary text-xs font-medium flex items-center gap-2 transition-colors whitespace-nowrap">
                  <Gem size={14} className="text-brand" /> {config.quality}
                </button>
              )}

              {/* ControlBar Helper: Ensure perspActive works */}
              {/* Note: Object Rotate logic is handled independently by the `isObjectOrientationActive` helper */}

              {/* Perspective chip */}
              <button
                onClick={() => togglePopup('perspective')}
                className={`h-8 px-3 rounded-lg text-xs font-medium flex items-center gap-2 transition-all whitespace-nowrap relative border
                  ${activePopup === 'perspective' ? 'bg-brand/20 text-brand border-brand/50'
                    : perspActive ? 'text-brand border-brand/30 hover:bg-brand/10'
                      : 'hover:bg-black/5 dark:hover:bg-white/10 text-text-secondary hover:text-text-primary border-transparent'}`}
                title="Move the Camera"
              >
                <Camera size={14} />
                Camera Angle
                {perspActive && <span className="absolute -top-1 -right-1 w-2 h-2 bg-brand rounded-full shadow-lg shadow-brand/50" />}
              </button>

              {/* Object Rotation chip */}
              <button
                onClick={() => togglePopup('object-rotate')}
                className={`h-8 px-3 rounded-lg text-xs font-medium flex items-center gap-2 transition-all whitespace-nowrap relative border
                  ${activePopup === 'object-rotate' ? 'bg-brand/20 text-brand border-brand/50'
                    : isObjectOrientationActive(objectOrientation) ? 'text-brand border-brand/30 hover:bg-brand/10'
                      : 'hover:bg-black/5 dark:hover:bg-white/10 text-text-secondary hover:text-text-primary border-transparent'}`}
                title="Rotate the Selected Object"
              >
                <RotateCcw size={14} />
                Rotate Object
                {isObjectOrientationActive(objectOrientation) && <span className="absolute -top-1 -right-1 w-2 h-2 bg-brand rounded-full shadow-lg shadow-brand/50" />}
              </button>

              {/* Prompts Library chip */}
              <button
                onClick={() => togglePopup('prompts')}
                className={`h-8 px-3 rounded-lg text-xs font-medium flex items-center gap-2 transition-all whitespace-nowrap border
                  ${activePopup === 'prompts' ? 'bg-surface text-text-primary border-border-base'
                    : 'hover:bg-black/5 dark:hover:bg-white/10 text-text-secondary hover:text-text-primary border-transparent'}`}
              >
                <Bookmark size={14} className={savedPrompts.length > 0 ? "text-brand" : ""} />
                Prompts {savedPrompts.length > 0 && <span className="bg-brand/10 text-brand px-1.5 rounded-full text-[10px] ml-1">{savedPrompts.length}</span>}
              </button>

              <div className="w-px h-5 bg-border-base mx-1" />

              {/* Brand Context Injector Chip */}
              {onSwitchBrand && (
                <button
                  onClick={() => togglePopup('brand')}
                  className={`h-8 px-3 rounded-lg text-xs font-bold flex items-center gap-2 transition-all whitespace-nowrap border relative
                    ${activePopup === 'brand' ? 'bg-brand/20 text-brand border-brand/50'
                      : activeBrandId ? 'bg-brand/10 text-brand border-brand/30 hover:border-brand/60'
                        : 'hover:bg-black/5 dark:hover:bg-white/10 text-text-secondary hover:text-text-primary border-transparent'}`}
                  title="Inject Brand DNA"
                >
                  <Sparkles size={14} className={activeBrandId ? "animate-pulse-slow" : ""} />
                  <span className="max-w-[100px] truncate">
                    {activeBrandId ? brands.find(b => b.id === activeBrandId)?.name || 'Brand Active' : 'No Brand'}
                  </span>
                  {activeBrandId && <span className="absolute -top-1 -right-1 w-2 h-2 bg-brand rounded-full shadow-lg shadow-brand/50" />}
                </button>
              )}

              {/* Character selector chip */}
              {characters.length > 0 && (
                <button
                  onClick={() => togglePopup('character')}
                  className={`h-8 px-3 rounded-lg text-xs font-bold flex items-center gap-2 transition-all whitespace-nowrap border relative
                    ${activePopup === 'character' ? 'bg-violet-500/20 text-violet-400 border-violet-500/50'
                      : selectedCharacterId ? 'bg-violet-500/10 text-violet-400 border-violet-500/30 hover:border-violet-500/60'
                        : 'hover:bg-black/5 dark:hover:bg-white/10 text-text-secondary hover:text-text-primary border-transparent'}`}
                  title="Select Character"
                >
                  <Users size={14} />
                  <span className="max-w-[80px] truncate">
                    {selectedCharacterId ? characters.find(c => c.id === selectedCharacterId)?.name || 'Character' : 'Character'}
                  </span>
                  {selectedCharacterId && <span className="absolute -top-1 -right-1 w-2 h-2 bg-violet-400 rounded-full shadow-lg shadow-violet-400/50" />}
                </button>
              )}

              {/* Product selector chip */}
              {activeBrandProducts.length > 0 && (
                <button
                  onClick={() => togglePopup('product')}
                  className={`h-8 px-3 rounded-lg text-xs font-bold flex items-center gap-2 transition-all whitespace-nowrap border relative
                    ${activePopup === 'product' ? 'bg-amber-500/20 text-amber-400 border-amber-500/50'
                      : selectedProductId ? 'bg-amber-500/10 text-amber-400 border-amber-500/30 hover:border-amber-500/60'
                        : 'hover:bg-black/5 dark:hover:bg-white/10 text-text-secondary hover:text-text-primary border-transparent'}`}
                  title="Select Product"
                >
                  📦
                  <span className="max-w-[80px] truncate">
                    {selectedProductId ? activeBrandProducts.find((p: any) => p.id === selectedProductId)?.name || 'Product' : 'Product'}
                  </span>
                  {selectedProductId && <span className="absolute -top-1 -right-1 w-2 h-2 bg-amber-400 rounded-full shadow-lg shadow-amber-400/50" />}
                </button>
              )}

              {showBatchSize && (
                <div className="ml-auto flex items-center bg-panel rounded-lg border border-border-base h-8 px-1">
                  <button onClick={() => setConfig(prev => ({ ...prev, batchSize: Math.max(1, prev.batchSize - 1) }))} className="w-6 h-full flex items-center justify-center text-text-secondary hover:text-text-primary">-</button>
                  <span className="text-xs font-mono font-medium text-text-primary w-6 text-center">{config.batchSize}</span>
                  <button onClick={() => setConfig(prev => ({ ...prev, batchSize: Math.min(maxBatch, prev.batchSize + 1) }))} className="w-6 h-full flex items-center justify-center text-text-secondary hover:text-text-primary">+</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
