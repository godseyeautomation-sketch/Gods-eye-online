/**
 * Kling 3.0 Reel Video Service
 *
 * When the Review agent generates a still image for a Reel-format slot, the
 * platform actually wants a *video*, not a still. This helper takes that
 * image + the slot's prompt and produces a Kling 3.0 image-to-video that
 * preserves the face/scene from the still and animates it into motion.
 *
 * Why Kling 3.0 specifically? Kuaishou's Kling models handle human faces and
 * brand product shots equally well, so we don't need a face-detection branch
 * (per the user's request — "always use Kling for Reels"). It's costlier
 * than Seedance but reliably good for both.
 *
 * Endpoint: fal-ai/kling-video/v3/pro/image-to-video
 * Input:    { prompt, image_url, aspect_ratio: '9:16', duration: '5' }
 * Output:   { video: { url } }
 *
 * The function blocks the caller until Kling finishes (polled every 4s with
 * a 5-min cap). Server-side approve handlers should call this with .catch()
 * and treat it as fire-and-forget, since 60-180s is too long for an HTTP
 * request to wait. The slot's `generated_video` field is updated when done.
 */

const FAL_BASE = 'https://queue.fal.run';
const KLING_MODEL = 'fal-ai/kling-video/v3/pro/image-to-video';

function getFalKey() {
  return process.env.FAL_KEY || process.env.VITE_FAL_KEY || '';
}

async function falFetch(url, opts = {}) {
  const key = getFalKey();
  if (!key) throw new Error('FAL_KEY not configured on server');
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Key ${key}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && (data.detail || data.message || data.error)) || `Kling request failed (${res.status})`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return data;
}

/**
 * Generate a Kling 3.0 reel from a still image.
 * @param {string} imageUrl  - Source image URL (any format fal accepts: data: URLs, https URLs, fal.media URLs)
 * @param {string} prompt    - Motion prompt (Priya's image_prompt + visual_direction concatenated)
 * @param {string} aspectRatio - '9:16' | '16:9' | '1:1' — defaults to 9:16 since reels are vertical
 * @returns {Promise<string>} The final video URL on fal.media
 */
export async function generateKlingReelVideo(imageUrl, prompt, aspectRatio = '9:16') {
  if (!imageUrl) throw new Error('Kling reel: imageUrl is required');
  if (!prompt || !prompt.trim()) throw new Error('Kling reel: prompt is required');

  const submitUrl = `${FAL_BASE}/${KLING_MODEL}`;
  const submitRes = await falFetch(submitUrl, {
    method: 'POST',
    body: JSON.stringify({
      prompt: prompt.trim(),
      image_url: imageUrl,
      aspect_ratio: aspectRatio,
      duration: '5',
    }),
  });

  if (!submitRes?.request_id) {
    throw new Error('Kling reel: submit returned no request_id');
  }

  console.log(`[KlingReel] submitted request_id=${submitRes.request_id}`);

  // Poll status_url until COMPLETED / FAILED / timeout
  const statusUrl = (submitRes.status_url || '').replace('https://queue.fal.run', FAL_BASE);
  const responseUrl = (submitRes.response_url || '').replace('https://queue.fal.run', FAL_BASE);
  const POLL_INTERVAL = 4000;
  const MAX_WAIT = 300000; // 5 min — Kling i2v normally takes 60-180s
  let elapsed = 0;
  let lastLog = '';

  while (elapsed < MAX_WAIT) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
    elapsed += POLL_INTERVAL;
    const status = await falFetch(`${statusUrl}?logs=1`);
    const latestLog = Array.isArray(status?.logs) && status.logs.length
      ? status.logs[status.logs.length - 1]?.message
      : '';
    if (latestLog && latestLog !== lastLog) {
      console.log(`[KlingReel] ${Math.round(elapsed / 1000)}s — ${latestLog}`);
      lastLog = latestLog;
    }
    if (status?.status === 'COMPLETED') {
      const result = await falFetch(responseUrl);
      const videoUrl =
        result?.video?.url ||
        result?.videos?.[0]?.url ||
        result?.output?.video?.url ||
        result?.data?.video?.url ||
        null;
      if (!videoUrl) {
        throw new Error('Kling reel: completed but no video URL in response');
      }
      console.log(`[KlingReel] ✓ done in ${Math.round(elapsed / 1000)}s — ${videoUrl}`);
      return videoUrl;
    }
    if (status?.status === 'FAILED') {
      throw new Error(latestLog || 'Kling reel generation failed on fal servers');
    }
  }
  throw new Error('Kling reel generation timed out after 5 minutes');
}

/**
 * Fire-and-forget helper for the approve endpoint. Generates the video in
 * the background and updates the linked content_slot's generated_video field
 * once done. Errors are logged but never thrown — the approve flow keeps
 * working even if Kling is down.
 *
 * @param {object} ctx - { slotId, imagePath, promptPath, aspectRatio, readSyncFile, writeSyncFile }
 */
export function kickOffReelVideoInBackground({ slotId, imageUrl, prompt, aspectRatio, readSyncFile, writeSyncFile }) {
  if (!slotId || !imageUrl || !prompt) return;
  // Don't await — let the caller's HTTP response complete first.
  (async () => {
    try {
      const videoUrl = await generateKlingReelVideo(imageUrl, prompt, aspectRatio);
      const slotsFile = readSyncFile('content_slots');
      const slots = slotsFile?.data || [];
      const idx = slots.findIndex(s => s.id === slotId);
      if (idx >= 0) {
        slots[idx].generated_video = videoUrl;
        slots[idx].updated_at = new Date().toISOString();
        writeSyncFile('content_slots', { _updatedAt: new Date().toISOString(), data: slots });
        console.log(`[KlingReel] Saved video to slot ${slotId}`);
      } else {
        console.warn(`[KlingReel] Could not find slot ${slotId} to attach video URL`);
      }
    } catch (err) {
      console.error(`[KlingReel] Background generation for slot ${slotId} failed:`, err?.message || err);
    }
  })();
}
