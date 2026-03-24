import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ArrowLeft, Clapperboard, UploadCloud, Loader2, Sparkles, Wand2,
  Download, Play, Pause, CheckCircle2, Film, RotateCcw, Target,
  X, MonitorPlay, Video, Pencil, RefreshCw, Save, ImageIcon,
  Plus, Trash2, FileText, Package
} from 'lucide-react';
import { useReelStudio, StoryFrame, ReelIngredient } from '../../context/ReelStudioContext';
import { useAuth } from '../../context/AuthContext';

/* ═══ Reel Player — phone-frame preview ═══════════════════════════════ */
const ReelPlayer: React.FC<{ onDownload: (frame: StoryFrame) => void }> = ({ onDownload }) => {
  const { storyboard, isPlaying, setIsPlaying, aspectRatio, activeFrameIndex, setActiveFrameIndex } = useReelStudio();
  const readyFrames = storyboard.filter(f => f.status === 'done' && f.imageUrl);

  // Map activeFrameIndex (storyboard index) to readyFrames index
  const activeFrame = storyboard[activeFrameIndex];
  const readyIndex = activeFrame ? readyFrames.findIndex(f => f.id === activeFrame.id) : 0;
  const displayIndex = readyIndex >= 0 ? readyIndex : 0;

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isPlaying && readyFrames.length > 0) {
      interval = setInterval(() => {
        // Advance to next ready frame by finding next storyboard index with a done frame
        const nextReadyIdx = (displayIndex + 1) % readyFrames.length;
        const nextFrame = readyFrames[nextReadyIdx];
        const storyIdx = storyboard.findIndex(f => f.id === nextFrame.id);
        if (storyIdx >= 0) setActiveFrameIndex(storyIdx);
      }, 1200);
    }
    return () => clearInterval(interval);
  }, [isPlaying, readyFrames.length, displayIndex, storyboard, readyFrames, setActiveFrameIndex]);

  if (readyFrames.length === 0) return null;
  const frame = readyFrames[displayIndex];

  return (
    <div className={`relative group bg-black rounded-3xl border-[8px] border-white/[0.06] shadow-2xl overflow-hidden transition-all duration-500 ${
      aspectRatio.value === '9:16' ? 'w-full max-w-xs aspect-[9/16]' :
      aspectRatio.value === '1:1' ? 'w-full max-w-sm aspect-square' :
      'w-full max-w-xl aspect-[16/9]'
    }`}>
      <img key={frame.id} src={frame.imageUrl!} alt={frame.title} className="w-full h-full object-cover animate-[fadeIn_0.4s_ease]" />

      {/* Download button — always visible top-right */}
      <button
        onClick={e => { e.stopPropagation(); onDownload(frame); }}
        className="absolute top-3 right-3 z-30 w-8 h-8 rounded-lg bg-black/60 backdrop-blur-sm flex items-center justify-center text-white/70 hover:text-white hover:bg-black/80 transition-all border border-white/10"
        title="Download this frame"
      >
        <Download size={14} />
      </button>

      {/* Progress bar */}
      <div className="absolute bottom-8 left-0 right-0 px-5 z-20 flex flex-col gap-1.5">
        <div className="flex gap-1">
          {readyFrames.map((rf, i) => (
            <button
              key={i}
              onClick={e => {
                e.stopPropagation();
                const storyIdx = storyboard.findIndex(f => f.id === rf.id);
                if (storyIdx >= 0) { setActiveFrameIndex(storyIdx); setIsPlaying(false); }
              }}
              className="flex-1 h-[3px] rounded-full overflow-hidden bg-white/20 cursor-pointer"
            >
              <div className="h-full bg-[#c8ff00] transition-all duration-300" style={{ width: i <= displayIndex ? '100%' : '0%' }} />
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <p className="text-[9px] font-black uppercase tracking-widest text-white/80 drop-shadow-md">{frame.title}</p>
          <span className="text-[9px] font-mono text-white/40">{String(displayIndex + 1).padStart(2, '0')} / {String(readyFrames.length).padStart(2, '0')}</span>
        </div>
      </div>

      {/* Play/Pause overlay */}
      <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => setIsPlaying(!isPlaying)} className="w-14 h-14 rounded-full bg-[#c8ff00] text-black flex items-center justify-center shadow-lg hover:scale-110 transition-transform">
          {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-0.5" />}
        </button>
      </div>
    </div>
  );
};

/* ═══ Frame Script Editor — inline edit prompt per frame ═══════════════ */
const FrameScriptEditor: React.FC<{ frame: StoryFrame; onClose: () => void }> = ({ frame, onClose }) => {
  const { updateFramePrompt, regenerateFrame, isRegenerating } = useReelStudio();
  const [localPrompt, setLocalPrompt] = useState(frame.prompt);
  const isThisRegenerating = isRegenerating === frame.id;

  const handleSave = () => {
    updateFramePrompt(frame.id, localPrompt);
  };

  const handleRegenerate = async () => {
    updateFramePrompt(frame.id, localPrompt);
    await regenerateFrame(frame.id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#111] border border-white/10 rounded-2xl w-full max-w-lg mx-4 p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Pencil size={14} className="text-[#c8ff00]" />
            Edit Frame: {frame.title}
          </h3>
          <button onClick={onClose} className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center text-white/40 hover:text-white">
            <X size={14} />
          </button>
        </div>

        {/* Frame preview */}
        {frame.imageUrl && (
          <div className="aspect-video rounded-xl overflow-hidden border border-white/[0.06]">
            <img src={frame.imageUrl} className="w-full h-full object-cover" alt={frame.title} />
          </div>
        )}

        {/* Prompt textarea */}
        <div>
          <label className="text-[10px] font-black uppercase tracking-[0.15em] text-white/30 mb-1.5 block">Frame Script / Prompt</label>
          <textarea
            value={localPrompt}
            onChange={e => setLocalPrompt(e.target.value)}
            rows={4}
            className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-3 py-2.5 text-[12px] text-white/80 placeholder-white/20 outline-none resize-none focus:border-[#c8ff00]/40 transition-colors"
            placeholder="Describe what this frame should look like..."
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            className="flex-1 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-white text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2"
          >
            <Save size={12} /> Save Prompt
          </button>
          <button
            onClick={handleRegenerate}
            disabled={isThisRegenerating}
            className="flex-1 py-2.5 rounded-xl bg-[#c8ff00] hover:bg-[#d4ff33] text-black text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isThisRegenerating ? <><Loader2 size={12} className="animate-spin" /> Regenerating...</> : <><RefreshCw size={12} /> Regenerate</>}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ═══ Main Reel Studio App ═══════════════════════════════════════════ */
export const ReelStudioApp: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const {
    sourceImage, setSourceImage, storyboard, generateScript, createCustomScript, generateFromNarrative,
    isScripting, isShooting, shootReel, activeFrameIndex, setActiveFrameIndex,
    isPlaying, setIsPlaying, isGeneratingNarrative,
    reset, aspectRatio, setAspectRatio, aspectOptions, error,
    generateStorylineOptions, isGeneratingOptions, storylineOptions,
    selectedStoryline, selectStoryline, isCreatingVideo, createVideo,
    saveAllToGallery, isSavingToGallery,
    ingredients, addIngredient, removeIngredient, updateIngredientName,
  } = useReelStudio();
  const { session } = useAuth();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const ingredientInputRef = useRef<HTMLInputElement>(null);
  const [pendingIngredientName, setPendingIngredientName] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [editingFrame, setEditingFrame] = useState<StoryFrame | null>(null);
  const [savedToGallery, setSavedToGallery] = useState(false);
  const [scriptMode, setScriptMode] = useState<'narrative' | 'ai' | 'custom'>('narrative');
  const [narrativeInput, setNarrativeInput] = useState('');
  const [customFrames, setCustomFrames] = useState<{ title: string; prompt: string }[]>([
    { title: 'Frame 1', prompt: '' },
    { title: 'Frame 2', prompt: '' },
    { title: 'Frame 3', prompt: '' },
  ]);

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => setSourceImage(e.target?.result as string);
    reader.readAsDataURL(file);
  }, [setSourceImage]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleFile(file);
  }, [handleFile]);

  const isReadyToShoot = storyboard.length > 0 && !isShooting;
  const allDone = storyboard.length > 0 && storyboard.every(f => f.status === 'done');
  const readyCount = storyboard.filter(f => f.status === 'done').length;

  const downloadFrame = (frame: StoryFrame) => {
    if (!frame.imageUrl) return;
    const link = document.createElement('a');
    link.href = frame.imageUrl;
    link.download = `reel-${frame.title.toLowerCase().replace(/\s+/g, '-')}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadAll = () => {
    storyboard.filter(f => f.status === 'done' && f.imageUrl).forEach(downloadFrame);
  };

  const handleSaveToGallery = async () => {
    const userId = session?.user?.id || 'anonymous';
    await saveAllToGallery(userId);
    setSavedToGallery(true);
    setTimeout(() => setSavedToGallery(false), 3000);
  };

  const handleIngredientFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const name = pendingIngredientName.trim() || file.name.replace(/\.[^.]+$/, '');
      addIngredient(name, dataUrl);
      setPendingIngredientName('');
    };
    reader.readAsDataURL(file);
  }, [addIngredient, pendingIngredientName]);

  return (
    <div className="h-full flex flex-col bg-[#0a0a0a] text-white overflow-hidden pt-20">
      {/* ── Top bar ── */}
      <div className="flex-shrink-0 flex items-center gap-3 px-5 py-3 border-b border-white/[0.06]">
        <button onClick={onBack} className="w-8 h-8 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] flex items-center justify-center text-white/50 hover:text-white transition-all">
          <ArrowLeft size={16} />
        </button>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#c8ff00] to-[#88cc00] flex items-center justify-center">
            <Clapperboard size={14} className="text-black" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white leading-none">Reel Studio</h1>
            <p className="text-[10px] text-white/30">One image. Five frames. One reel.</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* Download All button */}
          {allDone && (
            <button onClick={downloadAll} className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold text-white/50 hover:text-white border border-white/8 hover:border-white/20 rounded-lg transition-all">
              <Download size={11} /> Download All
            </button>
          )}
          {/* Save to Gallery */}
          {allDone && (
            <button
              onClick={handleSaveToGallery}
              disabled={isSavingToGallery || savedToGallery}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold rounded-lg transition-all border ${
                savedToGallery
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'text-[#c8ff00]/70 hover:text-[#c8ff00] border-[#c8ff00]/20 hover:border-[#c8ff00]/40'
              }`}
            >
              {isSavingToGallery ? <><Loader2 size={11} className="animate-spin" /> Saving...</> :
               savedToGallery ? <><CheckCircle2 size={11} /> Saved to Gallery</> :
               <><ImageIcon size={11} /> Save to Gallery</>}
            </button>
          )}
          {sourceImage && (
            <button onClick={reset} className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold text-white/30 hover:text-red-400 border border-white/8 hover:border-red-500/30 rounded-lg transition-all">
              <RotateCcw size={11} /> New Session
            </button>
          )}
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="mx-5 mt-3 flex items-center gap-2 px-4 py-2.5 bg-red-950/80 border border-red-800/30 rounded-xl text-red-300 text-[11px]">
          <span className="flex-1">{error}</span>
        </div>
      )}

      {/* ── Frame Script Editor Modal ── */}
      {editingFrame && (
        <FrameScriptEditor frame={editingFrame} onClose={() => setEditingFrame(null)} />
      )}

      {/* ── Main Content ── */}
      <div className="flex-1 overflow-hidden">
        {!sourceImage ? (
          /* ═══ Upload Phase ═══ */
          <div className="h-full flex items-center justify-center p-8">
            <div className="w-full max-w-lg flex flex-col items-center gap-8">
              <div className="text-center">
                <h2 className="text-3xl sm:text-4xl font-black text-white mb-2 tracking-tight">The Sequence</h2>
                <p className="text-xs text-white/30 uppercase tracking-[0.2em] font-bold">Turn one shot into a cinematic story arc</p>
              </div>
              <div
                onDragOver={e => { e.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`w-full aspect-[1.6/1] flex flex-col items-center justify-center border-2 border-dashed rounded-3xl cursor-pointer transition-all duration-300 ${
                  dragActive ? 'border-[#c8ff00] bg-[#c8ff00]/5 shadow-[0_0_40px_rgba(200,255,0,0.1)]' : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'
                }`}
              >
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
                <div className={`w-16 h-16 rounded-2xl border flex items-center justify-center mb-5 transition-all ${dragActive ? 'bg-[#c8ff00]/10 border-[#c8ff00]/30' : 'bg-white/[0.03] border-white/[0.06]'}`}>
                  <UploadCloud size={24} className={dragActive ? 'text-[#c8ff00]' : 'text-white/30'} />
                </div>
                <span className="text-white/60 font-bold text-sm mb-1">Drop your image here</span>
                <span className="text-white/20 text-[11px]">or click to browse</span>
              </div>
            </div>
          </div>
        ) : (
          /* ═══ Studio Phase ═══ */
          <div className="h-full flex overflow-hidden">
            {/* ── Left Panel: Source + Controls ── */}
            <aside className="w-[340px] flex-shrink-0 border-r border-white/[0.06] flex flex-col overflow-y-auto">
              {/* Source image */}
              <div className="p-4">
                <div className="aspect-[4/5] bg-black rounded-2xl border border-white/[0.06] overflow-hidden relative group">
                  <img src={sourceImage} alt="Source" className="w-full h-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/80 to-transparent">
                    <span className="text-[9px] font-black text-[#c8ff00] uppercase tracking-widest">Master Reference</span>
                  </div>
                </div>
              </div>

              {/* Aspect Ratio */}
              <div className="px-4 pb-4">
                <label className="text-[10px] font-black uppercase tracking-[0.15em] text-white/30 mb-2 block">Frame Size</label>
                <div className="grid grid-cols-3 gap-1.5 p-1 bg-white/[0.02] rounded-xl border border-white/[0.06]">
                  {aspectOptions.map(ar => (
                    <button key={ar.id} disabled={isShooting || allDone} onClick={() => setAspectRatio(ar)}
                      className={`py-2 flex flex-col items-center gap-0.5 rounded-lg transition-all text-[10px] font-bold ${
                        aspectRatio.id === ar.id ? 'bg-[#c8ff00] text-black' : 'text-white/30 hover:text-white/50 hover:bg-white/[0.04] disabled:opacity-30'
                      }`}>
                      <span>{ar.value}</span>
                      <span className="text-[8px] opacity-60">{ar.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* ═══ INGREDIENTS — Product/Prop Photos ═══ */}
              <div className="px-4 pb-4">
                <label className="text-[10px] font-black uppercase tracking-[0.15em] text-white/30 mb-2 block flex items-center gap-1.5">
                  <Package size={10} className="text-[#c8ff00]/60" /> Ingredients / Props
                </label>
                <div className="p-3 bg-white/[0.02] rounded-2xl border border-white/[0.06] space-y-3">
                  <p className="text-[10px] text-white/20">Add photos of specific items to include in your reel shots.</p>

                  {/* Existing ingredients */}
                  {ingredients.map(ing => (
                    <div key={ing.id} className="flex items-center gap-2 p-2 bg-white/[0.03] rounded-xl border border-white/[0.06]">
                      <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 border border-white/10">
                        <img src={ing.imageDataUrl} alt={ing.name} className="w-full h-full object-cover" />
                      </div>
                      <input
                        value={ing.name}
                        onChange={e => updateIngredientName(ing.id, e.target.value)}
                        className="flex-1 bg-transparent text-[11px] text-white/70 outline-none placeholder-white/20 min-w-0"
                        placeholder="Item name..."
                      />
                      <button
                        onClick={() => removeIngredient(ing.id)}
                        className="w-6 h-6 rounded-md flex items-center justify-center text-white/15 hover:text-red-400 hover:bg-red-500/10 transition-all flex-shrink-0"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ))}

                  {/* Add new ingredient */}
                  {ingredients.length < 5 && (
                    <div className="space-y-2">
                      <input
                        value={pendingIngredientName}
                        onChange={e => setPendingIngredientName(e.target.value)}
                        className="w-full bg-white/[0.03] border border-white/8 rounded-lg px-2.5 py-2 text-[11px] text-white/70 placeholder-white/15 outline-none focus:border-[#c8ff00]/30 transition-colors"
                        placeholder="Name this item (e.g. Product Jug, Coffee Cup)"
                      />
                      <input
                        ref={ingredientInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={e => {
                          const f = e.target.files?.[0];
                          if (f) handleIngredientFile(f);
                          e.target.value = '';
                        }}
                      />
                      <button
                        onClick={() => ingredientInputRef.current?.click()}
                        className="w-full py-2 rounded-lg border border-dashed border-white/10 hover:border-[#c8ff00]/30 text-[10px] text-white/25 hover:text-[#c8ff00]/60 font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5"
                      >
                        <Plus size={10} /> Upload Item Photo
                      </button>
                    </div>
                  )}

                  {ingredients.length >= 5 && (
                    <p className="text-[9px] text-white/15 text-center">Maximum 5 ingredients</p>
                  )}
                </div>
              </div>

              {/* Script Mode Toggle + Content */}
              <div className="px-4 pb-4 flex-1 space-y-3">

                {/* ═══ ONE-LINE NARRATIVE — quick start ═══ */}
                {storyboard.length === 0 && (
                  <div className="p-4 bg-white/[0.02] rounded-2xl border border-white/[0.06] space-y-3">
                    <h3 className="text-xs font-black text-white flex items-center gap-2 uppercase tracking-wider">
                      <Sparkles size={14} className="text-[#c8ff00]" /> Quick Reel
                    </h3>
                    <p className="text-[10px] text-white/25">Describe your reel in one line. AI analyzes your image and crafts a viral-optimized shot sequence.</p>
                    <textarea
                      value={narrativeInput}
                      onChange={e => setNarrativeInput(e.target.value)}
                      rows={2}
                      disabled={isGeneratingNarrative}
                      className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-3 py-2.5 text-[12px] text-white/80 placeholder-white/20 outline-none resize-none focus:border-[#c8ff00]/40 transition-colors disabled:opacity-40"
                      placeholder="e.g. A barista crafting the perfect latte in a cozy cafe"
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey && narrativeInput.trim() && !isGeneratingNarrative) {
                          e.preventDefault();
                          generateFromNarrative(narrativeInput);
                        }
                      }}
                    />

                    {/* AI Thinking Indicator */}
                    {isGeneratingNarrative && (
                      <div className="flex items-center gap-3 px-3 py-2.5 bg-[#c8ff00]/[0.05] border border-[#c8ff00]/20 rounded-xl">
                        <div className="flex gap-1">
                          <div className="w-1.5 h-1.5 rounded-full bg-[#c8ff00] animate-bounce" style={{ animationDelay: '0ms' }} />
                          <div className="w-1.5 h-1.5 rounded-full bg-[#c8ff00] animate-bounce" style={{ animationDelay: '150ms' }} />
                          <div className="w-1.5 h-1.5 rounded-full bg-[#c8ff00] animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                        <div className="flex-1">
                          <p className="text-[10px] font-bold text-[#c8ff00]/80">AI is crafting your viral script...</p>
                          <p className="text-[9px] text-white/30">Analyzing image • Building hook → tension → payoff → twist → CTA</p>
                        </div>
                      </div>
                    )}

                    <button
                      onClick={() => generateFromNarrative(narrativeInput)}
                      disabled={!narrativeInput.trim() || isGeneratingNarrative}
                      className="w-full py-3 rounded-xl bg-[#c8ff00] hover:bg-[#d4ff33] text-black font-black text-[10px] uppercase tracking-[0.15em] transition-all disabled:opacity-30">
                      <span className="flex items-center justify-center gap-2">
                        {isGeneratingNarrative ? (
                          <><Loader2 size={12} className="animate-spin" /> AI Thinking...</>
                        ) : (
                          <><Wand2 size={12} /> Generate Viral Script</>
                        )}
                      </span>
                    </button>
                  </div>
                )}

                {/* Mode toggle — AI Storylines vs Custom Write */}
                {storyboard.length === 0 && (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-px bg-white/[0.06]" />
                    <span className="text-[9px] text-white/15 uppercase tracking-widest font-bold">or</span>
                    <div className="flex-1 h-px bg-white/[0.06]" />
                  </div>
                )}
                {storyboard.length === 0 && (
                  <div className="grid grid-cols-2 gap-1 p-1 bg-white/[0.02] rounded-xl border border-white/[0.06]">
                    <button onClick={() => setScriptMode('ai')}
                      className={`py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 ${
                        scriptMode === 'ai' ? 'bg-white/10 text-white' : 'text-white/20 hover:text-white/40'
                      }`}>
                      <Target size={10} /> AI Storylines
                    </button>
                    <button onClick={() => setScriptMode('custom')}
                      className={`py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 ${
                        scriptMode === 'custom' ? 'bg-white/10 text-white' : 'text-white/20 hover:text-white/40'
                      }`}>
                      <FileText size={10} /> Write Script
                    </button>
                  </div>
                )}

                {/* ═══ AI STORYLINE MODE ═══ */}
                {scriptMode === 'ai' && storyboard.length === 0 && (
                  <div className="p-5 bg-white/[0.02] rounded-2xl border border-white/[0.06] space-y-4">
                    <h3 className="text-xs font-black text-white flex items-center gap-2 uppercase tracking-wider">
                      <Target size={14} className="text-[#c8ff00]" /> Narrative
                    </h3>

                    {storylineOptions.length === 0 && !isGeneratingOptions ? (
                      <button onClick={generateStorylineOptions}
                        className="w-full py-3 rounded-xl bg-[#c8ff00] hover:bg-[#d4ff33] text-black font-black text-[10px] uppercase tracking-[0.15em] transition-all">
                        <span className="flex items-center justify-center gap-2"><Sparkles size={12} /> Analyze Narrative Paths</span>
                      </button>
                    ) : isGeneratingOptions ? (
                      <div className="flex flex-col items-center gap-3 py-6">
                        <Loader2 size={20} className="animate-spin text-[#c8ff00]" />
                        <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest animate-pulse">AI is brainstorming...</p>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {storylineOptions.map(option => (
                          <button key={option.id} onClick={() => selectStoryline(option.id)} disabled={isScripting || isShooting}
                            className={`p-3 rounded-xl border text-left transition-all ${
                              selectedStoryline?.id === option.id ? 'bg-[#c8ff00]/10 border-[#c8ff00]/40' : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.05]'
                            }`}>
                            <div className="flex items-center justify-between mb-1">
                              <h4 className={`text-[11px] font-bold ${selectedStoryline?.id === option.id ? 'text-[#c8ff00]' : 'text-white/80'}`}>{option.title}</h4>
                              {selectedStoryline?.id === option.id && <CheckCircle2 size={12} className="text-[#c8ff00]" />}
                            </div>
                            <p className="text-[10px] text-white/30 leading-relaxed">{option.description}</p>
                          </button>
                        ))}
                      </div>
                    )}

                    {selectedStoryline && (
                      <button onClick={generateScript} disabled={isScripting}
                        className="w-full py-3 rounded-xl bg-[#c8ff00] hover:bg-[#d4ff33] text-black font-black text-[10px] uppercase tracking-[0.15em] transition-all disabled:opacity-50">
                        {isScripting
                          ? <span className="flex items-center justify-center gap-2"><Loader2 size={12} className="animate-spin" /> Writing Script...</span>
                          : <span className="flex items-center justify-center gap-2"><Wand2 size={12} /> Generate Script</span>}
                      </button>
                    )}
                  </div>
                )}

                {/* ═══ CUSTOM SCRIPT MODE ═══ */}
                {scriptMode === 'custom' && storyboard.length === 0 && (
                  <div className="p-5 bg-white/[0.02] rounded-2xl border border-white/[0.06] space-y-4">
                    <h3 className="text-xs font-black text-white flex items-center gap-2 uppercase tracking-wider">
                      <FileText size={14} className="text-[#c8ff00]" /> Write Your Script
                    </h3>
                    <p className="text-[10px] text-white/25">Write a prompt for each frame. Describe what the AI should generate.</p>

                    <div className="space-y-3">
                      {customFrames.map((cf, idx) => (
                        <div key={idx} className="p-3 bg-white/[0.02] rounded-xl border border-white/[0.06] space-y-2">
                          <div className="flex items-center justify-between">
                            <input
                              value={cf.title}
                              onChange={e => {
                                const updated = [...customFrames];
                                updated[idx] = { ...updated[idx], title: e.target.value };
                                setCustomFrames(updated);
                              }}
                              className="bg-transparent text-[10px] font-black text-[#c8ff00]/70 uppercase tracking-wider outline-none placeholder-white/15 w-32"
                              placeholder={`Frame ${idx + 1}`}
                            />
                            {customFrames.length > 1 && (
                              <button onClick={() => setCustomFrames(prev => prev.filter((_, i) => i !== idx))}
                                className="w-5 h-5 rounded flex items-center justify-center text-white/15 hover:text-red-400 transition-colors">
                                <Trash2 size={10} />
                              </button>
                            )}
                          </div>
                          <textarea
                            value={cf.prompt}
                            onChange={e => {
                              const updated = [...customFrames];
                              updated[idx] = { ...updated[idx], prompt: e.target.value };
                              setCustomFrames(updated);
                            }}
                            rows={2}
                            className="w-full bg-white/[0.03] border border-white/8 rounded-lg px-2.5 py-2 text-[11px] text-white/70 placeholder-white/15 outline-none resize-none focus:border-[#c8ff00]/30 transition-colors"
                            placeholder="Describe this frame... (camera angle, lighting, mood, action)"
                          />
                        </div>
                      ))}
                    </div>

                    {/* Add frame */}
                    {customFrames.length < 8 && (
                      <button onClick={() => setCustomFrames(prev => [...prev, { title: `Frame ${prev.length + 1}`, prompt: '' }])}
                        className="w-full py-2 rounded-lg border border-dashed border-white/10 hover:border-white/20 text-[10px] text-white/25 hover:text-white/50 font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5">
                        <Plus size={10} /> Add Frame
                      </button>
                    )}

                    {/* Use Custom Script */}
                    <button
                      onClick={() => {
                        const validFrames = customFrames.filter(f => f.prompt.trim());
                        if (validFrames.length > 0) createCustomScript(validFrames);
                      }}
                      disabled={customFrames.every(f => !f.prompt.trim())}
                      className="w-full py-3 rounded-xl bg-[#c8ff00] hover:bg-[#d4ff33] text-black font-black text-[10px] uppercase tracking-[0.15em] transition-all disabled:opacity-30">
                      <span className="flex items-center justify-center gap-2"><Wand2 size={12} /> Use This Script ({customFrames.filter(f => f.prompt.trim()).length} frames)</span>
                    </button>
                  </div>
                )}

                {/* ═══ SHOOT & EXPORT BUTTONS (shown when storyboard exists) ═══ */}
                {storyboard.length > 0 && (
                  <div className="p-5 bg-white/[0.02] rounded-2xl border border-white/[0.06] space-y-4">
                    {isReadyToShoot && !allDone && (
                      <button onClick={shootReel} disabled={isShooting}
                        className="w-full py-3 rounded-xl bg-white hover:bg-white/90 text-black font-black text-[10px] uppercase tracking-[0.15em] transition-all disabled:opacity-50">
                        {isShooting
                          ? <span className="flex items-center justify-center gap-2"><Loader2 size={12} className="animate-spin" /> Shooting... ({readyCount}/{storyboard.length})</span>
                          : <span className="flex items-center justify-center gap-2"><Film size={12} /> Start Shooting</span>}
                      </button>
                    )}

                    {allDone && (
                      <button onClick={createVideo} disabled={isCreatingVideo}
                        className="w-full py-3 rounded-xl bg-gradient-to-r from-[#c8ff00] to-[#88cc00] hover:brightness-110 text-black font-black text-[10px] uppercase tracking-[0.15em] transition-all disabled:opacity-50">
                        {isCreatingVideo
                          ? <span className="flex items-center justify-center gap-2"><Loader2 size={12} className="animate-spin" /> Creating Video...</span>
                          : <span className="flex items-center justify-center gap-2"><Video size={12} /> Export as Video</span>}
                      </button>
                    )}
                  </div>
                )}

                {/* ── Per-frame script list (editable after storyboard created) ── */}
                {storyboard.length > 0 && (
                  <div className="p-4 bg-white/[0.02] rounded-2xl border border-white/[0.06] space-y-2">
                    <h3 className="text-[10px] font-black text-white/40 uppercase tracking-widest flex items-center gap-2 mb-2">
                      <Pencil size={10} /> Frame Scripts <span className="text-white/15 font-normal normal-case">— click to edit</span>
                    </h3>
                    {storyboard.map((frame, idx) => (
                      <button
                        key={frame.id}
                        onClick={() => setEditingFrame(frame)}
                        className="w-full p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04] hover:border-white/[0.1] text-left transition-all group"
                      >
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[9px] font-black text-[#c8ff00]/60 uppercase tracking-wider">{idx + 1}. {frame.title}</span>
                          <div className="flex items-center gap-1">
                            {frame.status === 'done' && <CheckCircle2 size={9} className="text-[#c8ff00]/40" />}
                            <Pencil size={10} className="text-white/10 group-hover:text-[#c8ff00]/60 transition-colors" />
                          </div>
                        </div>
                        <p className="text-[10px] text-white/25 leading-relaxed line-clamp-2">{frame.prompt}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </aside>

            {/* ── Right Panel: Preview + Storyboard ── */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Preview area */}
              <div className="flex-1 flex items-center justify-center p-8 min-h-0">
                {storyboard.some(f => f.status === 'done') ? (
                  <ReelPlayer onDownload={downloadFrame} />
                ) : storyboard.length > 0 ? (
                  <div className="text-center flex flex-col items-center gap-4">
                    {isShooting ? (
                      <>
                        <div className="w-16 h-16 rounded-2xl bg-[#c8ff00]/10 border border-[#c8ff00]/20 flex items-center justify-center">
                          <Loader2 size={24} className="animate-spin text-[#c8ff00]" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-white mb-1">Shooting in progress...</p>
                          <p className="text-[11px] text-white/30">{readyCount} of {storyboard.length} frames generated</p>
                        </div>
                        <div className="w-64 h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-[#c8ff00] transition-all duration-500" style={{ width: `${(readyCount / storyboard.length) * 100}%` }} />
                        </div>
                      </>
                    ) : (
                      <>
                        <Film size={40} className="text-white/10" />
                        <div>
                          <p className="text-sm font-bold text-white/50 mb-1">Script Ready</p>
                          <p className="text-[11px] text-white/20">{storyboard.length} frames queued. Hit "Start Shooting" to generate.</p>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="text-center flex flex-col items-center gap-4">
                    <MonitorPlay size={40} className="text-white/10" />
                    <div>
                      <p className="text-sm font-bold text-white/40 mb-1">Preview</p>
                      <p className="text-[11px] text-white/20">Select a narrative and generate the script to begin.</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Storyboard strip */}
              {storyboard.length > 0 && (
                <div className="flex-shrink-0 border-t border-white/[0.06] bg-white/[0.01]">
                  <div className="px-5 py-2 flex items-center justify-between">
                    <span className="text-[10px] font-black text-white/30 uppercase tracking-widest">Storyboard</span>
                    <span className="text-[10px] text-white/20">{readyCount}/{storyboard.length} frames</span>
                  </div>
                  <div className="px-5 pb-4 flex gap-3 overflow-x-auto scrollbar-hide">
                    {storyboard.map((frame, idx) => (
                      <div key={frame.id} className={`flex-shrink-0 w-32 cursor-pointer transition-all ${activeFrameIndex === idx ? 'ring-2 ring-[#c8ff00] ring-offset-1 ring-offset-black' : ''}`}>
                        <div
                          onClick={() => { setActiveFrameIndex(idx); setIsPlaying(false); }}
                          className={`aspect-video bg-black rounded-lg border overflow-hidden relative group ${
                            frame.status === 'done' ? 'border-[#c8ff00]/30' : 'border-white/[0.06]'
                          }`}
                        >
                          {frame.imageUrl ? (
                            <img src={frame.imageUrl} className="w-full h-full object-cover" alt={frame.title} />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              {frame.status === 'pending' ? <Loader2 size={14} className="animate-spin text-[#c8ff00]/50" />
                                : frame.status === 'error' ? <X size={14} className="text-red-500/50" />
                                : <Film size={14} className="text-white/10" />}
                            </div>
                          )}

                          {/* Status dot */}
                          <div className="absolute top-1 left-1">
                            {frame.status === 'done' && <CheckCircle2 size={10} className="text-[#c8ff00]" />}
                            {frame.status === 'pending' && <Loader2 size={10} className="animate-spin text-[#c8ff00]" />}
                          </div>

                          {/* Hover overlay with actions */}
                          {frame.imageUrl && (
                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                              <button
                                onClick={e => { e.stopPropagation(); downloadFrame(frame); }}
                                className="w-7 h-7 rounded-lg bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition-all"
                                title="Download"
                              >
                                <Download size={12} />
                              </button>
                              <button
                                onClick={e => { e.stopPropagation(); setEditingFrame(frame); }}
                                className="w-7 h-7 rounded-lg bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition-all"
                                title="Edit script & regenerate"
                              >
                                <Pencil size={12} />
                              </button>
                            </div>
                          )}
                        </div>
                        <p className="text-[8px] font-bold text-white/30 uppercase tracking-wider mt-1 truncate text-center">{frame.title}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
