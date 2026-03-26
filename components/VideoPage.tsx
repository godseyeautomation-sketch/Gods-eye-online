
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
    Image as ImageIcon,
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
    Plus,
    Type,
    RefreshCw,
    AlertCircle,
    FolderSync
} from 'lucide-react';
import { VIDEO_MODELS, VIDEO_GEN_MODES, ASPECT_RATIOS } from '../constants';
import { generateVideo } from '../services/geminiService';
import { useAuth } from '../context/AuthContext';

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
    const { user } = useAuth();
    const [prompt, setPrompt] = useState('');
    const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isRatioMenuOpen, setIsRatioMenuOpen] = useState(false);

    const [selectedMode, setSelectedMode] = useState(VIDEO_GEN_MODES[0]);
    const [selectedModel, setSelectedModel] = useState(VIDEO_MODELS[0]);
    const [selectedRatio, setSelectedRatio] = useState(ASPECT_RATIOS[1]); // Default Portrait
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

    const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
    const [isScanning, setIsScanning] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const imageRefs = useRef<Map<string, HTMLImageElement>>(new Map());
    const folderInputRef = useRef<HTMLInputElement>(null);

    const modeMenuRef = useRef<HTMLDivElement>(null);
    const settingsRef = useRef<HTMLDivElement>(null);
    const ratioMenuRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const endInputRef = useRef<HTMLInputElement>(null);
    const ingredientInputRef = useRef<HTMLInputElement>(null);
    const inputContainerRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to inputs when mode changes
    useEffect(() => {
        if (selectedMode.id !== 'text-to-video' && inputContainerRef.current) {
            inputContainerRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [selectedMode]);
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

    const handleImageError = (imageId: string) => {
        setFailedImages(prev => new Set(prev).add(imageId));
    };

    const handleImageLoad = (imageId: string) => {
        setFailedImages(prev => {
            const newSet = new Set(prev);
            newSet.delete(imageId);
            return newSet;
        });
    };

    const handleAutoScan = async () => {
        if (failedImages.size === 0) return;
        
        setIsScanning(true);
        const failedIds = Array.from(failedImages);
        
        // Retry loading each failed image
        for (const imageId of failedIds) {
            const imgElement = imageRefs.current.get(imageId);
            if (imgElement) {
                const currentSrc = imgElement.src;
                imgElement.src = '';
                await new Promise(resolve => setTimeout(resolve, 100));
                imgElement.src = currentSrc + (currentSrc.includes('?') ? '&' : '?') + `_retry=${Date.now()}`;
            }
        }
        
        setTimeout(() => {
            setIsScanning(false);
        }, 2000);
    };

    const handleFolderSync = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.length || !user) return;
        
        setIsSyncing(true);
        const { saveToLocalGallery } = await import('../services/localStorageService');
        
        // Filter for video files
        const files = Array.from(e.target.files).filter(f =>
            f.name.toLowerCase().includes('gods') && (f.type.startsWith('video/') || f.type.startsWith('image/'))
        );

        if (files.length === 0) {
            alert("No 'Gods Eye' videos/images found in that folder.");
            setIsSyncing(false);
            return;
        }

        let count = 0;
        for (const file of files) {
            const reader = new FileReader();
            reader.onload = async (ev) => {
                const b64 = ev.target?.result as string;
                await saveToLocalGallery(
                    b64,
                    file.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' '),
                    '16:9',
                    'Imported',
                    user.id
                );
                count++;
                if (count === files.length) {
                    setIsSyncing(false);
                    alert(`Imported ${count} files! Refresh the page to see them.`);
                }
            };
            reader.readAsDataURL(file);
        }
    };

    const hasNoVisibleVideos = history.length === 0 && !generatedVideoUrl;

    return (
        <div className="flex flex-col h-full overflow-hidden font-sans relative w-full bg-bg text-text-primary pt-40">
            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileSelect} />

            {/* Folder Sync Button - Shows when no videos are visible */}
            {hasNoVisibleVideos && (
                <div className="fixed top-28 right-6 z-[9999] animate-slide-in">
                    <label 
                        htmlFor="video-folder-sync"
                        className="cursor-pointer flex items-center gap-2 px-4 py-2.5 bg-brand text-bg rounded-xl font-bold text-sm shadow-2xl transition-all hover:scale-105 active:scale-95 border-2 border-brand/20"
                    >
                        {isSyncing ? (
                            <>
                                <RefreshCw size={16} className="animate-spin" />
                                <span>Syncing...</span>
                            </>
                        ) : (
                            <>
                                <FolderSync size={16} />
                                <span>Sync Folder</span>
                            </>
                        )}
                    </label>
                    <input
                        id="video-folder-sync"
                        ref={folderInputRef}
                        type="file"
                        {...{ webkitdirectory: "", directory: "" } as any}
                        className="hidden"
                        onChange={handleFolderSync}
                        disabled={isSyncing}
                    />
                </div>
            )}

            {/* Auto Scan Button - Shows when images fail to load */}
            {failedImages.size > 0 && !hasNoVisibleVideos && (
                <div className="fixed top-24 right-6 z-50 animate-slide-in">
                    <button
                        onClick={handleAutoScan}
                        disabled={isScanning}
                        className="flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold text-sm shadow-lg transition-all hover:scale-105 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {isScanning ? (
                            <>
                                <RefreshCw size={16} className="animate-spin" />
                                <span>Scanning...</span>
                            </>
                        ) : (
                            <>
                                <AlertCircle size={16} />
                                <span>Auto Scan ({failedImages.size})</span>
                            </>
                        )}
                    </button>
                </div>
            )}

            {/* Top Header Section - Videos Only */}
            <div className="flex items-center justify-between px-6 py-3 bg-panel/50 backdrop-blur-md z-40">
                <div className="flex gap-1 bg-surface/50 p-0.5 rounded-lg">
                    <button className="flex items-center gap-2 px-3 py-1 rounded-md bg-white dark:bg-surface text-[10px] font-bold text-text-primary shadow-sm">
                        <Film size={12} /> Videos
                    </button>
                </div>

                <div className="flex-1 max-w-lg mx-6 relative group flex items-center bg-black/10 dark:bg-white/10 border border-brand/50 hover:border-brand rounded-lg px-3 py-2 transition-all focus-within:ring-1 focus-within:ring-brand">
                    <Search size={14} className="text-text-secondary/70 group-focus-within:text-brand transition-colors mr-3" />
                    <input
                        type="text"
                        placeholder="Search for a clip"
                        className="w-full bg-transparent border-none p-0 text-[11px] font-medium focus:outline-none focus:ring-0 text-text-primary placeholder:text-text-secondary"
                    />
                </div>

                <div className="flex items-center gap-2">
                    <button className="p-2 bg-surface/50 rounded-lg text-text-secondary hover:text-text-primary transition-all"><Grid size={16} /></button>
                    <button className="p-2 bg-surface/50 rounded-lg text-text-secondary hover:text-text-primary transition-all"><List size={16} /></button>
                    <button className="p-2 bg-surface/50 rounded-lg text-text-secondary hover:text-text-primary transition-all"><Heart size={16} /></button>
                </div>
            </div>

            {/* Main Preview / Empty State */}
            <div className="flex-1 relative flex items-center justify-center p-6 overflow-hidden">
                <div className="w-full max-w-5xl h-full flex flex-col items-center justify-center relative">
                    {isGenerating ? (
                        <div className="flex flex-col items-center animate-fade-in">
                            <div className="w-16 h-16 rounded-full border-2 border-brand border-t-transparent animate-spin mb-6"></div>
                            <h3 className="text-xl font-black uppercase tracking-[0.15em] mb-1.5">Creating Video</h3>
                            <p className="text-text-secondary/70 text-xs font-medium">Veo 3.1 is imagining your request...</p>
                        </div>
                    ) : generatedVideoUrl ? (
                        <div className="relative h-full w-full max-w-[360px] flex items-center justify-center group shadow-[0_40px_100px_rgba(0,0,0,0.8)] rounded-2xl overflow-hidden border border-border-base">
                            <video src={generatedVideoUrl} autoPlay loop className="h-full w-auto object-cover" />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <div className="flex gap-3">
                                    <button onClick={() => window.open(generatedVideoUrl)} className="w-12 h-12 bg-brand text-bg rounded-full flex items-center justify-center shadow-2xl hover:scale-110 transition-all"><Maximize2 size={20} /></button>
                                    <button onClick={() => setGeneratedVideoUrl(null)} className="w-12 h-12 bg-red-600 text-white rounded-full flex items-center justify-center shadow-2xl hover:scale-110 transition-all"><X size={20} /></button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center opacity-20">
                            <h1 className="text-xl font-medium text-text-secondary">Type in the prompt box to start</h1>
                        </div>
                    )}
                </div>
            </div>

            {/* Floating Settings & Prompt Bar - Matches Screen 2-5 */}
            <div className="w-full flex justify-center pb-10 px-6 z-50">
                <div className="w-full max-w-3xl relative">

                    {/* Settings Popup - Matches Screen 5 */}
                    {isSettingsOpen && (
                        <div
                            ref={settingsRef}
                            className="absolute bottom-full mb-4 right-0 w-[380px] bg-panel border border-border rounded-[24px] p-5 shadow-[0_30px_90px_rgba(0,0,0,0.2)] dark:shadow-[0_30px_90px_rgba(0,0,0,0.8)] animate-scale-in origin-bottom-right z-50"
                        >
                            <div className="space-y-5">
                                <div className="space-y-1.5 relative">
                                    <label className="text-[10px] text-text-secondary/70 font-bold uppercase tracking-wide">Aspect Ratio</label>
                                    <button
                                        onClick={() => setIsRatioMenuOpen(!isRatioMenuOpen)}
                                        className="w-full flex items-center justify-between bg-panel border border-border-base rounded-lg px-3.5 py-2.5 text-xs font-bold text-text-primary"
                                    >
                                        <div className="flex items-center gap-2.5">
                                            {selectedRatio.value === '16:9' ? <Monitor size={14} /> : <Smartphone size={14} />}
                                            {selectedRatio.label}
                                        </div>
                                        <ChevronDown size={14} className="text-text-secondary/70" />
                                    </button>

                                    {/* Ratio Selection Dropdown - Matches Screen 3 */}
                                    {isRatioMenuOpen && (
                                        <div ref={ratioMenuRef} className="absolute top-full left-0 w-full mt-2 bg-panel border border-border-base rounded-lg overflow-hidden shadow-2xl z-[60]">
                                            {ASPECT_RATIOS.map(r => (
                                                <button
                                                    key={r.value}
                                                    onClick={() => { setSelectedRatio(r); setIsRatioMenuOpen(false); }}
                                                    className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-bold transition-all ${selectedRatio.value === r.value ? 'bg-surface text-white' : 'text-text-secondary hover:bg-surface'}`}
                                                >
                                                    {r.value === '16:9' ? <Monitor size={14} /> : <Smartphone size={14} />}
                                                    {r.label}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="space-y-1.5">
                                    <label className="text-[10px] text-text-secondary/70 font-bold uppercase tracking-wide">Outputs per prompt</label>
                                    <select
                                        value={outputsPerPrompt}
                                        onChange={(e) => setOutputsPerPrompt(Number(e.target.value))}
                                        className="w-full bg-panel border border-border-base rounded-lg px-3.5 py-2.5 text-xs font-bold text-text-primary appearance-none outline-none"
                                    >
                                        <option value={1}>1</option>
                                        <option value={2}>2</option>
                                        <option value={4}>4</option>
                                    </select>
                                </div>

                                <div className="space-y-1.5">
                                    <label className="text-[10px] text-text-secondary/70 font-bold uppercase tracking-wide">Model</label>
                                    <select
                                        value={selectedModel.id}
                                        onChange={(e) => setSelectedModel(VIDEO_MODELS.find(m => m.id === e.target.value) || VIDEO_MODELS[0])}
                                        className="w-full bg-panel border border-border-base rounded-lg px-3.5 py-2.5 text-xs font-bold text-text-primary appearance-none outline-none"
                                    >
                                        {VIDEO_MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                    </select>
                                </div>

                                <div className="pt-3 border-t border-border-base flex items-center justify-between">
                                    <span className="text-[10px] text-text-secondary/70 font-medium italic">Each generation uses <span className="text-white font-bold underline">20 credits</span></span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Stacked Control Bar Layout */}
                    <div className="relative bg-panel/90 backdrop-blur-2xl border border-border-base rounded-[24px] p-4 shadow-2xl transition-all">

                        {/* 1. Header Row: Controls */}
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                {/* Mode Selector */}
                                <div className="relative" ref={modeMenuRef as any}>
                                    <button
                                        onClick={() => setIsModeMenuOpen(!isModeMenuOpen)}
                                        className={`h-8 px-3 rounded-lg border flex items-center gap-2 transition-all group whitespace-nowrap ${isModeMenuOpen ? 'bg-surface border-brand' : 'bg-panel border-border-base hover:border-brand/50'}`}
                                    >
                                        <div className="w-5 h-5 rounded-full bg-black/5 dark:bg-white/5 flex items-center justify-center text-brand group-hover:bg-brand group-hover:text-bg transition-colors">
                                            {selectedMode.icon === 'Type' ? <Type size={10} /> :
                                                selectedMode.icon === 'Image' ? <ImageIcon size={10} /> :
                                                    selectedMode.icon === 'Layers' ? <Layers size={10} /> :
                                                        <Sparkles size={10} fill="currentColor" />}
                                        </div>
                                        <span className="text-[10px] font-bold text-text-primary tracking-wide uppercase">{selectedMode.label}</span>
                                        <ChevronDown size={10} className="text-text-secondary/70" />
                                    </button>

                                    {isModeMenuOpen && (
                                        <div 
                                            className="absolute top-full left-0 mt-2 bg-panel border border-border-base rounded-xl overflow-hidden shadow-xl z-50 min-w-[200px] animate-in fade-in slide-in-from-top-2"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <div className="p-1.5 space-y-0.5">
                                                {VIDEO_GEN_MODES.map((mode) => (
                                                    <button
                                                        key={mode.id}
                                                        onClick={(e) => { 
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            setSelectedMode(mode); 
                                                            setIsModeMenuOpen(false); 
                                                        }}
                                                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs transition-colors ${selectedMode.id === mode.id ? 'bg-brand/10 text-brand font-bold' : 'text-text-secondary hover:bg-black/5 dark:hover:bg-white/5 hover:text-text-primary'}`}
                                                    >
                                                        {mode.icon === 'Type' ? <Type size={12} /> :
                                                            mode.icon === 'Image' ? <ImageIcon size={12} /> :
                                                                mode.icon === 'Layers' ? <Layers size={12} /> :
                                                                    <Sparkles size={12} />}
                                                        {mode.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Ratio Selector */}
                                <div className="relative">
                                    <button
                                        ref={ratioMenuRef as any}
                                        onClick={() => setIsRatioMenuOpen(!isRatioMenuOpen)}
                                        className={`h-8 px-3 rounded-lg border flex items-center gap-2 transition-all whitespace-nowrap ${isRatioMenuOpen ? 'bg-surface border-brand' : 'bg-panel border-border-base hover:border-brand/50'}`}
                                    >
                                        <div className="w-5 h-5 rounded-full bg-black/5 dark:bg-white/5 flex items-center justify-center text-neutral-300">
                                            {selectedRatio.value === '16:9' ? <Monitor size={10} /> : <Smartphone size={10} />}
                                        </div>
                                        <span className="text-[10px] font-bold text-text-primary tracking-wide">{selectedRatio.label}</span>
                                    </button>

                                    {isRatioMenuOpen && (
                                        <div className="absolute top-full left-0 mt-2 bg-panel border border-border-base rounded-xl overflow-hidden shadow-xl z-50 min-w-[160px] animate-in fade-in slide-in-from-top-2">
                                            <div className="p-1.5 space-y-0.5">
                                                {ASPECT_RATIOS.map((ratio) => (
                                                    <button
                                                        key={ratio.value}
                                                        onClick={() => { setSelectedRatio(ratio); setIsRatioMenuOpen(false); }}
                                                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs transition-colors ${selectedRatio.value === ratio.value ? 'bg-brand/10 text-brand font-bold' : 'text-text-secondary hover:bg-black/5 dark:hover:bg-white/5 hover:text-text-primary'}`}
                                                    >
                                                        {ratio.value === '16:9' ? <Monitor size={12} /> : <Smartphone size={12} />}
                                                        {ratio.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Settings / Model */}
                            <div className="relative">
                                <button
                                    ref={settingsRef as any}
                                    onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                                    className={`h-8 px-3 rounded-lg border flex items-center gap-2 transition-all whitespace-nowrap ${isSettingsOpen ? 'bg-surface border-brand' : 'bg-panel border-border-base hover:border-brand/50'}`}
                                >
                                    <div className="w-5 h-5 rounded-full bg-black/5 dark:bg-white/5 flex items-center justify-center text-neutral-300">
                                        <Settings2 size={10} />
                                    </div>
                                    <span className="text-[10px] font-bold text-text-primary tracking-wide">{selectedModel.name}</span>
                                </button>

                                {isSettingsOpen && (
                                    <div className="absolute bottom-full right-0 mb-2 bg-panel border border-border-base rounded-xl overflow-hidden shadow-xl z-50 min-w-[220px] animate-in fade-in slide-in-from-bottom-2">
                                        <div className="p-3 space-y-4">
                                            <div className="space-y-2">
                                                <label className="text-[10px] uppercase font-bold text-text-secondary/70 tracking-wider">Model</label>
                                                <div className="space-y-1">
                                                    {VIDEO_MODELS.map((model) => (
                                                        <button
                                                            key={model.id}
                                                            onClick={() => { setSelectedModel(model); setIsSettingsOpen(false); }}
                                                            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors ${selectedModel.id === model.id ? 'bg-brand/10 text-brand font-bold' : 'text-text-secondary hover:bg-black/5 dark:hover:bg-white/5 hover:text-text-primary'}`}
                                                        >
                                                            {model.name}
                                                            {selectedModel.id === model.id && <Sparkles size={10} />}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="space-y-2 pt-2 border-t border-border-base">
                                                <label className="text-[10px] uppercase font-bold text-text-secondary/70 tracking-wider">Outputs: {outputsPerPrompt}</label>
                                                <input
                                                    type="range"
                                                    min="1" max="4"
                                                    value={outputsPerPrompt}
                                                    onChange={(e) => setOutputsPerPrompt(Number(e.target.value))}
                                                    className="w-full h-1 bg-black/10 dark:bg-white/10 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-brand [&::-webkit-slider-thumb]:rounded-full"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>


                        {/* 1.5. Input Slots for Specific Modes */}
                        <div ref={inputContainerRef}>
                            {selectedMode.id === 'frames-to-video' && (
                                <div className="flex gap-4 mb-4">
                                    <div className="flex-1 space-y-2">
                                        <label className="text-[10px] font-bold text-text-secondary/70 uppercase tracking-wider">Start Frame</label>
                                        <div
                                            onClick={() => triggerUpload('start')}
                                            className={`h-32 rounded-xl border-2 border-dashed border-border-base hover:border-brand/50 bg-surface hover:bg-panel transition-all flex flex-col items-center justify-center cursor-pointer overflow-hidden relative group ${startImage ? 'border-solid border-brand/20' : ''}`}
                                        >
                                            {startImage ? (
                                                <>
                                                    <img 
                                                        ref={(el) => {
                                                            if (el) imageRefs.current.set('start-image', el);
                                                            else imageRefs.current.delete('start-image');
                                                        }}
                                                        src={startImage} 
                                                        alt="Start" 
                                                        className={`w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity ${failedImages.has('start-image') ? 'opacity-30' : ''}`}
                                                        onError={() => handleImageError('start-image')}
                                                        onLoad={() => handleImageLoad('start-image')}
                                                    />
                                                    {failedImages.has('start-image') && (
                                                        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                                                            <AlertCircle size={16} className="text-red-500" />
                                                        </div>
                                                    )}
                                                    <div className="absolute top-2 right-2 bg-black/50 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80" onClick={(e) => { e.stopPropagation(); setStartImage(null); setFailedImages(prev => { const newSet = new Set(prev); newSet.delete('start-image'); return newSet; }); }}>
                                                        <X size={12} className="text-white" />
                                                    </div>
                                                </>
                                            ) : (
                                                <div className="flex flex-col items-center gap-2 text-text-secondary/70 group-hover:text-brand">
                                                    <ImageIcon size={20} />
                                                    <span className="text-[10px] font-bold uppercase">Upload Start</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex-1 space-y-2">
                                        <label className="text-[10px] font-bold text-text-secondary/70 uppercase tracking-wider">End Frame (Optional)</label>
                                        <div
                                            onClick={() => triggerUpload('end')}
                                            className={`h-32 rounded-xl border-2 border-dashed border-border-base hover:border-brand/50 bg-surface hover:bg-panel transition-all flex flex-col items-center justify-center cursor-pointer overflow-hidden relative group ${endImage ? 'border-solid border-brand/20' : ''}`}
                                        >
                                            {endImage ? (
                                                <>
                                                    <img 
                                                        ref={(el) => {
                                                            if (el) imageRefs.current.set('end-image', el);
                                                            else imageRefs.current.delete('end-image');
                                                        }}
                                                        src={endImage} 
                                                        alt="End" 
                                                        className={`w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity ${failedImages.has('end-image') ? 'opacity-30' : ''}`}
                                                        onError={() => handleImageError('end-image')}
                                                        onLoad={() => handleImageLoad('end-image')}
                                                    />
                                                    {failedImages.has('end-image') && (
                                                        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                                                            <AlertCircle size={16} className="text-red-500" />
                                                        </div>
                                                    )}
                                                    <div className="absolute top-2 right-2 bg-black/50 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80" onClick={(e) => { e.stopPropagation(); setEndImage(null); setFailedImages(prev => { const newSet = new Set(prev); newSet.delete('end-image'); return newSet; }); }}>
                                                        <X size={12} className="text-white" />
                                                    </div>
                                                </>
                                            ) : (
                                                <div className="flex flex-col items-center gap-2 text-text-secondary/70 group-hover:text-brand">
                                                    <ImageIcon size={20} />
                                                    <span className="text-[10px] font-bold uppercase">Upload End</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {selectedMode.id === 'ingredients-to-video' && (
                                <div className="flex gap-4 mb-4 overflow-x-auto pb-2">
                                    {ingredients.map((img, idx) => {
                                        const ingredientId = `ingredient-${idx}`;
                                        const hasFailed = failedImages.has(ingredientId);
                                        return (
                                            <div key={idx} className="relative w-24 h-24 rounded-xl overflow-hidden border border-border-base flex-shrink-0 group">
                                                <img 
                                                    ref={(el) => {
                                                        if (el) imageRefs.current.set(ingredientId, el);
                                                        else imageRefs.current.delete(ingredientId);
                                                    }}
                                                    src={img} 
                                                    alt={`Ingredient ${idx}`} 
                                                    className={`w-full h-full object-cover ${hasFailed ? 'opacity-30' : ''}`}
                                                    onError={() => handleImageError(ingredientId)}
                                                    onLoad={() => handleImageLoad(ingredientId)}
                                                />
                                                {hasFailed && (
                                                    <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                                                        <AlertCircle size={12} className="text-red-500" />
                                                    </div>
                                                )}
                                                <div className="absolute top-1 right-1 bg-black/60 p-1 rounded-md cursor-pointer hover:bg-red-600 transition-colors opacity-0 group-hover:opacity-100" onClick={() => {
                                                    setIngredients(prev => prev.filter((_, i) => i !== idx));
                                                    setFailedImages(prev => { const newSet = new Set(prev); newSet.delete(ingredientId); return newSet; });
                                                }}>
                                                    <X size={10} className="text-white" />
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {ingredients.length < 5 && (
                                        <div
                                            onClick={() => triggerUpload('ingredient')}
                                            className="w-24 h-24 rounded-xl border-2 border-dashed border-border-base hover:border-brand/50 bg-surface hover:bg-panel transition-all flex flex-col items-center justify-center cursor-pointer flex-shrink-0 group"
                                        >
                                            <div className="flex flex-col items-center gap-1.5 text-text-secondary/70 group-hover:text-brand">
                                                <Plus size={16} />
                                                <span className="text-[9px] font-bold uppercase text-center leading-tight">Add<br />Ingredient</span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* 2. Middle Row: Prompt Input */}
                        </div>

                        <div className="relative">
                            <textarea
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                placeholder="Describe the video you want to generate..."
                                className="w-full bg-surface border border-border-base rounded-xl text-text-primary placeholder-text-secondary/40 outline-none px-4 py-3 h-24 resize-none text-sm font-medium leading-relaxed focus:border-brand/40 transition-colors"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleGenerate();
                                    }
                                }}
                            />
                        </div>

                        {/* 3. Footer Row: Generate Action */}
                        <div className="flex items-center justify-end gap-3 mt-3 pt-3 border-t border-border-base">
                            <span className="text-[10px] font-mono text-text-secondary/70 uppercase tracking-widest opacity-60">Veo 3.1 - Fast</span>
                            <button
                                onClick={handleGenerate}
                                disabled={!prompt || isGenerating}
                                className={`h-10 pl-5 pr-4 rounded-xl font-bold bg-brand text-black transition-all flex items-center gap-2 ${isGenerating ? 'opacity-80' : 'hover:scale-[1.02] active:scale-[0.98] hover:shadow-[0_0_20px_rgba(202,255,0,0.3)]'}`}
                            >
                                {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} fill="currentColor" />}
                                <span className="text-xs uppercase tracking-wider">Generate</span>
                                <ArrowRight size={14} className="ml-1 opacity-60" />
                            </button>
                        </div>
                    </div>
                </div>
                {/* Error Toast */}
                {error && (
                    <div className="fixed bottom-36 left-1/2 -translate-x-1/2 bg-red-600 text-white px-6 py-3 rounded-full text-xs font-bold shadow-2xl flex items-center gap-3 animate-slide-up z-[70]">
                        <X size={14} className="cursor-pointer" onClick={() => setError(null)} />
                        {error}
                    </div>
                )}
            </div>
        </div>
    );
};
