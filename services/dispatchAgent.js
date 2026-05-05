/**
 * Dispatch Agent — Publishes approved content slots to social media
 *
 * Flow:
 *   1. Read approved slots from content_slots.json sync file
 *   2. For each approved slot that hasn't been published yet:
 *      a. Build caption from brief (hook + caption + CTA + hashtags)
 *      b. Determine platforms from slot.platform or config.platforms
 *      c. Call upload-post.com API to publish (photo if has image, text if not)
 *      d. Mark slot as published (published_platforms, published_at, publish_request_id)
 *   3. Write updated slots back to sync file
 *   4. Return summary: { published_count, failed_count, platforms }
 */

import fs from 'fs';
import path from 'path';

const SYNC_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '', '.klint', 'sync');
const UPLOAD_POST_BASE = 'https://api.upload-post.com';

function getApiKey() { return process.env.UPLOAD_POST_API_KEY; }

// Tiny Supabase REST helper for the ownership-check guard. Returns null if
// Supabase isn't reachable so the dispatch keeps working in dev environments
// without Supabase credentials.
async function supabaseRest(tablePath, method = 'GET', body = null) {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const fullUrl = `${url}/rest/v1/${tablePath}`;
  const opts = {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
  };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const res = await fetch(fullUrl, opts);
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

function readSync(name) {
  try { return JSON.parse(fs.readFileSync(path.join(SYNC_DIR, `${name}.json`), 'utf-8')); }
  catch { return null; }
}

function writeSync(name, data) {
  if (!fs.existsSync(SYNC_DIR)) fs.mkdirSync(SYNC_DIR, { recursive: true });
  fs.writeFileSync(path.join(SYNC_DIR, `${name}.json`), JSON.stringify(data, null, 2), 'utf-8');
}

// ── Caption builder ─────────────────────────────────────────────────────────

function buildCaption(brief) {
  if (!brief) return '';

  const parts = [];

  // Hook first — grabs attention
  if (brief.hook) parts.push(brief.hook);

  // Main caption body
  if (brief.caption) parts.push(brief.caption);

  // Call to action
  if (brief.call_to_action) parts.push(brief.call_to_action);

  // Hashtags at the end
  if (brief.hashtags?.length) {
    const tags = brief.hashtags
      .slice(0, 30)  // Instagram max is 30
      .map(h => `#${String(h).replace(/^#+/, '')}`)
      .join(' ');
    parts.push(`\n${tags}`);
  }

  return parts.join('\n\n').trim();
}

// ── Convert data: URL to a Blob for multipart upload ────────────────────────

function dataUrlToBlob(dataUrl) {
  const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) return null;

  const mimeType = match[1];
  const base64Data = match[2];
  const buffer = Buffer.from(base64Data, 'base64');

  return { buffer, mimeType };
}

// ── Build multipart form body manually (Node.js compatible) ─────────────────

