/**
 * Video Processing Service — Browser-Native (No FFmpeg!)
 *
 * Uses Canvas + MediaRecorder for combining/trimming videos.
 * Zero external downloads, instant start, no browser freezing.
 * Exports as WebM (VP9) which plays everywhere.
 */

import type { TimelineClip } from '../types';
import { getVideoBlob } from './localStorageService';

/* ─── Frame Extraction (for timeline thumbnails) ─────────────────── */

/** Get video duration in seconds (with timeout) */
export const getVideoDuration = (url: string): Promise<number> => {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(0), 10000);
    const video = document.createElement('video');
    video.src = url;
    video.preload = 'metadata';
    video.onloadedmetadata = () => { clearTimeout(timeout); resolve(video.duration || 0); };
    video.onerror = () => { clearTimeout(timeout); resolve(0); };
  });
};

/** Extract thumbnail frames using native video + canvas */
export const extractFrames = async (
  videoUrl: string,
  count: number = 8
): Promise<string[]> => {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve([]), 15000);
    const video = document.createElement('video');
    video.src = videoUrl;
    if (!videoUrl.startsWith('blob:')) video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'metadata';

    video.onloadedmetadata = () => {
      const duration = video.duration;
      if (!duration || duration === Infinity) { clearTimeout(timeout); resolve([]); return; }

      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 90;
      const ctx = canvas.getContext('2d')!;
      const frames: string[] = [];
      const interval = duration / (count + 1);
      let current = 0;

      const captureNext = () => {
        current++;
        if (current > count) { clearTimeout(timeout); resolve(frames); return; }
        video.currentTime = current * interval;
      };

      video.onseeked = () => {
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          frames.push(canvas.toDataURL('image/jpeg', 0.6));
        } catch { /* canvas tainted */ }
        captureNext();
      };

      captureNext();
    };

    video.onerror = () => { clearTimeout(timeout); resolve([]); };
  });
};

/* ─── Video Combine/Export — Browser Native ──────────────────────── */

/**
 * Load a video element and wait for it to be ready at a specific time.
 */
const loadVideoAt = (url: string, time: number): Promise<HTMLVideoElement> => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Video load timeout')), 15000);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;

    video.onloadeddata = () => {
      video.currentTime = time;
      video.onseeked = () => {
        clearTimeout(timeout);
        resolve(video);
      };
    };
    video.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('Failed to load video'));
    };
  });
};

/**
 * Combine multiple trimmed clips into a single video file.
 * Uses Canvas + MediaRecorder — fully browser-native, no WASM, no downloads.
 * Plays each clip in real-time and records the canvas output.
 *
 * For a 7s combined video → ~7s export time. But:
 * - Zero setup time (no 30MB WASM download)
 * - Doesn't freeze the browser
 * - Works everywhere
 */
export const combineVideos = async (
  clips: TimelineClip[],
  onProgress?: (pct: number, msg: string) => void
): Promise<Blob> => {
  const sorted = [...clips].sort((a, b) => a.order - b.order);
  if (sorted.length === 0) throw new Error('No clips to export');

  onProgress?.(5, 'Preparing clips...');

  // Resolve blob URLs for all clips
  const clipData: { url: string; inPoint: number; outPoint: number; duration: number }[] = [];
  for (const clip of sorted) {
    let url = clip.url;
    let blob = clip.blob;
    if (!blob) {
      blob = await getVideoBlob(clip.videoId) ?? undefined;
      if (!blob) {
        const originalId = clip.videoId.replace(/_[ab]_\d+$/, '');
        if (originalId !== clip.videoId) {
          blob = await getVideoBlob(originalId) ?? undefined;
        }
      }
    }
    if (blob && blob.size > 0) {
      url = URL.createObjectURL(blob);
    }
    clipData.push({ url, inPoint: clip.inPoint, outPoint: clip.outPoint, duration: clip.outPoint - clip.inPoint });
  }

  const totalDuration = clipData.reduce((sum, c) => sum + c.duration, 0);

  // Set up canvas
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, 1280, 720);

  // Pick best available codec
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
      ? 'video/webm;codecs=vp8'
      : 'video/webm';

  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  recorder.start(100);

  onProgress?.(10, 'Recording clips...');

  let elapsed = 0;

  for (let i = 0; i < clipData.length; i++) {
    const clip = clipData[i];
    onProgress?.(10 + Math.round((elapsed / totalDuration) * 80), `Recording clip ${i + 1}/${clipData.length}...`);

    const video = await loadVideoAt(clip.url, clip.inPoint);

    await new Promise<void>((resolve) => {
      video.play().catch(() => {});

      const drawFrame = () => {
        if (video.currentTime >= clip.outPoint - 0.03 || video.ended || video.paused) {
          video.pause();

          // Draw one final frame
          try {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          } catch {}

          resolve();
          return;
        }

        // Draw frame, fitting to canvas
        try {
          const vw = video.videoWidth || 1280;
          const vh = video.videoHeight || 720;
          const scale = Math.min(1280 / vw, 720 / vh);
          const dw = vw * scale;
          const dh = vh * scale;
          const dx = (1280 - dw) / 2;
          const dy = (720 - dh) / 2;
          ctx.fillStyle = 'black';
          ctx.fillRect(0, 0, 1280, 720);
          ctx.drawImage(video, dx, dy, dw, dh);
        } catch {}

        // Update progress
        const currentElapsed = elapsed + (video.currentTime - clip.inPoint);
        const pct = 10 + Math.round((currentElapsed / totalDuration) * 80);
        onProgress?.(pct, `Recording ${Math.round(currentElapsed)}s / ${Math.round(totalDuration)}s`);

        requestAnimationFrame(drawFrame);
      };

      // Also stop at outPoint via timeupdate (more reliable for short clips)
      video.ontimeupdate = () => {
        if (video.currentTime >= clip.outPoint - 0.03) {
          video.pause();
        }
      };

      requestAnimationFrame(drawFrame);
    });

    elapsed += clip.duration;
  }

  onProgress?.(92, 'Finalizing video...');

  // Stop recording
  const outputBlob = await new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    recorder.stop();
  });

  // Cleanup
  stream.getTracks().forEach(t => t.stop());
  for (const clip of clipData) {
    if (clip.url.startsWith('blob:')) {
      try { URL.revokeObjectURL(clip.url); } catch {}
    }
  }

  onProgress?.(100, 'Done!');
  return outputBlob;
};
