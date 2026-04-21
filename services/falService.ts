// fal.ai Video Generation Service
// All requests go through /api/fal/* proxy — FAL_KEY never exposed to client

export type GenerationStatus = 'idle' | 'submitting' | 'queued' | 'processing' | 'done' | 'error';

export interface FalQueueResult {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  queue_position?: number;
  logs?: Array<{ message: string; timestamp: string }>;
}

export interface FalVideoResult {
  video?: { url: string; content_type?: string; duration?: number };
  videos?: Array<{ url: string; content_type?: string; duration?: number }>;
  output?: { video_url?: string; video?: { url: string } };
  data?: { video_url?: string; video?: { url: string } };
  video_url?: string;
}

export interface FalJobUrls {
  requestId: string;
  statusUrl: string;   // proxied status URL
  responseUrl: string; // proxied result URL
}

// ── Helper ──────────────────────────────────────────────────────────────────

const errMsg = (e: unknown): string => {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  try { return JSON.stringify(e); } catch { return String(e); }
};

// ── FAL Storage Upload ───────────────────────────────────────────────────────

/**
 * Upload a base64 data URL to fal.ai storage via the server-side proxy.
 * Returns a public HTTPS URL that fal.ai model endpoints can accept.
 */
export const uploadToFalStorage = async (dataUrl: string): Promise<string> => {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid data URL format');
  const [, mimeType, base64Data] = match;

  // Step 1: initiate upload (our proxy → rest.fal.ai) to get signed upload_url + file_url
  const ext = mimeType.split('/')[1]?.split('+')[0] || 'jpg';
  const initiateRes = await fetch(`/api/fal-storage/storage/upload/initiate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content_type: mimeType, file_name: `upload.${ext}` }),
  });

  if (!initiateRes.ok) {
    const err = await initiateRes.json().catch(() => ({}));
    throw new Error(err?.message || err?.error || `FAL storage initiate failed: ${initiateRes.status}`);
  }

  const { upload_url, file_url } = await safeJson(initiateRes, 'storage-initiate');
  if (!upload_url || !file_url) throw new Error('FAL storage did not return upload URLs');

  // Step 2: send the image via our /api/fal-upload server proxy (avoids browser CORS on direct PUT)
  const uploadRes = await fetch(`/api/fal-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ upload_url, base64: base64Data, content_type: mimeType }),
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.json().catch(() => ({}));
    throw new Error(err?.error || `FAL storage upload failed: ${uploadRes.status}`);
  }

  return file_url;
};

/**
 * Walk through image URL fields and upload any base64 data URLs to FAL storage.
 */