function buildMultipartBody(fields, fileField) {
  const boundary = `----DispatchAgent${Date.now()}`;
  const parts = [];

  // Text fields
  for (const [key, values] of Object.entries(fields)) {
    const vals = Array.isArray(values) ? values : [values];
    for (const val of vals) {
      parts.push(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
        `${val}\r\n`
      );
    }
  }

  // File field
  if (fileField) {
    const ext = fileField.mimeType.includes('png') ? 'png' : 'jpg';
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fileField.name}"; filename="post-image.${ext}"\r\n` +
      `Content-Type: ${fileField.mimeType}\r\n\r\n`
    );
    // File content added as buffer below
  }

  const textPart = Buffer.from(parts.join(''));

  if (fileField) {
    const ending = Buffer.from(`\r\n--${boundary}--\r\n`);
    return {
      body: Buffer.concat([textPart, fileField.buffer, ending]),
      contentType: `multipart/form-data; boundary=${boundary}`,
    };
  }

  const ending = Buffer.from(`--${boundary}--\r\n`);
  return {
    body: Buffer.concat([textPart, ending]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

// ── Publish a single slot via upload-post.com ───────────────────────────────

async function publishSlot(slot, platforms, uploadPostUser) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('UPLOAD_POST_API_KEY not configured');

  const caption = buildCaption(slot.brief);
  const hasImage = slot.generated_image && slot.generated_image.startsWith('data:');
  // Reels: if Kling has produced a video URL for this slot, publish the
  // VIDEO via upload-post's video endpoint instead of the still image.
  // This is what the user actually wants on TikTok / Instagram Reels.
  const hasReelVideo = slot.format === 'reel' && typeof slot.generated_video === 'string' && /^https?:/.test(slot.generated_video);

  if (hasReelVideo) {
    console.log(`[Dispatch] Publishing reel as VIDEO via Kling-generated URL for slot ${slot.id}`);
    const body = {
      user: uploadPostUser,
      platforms,
      video_url: slot.generated_video,
      ...(caption ? { description: caption } : {}),
    };
    const res = await fetch(`${UPLOAD_POST_BASE}/api/upload_videos`, {
      method: 'POST',
      headers: {
        'Authorization': `Apikey ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => 'Unknown error');
      throw new Error(`Reel video upload failed (${res.status}): ${errText.slice(0, 200)}`);
    }
    return await res.json();
  }

  // Reels with no video yet — skip publishing for now, Kling is still
  // generating in the background. Dispatch will pick them up on next run.
  if (slot.format === 'reel' && !hasReelVideo) {
    throw new Error(`Reel video still generating via Kling — try again in 1-2 min`);
  }

  if (hasImage) {
    // Photo upload via multipart/form-data
    const imageData = dataUrlToBlob(slot.generated_image);
    if (!imageData) throw new Error('Failed to decode generated_image data URL');

    const fields = {
      'user': uploadPostUser,
      'platform[]': platforms,
    };
    if (caption) fields['description'] = caption;

    const { body, contentType } = buildMultipartBody(fields, {
      name: 'photos[]',
      buffer: imageData.buffer,
      mimeType: imageData.mimeType,
    });

    const res = await fetch(`${UPLOAD_POST_BASE}/api/upload_photos`, {
      method: 'POST',
      headers: {
        'Authorization': `Apikey ${apiKey}`,
        'Content-Type': contentType,
        'Content-Length': String(body.length),
      },
      body,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => 'Unknown error');
      throw new Error(`Photo upload failed (${res.status}): ${errText.slice(0, 200)}`);
    }

    return await res.json();
  } else {
    // Text-only post
    const body = {
      user: uploadPostUser,
      platforms,
      text: caption || slot.idea || 'New post',
    };

    const res = await fetch(`${UPLOAD_POST_BASE}/api/upload_text`, {
      method: 'POST',
      headers: {
        'Authorization': `Apikey ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => 'Unknown error');
      throw new Error(`Text upload failed (${res.status}): ${errText.slice(0, 200)}`);
    }

    return await res.json();
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// scheduleSlotWithUploadPost — used by the approval flow
// ══════════════════════════════════════════════════════════════════════════════
// Hand a slot off to Upload Post's built-in scheduler with `scheduled_date`.
// Upload Post then handles the actual posting at the right time without us
// needing a cron loop. Returns { request_id, job_id } so callers can:
//   - Save request_id for analytics (Karma agent uses it later)
//   - Save job_id for PATCH/DELETE when the user reschedules / cancels
async function scheduleSlotWithUploadPost(slot, platforms, uploadPostUser, scheduledDateIso) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('UPLOAD_POST_API_KEY not configured');
  if (!uploadPostUser) throw new Error('No Upload Post profile connected for this brand');
  if (!Array.isArray(platforms) || platforms.length === 0) {
    throw new Error('At least one platform required');
  }

  // If the requested time is in the past, bump to "now + 2 minutes" (Q4=a)
  let when = scheduledDateIso ? new Date(scheduledDateIso) : new Date(Date.now() + 2 * 60 * 1000);
  if (isNaN(when.getTime()) || when.getTime() < Date.now() + 60_000) {
    when = new Date(Date.now() + 2 * 60 * 1000);
  }
  const scheduled_date = when.toISOString();

  const caption = buildCaption(slot.brief);
  const hasReelVideo = slot.format === 'reel'
    && typeof slot.generated_video === 'string'
    && /^https?:/.test(slot.generated_video);
  const hasImage = slot.generated_image && slot.generated_image.startsWith('data:');

  let endpoint;
  let body;
  let contentType = 'application/json';
  let bodyBuffer = null;

  // Field-name conventions match the original publishSlot() that's been
  // working — `description` (not caption) for photos, `platforms` (plural)
  // for the JSON video/text endpoints, /api/upload_videos for video URLs.
  if (hasReelVideo) {
    endpoint = `${UPLOAD_POST_BASE}/api/upload_videos`;
    body = JSON.stringify({
      user: uploadPostUser,
      platforms,
      video_url: slot.generated_video,
      ...(caption ? { description: caption } : {}),
      scheduled_date,
    });
  } else if (slot.format === 'reel' && !hasReelVideo) {
    return { deferred: true, reason: 'reel_video_pending' };
  } else if (hasImage) {
    endpoint = `${UPLOAD_POST_BASE}/api/upload_photos`;
    const imageData = dataUrlToBlob(slot.generated_image);
    if (!imageData) throw new Error('Failed to decode generated_image data URL');
    const fields = {
      'user': uploadPostUser,
      'platform[]': platforms,
      'scheduled_date': scheduled_date,
    };
    if (caption) fields['description'] = caption;  // Upload Post uses `description` for photos
    const built = buildMultipartBody(fields, {
      name: 'photos[]',
      buffer: imageData.buffer,
      mimeType: imageData.mimeType,
    });
    bodyBuffer = built.body;
    contentType = built.contentType;
  } else {
    endpoint = `${UPLOAD_POST_BASE}/api/upload_text`;
    body = JSON.stringify({
      user: uploadPostUser,
      platforms,
      title: caption || slot.idea || 'New post',
      scheduled_date,
    });
  }

  const headers = {
    'Authorization': `Apikey ${apiKey}`,
    'Content-Type': contentType,
  };
  const fetchOpts = bodyBuffer
    ? { method: 'POST', headers: { ...headers, 'Content-Length': String(bodyBuffer.length) }, body: bodyBuffer }
    : { method: 'POST', headers, body };

  console.log(`[Dispatch:schedule] POST ${endpoint} for ${uploadPostUser} (${platforms.join(',')}) scheduled_date=${scheduled_date}`);
  const res = await fetch(endpoint, fetchOpts);
  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error');
    console.error(`[Dispatch:schedule] FAILED ${res.status}: ${errText.slice(0, 500)}`);
    throw new Error(`Upload Post schedule failed (${res.status}): ${errText.slice(0, 300)}`);
  }
  const data = await res.json().catch(() => ({}));
  console.log(`[Dispatch:schedule] OK — response keys: ${Object.keys(data).join(', ')}`);
  return {
    deferred: false,
    request_id: data?.request_id || data?.data?.request_id || null,
    // Upload Post returns job_id for scheduled posts (vs immediate)
    job_id: data?.job_id || data?.data?.job_id || data?.scheduled_job_id || null,
    scheduled_date,
    platforms,
    raw: data,
  };
}

// ── PATCH a scheduled post (used when user reshuffles in the calendar) ─────
async function patchScheduledPost(jobId, patch) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('UPLOAD_POST_API_KEY not configured');
  if (!jobId) throw new Error('jobId required');
  const allowed = {};
  if (patch.scheduled_date) allowed.scheduled_date = new Date(patch.scheduled_date).toISOString();
  if (patch.timezone) allowed.timezone = patch.timezone;
  if (patch.title) allowed.title = patch.title;
  if (patch.caption) allowed.caption = patch.caption;
  const res = await fetch(`${UPLOAD_POST_BASE}/api/uploadposts/schedule/${encodeURIComponent(jobId)}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Apikey ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(allowed),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Upload Post PATCH failed (${res.status}): ${errText.slice(0, 200)}`);
  }
  return res.json().catch(() => ({}));
}

