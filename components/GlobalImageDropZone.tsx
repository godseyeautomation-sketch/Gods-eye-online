import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, AlertTriangle } from 'lucide-react';

interface GlobalImageDropZoneProps {
  /** Disable entirely (e.g. on tabs where dropping doesn't make sense). */
  enabled: boolean;
  /** Called with the accepted image Files once the user drops. */
  onDropImages: (files: File[]) => void;
}

/**
 * Full-viewport drag-and-drop overlay for attaching image files.
 *
 * Behavior:
 *   - Listens at `window` for dragenter/dragleave/dragover/drop.
 *   - While the user drags ANYTHING over the app, a lime dashed overlay fades
 *     in covering the whole viewport with a "Drop images to attach" hint.
 *   - On drop:
 *     - If at least one image/* file is present → hands them to `onDropImages`
 *       and flashes a small "Attached N images" toast.
 *     - If no image files (e.g. PDF, video, text) → shows a red rejection
 *       toast "Only images supported."
 *   - Dragging items INSIDE the page (text, canvas strokes, etc.) never
 *     triggers the overlay — we only light up when there's an external
 *     file in the drag data.
 */
export const GlobalImageDropZone: React.FC<GlobalImageDropZoneProps> = ({ enabled, onDropImages }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  // Counter to survive dragenter bubbling across nested elements — the
  // ghost flickers otherwise.
  const dragDepth = useRef(0);

  const showToast = useCallback((text: string, kind: 'ok' | 'error') => {
    setToast({ text, kind });
    window.setTimeout(() => setToast(null), 2200);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    // Returns true when the drag contains at least one external file
    // (Chrome/Firefox put "Files" in types when OS files are being dragged).
    const hasFiles = (e: DragEvent) => {
      const types = e.dataTransfer?.types;
      if (!types) return false;
      for (let i = 0; i < types.length; i++) {
        if (types[i] === 'Files') return true;
      }
      return false;
    };

    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setIsDragging(true);
    };

    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      // Let the browser show the "copy" cursor instead of "move"
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };

    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setIsDragging(false);
    };

    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setIsDragging(false);

      const all = Array.from(e.dataTransfer?.files || []);
      if (all.length === 0) return;

      const images = all.filter(f => f.type.startsWith('image/'));
      const rejected = all.length - images.length;

      if (images.length === 0) {
        showToast('Only images supported — other files were rejected.', 'error');
        return;
      }

      onDropImages(images);

      const suffix = rejected > 0 ? ` (${rejected} non-image file${rejected > 1 ? 's' : ''} rejected)` : '';
      const noun = images.length === 1 ? 'image' : 'images';
      showToast(`Attached ${images.length} ${noun}${suffix}`, rejected > 0 ? 'error' : 'ok');
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);

    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      dragDepth.current = 0;
    };
  }, [enabled, onDropImages, showToast]);

  // Reset state if parent flips enabled off mid-drag
  useEffect(() => {
    if (!enabled) {
      dragDepth.current = 0;
      setIsDragging(false);
    }
  }, [enabled]);

  return (
    <>
      {/* Full-page drag overlay */}
      {enabled && isDragging && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-[90] pointer-events-none flex items-center justify-center animate-in fade-in duration-150"
          style={{ background: 'rgba(0, 0, 0, 0.55)', backdropFilter: 'blur(6px)' }}
        >
          {/* Dashed brand-colored border box */}
          <div
            className="flex flex-col items-center justify-center gap-3 px-12 py-10 rounded-3xl"
            style={{
              border: '2px dashed #CCFF00',
              background: 'rgba(204, 255, 0, 0.05)',
              boxShadow: '0 0 60px rgba(204, 255, 0, 0.2)',
            }}
          >
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: 'rgba(204, 255, 0, 0.15)', color: '#CCFF00' }}
            >
              <ImagePlus size={28} strokeWidth={2.5} />
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-white tracking-tight">Drop images to attach</p>
              <p className="text-xs text-white/60 mt-1">PNG, JPG, WEBP, GIF — anything else will be rejected</p>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[95] pointer-events-none animate-in fade-in slide-in-from-bottom-2 duration-200"
        >
          <div
            className="flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-semibold shadow-lg"
            style={
              toast.kind === 'ok'
                ? { background: '#CCFF00', color: '#000' }
                : { background: '#2a0e0e', color: '#ff6b6b', border: '1px solid rgba(255, 107, 107, 0.3)' }
            }
          >
            {toast.kind === 'ok' ? <ImagePlus size={14} /> : <AlertTriangle size={14} />}
            <span>{toast.text}</span>
          </div>
        </div>
      )}
    </>
  );
};