const resolveInputImages = async (input: Record<string, any>): Promise<Record<string, any>> => {
  // Single-value image keys (string)
  const IMAGE_KEYS = ['image_url', 'start_image_url', 'end_image_url', 'reference_image_url', 'init_image_url'];
  // Array-value image keys (string[]) — e.g. Seedream /edit uses image_urls
  const IMAGE_ARRAY_KEYS = ['image_urls'];
  const resolved: Record<string, any> = { ...input };

  // Helper: convert blob: URL → data:image/ URL so it can be uploaded to fal storage
  const blobToDataUrl = async (blobUrl: string): Promise<string> => {
    const res = await fetch(blobUrl);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const needsUpload = (url: string) =>
    url.startsWith('data:image/') || url.startsWith('blob:');

  const resolveUrl = async (url: string): Promise<string> => {
    if (url.startsWith('blob:')) {
      const dataUrl = await blobToDataUrl(url);
      return uploadToFalStorage(dataUrl);
    }
    if (url.startsWith('data:image/')) {
      return uploadToFalStorage(url);
    }
    return url;
  };

  await Promise.all([
    // Handle single-string image fields
    ...IMAGE_KEYS.map(async (key) => {
      if (typeof resolved[key] === 'string' && needsUpload(resolved[key])) {
        resolved[key] = await resolveUrl(resolved[key]);
      }
    }),
    // Handle array image fields — upload each base64 entry
    ...IMAGE_ARRAY_KEYS.map(async (key) => {
      if (Array.isArray(resolved[key])) {
        resolved[key] = await Promise.all(
          resolved[key].map(async (url: string) =>
            typeof url === 'string' && needsUpload(url)
              ? resolveUrl(url)
              : url
          )
        );
      }
    }),
  ]);

  return resolved;
};

// ── Core API calls ──────────────────────────────────────────────────────────

/** Convert a fal.ai absolute queue URL to a proxied /api/fal/ path */
const toProxiedUrl = (absoluteUrl: string): string =>
  absoluteUrl.replace('https://queue.fal.run/', '/api/fal/');

const safeJson = async (res: Response, label: string): Promise<any> => {
  const text = await res.text();
  if (!text.trim()) throw new Error(`fal.ai ${label} returned an empty response (status ${res.status}). Check your FAL_KEY and model ID.`);
  try { return JSON.parse(text); } catch {
    throw new Error(`fal.ai ${label} returned invalid JSON (status ${res.status}): ${text.slice(0, 200)}`);
  }
};

/** Submit a video generation job to the fal.ai queue */
export const submitJob = async (modelId: string, input: Record<string, any>): Promise<FalJobUrls> => {
  const resolvedInput = await resolveInputImages(input);

  // FAL video queue endpoints always expect a FLAT body — params at body root, never in {"input":{}}.
  const requestBody = { ...resolvedInput };

  const res = await fetch(`/api/fal/${modelId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
  console.log('[falService] submitJob →', modelId, JSON.stringify(requestBody, null, 2));

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = err?.detail;
    const msg = typeof detail === 'string' ? detail
      : Array.isArray(detail) ? detail.map((d: any) => d?.msg || errMsg(d)).join(', ')
      : err?.message || err?.error || `fal.ai submit failed: ${res.status}`;
    throw new Error(msg);
  }

  const data = await safeJson(res, 'submit');
  if (!data.request_id) throw new Error('fal.ai returned no request_id. Check your FAL_KEY and model ID.');

  return {
    requestId: data.request_id,
    statusUrl: toProxiedUrl(data.status_url),
    responseUrl: toProxiedUrl(data.response_url),
  };
};

/** Poll job status using the status_url returned by submitJob.
 *  Passes logs=1 so fal.ai returns its internal log messages (queue position,
 *  model-side progress, rejection reasons). Without this flag the caller only
 *  sees 'IN_PROGRESS' for the entire run and has no diagnostic info when a
 *  job hangs. */
export const pollStatus = async (statusUrl: string): Promise<FalQueueResult> => {
  const url = statusUrl.includes('?')
    ? `${statusUrl}&logs=1`
    : `${statusUrl}?logs=1`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(errMsg(err?.detail) || `Status poll failed: ${res.status}`);
  }
  return safeJson(res, 'status');
};

/** Fetch the completed job result using response_url returned by submitJob */
export const fetchResult = async (responseUrl: string): Promise<FalVideoResult> => {
  const res = await fetch(responseUrl, { method: 'GET' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(errMsg(err?.detail) || `Result fetch failed: ${res.status}`);
  }
  return safeJson(res, 'result');
};

/** Extract the video URL from a completed result (handles model differences) */
export const extractVideoUrl = (result: FalVideoResult): string => {
  // Handle all known fal.ai response formats
  if (result.video?.url) return result.video.url;
  if (result.videos?.[0]?.url) return result.videos[0].url;
  if (result.output?.video_url) return result.output.video_url;
  if (result.output?.video?.url) return result.output.video.url;
  if (result.data?.video_url) return result.data.video_url;
  if (result.data?.video?.url) return result.data.video.url;
  if (result.video_url) return result.video_url;

  // Fallback: walk the result object looking for any .url string that looks like a video
  const findUrl = (obj: any, depth = 0): string | null => {
    if (depth > 4 || !obj || typeof obj !== 'object') return null;
    if (typeof obj.url === 'string' && (obj.url.includes('.mp4') || obj.url.includes('video') || obj.url.includes('fal.media'))) return obj.url;
    for (const key of Object.keys(obj)) {
      const found = findUrl(obj[key], depth + 1);
      if (found) return found;
    }
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = findUrl(item, depth + 1);
        if (found) return found;
      }
    }
    return null;
  };
  const found = findUrl(result);
  if (found) return found;

  console.error('[falService] Could not find video URL in result:', JSON.stringify(result).slice(0, 500));
  throw new Error('No video URL found in result. The model may have returned an unexpected format.');
};

// ── High-level fal.ai IMAGE generation (e.g. Qwen Layered) ─────────────────

export interface GenerateFalImageOptions {
  modelId: string;
  input: Record<string, any>;
  onStatus?: (status: GenerationStatus, detail?: string) => void;
}

/**
 * Generate images via a fal.ai model (queue-based, same as video).
 * Returns an array of output image URLs.
 */
export const generateFalImage = async ({
  modelId,
  input,
  onStatus,
}: GenerateFalImageOptions): Promise<string[]> => {
  onStatus?.('submitting', 'Uploading assets & submitting…');
  const { statusUrl, responseUrl } = await submitJob(modelId, input);

  let elapsed = 0;
  const POLL_INTERVAL = 3000;
  const MAX_WAIT = 120000;

  while (elapsed < MAX_WAIT) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
    elapsed += POLL_INTERVAL;

    const status = await pollStatus(statusUrl);

    if (status.status === 'IN_QUEUE') {
      onStatus?.('queued', `In queue…`);
    } else if (status.status === 'IN_PROGRESS') {
      onStatus?.('processing', 'Generating layers…');
    } else if (status.status === 'COMPLETED') {
      const result = await fetchResult(responseUrl) as any;

      const urls: string[] = [];
      // Qwen Layered returns `layers`, some models return `images` or `image`
      // Some models wrap output in `output` or `data`
      const root = result.output ?? result.data ?? result;

      if (Array.isArray(root.layers)) {
        urls.push(...root.layers.map((l: any) => l.url ?? l).filter(Boolean));
      } else if (Array.isArray(root.images)) {
        urls.push(...root.images.map((i: any) => i.url ?? i).filter(Boolean));
      } else if (root.image?.url) {
        urls.push(root.image.url);
      }

      // Fallback: also check top-level if `output`/`data` wrapper didn't have images
      if (urls.length === 0 && root !== result) {
        if (Array.isArray(result.images)) {
          urls.push(...result.images.map((i: any) => i.url ?? i).filter(Boolean));
        } else if (result.image?.url) {
          urls.push(result.image.url);
        }
      }

      // Deep-walk fallback: find any url fields in the result
      if (urls.length === 0) {
        const walk = (obj: any, depth = 0): void => {
          if (!obj || depth > 4) return;
          if (typeof obj === 'string' && (obj.startsWith('http://') || obj.startsWith('https://')) && /\.(png|jpg|jpeg|webp|gif)/.test(obj)) {
            urls.push(obj);
          } else if (Array.isArray(obj)) {
            obj.forEach(item => walk(item, depth + 1));
          } else if (typeof obj === 'object') {
            for (const val of Object.values(obj)) walk(val, depth + 1);
          }
        };
        walk(result);
      }

      if (urls.length === 0) throw new Error('No images returned by fal.ai model.');
      onStatus?.('done');
      return urls;
    } else if (status.status === 'FAILED') {
      throw new Error('Image generation failed on fal.ai servers.');
    }
  }

  throw new Error('Generation timed out after 2 minutes.');
};

// ── High-level generate + poll helper ──────────────────────────────────────

export interface GenerateVideoOptions {
  modelId: string;
  input: Record<string, any>;
  onStatus: (status: GenerationStatus, detail?: string) => void;
  signal?: AbortSignal;
}

export const generateVideo = async ({
  modelId,
  input,
  onStatus,
  signal,
}: GenerateVideoOptions): Promise<string> => {
  onStatus('submitting', 'Uploading assets & submitting to fal.ai…');
  const { statusUrl, responseUrl } = await submitJob(modelId, input);

  let elapsed = 0;
  const POLL_INTERVAL = 4000;
  // 5 min cap — video models should finish in 60-180s. If it's still running
  // past 5 min something is wrong on fal's side and the user should retry.
  const MAX_WAIT = 300000;
  let lastLogMessage = '';

  while (elapsed < MAX_WAIT) {
    if (signal?.aborted) throw new Error('Generation cancelled.');

    await new Promise(r => setTimeout(r, POLL_INTERVAL));
    elapsed += POLL_INTERVAL;

    const status = await pollStatus(statusUrl);

    // Capture the most recent log line from fal's internal pipeline so the
    // user can see what's actually happening (queue wait vs model inference
    // vs waiting on storage, etc.) instead of a generic 'Generating...'.
    const latestLog = status.logs && status.logs.length > 0
      ? status.logs[status.logs.length - 1]?.message
      : undefined;
    if (latestLog && latestLog !== lastLogMessage) {
      console.log('[falService] fal log:', latestLog);
      lastLogMessage = latestLog;
    }

    if (status.status === 'IN_QUEUE') {
      const pos = status.queue_position != null ? ` (position ${status.queue_position})` : '';
      onStatus('queued', `In queue${pos}…`);
    } else if (status.status === 'IN_PROGRESS') {
      const secs = Math.round(elapsed / 1000);
      const logSuffix = latestLog ? ` — ${latestLog.slice(0, 60)}` : '';
      onStatus('processing', `Generating… ${secs}s${logSuffix}`);
    } else if (status.status === 'COMPLETED') {
      onStatus('processing', 'Fetching result…');
      const result = await fetchResult(responseUrl);
      const url = extractVideoUrl(result);
      onStatus('done');
      return url;
    } else if (status.status === 'FAILED') {
      // Surface fal's own error log line if present — much more actionable
      // than a generic "failed on servers" message.
      const reason = latestLog || 'Video generation failed on fal.ai servers.';
      throw new Error(reason);
    }
  }

  const tail = lastLogMessage ? ` Last log: ${lastLogMessage}` : '';
  throw new Error(`Generation timed out after 5 minutes.${tail} Try again or switch to a Fast variant.`);
};
