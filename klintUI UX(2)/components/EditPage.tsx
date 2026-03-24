import React, { useState, useRef, useEffect } from 'react';
import { 
  Pen, 
  Eraser, 
  Hand, 
  Undo2, 
  Download, 
  Plus, 
  X,
  Loader2,
  Sparkles,
  Maximize2,
  ChevronRight,
  Gem,
  Square,
  PenTool,
  Check,
  Zap,
  Monitor,
  Smartphone,
  RectangleHorizontal,
  RectangleVertical
} from 'lucide-react';
import { generateImage } from '../services/geminiService';
import { GenerationConfig, ModelType } from '../types';
import { MODELS, ASPECT_RATIOS } from '../constants';

interface EditPageProps {
  initialImage?: string | null;
  onAssetGenerated?: (url: string, prompt: string) => void;
}

export const EditPage: React.FC<EditPageProps> = ({ initialImage, onAssetGenerated }) => {
  const DEFAULT_IMAGE = "https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?q=80&w=1000&auto=format&fit=crop";
  const [baseImage, setBaseImage] = useState<string | null>(initialImage || DEFAULT_IMAGE);
  const [originalImage, setOriginalImage] = useState<string | null>(initialImage || DEFAULT_IMAGE);
  const [tool, setTool] = useState<'paint' | 'erase' | 'move'>('paint');
  
  const [config, setConfig] = useState<GenerationConfig>({
    model: ModelType.NANO_BANANA_PRO,
    aspectRatio: '1:1',
    quality: '1K',
    batchSize: 1,
    prompt: ''
  });
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [referenceAssets, setReferenceAssets] = useState<string[]>([]);
  const [activePopup, setActivePopup] = useState<string | null>(null);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(0.5);
  const [imgDims, setImgDims] = useState({ w: 0, h: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [elementStart, setElementStart] = useState({ x: 0, y: 0 });
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 });
  const [history, setHistory] = useState<ImageData[]>([]);
  const [historyStep, setHistoryStep] = useState(-1);

  useEffect(() => {
    if (initialImage) {
        setBaseImage(initialImage);
        setOriginalImage(initialImage);
    }
  }, [initialImage]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        setActivePopup(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fix for "weird cropping": Set explicit dimensions and ensure flexible scaling
  useEffect(() => {
    if (baseImage && canvasRef.current && containerRef.current) {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const img = new Image();
        img.src = baseImage;
        img.crossOrigin = "anonymous";
        img.onload = () => {
            const width = img.width;
            const height = img.height;
            setImgDims({ w: width, h: height });
            canvas.width = width;
            canvas.height = height;
            
            setTimeout(() => {
                if (!containerRef.current) return;
                const containerWidth = containerRef.current.clientWidth;
                const containerHeight = containerRef.current.clientHeight;
                
                const padding = 0.8;
                const scaleX = (containerWidth * padding) / width;
                const scaleY = (containerHeight * padding) / height;
                const initialScale = Math.min(scaleX, scaleY, 1.0); 
                
                setScale(initialScale);
                setOffset({ x: 0, y: 0 });

                if (ctx) {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    setHistory([]);
                    setHistoryStep(-1);
                    saveHistory();
                }
            }, 60);
        };
    }
  }, [baseImage]);

  const saveHistory = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      const newHistory = history.slice(0, historyStep + 1);
      newHistory.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
      setHistory(newHistory);
      setHistoryStep(newHistory.length - 1);
  };

  const getCanvasCoordinates = (e: React.MouseEvent | MouseEvent, canvas: HTMLCanvasElement) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
          x: (e.clientX - rect.left) * scaleX,
          y: (e.clientY - rect.top) * scaleY
      };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
      if (!baseImage) return;
      if (tool === 'move' || e.button === 1) {
          setIsDragging(true);
          setDragStart({ x: e.clientX, y: e.clientY });
          setElementStart({ x: offset.x, y: offset.y });
      } else {
          setIsDrawing(true);
          const canvas = canvasRef.current;
          if (!canvas) return;
          const { x, y } = getCanvasCoordinates(e, canvas);
          setLastPos({ x, y });
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.beginPath();
          ctx.arc(x, y, (20 / scale), 0, Math.PI * 2);
          ctx.fillStyle = tool === 'erase' ? 'rgba(0,0,0,1)' : 'rgba(204, 255, 0, 0.4)';
          ctx.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over';
          ctx.fill();
      }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
      if (isDragging) {
          setOffset({
              x: elementStart.x + (e.clientX - dragStart.x),
              y: elementStart.y + (e.clientY - dragStart.y)
          });
      } else if (isDrawing && (tool === 'paint' || tool === 'erase')) {
          const canvas = canvasRef.current;
          if (!canvas) return;
          const { x, y } = getCanvasCoordinates(e, canvas);
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.beginPath();
          ctx.moveTo(lastPos.x, lastPos.y);
          ctx.lineTo(x, y);
          ctx.lineWidth = 40 / scale; 
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over';
          ctx.strokeStyle = tool === 'erase' ? 'rgba(255, 255, 255, 1)' : 'rgba(204, 255, 0, 0.4)';
          ctx.stroke();
          setLastPos({ x, y });
      }
  };

  const handleMouseUp = () => {
      if (isDrawing) {
          setIsDrawing(false);
          saveHistory();
      }
      setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (!baseImage) return;
    const zoomSpeed = 0.001;
    const newScale = Math.max(0.01, Math.min(10, scale - e.deltaY * zoomSpeed));
    setScale(newScale);
  };

  const handleUndo = () => {
      if (historyStep > 0) {
          const newStep = historyStep - 1;
          const canvas = canvasRef.current;
          if (canvas) {
              const ctx = canvas.getContext('2d');
              if (ctx) ctx.putImageData(history[newStep], 0, 0);
          }
          setHistoryStep(newStep);
      }
  };

  const handleDownload = async () => {
    if (!baseImage) return;
    try {
        const canvas = document.createElement('canvas');
        const img = new Image();
        img.crossOrigin = "anonymous";
        // Type narrowing with explicit check
        img.src = baseImage as string;
        // Fix: Use explicitly typed promise to wait for image loading to avoid type errors and race conditions
        await new Promise<void>((resolve) => {
            img.onload = () => resolve();
            img.onerror = () => resolve();
        });
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        if (canvasRef.current) {
            ctx.drawImage(canvasRef.current, 0, 0);
        }
        const url = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = url;
        link.download = `klint-edit-${Date.now()}.png`;
        link.click();
    } catch (e) {
        console.error("Download failed", e);