import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronUp, ChevronDown, GripVertical } from 'lucide-react';
import type { TimelineClip } from '../../types';

interface Props {
  clip: TimelineClip;
  index: number;
  total: number;
  frames: string[];
  onTrimChange: (inPoint: number, outPoint: number) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export const TimelineTrack: React.FC<Props> = ({
  clip, index, total, frames, onTrimChange, onMoveUp, onMoveDown,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'in' | 'out' | null>(null);

  const pctIn = (clip.inPoint / clip.duration) * 100;
  const pctOut = (clip.outPoint / clip.duration) * 100;
  const trimmedDuration = clip.outPoint - clip.inPoint;

  const handlePointerDown = useCallback((handle: 'in' | 'out') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(handle);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const time = pct * clip.duration;

    if (dragging === 'in') {
      const newIn = Math.min(time, clip.outPoint - 0.1);
      onTrimChange(Math.max(0, newIn), clip.outPoint);
    } else {
      const newOut = Math.max(time, clip.inPoint + 0.1);
      onTrimChange(clip.inPoint, Math.min(clip.duration, newOut));
    }
  }, [dragging, clip, onTrimChange]);

  const handlePointerUp = useCallback(() => {
    setDragging(null);
  }, []);

  return (
    <div className="flex items-center gap-2 group">
      {/* Reorder buttons */}
      <div className="flex flex-col gap-0.5 flex-shrink-0">
        <button
          onClick={onMoveUp}
          disabled={index === 0}
          className="w-6 h-6 rounded bg-white/[0.04] flex items-center justify-center
                     text-white/20 hover:text-white/50 disabled:opacity-20 transition-all"
        >
          <ChevronUp size={12} />
        </button>
        <button
          onClick={onMoveDown}
          disabled={index === total - 1}
          className="w-6 h-6 rounded bg-white/[0.04] flex items-center justify-center
                     text-white/20 hover:text-white/50 disabled:opacity-20 transition-all"
        >
          <ChevronDown size={12} />
        </button>
      </div>

      {/* Clip number */}
      <span className="text-[10px] text-white/25 w-4 flex-shrink-0 text-center">{index + 1}</span>

      {/* Track bar */}
      <div className="flex-1 min-w-0">
        <div
          ref={trackRef}
          className="relative h-14 rounded-lg overflow-hidden bg-[#1a1a1a] border border-white/8 cursor-default select-none"
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          {/* Thumbnail strip background */}
          <div className="absolute inset-0 flex">
            {frames.length > 0 ? frames.map((f, i) => (
              <img
                key={i}
                src={f}
                className="h-full flex-1 object-cover opacity-50"
                draggable={false}
              />
            )) : (
              <div className="w-full h-full bg-gradient-to-r from-white/[0.03] to-white/[0.06]" />
            )}
          </div>

          {/* Dim areas outside trim */}
          <div
            className="absolute inset-y-0 left-0 bg-black/70"
            style={{ width: `${pctIn}%` }}
          />
          <div
            className="absolute inset-y-0 right-0 bg-black/70"
            style={{ width: `${100 - pctOut}%` }}
          />

          {/* Active trim region border */}
          <div
            className="absolute inset-y-0 border-y-2 border-[#c8ff00]/50"
            style={{ left: `${pctIn}%`, right: `${100 - pctOut}%` }}
          />

          {/* In handle */}
          <div
            className={`absolute inset-y-0 w-3 cursor-col-resize z-10 flex items-center justify-center
              ${dragging === 'in' ? 'bg-[#c8ff00]' : 'bg-[#c8ff00]/70 hover:bg-[#c8ff00]'} transition-colors`}
            style={{ left: `calc(${pctIn}% - 6px)` }}
            onPointerDown={handlePointerDown('in')}
          >
            <GripVertical size={10} className="text-black/60" />
          </div>

          {/* Out handle */}
          <div
            className={`absolute inset-y-0 w-3 cursor-col-resize z-10 flex items-center justify-center
              ${dragging === 'out' ? 'bg-[#c8ff00]' : 'bg-[#c8ff00]/70 hover:bg-[#c8ff00]'} transition-colors`}
            style={{ left: `calc(${pctOut}% - 6px)` }}
            onPointerDown={handlePointerDown('out')}
          >
            <GripVertical size={10} className="text-black/60" />
          </div>
        </div>

        {/* Duration label */}
        <div className="flex justify-between mt-1 px-1">
          <span className="text-[9px] text-white/25">{clip.inPoint.toFixed(1)}s</span>
          <span className="text-[10px] text-[#c8ff00]/50 font-medium">{trimmedDuration.toFixed(1)}s</span>
          <span className="text-[9px] text-white/25">{clip.outPoint.toFixed(1)}s</span>
        </div>
      </div>
    </div>
  );
};
