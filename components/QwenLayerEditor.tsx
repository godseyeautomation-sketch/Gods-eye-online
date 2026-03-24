import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, Download, Eye, EyeOff, Layers, ChevronUp, ChevronDown, Type, Pencil } from 'lucide-react';

interface LayerState {
  url: string;
  visible: boolean;
  opacity: number;
  label: string;
}

interface TextOverlay {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontWeight: string;
}

interface QwenLayerEditorProps {
  layers: string[];
  prompt: string;
  onClose: () => void;
}

export const QwenLayerEditor: React.FC<QwenLayerEditorProps> = ({ layers, prompt, onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [layerStates, setLayerStates] = useState<LayerState[]>(() =>
    layers.map((url, i) => ({
      url,
      visible: true,
      opacity: 1,
      label: i === 0 ? 'Base Layer' : `Layer ${i + 1}`,
    }))
  );
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const loadedImgs = useRef<Map<string, HTMLImageElement>>(new Map());

  // Text overlay state
  const [textOverlays, setTextOverlays] = useState<TextOverlay[]>([]);
  const [isAddingText, setIsAddingText] = useState(false);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [newTextValue, setNewTextValue] = useState('');
  const [textColor, setTextColor] = useState('#ffffff');
  const [textSize, setTextSize] = useState(32);

  // Label editing
  const [editingLabelIdx, setEditingLabelIdx] = useState<number | null>(null);
  const [editLabelValue, setEditLabelValue] = useState('');

  // Pre-load all layer images
  useEffect(() => {
    let loaded = 0;
    layers.forEach(url => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        loadedImgs.current.set(url, img);
        loaded++;
        if (loaded === layers.length) setImagesLoaded(true);
      };
      img.onerror = () => {
        loaded++;
        if (loaded === layers.length) setImagesLoaded(true);
      };
      img.src = url;
    });
  }, [layers]);

  // Composite onto canvas whenever layer states or images change
  const composite = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imagesLoaded) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Determine canvas size from first loaded image
    const firstImg = loadedImgs.current.get(layers[0]);
    if (!firstImg) return;
    canvas.width = firstImg.naturalWidth;
    canvas.height = firstImg.naturalHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw bottom-to-top
    [...layerStates].reverse().forEach(ls => {
      if (!ls.visible) return;
      const img = loadedImgs.current.get(ls.url);
      if (!img) return;
      ctx.globalAlpha = ls.opacity;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    });
    ctx.globalAlpha = 1;

    // Draw text overlays
    textOverlays.forEach(overlay => {
      ctx.font = `${overlay.fontWeight} ${overlay.fontSize}px sans-serif`;
      ctx.fillStyle = overlay.color;
      ctx.textBaseline = 'top';
      // Add shadow for readability
      ctx.shadowColor = 'rgba(0,0,0,0.7)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetX = 1;
      ctx.shadowOffsetY = 1;
      ctx.fillText(overlay.text, overlay.x, overlay.y);
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
    });
  }, [imagesLoaded, layerStates, layers, textOverlays]);

  useEffect(() => { composite(); }, [composite]);

  const toggleVisible = (i: number) =>
    setLayerStates(prev => prev.map((l, idx) => idx === i ? { ...l, visible: !l.visible } : l));

  const setOpacity = (i: number, v: number) =>
    setLayerStates(prev => prev.map((l, idx) => idx === i ? { ...l, opacity: v } : l));

  const moveLayer = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= layerStates.length) return;
    setLayerStates(prev => {
      const arr = [...prev];
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return arr;
    });
  };

  const startEditLabel = (i: number) => {
    setEditingLabelIdx(i);
    setEditLabelValue(layerStates[i].label);
  };

  const commitLabel = () => {
    if (editingLabelIdx !== null && editLabelValue.trim()) {
      setLayerStates(prev => prev.map((l, idx) =>
        idx === editingLabelIdx ? { ...l, label: editLabelValue.trim() } : l
      ));
    }
    setEditingLabelIdx(null);
    setEditLabelValue('');
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isAddingText) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const newOverlay: TextOverlay = {
      id: crypto.randomUUID(),
      text: 'Double-click to edit',
      x,
      y,
      fontSize: textSize,
      color: textColor,
      fontWeight: 'bold',
    };
    setTextOverlays(prev => [...prev, newOverlay]);
    setEditingTextId(newOverlay.id);
    setNewTextValue(newOverlay.text);
    setIsAddingText(false);
  };

  const commitTextEdit = () => {
    if (editingTextId && newTextValue.trim()) {
      setTextOverlays(prev => prev.map(t =>
        t.id === editingTextId ? { ...t, text: newTextValue.trim() } : t
      ));
    } else if (editingTextId && !newTextValue.trim()) {
      setTextOverlays(prev => prev.filter(t => t.id !== editingTextId));
    }
    setEditingTextId(null);
    setNewTextValue('');
  };

  const deleteTextOverlay = (id: string) => {
    setTextOverlays(prev => prev.filter(t => t.id !== id));
    if (editingTextId === id) {
      setEditingTextId(null);
      setNewTextValue('');
    }
  };

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'qwen-layers-composite.png';
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingTextId) commitTextEdit();
        else if (editingLabelIdx !== null) commitLabel();
        else onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingTextId, editingLabelIdx, onClose]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={containerRef}
        className="w-full max-w-5xl h-[85vh] flex flex-col rounded-[28px] bg-[#0d0d0d] border border-white/10 shadow-[0_40px_80px_-20px_rgba(0,0,0,0.9)] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/8 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-brand/15 border border-brand/30 flex items-center justify-center">
              <Layers size={18} className="text-brand" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Qwen Layer Editor</h2>
              <p className="text-[10px] text-text-secondary truncate max-w-xs">{prompt || 'Layered decomposition'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Text tool button */}
            <button
              onClick={() => setIsAddingText(!isAddingText)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                isAddingText
                  ? 'bg-blue-500 text-white'
                  : 'bg-white/5 border border-white/10 text-text-secondary hover:text-white hover:bg-white/10'
              }`}
            >
              <Type size={13} /> {isAddingText ? 'Click on Canvas' : 'Add Text'}
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand text-bg text-xs font-bold hover:brightness-110 active:scale-95 transition-all"
            >
              <Download size={13} /> Export Composite
            </button>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-text-secondary hover:text-white hover:bg-white/10 transition-all"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 flex overflow-hidden min-h-0">

          {/* Canvas preview */}
          <div className="flex-1 bg-[#060606] flex items-center justify-center p-6 min-w-0 relative">
            {!imagesLoaded ? (
              <div className="flex flex-col items-center gap-3 text-text-secondary">
                <div className="w-10 h-10 rounded-2xl border-2 border-brand/40 border-t-brand animate-spin" />
                <p className="text-xs">Loading layers...</p>
              </div>
            ) : (
              <>
                <canvas
                  ref={canvasRef}
                  className={`max-w-full max-h-full object-contain rounded-xl border border-white/8 shadow-2xl ${isAddingText ? 'cursor-crosshair' : 'cursor-default'}`}
                  style={{ imageRendering: 'auto' }}
                  onClick={handleCanvasClick}
                />
                {isAddingText && (
                  <div className="absolute top-8 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-blue-500/90 text-white text-xs font-bold backdrop-blur-sm pointer-events-none">
                    Click anywhere on the canvas to place text
                  </div>
                )}
              </>
            )}
          </div>

          {/* Layer stack panel + text overlays */}
          <div className="w-72 flex-shrink-0 border-l border-white/8 flex flex-col">
            <div className="px-4 py-3 border-b border-white/8 flex-shrink-0">
              <p className="text-[10px] font-bold text-text-secondary uppercase tracking-[0.12em]">Layers ({layerStates.length})</p>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 scrollbar-hide">
              {layerStates.map((ls, i) => (
                <div
                  key={ls.url}
                  className="rounded-[14px] border border-white/8 bg-white/[0.02] overflow-hidden"
                >
                  {/* Layer thumbnail + header */}
                  <div className="flex items-center gap-2 p-2.5">
                    <div className="w-10 h-10 rounded-lg overflow-hidden border border-white/10 flex-shrink-0 bg-black">
                      <img
                        src={ls.url}
                        alt={ls.label}
                        className="w-full h-full object-cover"
                        style={{ opacity: ls.opacity }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      {editingLabelIdx === i ? (
                        <input
                          className="w-full bg-white/[0.06] border border-brand/40 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-text-primary outline-none"
                          value={editLabelValue}
                          onChange={e => setEditLabelValue(e.target.value)}
                          onBlur={commitLabel}
                          onKeyDown={e => {
                            if (e.key === 'Enter') commitLabel();
                            if (e.key === 'Escape') { setEditingLabelIdx(null); setEditLabelValue(''); }
                            e.stopPropagation();
                          }}
                          autoFocus
                        />
                      ) : (
                        <div className="flex items-center gap-1 group/label cursor-pointer" onClick={() => startEditLabel(i)}>
                          <p className="text-[11px] font-semibold text-text-primary truncate">{ls.label}</p>
                          <Pencil size={9} className="text-text-secondary/30 opacity-0 group-hover/label:opacity-100 transition-opacity flex-shrink-0" />
                        </div>
                      )}
                      <p className="text-[9px] text-text-secondary/50 tabular-nums">{Math.round(ls.opacity * 100)}%</p>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <button
                        onClick={() => moveLayer(i, -1)}
                        disabled={i === 0}
                        className="w-5 h-5 rounded-md flex items-center justify-center text-text-secondary/40 hover:text-white hover:bg-white/10 disabled:opacity-20 transition-all"
                      >
                        <ChevronUp size={11} />
                      </button>
                      <button
                        onClick={() => moveLayer(i, 1)}
                        disabled={i === layerStates.length - 1}
                        className="w-5 h-5 rounded-md flex items-center justify-center text-text-secondary/40 hover:text-white hover:bg-white/10 disabled:opacity-20 transition-all"
                      >
                        <ChevronDown size={11} />
                      </button>
                    </div>
                    <button
                      onClick={() => toggleVisible(i)}
                      className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${ls.visible ? 'text-brand bg-brand/10 border border-brand/30' : 'text-text-secondary/40 bg-white/[0.03] border border-white/8'}`}
                    >
                      {ls.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>
                  </div>

                  {/* Opacity slider */}
                  <div className="px-2.5 pb-2.5">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={ls.opacity}
                      onChange={e => setOpacity(i, parseFloat(e.target.value))}
                      className="w-full h-1 accent-brand cursor-pointer"
                    />
                  </div>
                </div>
              ))}

              {/* Text Overlays Section */}
              {textOverlays.length > 0 && (
                <div className="mt-3 pt-3 border-t border-white/8">
                  <p className="text-[10px] font-bold text-text-secondary uppercase tracking-[0.12em] mb-2">Text Overlays ({textOverlays.length})</p>
                  {textOverlays.map(overlay => (
                    <div key={overlay.id} className="rounded-[12px] border border-white/8 bg-white/[0.02] p-2.5 mb-2">
                      {editingTextId === overlay.id ? (
                        <div className="space-y-2">
                          <input
                            className="w-full bg-white/[0.06] border border-brand/40 rounded-lg px-2.5 py-1.5 text-[11px] text-text-primary outline-none"
                            value={newTextValue}
                            onChange={e => setNewTextValue(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') commitTextEdit();
                              if (e.key === 'Escape') { setEditingTextId(null); setNewTextValue(''); }
                              e.stopPropagation();
                            }}
                            autoFocus
                            placeholder="Enter text..."
                          />
                          <div className="flex gap-2">
                            <input
                              type="color"
                              value={overlay.color}
                              onChange={e => setTextOverlays(prev => prev.map(t =>
                                t.id === overlay.id ? { ...t, color: e.target.value } : t
                              ))}
                              className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                            />
                            <input
                              type="range"
                              min={12}
                              max={120}
                              value={overlay.fontSize}
                              onChange={e => setTextOverlays(prev => prev.map(t =>
                                t.id === overlay.id ? { ...t, fontSize: parseInt(e.target.value) } : t
                              ))}
                              className="flex-1 h-1 mt-2.5 accent-brand cursor-pointer"
                            />
                            <span className="text-[9px] text-text-secondary/50 w-8 text-right mt-1.5">{overlay.fontSize}px</span>
                          </div>
                          <button
                            onClick={commitTextEdit}
                            className="w-full py-1.5 rounded-lg bg-brand/20 text-brand text-[10px] font-bold hover:bg-brand/30 transition-colors"
                          >
                            Done
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div
                            className="w-4 h-4 rounded flex-shrink-0 border border-white/20"
                            style={{ backgroundColor: overlay.color }}
                          />
                          <p
                            className="text-[11px] text-text-primary truncate flex-1 cursor-pointer hover:text-brand transition-colors"
                            onClick={() => { setEditingTextId(overlay.id); setNewTextValue(overlay.text); }}
                          >
                            {overlay.text}
                          </p>
                          <button
                            onClick={() => deleteTextOverlay(overlay.id)}
                            className="w-5 h-5 rounded flex items-center justify-center text-text-secondary/30 hover:text-red-400 hover:bg-red-400/10 transition-all"
                          >
                            <X size={10} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Text tool settings */}
              {isAddingText && (
                <div className="mt-3 pt-3 border-t border-white/8 space-y-2">
                  <p className="text-[10px] font-bold text-text-secondary uppercase tracking-[0.12em]">Text Settings</p>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-text-secondary/50 w-10">Color</span>
                    <input
                      type="color"
                      value={textColor}
                      onChange={e => setTextColor(e.target.value)}
                      className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-text-secondary/50 w-10">Size</span>
                    <input
                      type="range"
                      min={12}
                      max={120}
                      value={textSize}
                      onChange={e => setTextSize(parseInt(e.target.value))}
                      className="flex-1 h-1 accent-brand cursor-pointer"
                    />
                    <span className="text-[9px] text-text-secondary/50 w-8 text-right">{textSize}px</span>
                  </div>
                </div>
              )}
            </div>

            {/* Layer download section - positioned above any input boxes */}
            <div className="flex-shrink-0 border-t border-white/8 p-3 space-y-1.5 max-h-[180px] overflow-y-auto scrollbar-hide">
              <p className="text-[9px] text-text-secondary/40 uppercase tracking-widest font-bold">Export Individual Layer</p>
              {layerStates.map((ls, i) => (
                <a
                  key={ls.url}
                  href={ls.url}
                  download={`layer-${i + 1}.png`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 px-2.5 py-2 rounded-xl bg-white/[0.03] border border-white/8 hover:border-white/20 transition-all group"
                >
                  <Download size={10} className="text-text-secondary/50 group-hover:text-brand transition-colors" />
                  <span className="text-[10px] text-text-secondary truncate group-hover:text-white transition-colors">{ls.label}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
