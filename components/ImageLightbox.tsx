import React, { useEffect } from 'react';
import { X, Download } from 'lucide-react';

interface ImageLightboxProps {
  url: string;
  prompt?: string;
  onClose: () => void;
}

/**
 * Full-screen lightbox preview for a generated image.
 * - Close via X button, ESC key, or clicking the backdrop.
 * - Click on the image itself does NOT close (stopPropagation).
 */
export const ImageLightbox: React.FC<ImageLightboxProps> = ({ url, prompt, onClose }) => {
  // ESC closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Lock body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `godseye-preview-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(url, '_blank');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-xl animate-in fade-in duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
    >
      {/* Top bar — close + download */}
      <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
        <button
          onClick={handleDownload}
          className="w-11 h-11 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-white flex items-center justify-center transition-all hover:bg-white/20 hover:scale-105 active:scale-95"
          title="Download"
        >
          <Download size={20} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="w-11 h-11 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-white flex items-center justify-center transition-all hover:bg-white/20 hover:scale-105 active:scale-95"
          title="Close (Esc)"
          aria-label="Close preview"
        >
          <X size={22} />
        </button>
      </div>

      {/* Image — click doesn't close */}
      <div
        className="relative max-w-[92vw] max-h-[88vh] flex flex-col items-center gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={url}
          alt={prompt || 'Generated image preview'}
          className="max-w-full max-h-[80vh] object-contain rounded-xl shadow-[0_20px_80px_rgba(0,0,0,0.6)]"
        />
        {prompt && (
          <div className="max-w-2xl px-4 py-2 rounded-xl bg-white/[0.06] border border-white/10 backdrop-blur-md">
            <p className="text-sm text-white/80 text-center line-clamp-2 leading-snug">{prompt}</p>
          </div>
        )}
      </div>

      {/* Hint */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[11px] text-white/40 font-medium tracking-wide pointer-events-none">
        Press <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/70 font-mono text-[10px]">Esc</kbd> or click outside to close
      </div>
    </div>
  );
};
