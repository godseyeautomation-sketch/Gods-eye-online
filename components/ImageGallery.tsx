
import React, { useState, useRef, useEffect } from 'react';
import { GeneratedAsset } from '../types';
import { Download, Share2, Maximize2, PenTool, Trash2, Video, RefreshCw, AlertCircle, FolderSync, Zap, Copy, Check, Layers, Eye } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { BrainActions } from './BrainActions';
import { QwenLayerEditor } from './QwenLayerEditor';
import { ImageLightbox } from './ImageLightbox';

interface ImageGalleryProps {
  assets: GeneratedAsset[];
  onEdit?: (url: string) => void;
  onDelete?: (id: string, url: string) => void;
  onToVideo?: (url: string) => void;
  onAssetsUpdated?: () => void;
  /** Bubble a preview request up so a single lightbox instance can render at App level. */
  onRequestPreview?: (asset: GeneratedAsset) => void;
}

export const ImageGallery: React.FC<ImageGalleryProps> = ({ assets, onEdit, onDelete, onToVideo, onAssetsUpdated, onRequestPreview }) => {
  const { user } = useAuth();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [loadingImages, setLoadingImages] = useState<Set<string>>(new Set());
  const [layerEditorAsset, setLayerEditorAsset] = useState<GeneratedAsset | null>(null);
  const [previewAsset, setPreviewAsset] = useState<GeneratedAsset | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const imageRefs = useRef<Map<string, HTMLImageElement>>(new Map());
  const loadingTimeouts = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Test mode: Press 'T' key to toggle test mode (shows button even if no failures)
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 't' || e.key === 'T') {
        if (e.shiftKey && e.ctrlKey) {
          setTestMode(prev => !prev);
          if (!testMode) {
            // Simulate a failed image for testing
            setFailedImages(new Set(['test-image']));
          } else {
            setFailedImages(new Set());
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [testMode]);

  const handleDownload = async (url: string, id: string, prompt: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `godseye-image-${id}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Download failed', error);
    }
  };

  const handleCopyPrompt = (id: string, prompt: string) => {
    navigator.clipboard.writeText(prompt).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  };

  const handleImageError = (assetId: string) => {
    console.log('🟥 Image failed to load:', assetId);
    setFailedImages(prev => {
      const newSet = new Set(prev).add(assetId);
      console.log('🟥 Failed images count:', newSet.size);
      return newSet;
    });
    setLoadingImages(prev => {
      const newSet = new Set(prev);
      newSet.delete(assetId);
      return newSet;
    });
    // Clear timeout if exists
    const timeout = loadingTimeouts.current.get(assetId);
    if (timeout) {
      clearTimeout(timeout);
      loadingTimeouts.current.delete(assetId);
    }
  };

  const handleImageLoad = (assetId: string) => {
    setFailedImages(prev => {
      const newSet = new Set(prev);
      newSet.delete(assetId);
      return newSet;
    });
    setLoadingImages(prev => {
      const newSet = new Set(prev);
      newSet.delete(assetId);
      return newSet;
    });
    // Clear timeout if exists
    const timeout = loadingTimeouts.current.get(assetId);
    if (timeout) {
      clearTimeout(timeout);
      loadingTimeouts.current.delete(assetId);
    }
  };

  const handleImageStartLoad = (assetId: string) => {
    // Prevent multiple calls for the same image
    if (loadingImages.has(assetId)) return;

    setLoadingImages(prev => new Set(prev).add(assetId));
    // If image takes more than 5 seconds to load, mark it as potentially failed
    const timeout = setTimeout(() => {
      const imgElement = imageRefs.current.get(assetId);
      if (imgElement && !imgElement.complete) {
        // Image is still loading after 5 seconds - show button
        console.log('⏱️ Image taking too long to load:', assetId);
        setFailedImages(prev => {
          const newSet = new Set(prev).add(assetId);
          console.log('⏱️ Failed images count (slow load):', newSet.size);
          return newSet;
        });
      }
      loadingTimeouts.current.delete(assetId);
    }, 5000);
    loadingTimeouts.current.set(assetId, timeout);
  };

  const handleAutoScan = async () => {
    if (failedImages.size === 0) return;

    setIsScanning(true);
    const failedIds = Array.from(failedImages);

    // Retry loading each failed image
    for (const assetId of failedIds) {
      const imgElement = imageRefs.current.get(assetId);
      if (imgElement) {
        // Force reload by adding timestamp to URL or reloading
        const currentSrc = imgElement.src;
        imgElement.src = '';
        // Small delay to ensure browser resets
        await new Promise(resolve => setTimeout(resolve, 100));
        imgElement.src = currentSrc + (currentSrc.includes('?') ? '&' : '?') + `_retry=${Date.now()}`;
      }
    }

    // Wait a bit for images to load, then check again
    setTimeout(() => {
      setIsScanning(false);
    }, 2000);
  };

  // Reset failed images when assets change
  useEffect(() => {
    setFailedImages(new Set());
    setLoadingImages(new Set());
    // Clear all timeouts
    loadingTimeouts.current.forEach(timeout => clearTimeout(timeout));
    loadingTimeouts.current.clear();
  }, [assets.length]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      loadingTimeouts.current.forEach(timeout => clearTimeout(timeout));
      loadingTimeouts.current.clear();
    };
  }, []);

  // Debug: Log when button should appear (must be before conditional returns)
  const hasIssues = failedImages.size > 0 || testMode;
  useEffect(() => {
    if (hasIssues) {
      console.log('🔴 Auto Scan button should be visible. Failed images:', Array.from(failedImages));
    }
  }, [hasIssues, failedImages]);

  const handleFolderSync = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length || !user) return;

    setIsSyncing(true);
    const { saveToLocalGallery } = await import('../services/localStorageService');

    // Filter for 'klint' files only (images)
    const files = Array.from(e.target.files).filter((f: File) =>
      f.name.toLowerCase().includes('gods') && f.type.startsWith('image/')
    );

    if (files.length === 0) {
      alert("No 'Gods Eye' images found in that folder.");
      setIsSyncing(false);
      return;
    }

    let count = 0;
    for (const file of files as File[]) {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const b64 = ev.target?.result as string;
        await saveToLocalGallery(
          b64,
          file.name.replace('.png', '').replace(/_/g, ' '),
          '16:9',
          'Imported',
          user.id
        );
        count++;
        if (count === files.length) {
          setIsSyncing(false);
          alert(`Imported ${count} images! Gallery will refresh shortly.`);
          if (onAssetsUpdated) {
            setTimeout(() => onAssetsUpdated(), 500);
          }
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const hasNoVisibleImages = assets.length === 0 || (assets.length > 0 && failedImages.size === assets.length);

  // All hooks must be called before any conditional returns
  if (assets.length === 0) {
    return (
      <div className="relative flex-1 flex flex-col items-center justify-center text-text-secondary pt-40 pb-40 min-h-[calc(100vh-4rem)]">
        <div aria-hidden className="pointer-events-none absolute inset-0 top-16 -z-0 overflow-hidden">
          <div className="absolute top-[-10%] left-[-10%] right-[40%] h-[600px] aw-aurora" style={{ background: 'radial-gradient(45% 50% at 25% 35%, rgba(204,255,0,0.10), transparent 65%)' }} />
          <div className="absolute bottom-[-20%] left-[40%] right-[-10%] h-[600px] aw-aurora" style={{ background: 'radial-gradient(40% 50% at 70% 70%, rgba(204,255,0,0.05), transparent 65%)', animationDelay: '-9s', animationDuration: '20s' }} />
        </div>

        {/* Folder Sync Button - Top Right */}
        <div className="fixed top-28 right-6 z-[9999]">
          <label className="cursor-pointer flex items-center gap-2 px-4 py-2.5 bg-brand text-bg rounded-xl font-bold text-sm shadow-2xl transition-all hover:scale-105 active:scale-95 border-2 border-brand/20">
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
            <input
              ref={folderInputRef}
              type="file"
              {...{ webkitdirectory: "", directory: "" } as any}
              className="hidden"
              onChange={handleFolderSync}
              disabled={isSyncing}
            />
          </label>
        </div>

        <div className="relative z-10 text-center">
          <p className="aw-fade-up text-[10px] tracking-[0.22em] text-text-secondary/60 uppercase font-semibold flex items-center justify-center gap-2" style={{ animationDelay: '0ms' }}>
            <span className="relative flex w-2 h-2">
              <span className="absolute inset-0 rounded-full bg-brand animate-ping opacity-75" />
              <span className="relative w-2 h-2 rounded-full bg-brand" />
            </span>
            Image Studio
          </p>
          <h1 className="aw-fade-up text-4xl md:text-5xl font-serif italic text-text-primary mt-3 leading-[1.05] tracking-tight" style={{ animationDelay: '120ms' }}>
            Your canvas is empty<span className="aw-blink text-brand ml-1">.</span>
          </h1>
          <p className="aw-fade-up text-sm text-text-secondary/80 mt-3 max-w-md mx-auto leading-relaxed" style={{ animationDelay: '240ms' }}>
            Enter a prompt below to start creating. Every generation lands here in your gallery — searchable, editable, ready for the next move.
          </p>
        </div>
      </div>
    );
  }

  // Helper: Optimize for thumbnail display
  const getOptimizedUrl = (url: string, width = 500) => {
    // Optimization disabled: original high-res URL is used (Base64 or external)
    return url;
  };

  return (
    <>
    <div className="w-full px-4 md:px-8 pb-32 pt-40 relative">
      {/* Folder Sync Button - Shows when no images are visible */}
      {hasNoVisibleImages && (
        <div className="fixed top-28 right-6 z-[9999] animate-slide-in">
          <label className="cursor-pointer flex items-center gap-2 px-4 py-2.5 bg-brand text-bg rounded-xl font-bold text-sm shadow-2xl transition-all hover:scale-105 active:scale-95 border-2 border-brand/20">
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
            <input
              ref={folderInputRef}
              type="file"
              {...{ webkitdirectory: "", directory: "" } as any}
              className="hidden"
              onChange={handleFolderSync}
              disabled={isSyncing}
            />
          </label>
        </div>
      )}

      {/* Auto Scan Button - Shows when images fail to load or are slow */}
      {hasIssues && !hasNoVisibleImages && (
        <div
          className="fixed top-28 right-6 z-[9999] animate-slide-in"
          style={{
            position: 'fixed',
            zIndex: 9999,
            pointerEvents: 'auto'
          }}
        >
          <button
            onClick={handleAutoScan}
            disabled={isScanning}
            className="flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold text-sm shadow-2xl transition-all hover:scale-105 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed border-2 border-red-400"
            style={{
              boxShadow: '0 10px 40px rgba(220, 38, 38, 0.5)',
              zIndex: 9999
            }}
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

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
        {assets.map((asset) => {
          // Skeleton loading card
          if (asset.loading) {
            return (
              <div key={asset.id} className="relative rounded-2xl overflow-hidden bg-panel/60 backdrop-blur-md border border-white/5 animate-fade-in self-start">
                <div className="w-full aspect-[4/3] bg-white/[0.03] animate-pulse flex flex-col items-center justify-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-brand/20 flex items-center justify-center">
                    <Zap size={18} className="text-brand animate-pulse" />
                  </div>
                  <p className="text-[10px] text-brand/60 font-mono uppercase tracking-widest">Generating…</p>
                </div>
                <div className="p-3 space-y-2">
                  <div className="h-3 bg-white/[0.05] rounded-full w-3/4 animate-pulse" />
                  <div className="h-3 bg-white/[0.05] rounded-full w-1/2 animate-pulse" />
                </div>
              </div>
            );
          }

          const hasFailed = failedImages.has(asset.id);
          return (
            <div key={asset.id} className="group relative rounded-2xl overflow-hidden bg-panel/60 backdrop-blur-md border border-white/5 animate-fade-in shadow-sm hover:shadow-xl hover:shadow-brand/5 transition-all hover:-translate-y-1 hover:border-white/10 self-start">
              <div className="relative">
                <img
                  ref={(el) => {
                    if (el) {
                      imageRefs.current.set(asset.id, el);
                    } else {
                      imageRefs.current.delete(asset.id);
                    }
                  }}
                  src={getOptimizedUrl(asset.url)}
                  alt={asset.prompt}
                  loading="lazy"
                  onError={() => handleImageError(asset.id)}
                  onLoad={() => handleImageLoad(asset.id)}
                  onLoadStart={() => handleImageStartLoad(asset.id)}
                  // width={500} // Removed to prevent browser resizing hints
                  className={`w-full h-auto object-contain bg-white/5 ${hasFailed ? 'opacity-50' : ''}`}
                />
                {hasFailed && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="text-center p-4">
                      <AlertCircle size={24} className="text-red-500 mx-auto mb-2" />
                      <p className="text-xs text-white font-medium">Image failed to load</p>
                    </div>
                  </div>
                )}
              </div>

              {/* TOP CORNERS: Delete top-left + Brain Tag top-right */}
              <div className="absolute top-0 left-0 right-0 flex items-start justify-between p-2.5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10">
                {onDelete ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(asset.id, asset.url); }}
                    className="w-8 h-8 bg-black/70 backdrop-blur-md rounded-full text-red-400 flex items-center justify-center border border-red-500/30 transition-all hover:bg-red-600 hover:text-white hover:scale-110 active:scale-95 shadow-lg"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                ) : <div />}
                <BrainActions imageUrl={asset.url} prompt={asset.prompt} />
              </div>

              {/* BOTTOM: Prompt + action buttons */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4 pt-14">
                <div className="flex items-start gap-1.5 mb-3">
                  <p className="text-white text-sm line-clamp-2 font-bold leading-snug flex-1">{asset.prompt}</p>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleCopyPrompt(asset.id, asset.prompt); }}
                    className="shrink-0 w-7 h-7 bg-black/50 backdrop-blur-md rounded-lg text-white flex items-center justify-center border border-white/10 transition-all hover:scale-110 active:scale-95 hover:bg-white/10"
                    title="Copy prompt"
                  >
                    {copiedId === asset.id ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="px-2.5 py-1 rounded-lg bg-black/40 backdrop-blur-md border border-white/10 text-[10px] text-white font-mono uppercase truncate max-w-[110px]">
                    {asset.model || 'GEMINI-3-PRO'}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {/* Qwen Layered: Edit Layers button */}
                    {asset.layers && asset.layers.length > 1 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setLayerEditorAsset(asset); }}
                        className="w-9 h-9 bg-brand text-bg rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-110 active:scale-95"
                        title="Edit Layers"
                      >
                        <Layers size={16} />
                      </button>
                    )}
                    {onEdit && !asset.layers && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onEdit(asset.url); }}
                        className="w-9 h-9 bg-brand text-bg rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-110 active:scale-95"
                        title="Edit & Refine"
                      >
                        <PenTool size={16} />
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); (onRequestPreview ?? setPreviewAsset)(asset); }}
                      className="w-9 h-9 bg-black/60 backdrop-blur-md rounded-full text-white flex items-center justify-center border border-white/10 transition-transform hover:scale-110 active:scale-95"
                      title="Preview"
                    >
                      <Eye size={16} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDownload(asset.url, asset.id, asset.prompt); }}
                      className="w-9 h-9 bg-black/60 backdrop-blur-md rounded-full text-white flex items-center justify-center border border-white/10 transition-transform hover:scale-110 active:scale-95"
                      title="Download"
                    >
                      <Download size={16} />
                    </button>
                    {onToVideo && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onToVideo(asset.url); }}
                        className="w-9 h-9 bg-black/60 backdrop-blur-md rounded-full text-white flex items-center justify-center border border-white/10 transition-transform hover:scale-110 active:scale-95"
                        title="Convert to Video"
                      >
                        <Video size={16} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
            );
          })}
      </div>
    </div>

      {/* Qwen Layer Editor modal */}
      {layerEditorAsset?.layers && (
        <QwenLayerEditor
          layers={layerEditorAsset.layers}
          prompt={layerEditorAsset.prompt}
          onClose={() => setLayerEditorAsset(null)}
        />
      )}

      {/* Full-screen image preview lightbox */}
      {previewAsset && (
        <ImageLightbox
          url={previewAsset.url}
          prompt={previewAsset.prompt}
          onClose={() => setPreviewAsset(null)}
        />
      )}
    </>
  );
};
