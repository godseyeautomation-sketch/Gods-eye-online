import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  X, Download, Loader2, AlertCircle, Play, Pause, Scissors,
  Trash2, Volume2, VolumeX, ZoomIn, ZoomOut, SkipBack, SkipForward,
} from 'lucide-react';
import type { TimelineClip } from '../../types';
import type { StoredVideo } from '../../services/localStorageService';
import { getVideoBlob } from '../../services/localStorageService';

interface Props {
  videos: StoredVideo[];
  onClose: () => void;
}

/* ─── helpers ────────────────────────────────────────────────────────── */

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const fr = Math.floor((s % 1) * 100);
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${fr.toString().padStart(2, '0')}`;
};

/* ─── component ──────────────────────────────────────────────────────── */

const VideoTimeline: React.FC<Props> = ({ videos, onClose }) => {
  /* — state — */
  const [clips, setClips] = useState<TimelineClip[]>([]);
  const [frames, setFrames] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportMsg, setExportMsg] = useState('');
  const [error, setError] = useState<string | null>(null);

  // global playhead = seconds into the full concatenated timeline
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [selectedClipIdx, setSelectedClipIdx] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1); // px per second

  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const draggingPlayhead = useRef(false);
  const lastVideoSrc = useRef('');

  /* — init clips — */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { getVideoDuration, extractFrames } = await import('../../services/videoProcessingService');
      const newClips: TimelineClip[] = [];
      const newFrames: Record<string, string[]> = {};

      for (let i = 0; i < videos.length; i++) {
        const v = videos[i];
        const dur = await getVideoDuration(v.url);
        const blob = await getVideoBlob(v.id);
        let playUrl = v.url;
        if (blob && blob.size > 0) playUrl = URL.createObjectURL(blob);

        newClips.push({
          videoId: v.id, url: playUrl, blob: blob ?? undefined,
          inPoint: 0, outPoint: dur || 5, duration: dur || 5, order: i,
        });
        newFrames[v.id] = await extractFrames(playUrl, 12);
      }

      if (!cancelled) { setClips(newClips); setFrames(newFrames); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [videos]);

  /* — derived — */
  const clipRanges = useMemo(() => {
    let off = 0;
    return clips.map(c => {
      const len = c.outPoint - c.inPoint;
      const r = { start: off, end: off + len, clip: c };
      off += len;
      return r;
    });
  }, [clips]);

  const totalDuration = useMemo(() => clipRanges.length ? clipRanges[clipRanges.length - 1].end : 0, [clipRanges]);

  // which clip is the playhead on?
  const activeRange = useMemo(() => {
    for (let i = clipRanges.length - 1; i >= 0; i--) {
      if (playhead >= clipRanges[i].start) return { idx: i, ...clipRanges[i] };
    }
    return clipRanges.length ? { idx: 0, ...clipRanges[0] } : null;
  }, [playhead, clipRanges]);

  const PX_PER_SEC = 80 * zoom;

  /* — refs for playback state (avoids stale closures) — */
  const playheadRef = useRef(playhead);
  playheadRef.current = playhead;
  const clipRangesRef = useRef(clipRanges);
  clipRangesRef.current = clipRanges;
  const totalDurationRef = useRef(totalDuration);
  totalDurationRef.current = totalDuration;
  const currentClipIdx = useRef(-1); // tracks which clip is loaded in <video>

  /** Find which clipRange the given time falls in */
  const findRange = (t: number) => {
    const ranges = clipRangesRef.current;
    for (let i = ranges.length - 1; i >= 0; i--) {
      if (t >= ranges[i].start) return { idx: i, ...ranges[i] };
    }
    return ranges.length ? { idx: 0, ...ranges[0] } : null;
  };

  /** Load a clip into the video element without interrupting if already loaded */
  const loadClipIntoVideo = useCallback((clipUrl: string, localTime: number, shouldPlay: boolean) => {
    const vid = videoRef.current;
    if (!vid) return;
    if (lastVideoSrc.current !== clipUrl) {
      lastVideoSrc.current = clipUrl;
      vid.src = clipUrl;
    }
    vid.currentTime = localTime;
    if (shouldPlay) vid.play().catch(() => {});
  }, []);

  /* — Sync video when scrubbing (not playing) — */
  useEffect(() => {
    if (isPlaying) return;
    const vid = videoRef.current;
    if (!vid || !activeRange) return;
    const clip = activeRange.clip;
    const localTime = clip.inPoint + (playhead - activeRange.start);
    loadClipIntoVideo(clip.url, localTime, false);
    currentClipIdx.current = activeRange.idx;
  }, [playhead, activeRange, isPlaying, loadClipIntoVideo]);

  /* — Playback engine: single rAF loop drives playhead + video — */
  useEffect(() => {
    if (!isPlaying) {
      cancelAnimationFrame(animRef.current);
      videoRef.current?.pause();
      return;
    }

    const vid = videoRef.current;
    if (!vid) return;
    vid.muted = isMuted;

    // Ensure the correct clip is loaded at the start of playback
    const range = findRange(playheadRef.current);
    if (range) {
      const localTime = range.clip.inPoint + (playheadRef.current - range.start);
      loadClipIntoVideo(range.clip.url, localTime, true);
      currentClipIdx.current = range.idx;
    }

    let lastT = performance.now();

    const tick = (now: number) => {
      const dt = (now - lastT) / 1000;
      lastT = now;

      const newPlayhead = playheadRef.current + dt;

      if (newPlayhead >= totalDurationRef.current) {
        setPlayhead(totalDurationRef.current);
        setIsPlaying(false);
        vid.pause();
        return;
      }

      // Check if we've crossed into a new clip
      const range = findRange(newPlayhead);
      if (range && range.idx !== currentClipIdx.current) {
        // Switch to new clip seamlessly
        const localTime = range.clip.inPoint + (newPlayhead - range.start);
        lastVideoSrc.current = range.clip.url;
        vid.src = range.clip.url;
        vid.currentTime = localTime;
        vid.play().catch(() => {});
        currentClipIdx.current = range.idx;
      }

      setPlayhead(newPlayhead);
      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(animRef.current); };
  }, [isPlaying, isMuted, loadClipIntoVideo]);

  /* — controls — */
  const togglePlay = useCallback(() => {
    if (isPlaying) { setIsPlaying(false); return; }
    if (playhead >= totalDuration) setPlayhead(0);
    setIsPlaying(true);
  }, [isPlaying, playhead, totalDuration]);

  const seekTo = useCallback((t: number) => {
    const clamped = Math.max(0, Math.min(totalDuration, t));
    setPlayhead(clamped);
    setIsPlaying(false);
  }, [totalDuration]);

  /* — split at playhead (CapCut style) — */
  const handleSplit = useCallback(() => {
    if (!activeRange) return;
    const { idx, start, clip } = activeRange;
    const localTime = clip.inPoint + (playhead - start);

    // Don't split too close to edges
    if (localTime <= clip.inPoint + 0.15 || localTime >= clip.outPoint - 0.15) return;

    setClips(prev => {
      const arr = [...prev];
      const original = arr[idx];
      const clipA: TimelineClip = {
        ...original,
        videoId: original.videoId + '_a_' + Date.now(),
        outPoint: localTime,
        order: idx,
      };
      const clipB: TimelineClip = {
        ...original,
        videoId: original.videoId + '_b_' + Date.now(),
        inPoint: localTime,
        order: idx + 1,
      };
      arr.splice(idx, 1, clipA, clipB);
      return arr.map((c, i) => ({ ...c, order: i }));
    });
  }, [activeRange, playhead]);

  const handleDeleteClip = useCallback((idx: number) => {
    setClips(prev => {
      if (prev.length <= 1) return prev; // keep at least 1
      const arr = prev.filter((_, i) => i !== idx);
      return arr.map((c, i) => ({ ...c, order: i }));
    });
    setSelectedClipIdx(null);
    if (playhead > totalDuration) setPlayhead(0);
  }, [playhead, totalDuration]);

  /* — trim handles (drag in/out on clip edges) — */
  const trimDrag = useRef<{ idx: number; edge: 'in' | 'out'; startX: number; startVal: number } | null>(null);

  const onTrimPointerDown = useCallback((idx: number, edge: 'in' | 'out', e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const clip = clips[idx];
    trimDrag.current = { idx, edge, startX: e.clientX, startVal: edge === 'in' ? clip.inPoint : clip.outPoint };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [clips]);

  const onTrimPointerMove = useCallback((e: React.PointerEvent) => {
    const d = trimDrag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dt = dx / PX_PER_SEC;
    setClips(prev => prev.map((c, i) => {
      if (i !== d.idx) return c;
      if (d.edge === 'in') {
        const newIn = Math.max(0, Math.min(c.outPoint - 0.2, d.startVal + dt));
        return { ...c, inPoint: newIn };
      } else {
        const newOut = Math.max(c.inPoint + 0.2, Math.min(c.duration, d.startVal + dt));
        return { ...c, outPoint: newOut };
      }
    }));
  }, [PX_PER_SEC]);

  const onTrimPointerUp = useCallback(() => { trimDrag.current = null; }, []);

  /* — playhead drag on timeline — */
  const onTimelinePointerDown = useCallback((e: React.PointerEvent) => {
    if (!trackRef.current) return;
    draggingPlayhead.current = true;
    setIsPlaying(false);
    const rect = trackRef.current.getBoundingClientRect();
    const scrollLeft = trackRef.current.parentElement?.scrollLeft || 0;
    const x = e.clientX - rect.left + scrollLeft;
    seekTo(x / PX_PER_SEC);
  }, [PX_PER_SEC, seekTo]);

  const onTimelinePointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingPlayhead.current || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const scrollLeft = trackRef.current.parentElement?.scrollLeft || 0;
    const x = e.clientX - rect.left + scrollLeft;
    seekTo(x / PX_PER_SEC);
  }, [PX_PER_SEC, seekTo]);

  const onTimelinePointerUp = useCallback(() => { draggingPlayhead.current = false; }, []);

  /* — export — */
  const handleExport = useCallback(async () => {
    setExporting(true); setError(null); setExportProgress(0);
    try {
      const { combineVideos } = await import('../../services/videoProcessingService');
      const blob = await combineVideos(clips, (pct, msg) => { setExportProgress(pct); setExportMsg(msg); });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `godseye-edit-${Date.now()}.webm`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setExporting(false); onClose();
    } catch (e: any) { setError(e.message || 'Export failed'); setExporting(false); }
  }, [clips, onClose]);

  /* — auto-scroll timeline to keep playhead visible — */
  useEffect(() => {
    if (!timelineRef.current) return;
    const container = timelineRef.current;
    const playheadPx = playhead * PX_PER_SEC;
    const viewLeft = container.scrollLeft;
    const viewRight = viewLeft + container.clientWidth;
    const margin = 100;
    if (playheadPx < viewLeft + margin) {
      container.scrollLeft = Math.max(0, playheadPx - margin);
    } else if (playheadPx > viewRight - margin) {
      container.scrollLeft = playheadPx - container.clientWidth + margin;
    }
  }, [playhead, PX_PER_SEC]);

  /* — time ruler ticks — */
  const rulerTicks = useMemo(() => {
    const ticks: { pos: number; label: string; major: boolean }[] = [];
    // Determine interval based on zoom
    let interval = 1; // 1 second ticks
    if (zoom < 0.5) interval = 5;
    if (zoom < 0.3) interval = 10;
    const dur = Math.max(totalDuration, 5);
    for (let t = 0; t <= dur + interval; t += interval) {
      ticks.push({ pos: t * PX_PER_SEC, label: fmt(t), major: t % (interval * 5 === 0 ? 5 : 5) === 0 });
    }
    // Also add half-second ticks if zoomed in
    if (zoom >= 1) {
      for (let t = 0.5; t <= dur; t += interval) {
        ticks.push({ pos: t * PX_PER_SEC, label: '', major: false });
      }
    }
    return ticks;
  }, [totalDuration, PX_PER_SEC, zoom]);

  /* ════════════════════════ RENDER ════════════════════════ */

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0a0a] flex flex-col select-none">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 h-12 flex-shrink-0 border-b border-white/8 bg-[#0d0d0d]">
        <h3 className="text-white text-[14px] font-bold">Video Editor</h3>
        <div className="flex items-center gap-3">
          <span className="text-white/25 text-[11px]">{clips.length} clip{clips.length !== 1 ? 's' : ''} · {totalDuration.toFixed(1)}s</span>
          <button onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/[0.06] flex items-center justify-center text-white/30 hover:text-white hover:bg-white/10 transition-all">
            <X size={16} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center gap-3">
          <Loader2 size={20} className="animate-spin text-[#c8ff00]/60" />
          <span className="text-white/40 text-[13px]">Loading clips...</span>
        </div>
      ) : (
        <>
          {/* ── Preview Player ── */}
          <div className="flex-1 flex items-center justify-center bg-black min-h-0 p-4">
            <div className="relative max-w-3xl w-full aspect-video bg-black rounded-xl overflow-hidden border border-white/10">
              <video ref={videoRef} className="w-full h-full object-contain" muted={isMuted} playsInline onClick={togglePlay} />
              {!isPlaying && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-14 h-14 rounded-full bg-white/10 backdrop-blur-xl flex items-center justify-center">
                    <Play size={24} className="text-white ml-1" />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Transport Bar ── */}
          <div className="flex items-center gap-1 px-4 py-2 border-t border-white/8 bg-[#111] flex-shrink-0">
            {/* Time */}
            <span className="text-[#c8ff00] text-[12px] font-mono w-[90px]">{fmt(playhead)}</span>
            <span className="text-white/20 text-[12px] font-mono w-[90px]">{fmt(totalDuration)}</span>

            <div className="w-px h-5 bg-white/10 mx-1" />

            {/* Playback */}
            <button onClick={() => seekTo(0)} className="w-8 h-8 rounded-lg bg-white/[0.05] flex items-center justify-center text-white/40 hover:text-white transition-all">
              <SkipBack size={14} />
            </button>
            <button onClick={togglePlay}
              className="w-10 h-8 rounded-lg bg-white/[0.08] flex items-center justify-center text-white hover:bg-white/15 transition-all">
              {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
            </button>
            <button onClick={() => seekTo(totalDuration)} className="w-8 h-8 rounded-lg bg-white/[0.05] flex items-center justify-center text-white/40 hover:text-white transition-all">
              <SkipForward size={14} />
            </button>

            <div className="w-px h-5 bg-white/10 mx-1" />

            {/* Split */}
            <button onClick={handleSplit} title="Split at playhead"
              className="flex items-center gap-1.5 px-3 h-8 rounded-lg bg-white/[0.05] text-white/50 hover:text-[#c8ff00] hover:bg-[#c8ff00]/10 transition-all text-[11px] font-medium">
              <Scissors size={14} />
              Split
            </button>

            {/* Delete selected clip */}
            {selectedClipIdx !== null && clips.length > 1 && (
              <button onClick={() => handleDeleteClip(selectedClipIdx)} title="Delete selected clip"
                className="flex items-center gap-1.5 px-3 h-8 rounded-lg bg-white/[0.05] text-white/50 hover:text-red-400 hover:bg-red-500/10 transition-all text-[11px] font-medium">
                <Trash2 size={13} />
                Delete
              </button>
            )}

            <div className="flex-1" />

            {/* Mute */}
            <button onClick={() => setIsMuted(m => !m)}
              className="w-8 h-8 rounded-lg bg-white/[0.05] flex items-center justify-center text-white/30 hover:text-white transition-all">
              {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>

            {/* Zoom */}
            <button onClick={() => setZoom(z => Math.max(0.2, z - 0.2))}
              className="w-8 h-8 rounded-lg bg-white/[0.05] flex items-center justify-center text-white/30 hover:text-white transition-all">
              <ZoomOut size={14} />
            </button>
            <span className="text-[10px] text-white/25 w-8 text-center">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(z => Math.min(3, z + 0.2))}
              className="w-8 h-8 rounded-lg bg-white/[0.05] flex items-center justify-center text-white/30 hover:text-white transition-all">
              <ZoomIn size={14} />
            </button>
          </div>

          {/* ── Timeline ── */}
          <div className="flex-shrink-0 bg-[#0d0d0d] border-t border-white/8"
            style={{ height: 180 }}>

            {/* Scrollable area */}
            <div ref={timelineRef} className="w-full h-full overflow-x-auto overflow-y-hidden relative"
              onPointerDown={onTimelinePointerDown}
              onPointerMove={onTimelinePointerMove}
              onPointerUp={onTimelinePointerUp}
              onPointerLeave={onTimelinePointerUp}
            >
              <div ref={trackRef}
                className="relative"
                style={{ width: Math.max(totalDuration * PX_PER_SEC + 200, 800), height: '100%' }}
              >
                {/* Time ruler */}
                <div className="h-6 relative border-b border-white/[0.06]">
                  {rulerTicks.map((tick, i) => (
                    <div key={i} className="absolute top-0" style={{ left: tick.pos }}>
                      <div className={`w-px ${tick.label ? 'h-4 bg-white/15' : 'h-2 bg-white/8'}`} />
                      {tick.label && (
                        <span className="absolute top-0.5 left-1 text-[9px] text-white/25 whitespace-nowrap">{tick.label}</span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Clip track */}
                <div className="relative h-[70px] mt-2 mx-0"
                  onPointerMove={onTrimPointerMove}
                  onPointerUp={onTrimPointerUp}
                  onPointerLeave={onTrimPointerUp}
                >
                  {clipRanges.map((range, i) => {
                    const clip = range.clip;
                    const widthPx = (clip.outPoint - clip.inPoint) * PX_PER_SEC;
                    const leftPx = range.start * PX_PER_SEC;
                    const isSelected = selectedClipIdx === i;
                    const clipFrames = frames[clip.videoId.replace(/_[ab]_\d+$/, '')] || frames[clip.videoId] || [];

                    return (
                      <div key={clip.videoId + '_' + i}
                        className={`absolute top-0 h-full rounded-lg overflow-hidden cursor-pointer transition-shadow
                          ${isSelected ? 'ring-2 ring-[#c8ff00] shadow-lg shadow-[#c8ff00]/10' : 'ring-1 ring-white/15 hover:ring-white/30'}`}
                        style={{ left: leftPx, width: widthPx }}
                        onClick={(e) => { e.stopPropagation(); setSelectedClipIdx(i); }}
                      >
                        {/* Filmstrip thumbnails */}
                        <div className="absolute inset-0 flex">
                          {clipFrames.length > 0 ? clipFrames.map((f, fi) => (
                            <img key={fi} src={f} className="h-full flex-1 object-cover opacity-70" draggable={false} />
                          )) : (
                            <div className="w-full h-full bg-gradient-to-r from-[#1a2a00] to-[#0a1500]" />
                          )}
                        </div>

                        {/* Clip overlay info */}
                        <div className="absolute bottom-1 left-2 flex items-center gap-1.5">
                          <span className="text-[10px] text-white/80 font-medium bg-black/50 px-1.5 py-0.5 rounded">
                            Clip {i + 1}
                          </span>
                          <span className="text-[9px] text-white/40 bg-black/50 px-1.5 py-0.5 rounded">
                            {(clip.outPoint - clip.inPoint).toFixed(1)}s
                          </span>
                        </div>

                        {/* Left trim handle */}
                        <div
                          className={`absolute left-0 top-0 bottom-0 w-3 cursor-col-resize z-10 flex items-center justify-center
                            ${isSelected ? 'bg-[#c8ff00]' : 'bg-[#c8ff00]/60'} hover:bg-[#c8ff00] transition-colors`}
                          onPointerDown={e => onTrimPointerDown(i, 'in', e)}
                          onClick={e => e.stopPropagation()}
                        >
                          <div className="w-0.5 h-5 bg-black/40 rounded-full" />
                        </div>

                        {/* Right trim handle */}
                        <div
                          className={`absolute right-0 top-0 bottom-0 w-3 cursor-col-resize z-10 flex items-center justify-center
                            ${isSelected ? 'bg-[#c8ff00]' : 'bg-[#c8ff00]/60'} hover:bg-[#c8ff00] transition-colors`}
                          onPointerDown={e => onTrimPointerDown(i, 'out', e)}
                          onClick={e => e.stopPropagation()}
                        >
                          <div className="w-0.5 h-5 bg-black/40 rounded-full" />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Audio waveform placeholder track */}
                <div className="relative h-6 mt-1 mx-0">
                  {clipRanges.map((range, i) => {
                    const clip = range.clip;
                    const widthPx = (clip.outPoint - clip.inPoint) * PX_PER_SEC;
                    const leftPx = range.start * PX_PER_SEC;
                    return (
                      <div key={'audio_' + i}
                        className="absolute top-0 h-full rounded bg-[#c8ff00]/5 border border-[#c8ff00]/10 overflow-hidden"
                        style={{ left: leftPx, width: widthPx }}
                      >
                        {/* Fake waveform bars */}
                        <div className="flex items-end h-full gap-px px-0.5">
                          {Array.from({ length: Math.max(1, Math.floor(widthPx / 3)) }).map((_, bi) => (
                            <div key={bi} className="flex-1 bg-[#c8ff00]/20 rounded-t-sm"
                              style={{ height: `${20 + Math.random() * 80}%` }} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* ── Playhead ── */}
                <div className="absolute top-0 bottom-0 z-30 pointer-events-none"
                  style={{ left: playhead * PX_PER_SEC }}>
                  {/* Head triangle */}
                  <div className="relative -left-[7px] top-0 w-[14px] h-5 flex items-start justify-center">
                    <svg width="14" height="18" viewBox="0 0 14 18" className="drop-shadow-lg">
                      <path d="M0 0h14v12l-7 6-7-6z" fill="#c8ff00" />
                    </svg>
                  </div>
                  {/* Vertical line */}
                  <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#c8ff00] -translate-x-[1px]"
                    style={{ boxShadow: '0 0 8px rgba(200,255,0,0.4)' }} />
                </div>
              </div>
            </div>
          </div>

          {/* ── Error ── */}
          {error && (
            <div className="mx-4 my-2 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-2">
              <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
              <p className="text-red-300 text-[12px] flex-1">{error}</p>
              <button onClick={() => setError(null)} className="text-red-400/50 hover:text-red-300"><X size={12} /></button>
            </div>
          )}

          {/* ── Export Bar ── */}
          <div className="flex items-center gap-3 px-5 py-3 border-t border-white/8 bg-[#0d0d0d] flex-shrink-0">
            {exporting ? (
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-white/50 text-[11px]">{exportMsg}</span>
                  <span className="text-[#c8ff00]/60 text-[11px] font-medium">{exportProgress}%</span>
                </div>
                <div className="w-full h-1.5 bg-white/8 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-[#c8ff00]/60 to-[#c8ff00] transition-all duration-300"
                    style={{ width: `${exportProgress}%` }} />
                </div>
              </div>
            ) : (
              <>
                <p className="flex-1 text-white/20 text-[11px]">
                  Drag yellow handles to trim · Split ✂ at playhead · Reorder by splitting
                </p>
                <button onClick={handleExport} disabled={clips.length === 0}
                  className="flex items-center gap-2 px-6 py-2.5 bg-[#c8ff00] text-black text-[13px] font-bold
                             rounded-full hover:bg-[#d4ff33] transition-colors disabled:opacity-30 shadow-lg shadow-[#c8ff00]/20">
                  <Download size={14} />
                  Export Video
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default VideoTimeline;
