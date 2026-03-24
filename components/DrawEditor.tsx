import React, { useRef, useState, useEffect } from 'react';
import { X, Eraser, Pen, Undo, Download, Trash2 } from 'lucide-react';
import { Button } from './Button';

interface DrawEditorProps {
  onClose: () => void;
  onUseSketch: (imageData: string) => void;
}

export const DrawEditor: React.FC<DrawEditorProps> = ({ onClose, onUseSketch }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#FFFFFF');
  const [brushSize, setBrushSize] = useState(4);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
  }, []);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.strokeStyle = tool === 'eraser' ? '#000000' : color;

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
    }
  };

  const handleDone = () => {
    if (canvasRef.current) {
        const dataUrl = canvasRef.current.toDataURL('image/png');
        // Strip prefix for API usage if needed, or pass full url
        const base64 = dataUrl.split(',')[1];
        onUseSketch(base64);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-neutral-800">
        <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={onClose}><X size={20}/></Button>
            <h2 className="text-white font-medium">Sketch to Image Editor</h2>
        </div>
        <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={clearCanvas} className="gap-2">
                <Trash2 size={16}/> Clear
            </Button>
            <Button variant="primary" onClick={handleDone} className="gap-2">
                Use Sketch <Download size={16}/>
            </Button>
        </div>
      </div>

      {/* Workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* Toolbar */}
        <div className="w-16 bg-neutral-900 border-r border-neutral-800 flex flex-col items-center py-4 gap-4">
            <button 
                onClick={() => setTool('pen')}
                className={`p-3 rounded-xl transition-all ${tool === 'pen' ? 'bg-brand text-black' : 'text-neutral-400 hover:bg-neutral-800'}`}
            >
                <Pen size={20}/>
            </button>
            <button 
                onClick={() => setTool('eraser')}
                className={`p-3 rounded-xl transition-all ${tool === 'eraser' ? 'bg-white text-black' : 'text-neutral-400 hover:bg-neutral-800'}`}
            >
                <Eraser size={20}/>
            </button>
            
            <div className="w-full h-px bg-neutral-800 my-2"></div>
            
            {/* Color Picker (Simplified) */}
            <div className="flex flex-col gap-2">
                {['#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00'].map(c => (
                    <button 
                        key={c}
                        onClick={() => setColor(c)}
                        className={`w-6 h-6 rounded-full border-2 ${color === c ? 'border-white scale-110' : 'border-transparent'}`}
                        style={{ backgroundColor: c }}
                    />
                ))}
            </div>

             <div className="w-full h-px bg-neutral-800 my-2"></div>

             {/* Brush Size */}
             <div className="flex flex-col items-center gap-2">
                <span className="text-[10px] text-neutral-500">Size</span>
                <input 
                    type="range" 
                    min="1" 
                    max="20" 
                    value={brushSize} 
                    onChange={(e) => setBrushSize(parseInt(e.target.value))}
                    className="h-24 w-1 bg-neutral-700 rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-brand"
                    style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
                />
             </div>
        </div>

        {/* Canvas Area */}
        <div className="flex-1 bg-neutral-950 relative flex items-center justify-center p-8">
            <div className="relative shadow-2xl shadow-black ring-1 ring-neutral-800 rounded-lg overflow-hidden bg-black" style={{ aspectRatio: '1/1', height: '90%' }}>
                <canvas
                    ref={canvasRef}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    className="w-full h-full cursor-crosshair"
                />
            </div>
        </div>
      </div>
    </div>
  );
};