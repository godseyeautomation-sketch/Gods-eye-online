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
  if (!uploadPostUser) throw new Error('No upload-post.com username found. Connect a social profile first.');

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

export { executeDispatch };