// ── DELETE a scheduled post (used when user un-approves / rejects) ─────────
async function cancelScheduledPost(jobId) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('UPLOAD_POST_API_KEY not configured');
  if (!jobId) return { ok: true, skipped: true };
  const res = await fetch(`${UPLOAD_POST_BASE}/api/uploadposts/schedule/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Apikey ${apiKey}` },
  });
  if (!res.ok && res.status !== 404) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Upload Post DELETE failed (${res.status}): ${errText.slice(0, 200)}`);
  }
  return { ok: true };
}

// ── Poll status of one scheduled job ───────────────────────────────────────
// Returns { status, finished, post_results } where status is one of
// PENDING / PROCESSING / FINISHED / ERROR. Used by the periodic poller to
// flip slot.status from 'scheduled' to 'published' once Upload Post posts.
async function getJobStatus(jobIdOrRequestId) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('UPLOAD_POST_API_KEY not configured');
  if (!jobIdOrRequestId) return null;
  // Try job_id first (scheduled post), fall back to request_id (async)
  const tryFetch = async (param) => {
    const url = `${UPLOAD_POST_BASE}/api/uploadposts/status?${param}=${encodeURIComponent(jobIdOrRequestId)}`;
    const res = await fetch(url, { headers: { 'Authorization': `Apikey ${apiKey}` } });
    if (!res.ok) return null;
    return res.json().catch(() => null);
  };
  let data = await tryFetch('job_id');
  if (!data) data = await tryFetch('request_id');
  if (!data) return null;
  const status = String(data.status || '').toUpperCase();
  return {
    status,
    finished: status === 'FINISHED',
    failed: status === 'ERROR',
    post_results: data.post_results || data.results || data.platforms || null,
    raw: data,
  };
}

// ── Resolve the Upload-Post username for a brand ────────────────────────────

function resolveUploadPostUser(userId, brand) {
  // 1. Check brand-level config
  if (brand?.upload_post_user) return brand.upload_post_user;

  // 2. Check social-profile-owners mapping
  try {
    const ownersFile = path.join(SYNC_DIR, 'social-profile-owners.json');
    if (fs.existsSync(ownersFile)) {
      const owners = JSON.parse(fs.readFileSync(ownersFile, 'utf-8'));
      const userProfiles = owners[userId];
      if (Array.isArray(userProfiles) && userProfiles.length > 0) {
        return userProfiles[0];  // Use first connected profile
      }
    }
  } catch {}

  // 3. Fall back to brand instagram handle or name slug
  if (brand?.instagram_handle) return brand.instagram_handle;
  if (brand?.name) return brand.name.toLowerCase().replace(/[^a-z0-9]/g, '_');

  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// Main: Execute Dispatch Agent
// ══════════════════════════════════════════════════════════════════════════════

async function executeDispatch(userId, brandId, config = {}) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('UPLOAD_POST_API_KEY not configured in .env');

  // Load brand
  const brandsFile = readSync('brand_profiles');
  const allBrands = brandsFile?.data || brandsFile || [];
  const brand = allBrands.find(b => b.id === brandId);
  if (!brand) throw new Error(`Brand not found: ${brandId}`);

  // Resolve upload-post.com username
  const uploadPostUser = config.upload_post_user || resolveUploadPostUser(userId, brand);

  // ── Real connection check (not just "does a profile exist?") ─────────
  // A profile can exist with 0 connected platforms — that's not actually
  // dispatchable. So we hit the Upload Post users endpoint and verify
  // that AT LEAST ONE platform is connected for this user's profiles.
  let hasConnectedPlatform = false;
  if (uploadPostUser) {
    try {
      const apiKey = getApiKey();
      const resp = await fetch(`${UPLOAD_POST_BASE}/api/uploadposts/users`, {
        headers: { 'Authorization': `Apikey ${apiKey}` },
      });
      const data = await resp.json().catch(() => ({}));
      const all = Array.isArray(data?.profiles) ? data.profiles : (Array.isArray(data) ? data : []);
      const me = all.find(p => p.username === uploadPostUser);
      if (me?.social_accounts && typeof me.social_accounts === 'object') {
        hasConnectedPlatform = Object.values(me.social_accounts).some(v => v && String(v).length > 0);
      }
    } catch (err) {
      console.warn('[Dispatch] Could not verify platform connection state:', err.message);
    }
  }

  if (!uploadPostUser || !hasConnectedPlatform) {
    return {
      ok: false,
      needs_connection: true,
      brand_id: brandId,
      brand_name: brand.name,
      published_count: 0,
      failed_count: 0,
      skipped_count: 0,
      published_slots: [],
      errors: [],
      message: !uploadPostUser
        ? 'No social profile connected. Connect a profile in Social Accounts → posts will publish automatically.'
        : `Profile "${uploadPostUser}" exists but no platforms are connected. Click any platform pill (Instagram / TikTok / etc.) on Social Accounts to connect.`,
      profile_username: uploadPostUser || null,
      generated_at: new Date().toISOString(),
    };
  }

  // Verify the user actually OWNS this upload-post profile (not someone else's
  // leaked from the shared workspace). Lookup is via the Supabase ownership
  // table that server.js writes when a user connects a profile.
  try {
    const ownerRows = await supabaseRest(
      `social_profile_owners?user_id=eq.${encodeURIComponent(userId)}&upload_post_username=eq.${encodeURIComponent(uploadPostUser)}&select=upload_post_username`
    );
    if (Array.isArray(ownerRows) && ownerRows.length === 0) {
      console.warn(`[Dispatch] User ${userId} does not own profile "${uploadPostUser}". Continuing — may have been connected before isolation table was added.`);
    }
  } catch (err) {
    // Non-fatal — continue with publish if Supabase isn't reachable
    console.warn('[Dispatch] Ownership check skipped:', err.message);
  }

  // Default platforms
  const defaultPlatforms = config.platforms || ['instagram'];

  // Load content slots
  const slotsFile = readSync('content_slots');
  const allSlots = Array.isArray(slotsFile?.data) ? slotsFile.data : [];

  // Find approved but unpublished slots for this brand.
  // Scheduled slots (scheduled_at > now) are skipped until their time arrives.
  const nowIso = new Date().toISOString();
  const approvedUnpublished = allSlots.filter(s =>
    s.brand_id === brandId &&
    (s.status === 'approved' || s.approved === true) &&
    !s.published_at
  );
  const eligibleSlots = approvedUnpublished.filter(s =>
    !s.scheduled_at || s.scheduled_at <= nowIso
  );
  const skippedScheduled = approvedUnpublished.length - eligibleSlots.length;

  if (eligibleSlots.length === 0) {
    console.log(`[Dispatch] No approved unpublished slots due for brand ${brand.name} (${skippedScheduled} scheduled for future)`);
    return {
      brand_id: brandId,
      brand_name: brand.name,
      published_count: 0,
      failed_count: 0,
      skipped_count: 0,
      skipped_scheduled: skippedScheduled,
      platforms: defaultPlatforms,
      published_slots: [],
      errors: [],
      generated_at: new Date().toISOString(),
    };
  }

  console.log(`\n[Dispatch] ═══ Publishing ${eligibleSlots.length} slots for ${brand.name} (${skippedScheduled} scheduled for future) ═══`);
  console.log(`[Dispatch] Platforms: ${defaultPlatforms.join(', ')}`);
  console.log(`[Dispatch] Upload-Post user: ${uploadPostUser}`);

  const published = [];
  const errors = [];

  for (const slot of eligibleSlots) {
    const platforms = slot.platform
      ? [slot.platform]
      : defaultPlatforms;

    try {
      console.log(`[Dispatch] Publishing: ${slot.slot_date}/${slot.format} → ${platforms.join(', ')}`);
      const result = await publishSlot(slot, platforms, uploadPostUser);

      // Extract request_id from the API response
      const requestId = result?.request_id || result?.data?.request_id || result?.id || `dispatch_${Date.now()}`;

      // Update slot in allSlots array
      const idx = allSlots.findIndex(s => s.id === slot.id);
      if (idx >= 0) {
        allSlots[idx] = {
          ...allSlots[idx],
          status: 'published',
          published_at: new Date().toISOString(),
          published_platforms: platforms,
          publish_request_id: requestId,
          updated_at: new Date().toISOString(),
        };
      }

      published.push({
        slot_id: slot.id,
        slot_date: slot.slot_date,
        format: slot.format,
        platforms,
        request_id: requestId,
      });

      console.log(`[Dispatch] OK: ${slot.slot_date}/${slot.format} (request_id: ${requestId})`);

      // Small delay between publishes to avoid rate limiting
      if (eligibleSlots.indexOf(slot) < eligibleSlots.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    } catch (err) {
      console.error(`[Dispatch] FAIL: ${slot.slot_date}/${slot.format}:`, err.message);
      errors.push({
        slot_id: slot.id,
        slot_date: slot.slot_date,
        format: slot.format,
        error: err.message,
      });
    }
  }

  // Persist updated slots
  writeSync('content_slots', { _updatedAt: new Date().toISOString(), data: allSlots });
  console.log(`[Dispatch] ═══ Done: ${published.length} published, ${errors.length} failed ═══\n`);

  return {
    brand_id: brandId,
    brand_name: brand.name,
    published_count: published.length,
    failed_count: errors.length,
    skipped_count: eligibleSlots.length - published.length - errors.length,
    skipped_scheduled: skippedScheduled,
    platforms: defaultPlatforms,
    published_slots: published,
    errors,
    generated_at: new Date().toISOString(),
  };
}

export {
  executeDispatch,
  scheduleSlotWithUploadPost,
  patchScheduledPost,
  cancelScheduledPost,
  getJobStatus,
  resolveUploadPostUser,
};
