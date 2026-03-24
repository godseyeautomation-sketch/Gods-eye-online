
import React, { useState, useRef, useEffect } from 'react';
import { 
  Type, 
  Image as ImageIcon, 
  MousePointer2, 
  Plus, 
  Trash2, 
  Sparkles, 
  ChevronRight, 
  ChevronLeft,
  Move,
  Maximize2,
  Palette,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Download,
  Loader2,
  Check
} from 'lucide-react';
import { StudioElement } from '../types';
import { GoogleGenAI } from "@google/genai";

export const StudioPage: React.FC = () => {
  const [elements, setElements] = useState<StudioElement[]>([
    {
      id: '1',
      type: 'heading',
      content: 'KLINT STUDIO',
      x: 100,
      y: 100,
      width: 400,
      style: { fontSize: 48, color: '#CCFF00', textAlign: 'left' }
    },
    {
      id: '2',
      type: 'text',
      content: 'Build visual experiences without touching a single line of code.',
      x: 100,
      y: 180,
      width: 300,
      style: { fontSize: 16, color: '#FFFFFF', textAlign: 'left' }
    }
  ]);
  
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isAILoading, setIsAILoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedElement = elements.find(el => el.id === selectedId);

  const addElement = (type: StudioElement['type']) => {
    const newEl: StudioElement = {
      id: Date.now().toString(),
      type,
      content: type === 'image' ? 'https://picsum.photos/400/300' : 'New ' + type,
      x: 200,
      y: 200,
      width: type === 'image' ? 300 : 250,
      height: type === 'image' ? 200 : undefined,
      style: {
        fontSize: type === 'heading' ? 32 : 16,
        color: '#FFFFFF',
        borderRadius: type === 'image' ? 12 : 0,
        textAlign: 'left'
      }
    };
    setElements([...elements, newEl]);
    setSelectedId(newEl.id);
  };

  const updateElement = (id: string, updates: Partial<StudioElement>) => {
    setElements(elements.map(el => el.id === id ? { ...el, ...updates } : el));
  };

  const updateStyle = (id: string, styleUpdates: Partial<StudioElement['style']>) => {
    setElements(elements.map(el => el.id === id ? { ...el, style: { ...el.style, ...styleUpdates } } : el));
  };

  const handleMouseDown = (e: React.MouseEvent, id: string) => {
    setSelectedId(id);
    setIsDragging(true);
    const el = elements.find(el => el.id === id);
    if (el) {
      setDragOffset({ x: e.clientX - el.x, y: e.clientY - el.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && selectedId) {
      updateElement(selectedId, {
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0] && selectedId) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        updateElement(selectedId, { content: ev.target?.result as string });
      };
      reader.readAsDataURL(e.target.files[0]);
    }
  };

  const refineTextWithAI = async () => {
    if (!selectedElement || selectedElement.type === 'image') return;
    setIsAILoading(true);
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Rewrite this short text to be more cinematic and premium for a design studio website. Keep it under 20 words. Original: "${selectedElement.content}"`,
      });
      
      const newText = response.text?.trim() || selectedElement.content;
      updateElement(selectedElement.id, { content: newText });
    } catch (err) {
      console.error(err);
    } finally {
      setIsAILoading(false);
    }
  };

  return (
    <div className="flex h-full w-full bg-[#030303] overflow-hidden select-none font-sans" onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}>
      
      {/* Sidebar: Elements */}
      <div className="w-64 border-r border-white/5 bg-[#0a0a0a] p-6 flex flex-col gap-8 z-20">
        <div>
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-neutral-500 mb-6">Library</h3>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => addElement('heading')} className="flex flex-col items-center justify-center p-4 bg-white/5 rounded-2xl border border-white/5 hover:border-brand/50 hover:bg-brand/5 transition-all gap-2 group">
              <Type size={20} className="text-neutral-400 group-hover:text-brand" />
              <span className="text-[10px] font-bold text-neutral-500 group-hover:text-white">Heading</span>
            </button>
            <button onClick={() => addElement('text')} className="flex flex-col items-center justify-center p-4 bg-white/5 rounded-2xl border border-white/5 hover:border-brand/50 hover:bg-brand/5 transition-all gap-2 group">
              <AlignLeft size={20} className="text-neutral-400 group-hover:text-brand" />
              <span className="text-[10px] font-bold text-neutral-500 group-hover:text-white">Text</span>
            </button>
            <button onClick={() => addElement('image')} className="flex flex-col items-center justify-center p-4 bg-white/5 rounded-2xl border border-white/5 hover:border-brand/50 hover:bg-brand/5 transition-all gap-2 group">
              <ImageIcon size={20} className="text-neutral-400 group-hover:text-brand" />
              <span className="text-[10px] font-bold text-neutral-500 group-hover:text-white">Image</span>
            </button>
            <button className="flex flex-col items-center justify-center p-4 bg-white/5 rounded-2xl border border-white/5 opacity-30 cursor-not-allowed gap-2">
              <Move size={20} className="text-neutral-400" />
              <span className="text-[10px] font-bold text-neutral-500">Group</span>
            </button>
          </div>
        </div>

        <div className="mt-auto">
          <button className="w-full flex items-center justify-between p-4 bg-brand text-bg rounded-2xl font-bold text-xs uppercase tracking-widest shadow-lg shadow-brand/10 hover:brightness-110 transition-all">
            Export <Download size={16} />
          </button>
        </div>
      </div>

      {/* Main Canvas Area */}
      <div className="flex-1 relative bg-canvas-dots overflow-hidden group/canvas" onClick={() => setSelectedId(null)}>
        <style>{`
          .bg-canvas-dots {
            background-image: radial-gradient(rgba(255,255,255,0.05) 1.5px, transparent 1.5px);
            background-size: 30px 30px;
          }
        `}</style>

        {elements.map((el) => (
          <div
            key={el.id}
            onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, el.id); }}
            className={`absolute cursor-move transition-shadow ${selectedId === el.id ? 'ring-2 ring-brand ring-offset-4 ring-offset-[#030303] z-10' : 'hover:ring-1 hover:ring-white/20'}`}
            style={{ 
              left: el.x, 
              top: el.y, 
              width: el.width, 
              height: el.height,
              zIndex: selectedId === el.id ? 100 : 1,
            }}
          >
            {el.type === 'image' ? (
              <img 
                src={el.content} 
                className="w-full h-full object-cover" 
                style={{ borderRadius: el.style.borderRadius + 'px' }} 
                alt="Studio Element" 
              />
            ) : (
              <div 
                contentEditable={selectedId === el.id}
                suppressContentEditableWarning
                onBlur={(e) => updateElement(el.id, { content: e.currentTarget.textContent || '' })}
                className="outline-none whitespace-pre-wrap break-words leading-tight p-2"
                style={{ 
                  fontSize: el.style.fontSize + 'px', 
                  color: el.style.color,
                  textAlign: el.style.textAlign,
                  fontWeight: el.type === 'heading' ? 800 : 400,
                  textTransform: el.type === 'heading' ? 'uppercase' : 'none'
                }}
              >
                {el.content}
              </div>
            )}
          </div>
        ))}

        {/* Floating Tooltips for selected item */}
        {selectedElement && (
          <div 
            className="absolute bg-[#121212] border border-white/10 rounded-full px-4 py-2 flex items-center gap-3 shadow-2xl z-[150] animate-fade-in"
            style={{ left: selectedElement.x, top: selectedElement.y - 60 }}
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={() => setElements(elements.filter(e => e.id !== selectedId))} className="p-2 hover:bg-red-500/20 text-red-500 rounded-full"><Trash2 size={16} /></button>
            <div className="w-px h-4 bg-white/10" />
            {selectedElement.type === 'image' ? (
              <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 text-[10px] font-bold text-white px-3 py-1 bg-white/5 rounded-full hover:bg-white/10 transition-colors">
                REPLACE IMAGE
              </button>
            ) : (
              <button 
                onClick={refineTextWithAI}
                disabled={isAILoading}
                className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-brand px-4 py-1.5 bg-brand/10 border border-brand/20 rounded-full hover:bg-brand/20 transition-all"
              >
                {isAILoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {isAILoading ? 'Thinking...' : 'AI Refine'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Sidebar: Inspector */}
      <div className="w-80 border-l border-white/5 bg-[#0a0a0a] p-8 z-20 overflow-y-auto">
        {selectedElement ? (
          <div className="space-y-10 animate-fade-in">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-black uppercase tracking-tighter text-white">Inspector</h2>
              <span className="text-[10px] font-mono text-neutral-500 px-2 py-1 bg-white/5 rounded">{selectedElement.type}</span>
            </div>

            <div className="space-y-6">
              <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-neutral-500">Geometry</label>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <span className="text-[10px] font-bold text-neutral-400">Width</span>
                  <input type="number" value={selectedElement.width} onChange={(e) => updateElement(selectedElement.id, { width: Number(e.target.value) })} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-brand" />
                </div>
                {selectedElement.type === 'image' && (
                  <div className="space-y-2">
                    <span className="text-[10px] font-bold text-neutral-400">Height</span>
                    <input type="number" value={selectedElement.height} onChange={(e) => updateElement(selectedElement.id, { height: Number(e.target.value) })} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-brand" />
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-6">
              <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-neutral-500">Style</label>
              
              {selectedElement.type !== 'image' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-[10px] font-bold text-neutral-400">Font Size</span>
                      <span className="text-[10px] font-mono text-brand">{selectedElement.style.fontSize}px</span>
                    </div>
                    <input type="range" min="8" max="120" value={selectedElement.style.fontSize} onChange={(e) => updateStyle(selectedId!, { fontSize: Number(e.target.value) })} className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-brand" />
                  </div>
                  
                  <div className="space-y-2">
                    <span className="text-[10px] font-bold text-neutral-400">Color</span>
                    <div className="flex gap-2">
                      {['#FFFFFF', '#CCFF00', '#FF3366', '#33CCFF'].map(c => (
                        <button key={c} onClick={() => updateStyle(selectedId!, { color: c })} className={`w-8 h-8 rounded-full border-2 ${selectedElement.style.color === c ? 'border-brand' : 'border-transparent'}`} style={{ backgroundColor: c }} />
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <span className="text-[10px] font-bold text-neutral-400">Alignment</span>
                    <div className="flex bg-white/5 rounded-lg p-1 gap-1">
                      <button onClick={() => updateStyle(selectedId!, { textAlign: 'left' })} className={`flex-1 p-2 rounded ${selectedElement.style.textAlign === 'left' ? 'bg-white/10 text-brand' : 'text-neutral-500 hover:text-white'}`}><AlignLeft size={14}/></button>
                      <button onClick={() => updateStyle(selectedId!, { textAlign: 'center' })} className={`flex-1 p-2 rounded ${selectedElement.style.textAlign === 'center' ? 'bg-white/10 text-brand' : 'text-neutral-500 hover:text-white'}`}><AlignCenter size={14}/></button>
                      <button onClick={() => updateStyle(selectedId!, { textAlign: 'right' })} className={`flex-1 p-2 rounded ${selectedElement.style.textAlign === 'right' ? 'bg-white/10 text-brand' : 'text-neutral-500 hover:text-white'}`}><AlignRight size={14}/></button>
                    </div>
                  </div>
                </div>
              )}

              {selectedElement.type === 'image' && (
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-[10px] font-bold text-neutral-400">Rounding</span>
                    <span className="text-[10px] font-mono text-brand">{selectedElement.style.borderRadius}px</span>
                  </div>
                  <input type="range" min="0" max="100" value={selectedElement.style.borderRadius} onChange={(e) => updateStyle(selectedId!, { borderRadius: Number(e.target.value) })} className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-brand" />
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center opacity-30">
            <MousePointer2 size={48} className="mb-4" strokeWidth={1} />
            <p className="text-xs font-bold uppercase tracking-widest leading-loose">Select an element<br/>to begin styling</p>
          </div>
        )}
      </div>

      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
    </div>
  );
};
