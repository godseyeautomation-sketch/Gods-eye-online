import React, { useState, useRef, useEffect } from 'react';
import {
    Pen,
    Eraser,
    Hand,
    Undo2,
    Redo2,
    Download,
    Plus,
    Minus,
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
    RectangleVertical,
    ImagePlus,
    RotateCw,
    Wand2,
    BoxSelect
} from 'lucide-react';
import { ControlBar } from './ControlBar';
import { BrainActions } from './BrainActions';
import { generateImage, editImage } from '../services/geminiService';
import { GenerationConfig, ModelType, PerspectiveConfig, DEFAULT_PERSPECTIVE, buildPerspectiveText, ObjectOrientation, DEFAULT_OBJECT_ORIENTATION, buildObjectOrientationText } from '../types';
import { MODELS, ASPECT_RATIOS } from '../constants';

interface EditPageProps {
    initialImage?: string | null;
    onAssetGenerated?: (url: string, prompt: string) => void;
}

interface StickerState {
    src: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    skewX?: number;
    skewY?: number;
    aspect: number;
}

export const EditPage: React.FC<EditPageProps> = ({ initialImage, onAssetGenerated }) => {
    const DEFAULT_IMAGE = "https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?q=80&w=1000&auto=format&fit=crop";
    const [baseImage, setBaseImage] = useState<string | null>(initialImage || DEFAULT_IMAGE);
    const [originalImage, setOriginalImage] = useState<string | null>(initialImage || DEFAULT_IMAGE);
    const [tool, setTool] = useState<'paint' | 'erase' | 'move' | 'sticker'>('paint');
    const [brushColor, setBrushColor] = useState('rgba(204, 255, 0, 0.4)'); // Default Lime

    // Colors available for masking
    const MASK_COLORS = [
        { id: 'lime', value: 'rgba(204, 255, 0, 0.4)', label: 'Green' },
        { id: 'blue', value: 'rgba(0, 195, 255, 0.4)', label: 'Blue' },
        { id: 'red', value: 'rgba(255, 60, 0, 0.4)', label: 'Red' },
        { id: 'yellow', value: 'rgba(255, 230, 0, 0.4)', label: 'Yellow' }
    ];

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

    // Perspective & Object Control State
    const [perspective, setPerspective] = useState<PerspectiveConfig>(DEFAULT_PERSPECTIVE);
    const [objectOrientation, setObjectOrientation] = useState<ObjectOrientation>(DEFAULT_OBJECT_ORIENTATION);
    const [sticker, setSticker] = useState<StickerState | null>(null);
    const [showPerspective, setShowPerspective] = useState(false);
    const [stickerDrag, setStickerDrag] = useState<{
        startX: number,
        startY: number,
        startState: StickerState,
        mode: 'move' | 'resize' | 'rotate',
        centerX?: number,
        centerY?: number
    } | null>(null);


    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const stickerInputRef = useRef<HTMLInputElement>(null);
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

    /**
     * Composites an AI-generated image onto the original image using a feathered mask.
     * This ensures 100% original pixel quality outside the masked area.
     */
    const applyMaskComposite = async (
        originalUrl: string,
        maskUrl: string,
        aiResultUrl: string
    ): Promise<string> => {
        return new Promise((resolve, reject) => {
            const loadImg = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.onload = () => res(img);
                img.onerror = rej;
                img.src = src;
            });

            Promise.all([
                loadImg(originalUrl),
                loadImg(maskUrl),
                loadImg(aiResultUrl)
            ]).then(([origImg, maskImg, aiImg]) => {
                const canvas = document.createElement('canvas');
                canvas.width = origImg.width;
                canvas.height = origImg.height;
                const ctx = canvas.getContext('2d');
                if (!ctx) return reject(new Error("No 2d context"));

                // 1. Draw the Original Uncompressed Background
                ctx.drawImage(origImg, 0, 0);

                // 2. We need to create a feathered mask buffer
                // This buffer will hold the transparent mask hole with soft edges
                const maskBuffer = document.createElement('canvas');
                maskBuffer.width = origImg.width;
                maskBuffer.height = origImg.height;
                const maskCtx = maskBuffer.getContext('2d');
                if (!maskCtx) return reject(new Error("No mask context"));

                // Draw the user's mask canvas
                maskCtx.drawImage(maskImg, 0, 0);

                // CRITICAL FIX: The mask canvas from the UI might not be truly transparent 
                // outside the drawn strokes. It might have a white/black background, or be 
                // fully opaque. We MUST extract only the drawn pixels to create a true alpha mask.
                const maskImageData = maskCtx.getImageData(0, 0, maskBuffer.width, maskBuffer.height);
                const data = maskImageData.data;
                for (let i = 0; i < data.length; i += 4) {
                    const r = data[i];
                    const g = data[i + 1];
                    const b = data[i + 2];
                    const a = data[i + 3];

                    // Klint's edit brush is usually neon yellow/green (high R & G, low B), 
                    // or high alpha if drawn on a transparent canvas.
                    // If the pixel is mostly dark or mostly white background, make it transparent.
                    // The safest bet: if it has meaningful color density and opacity, keep it, else clear it.
                    // We check if it's the brush (non-transparent AND non-black/non-white background)
                    const isWhiteBg = r > 240 && g > 240 && b > 240;
                    const isBlackBg = r < 15 && g < 15 && b < 15 && a > 240;

                    if (a < 10 || isWhiteBg || isBlackBg) {
                        data[i + 3] = 0; // Make outside transparent
                    } else {
                        // Make inside solid black for a perfect composite mask
                        data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
                    }
                }
                maskCtx.putImageData(maskImageData, 0, 0);

                // Apply feathering to the true alpha mask
                maskCtx.filter = 'blur(12px)';
                // We have to redraw the image data to apply the CSS filter
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = maskBuffer.width; tempCanvas.height = maskBuffer.height;
                tempCanvas.getContext('2d')?.putImageData(maskImageData, 0, 0);
                maskCtx.clearRect(0, 0, maskBuffer.width, maskBuffer.height);
                maskCtx.drawImage(tempCanvas, 0, 0);
                maskCtx.filter = 'none'; // reset

                // Now that the mask is ONLY the drawn strokes with soft edges,
                // we use globalCompositeOperation to draw the AI image *only* where the mask exists.
                maskCtx.globalCompositeOperation = 'source-in';

                // Fix squishing: Calculate destination size exactly maintaining original canvas scale
                // If the Gemini image is slightly different in ratio (even with getClosestAspectRatio),
                // we crop the AI image (source) to match the canvas (destination) aspect ratio exactly.
                const canvasRatio = canvas.width / canvas.height;
                const aiRatio = aiImg.width / aiImg.height;

                let srcX = 0, srcY = 0, srcW = aiImg.width, srcH = aiImg.height;

                if (aiRatio > canvasRatio) {
                    // AI image is wider than canvas -> crop sides
                    srcW = aiImg.height * canvasRatio;
                    srcX = (aiImg.width - srcW) / 2;
                } else {
                    // AI image is taller than canvas -> crop top/bottom
                    srcH = aiImg.width / canvasRatio;
                    srcY = (aiImg.height - srcH) / 2;
                }

                // Draw the perfectly cropped source into the exact canvas dimensions
                maskCtx.drawImage(aiImg, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);

                // 3. Now draw that buffered (Feathered AI object) over the pristine Original Background
                ctx.drawImage(maskBuffer, 0, 0);

                resolve(canvas.toDataURL('image/png', 1.0));
            }).catch(reject);
        });
    };

    // Helper to calculate closest Gemini-supported aspect ratio
    const getClosestAspectRatio = (w: number, h: number): string => {
        const ratio = w / h;
        const ratios = [
            { label: '1:1', val: 1 },
            { label: '16:9', val: 16 / 9 },
            { label: '9:16', val: 9 / 16 },
            { label: '4:3', val: 4 / 3 },
            { label: '3:4', val: 3 / 4 },
            { label: '3:2', val: 3 / 2 },
            { label: '2:3', val: 2 / 3 },
            { label: '4:5', val: 4 / 5 },
            { label: '5:4', val: 5 / 4 },
        ];
        return ratios.reduce((prev, curr) => Math.abs(curr.val - ratio) < Math.abs(prev.val - ratio) ? curr : prev).label;
    };

    const handleGenerate = async () => {
        if (!config.prompt || isGenerating) return;
        setIsGenerating(true);

        // Build final prompt: object orientation first, then user prompt, then perspective suffix
        const objText = buildObjectOrientationText(objectOrientation);
        const perspText = buildPerspectiveText(perspective);

        let finalPrompt = config.prompt;
        if (objText) finalPrompt = `${objText}, ${finalPrompt}`;
        if (perspText) finalPrompt = `${finalPrompt}, ${perspText}`;

        console.log("Generating with prompt:", finalPrompt);

        try {
            const canvas = canvasRef.current;
            if (!canvas) throw new Error("Canvas not found");

            // Intercept aspect ratio for editing: Force API to match the image to prevent squishing
            const optimalRatio = getClosestAspectRatio(canvas.width, canvas.height);

            // PNG required — JPEG is lossy and corrupts transparency in masks
            const maskData = canvas.toDataURL('image/png');
            const imageData = baseImage || originalImage || DEFAULT_IMAGE;

            // Call editImage with the enriched final prompt and the optimal ratio
            const resultBase64 = await editImage(imageData, maskData, finalPrompt, config.model, optimalRatio, referenceAssets, config.harmonize || false);

            if (resultBase64 && resultBase64.startsWith('data:image')) {
                // Perform client-side compositing: 
                // CRITICAL FIX FOR CUMULATIVE DEGRADATION: 
                // Always composite the AI output over the pristine `originalImage`, NOT the recycled `baseImage`.
                // This ensures that doing 5 edits in a row doesn't compress the background 5 times.
                console.log("Compositing AI result over pristine original background...");
                const perfectComposite = await applyMaskComposite(originalImage || DEFAULT_IMAGE, maskData, resultBase64);

                // Update the state with the perfectly blended composite
                setBaseImage(perfectComposite);

                // Clear the drawing (mask) since it's been consumed
                setHistoryStep(-1);
                setHistory([]);
                saveHistory();

                if (onAssetGenerated) {
                    onAssetGenerated(perfectComposite, config.prompt);
                }
            }
        } catch (error: any) {
            console.error("Edit generation failed:", error);
            const errorMessage = error?.message || "Generation failed. Please check your API key and try again.";
            alert(errorMessage);
        } finally {
            setIsGenerating(false);
        }
    };

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
                        // Draw the base image on the canvas
                        ctx.drawImage(img, 0, 0, width, height);
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

        // Sticker interaction takes precedence if active
        if (sticker) return;

        if (tool === 'move' || e.button === 1) {
            setIsDragging(true);
            setDragStart({ x: e.clientX, y: e.clientY });
            setElementStart({ x: offset.x, y: offset.y });
        } else if (tool === 'paint' || tool === 'erase') {
            setIsDrawing(true);
            const canvas = canvasRef.current;
            if (!canvas) return;
            const { x, y } = getCanvasCoordinates(e, canvas);
            setLastPos({ x, y });
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.beginPath();
            ctx.arc(x, y, (20 / scale), 0, Math.PI * 2);
            ctx.fillStyle = tool === 'erase' ? 'rgba(0,0,0,1)' : brushColor;
            ctx.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over';
            ctx.fill();
        }
    };

    // Global listeners for smooth dragging outside canvas bounds
    useEffect(() => {
        if (!stickerDrag) return;

        const handleGlobalMove = (e: MouseEvent) => {
            e.preventDefault();
            const dx = (e.clientX - stickerDrag.startX) / scale;
            const dy = (e.clientY - stickerDrag.startY) / scale;

            if (stickerDrag.mode === 'move') {
                setSticker(prev => prev ? ({
                    ...prev,
                    x: stickerDrag.startState.x + dx,
                    y: stickerDrag.startState.y + dy
                }) : null);
            } else if (stickerDrag.mode === 'resize') {
                // Use the larger movement component or scalar project for smoother diagonal resizing
                // Simple approach: Average of dx/dy if dragging from corner, or just dominant axis
                // Since handle is bottom-right, positive dx/dy means grow.

                // Taking the max of dx/dy provides a "snappier" feel, taking average is smoother. 
                // Let's use the larger delta to allow growing efficiently in any direction
                const delta = Math.abs(dx) > Math.abs(dy) ? dx : dy;

                const newWidth = Math.max(20, stickerDrag.startState.width + delta);
                setSticker(prev => prev ? ({
                    ...prev,
                    width: newWidth,
                    height: newWidth / prev.aspect
                }) : null);
            } else if (stickerDrag.mode === 'rotate' && stickerDrag.centerX !== undefined && stickerDrag.centerY !== undefined) {
                // Calculate angle from center
                const angleRad = Math.atan2(e.clientY - stickerDrag.centerY, e.clientX - stickerDrag.centerX);
                const angleDeg = angleRad * (180 / Math.PI);
                // Adjust for handle position (top = -90deg)
                setSticker(prev => prev ? ({
                    ...prev,
                    rotation: angleDeg + 90
                }) : null);
            }
        };

        const handleGlobalUp = () => {
            setStickerDrag(null);
        };

        window.addEventListener('mousemove', handleGlobalMove);
        window.addEventListener('mouseup', handleGlobalUp);

        return () => {
            window.removeEventListener('mousemove', handleGlobalMove);
            window.removeEventListener('mouseup', handleGlobalUp);
        };
    }, [stickerDrag, scale]);

    const handleMouseMove = (e: React.MouseEvent) => {
        // Sticker drag is now handled by the global effect
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
            ctx.strokeStyle = tool === 'erase' ? 'rgba(255, 255, 255, 1)' : brushColor;
            ctx.stroke();
            setLastPos({ x, y });
        }
    };

    const handleMouseUp = () => {
        // Sticker drag up is handled by global effect
        if (isDrawing) {
            setIsDrawing(false);
            saveHistory();
        }
        setIsDragging(false);
    };

    // Zoom controls — explicit +/- buttons only (mouse-wheel zoom intentionally disabled)
    const ZOOM_MIN = 0.1;
    const ZOOM_MAX = 4;
    const ZOOM_STEP = 0.1;
    const clampZoom = (v: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number(v.toFixed(2))));
    const handleZoomIn = () => setScale(prev => clampZoom(prev + ZOOM_STEP));
    const handleZoomOut = () => setScale(prev => clampZoom(prev - ZOOM_STEP));
    const handleZoomReset = () => setScale(1);

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

    const handleRedo = () => {
        if (historyStep < history.length - 1) {
            const newStep = historyStep + 1;
            const canvas = canvasRef.current;
            if (canvas) {
                const ctx = canvas.getContext('2d');
                if (ctx) ctx.putImageData(history[newStep], 0, 0);
            }
            setHistoryStep(newStep);
        }
    };

    const handleStickerFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !canvasRef.current) return;

        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
                // Initial placement: Center, 50% width
                const canvasW = canvasRef.current!.width;
                const aspect = img.width / img.height;
                const initialW = canvasW * 0.5;
                const initialH = initialW / aspect;
                const initialX = (canvasW - initialW) / 2;
                const initialY = (canvasRef.current!.height - initialH) / 2;

                setSticker({
                    src: ev.target?.result as string,
                    x: initialX,
                    y: initialY,
                    width: initialW,
                    height: initialH,
                    rotation: 0,
                    skewX: 0,
                    skewY: 0,
                    aspect
                });
                setTool('sticker');
                setShowPerspective(false);
            };
            img.src = ev.target!.result as string;
        };
        reader.readAsDataURL(file);
        // Clear input so same file can be selected again
        e.target.value = '';
    };

    const handleRemoveBackground = async () => {
        if (!sticker) return;

        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = sticker.src;
        await new Promise<void>((resolve) => { img.onload = () => resolve(); });

        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // Sample top-left pixel
        const r0 = data[0];
        const g0 = data[1];
        const b0 = data[2];
        const a0 = data[3];

        const tolerance = 30; // 0-255

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            // Simple Euclidean distance or just absolute diff sum
            if (
                Math.abs(r - r0) < tolerance &&
                Math.abs(g - g0) < tolerance &&
                Math.abs(b - b0) < tolerance
            ) {
                data[i + 3] = 0; // Transparent
            }
        }

        ctx.putImageData(imageData, 0, 0);
        setSticker({ ...sticker, src: canvas.toDataURL() });
    };

    const handleStickerStamp = () => {
        if (!sticker || !canvasRef.current) return;

        const ctx = canvasRef.current.getContext('2d');
        if (!ctx) return;

        const img = new Image();
        img.onload = () => {
            ctx.save();
            ctx.translate(sticker.x + sticker.width / 2, sticker.y + sticker.height / 2);
            ctx.rotate(sticker.rotation * Math.PI / 180);

            // Apply Skew if present
            const sx = (sticker.skewX || 0) * Math.PI / 180;
            const sy = (sticker.skewY || 0) * Math.PI / 180;
            ctx.transform(1, Math.tan(sy), Math.tan(sx), 1, 0, 0);

            ctx.drawImage(img, -sticker.width / 2, -sticker.height / 2, sticker.width, sticker.height);
            ctx.restore();

            saveHistory();

            // Auto-add sticker as reference to prevent AI hallucination
            if (!referenceAssets.includes(sticker.src)) {
                setReferenceAssets(prev => [...prev, sticker.src]);
            }

            setSticker(null);
            setTool('paint'); // Auto-switch to mask tool for blending
            setShowPerspective(false);
        };
        img.src = sticker.src;
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
            link.download = `godseye-edit-${Date.now()}.png`;
            link.click();

        } catch (e) {
            console.error("Download failed", e);
        }
    };

    // Helper to calculate center
    const getStickerScreenCenter = () => {
        if (!sticker || !canvasRef.current) return null;
        const rect = canvasRef.current.getBoundingClientRect();
        // Convert sticker center (canvas coords) to Screen Coords
        const cx = rect.left + (sticker.x + sticker.width / 2) * scale;
        const cy = rect.top + (sticker.y + sticker.height / 2) * scale;
        return { cx, cy };
    };

    return (
        <div className="relative w-full h-full bg-bg overflow-hidden flex items-center justify-center pt-40" ref={containerRef}>
            <div className="absolute top-32 left-1/2 transform -translate-x-1/2 z-50 bg-panel border border-border rounded-full px-4 py-2 flex items-center gap-4 shadow-lg">
                <div className="flex items-center gap-2">
                    <button onClick={() => setTool('paint')} className={`p-2 rounded-full transition-colors ${tool === 'paint' ? 'bg-brand text-bg' : 'text-text-secondary hover:text-text-primary'}`} title="Paint"><Pen size={18} /></button>
                    <button onClick={() => setTool('erase')} className={`p-2 rounded-full transition-colors ${tool === 'erase' ? 'bg-brand text-bg' : 'text-text-secondary hover:text-text-primary'}`} title="Erase"><Eraser size={18} /></button>
                    <button
                        onClick={() => {
                            setTool('erase');
                            setConfig(prev => ({ ...prev, prompt: 'Remove the masked object and fill background seamlessly' }));
                        }}
                        className={`p-2 rounded-full transition-colors ${config.prompt.includes('Remove the masked object') ? 'text-brand' : 'text-text-secondary hover:text-text-primary'}`}
                        title="Magic Eraser (Auto-Prompt)"
                    >
                        <Sparkles size={18} />
                    </button>
                    <button onClick={() => setTool('move')} className={`p-2 rounded-full transition-colors ${tool === 'move' ? 'bg-brand text-bg' : 'text-text-secondary hover:text-text-primary'}`} title="Move"><Hand size={18} /></button>
                    <button onClick={() => stickerInputRef.current?.click()} className={`p-2 rounded-full transition-colors ${tool === 'sticker' || sticker ? 'bg-brand text-bg' : 'text-text-secondary hover:text-text-primary'}`} title="Add Image Sticker">
                        <ImagePlus size={18} />
                    </button>
                    <input ref={stickerInputRef} type="file" className="hidden" accept="image/*" onChange={handleStickerFileSelect} />
                </div>

                <div className="w-px h-4 bg-border" />

                {/* Color Picker */}
                <div className="flex items-center gap-2 px-2">
                    {MASK_COLORS.map(c => (
                        <button
                            key={c.id}
                            onClick={() => { setBrushColor(c.value); setTool('paint'); }}
                            className={`w-6 h-6 rounded-full border-2 transition-all hover:scale-110 ${brushColor === c.value ? 'border-white scale-110' : 'border-transparent opacity-70 hover:opacity-100'}`}
                            style={{ backgroundColor: c.value.replace('0.4', '1') }}
                            title={c.label}
                        />
                    ))}
                </div>

                <div className="w-px h-4 bg-border" />

                <div className="flex items-center gap-2">
                    <button
                        onClick={handleUndo}
                        disabled={historyStep <= 0}
                        className="p-2 rounded-full text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-text-secondary"
                        title="Undo"
                    ><Undo2 size={18} /></button>
                    <button
                        onClick={handleRedo}
                        disabled={historyStep >= history.length - 1}
                        className="p-2 rounded-full text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-text-secondary"
                        title="Redo"
                    ><Redo2 size={18} /></button>
                </div>

                <div className="w-px h-4 bg-border" />

                {/* Zoom controls */}
                <div className="flex items-center gap-1">
                    <button
                        onClick={handleZoomOut}
                        disabled={scale <= ZOOM_MIN + 0.001}
                        className="p-2 rounded-full text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-text-secondary"
                        title="Zoom out"
                    ><Minus size={18} /></button>
                    <button
                        onClick={handleZoomReset}
                        className="px-2 py-1 rounded-full text-xs font-semibold text-text-secondary hover:text-text-primary hover:bg-white/[0.04] transition-colors tabular-nums min-w-[3.25rem] text-center"
                        title="Reset zoom to 100%"
                    >{Math.round(scale * 100)}%</button>
                    <button
                        onClick={handleZoomIn}
                        disabled={scale >= ZOOM_MAX - 0.001}
                        className="p-2 rounded-full text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-text-secondary"
                        title="Zoom in"
                    ><Plus size={18} /></button>
                </div>

                <div className="w-px h-4 bg-border" />

                <div className="flex items-center gap-2">
                    <button onClick={handleDownload} className="p-2 rounded-full text-text-secondary hover:text-text-primary transition-colors" title="Download"><Download size={18} /></button>
                    {baseImage && <BrainActions imageUrl={baseImage} prompt={config.prompt || 'Edited Image'} />}
                </div>
            </div>

            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="relative pointer-events-auto" style={{
                    transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                    transformOrigin: 'center',
                    width: imgDims.w,
                    height: imgDims.h
                }}>
                    <canvas
                        ref={canvasRef}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseUp}
                        className="absolute inset-0 touch-none"
                        style={{
                            cursor: tool === 'move' ? (isDragging ? 'grabbing' : 'grab') : (sticker ? 'default' : 'crosshair')
                        }}
                    />

                    {/* Sticker Overlay */}
                    {sticker && (
                        <div
                            className="absolute border-2 border-brand z-50 group"
                            style={{
                                left: sticker.x,
                                top: sticker.y,
                                width: sticker.width,
                                height: sticker.height,
                                cursor: 'move',
                                transform: `rotate(${sticker.rotation}deg) skew(${sticker.skewX || 0}deg, ${sticker.skewY || 0}deg)`
                            }}
                            onMouseDown={(e) => {
                                e.stopPropagation();
                                setStickerDrag({ startX: e.clientX, startY: e.clientY, startState: sticker, mode: 'move' });
                            }}
                        >
                            <img src={sticker.src} className="w-full h-full object-contain pointer-events-none" alt="sticker" />

                            {/* Actions Header */}
                            <div className="absolute -top-12 left-0 right-0 flex justify-center gap-2 pointer-events-auto">
                                <button onClick={handleRemoveBackground} className="bg-blue-600 text-white p-1 rounded hover:scale-110 shadow-lg" title="Remove Background (Magic Wand)">
                                    <Wand2 size={20} strokeWidth={2} />
                                </button>
                                <button onClick={() => setShowPerspective(!showPerspective)} className={`bg-purple-600 text-white p-1 rounded hover:scale-110 shadow-lg ${showPerspective ? 'ring-2 ring-white' : ''}`} title="Perspective / Tilt">
                                    <BoxSelect size={20} strokeWidth={2} />
                                </button>
                                <div className="w-px h-6 bg-gray-500 mx-1"></div>
                                <button onClick={handleStickerStamp} className="bg-green-500 text-white p-1 rounded hover:scale-110 shadow-lg" title="Stamp (Burn) to Canvas">
                                    <Check size={20} strokeWidth={3} />
                                </button>
                                <button onClick={() => setSticker(null)} className="bg-red-500 text-white p-1 rounded hover:scale-110 shadow-lg" title="Cancel">
                                    <X size={20} strokeWidth={3} />
                                </button>
                            </div>

                            {/* Perspective Sliders removed from here */}

                            {/* Rotation Handle */}
                            <div className="absolute -top-12 left-1/2 -ml-px h-8 w-px bg-brand pointer-events-none" />
                            <div
                                className="absolute -top-16 left-1/2 -ml-3 w-6 h-6 bg-white border border-brand rounded-full flex items-center justify-center cursor-pointer hover:scale-110 shadow-md"
                                onMouseDown={(e) => {
                                    e.stopPropagation();
                                    const center = getStickerScreenCenter();
                                    if (center) {
                                        setStickerDrag({
                                            startX: e.clientX,
                                            startY: e.clientY,
                                            startState: sticker,
                                            mode: 'rotate',
                                            centerX: center.cx,
                                            centerY: center.cy
                                        });
                                    }
                                }}
                            >
                                <RotateCw size={12} className="text-brand" />
                            </div>

                            {/* Resize Handle */}
                            <div
                                className="absolute -bottom-3 -right-3 w-6 h-6 bg-brand rounded-full cursor-se-resize shadow-md"
                                onMouseDown={(e) => {
                                    e.stopPropagation();
                                    setStickerDrag({ startX: e.clientX, startY: e.clientY, startState: sticker, mode: 'resize' });
                                }}
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* Perspective HUD (Fixed Overlay) */}
            {sticker && showPerspective && (
                <div
                    className="absolute bottom-24 right-8 z-50 bg-panel border-2 border-brand/50 p-4 rounded-xl shadow-2xl flex flex-col gap-3 w-56 animate-scale-in"
                    onMouseDown={e => e.stopPropagation()}
                >
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold uppercase text-brand tracking-wider">3D Perspective</span>
                        <button onClick={() => setShowPerspective(false)} className="text-text-secondary hover:text-white"><X size={14} /></button>
                    </div>

                    <div className="flex items-center gap-3">
                        <span className="text-xs text-text-secondary w-8 font-mono">X-Tilt</span>
                        <input
                            type="range" min="-60" max="60" value={sticker.skewX || 0}
                            onChange={(e) => setSticker({ ...sticker, skewX: Number(e.target.value) })}
                            className="flex-1 h-1.5 bg-surface rounded-lg appearance-none cursor-pointer accent-brand"
                        />
                        <span className="text-xs text-text-primary w-6 text-right">{sticker.skewX || 0}°</span>
                    </div>

                    <div className="flex items-center gap-3">
                        <span className="text-xs text-text-secondary w-8 font-mono">Y-Tilt</span>
                        <input
                            type="range" min="-60" max="60" value={sticker.skewY || 0}
                            onChange={(e) => setSticker({ ...sticker, skewY: Number(e.target.value) })}
                            className="flex-1 h-1.5 bg-surface rounded-lg appearance-none cursor-pointer accent-brand"
                        />
                        <span className="text-xs text-text-primary w-6 text-right">{sticker.skewY || 0}°</span>
                    </div>

                    <button
                        onClick={() => setSticker({ ...sticker, skewX: 0, skewY: 0 })}
                        className="text-[10px] text-text-secondary hover:text-brand mt-1 self-end uppercase font-bold tracking-wide"
                    >
                        Reset Tilt
                    </button>
                </div>
            )}

            <ControlBar
                config={config}
                setConfig={setConfig}
                onGenerate={handleGenerate}
                onEnterDrawMode={() => { }}
                isGenerating={isGenerating}
                inputImages={referenceAssets}
                setInputImages={setReferenceAssets}
                perspective={perspective}
                setPerspective={setPerspective}
                objectOrientation={objectOrientation}
                setObjectOrientation={setObjectOrientation}
            />
        </div>
    );
};