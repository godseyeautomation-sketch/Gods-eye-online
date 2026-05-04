/**
 * Review Agent — Per-Platform HITL with Slack + In-App Dashboard
 *
 * Flow (per platform, run in parallel):
 *   1. Pick first 3 briefed slots for each platform → "sample"
 *   2. Remaining slots → "auto-approve pending" (auto-approved if sample passes)
 *   3. Generate images for all samples (uses product lock if available)
 *   4. Post to Slack with Block Kit (if SLACK configured) + write to approval_queue.json
 *   5. User clicks Approve/Reject on each — from Slack OR in-app dashboard
 *   6. Per-platform threshold logic:
 *      - 2+ approved → auto-approve remaining platform slots + schedule them
 *      - 2+ rejected → collect feedback, regenerate ONLY that platform via Priya
 *   7. Other platforms unaffected by one platform's rejection
 */

import fs from 'fs';
import path from 'path';

const SYNC_DIR = path.join(process.env.HOME || '', '.klint', 'sync');

function readSync(name) {
  try { return JSON.parse(fs.readFileSync(path.join(SYNC_DIR, `${name}.json`), 'utf-8')); }
  catch { return null; }
}

function writeSync(name, data) {
  if (!fs.existsSync(SYNC_DIR)) fs.mkdirSync(SYNC_DIR, { recursive: true });
  fs.writeFileSync(path.join(SYNC_DIR, `${name}.json`), JSON.stringify(data, null, 2), 'utf-8');
}

function getSlackToken() { return process.env.SLACK_BOT_TOKEN; }
function getSlackChannel() { return process.env.SLACK_CHANNEL_ID; }
function getGeminiKey() { return process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY; }

// ── In-memory store for pending reviews (persists across requests within session) ──
const pendingReviews = new Map(); // reviewId → { slots, decisions, feedback, resolve }

// ══════════════════════════════════════════════════════════════════════════════
// Slack helpers
// ══════════════════════════════════════════════════════════════════════════════

async function slackPost(method, body, tokenOverride) {
  const token = tokenOverride || getSlackToken();
  if (!token) throw new Error('SLACK_BOT_TOKEN not configured');

  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack ${method}: ${data.error}`);
  return data;
}

// ══════════════════════════════════════════════════════════════════════════════
// Slack Modal builders — Block Kit views opened via views.open
// ══════════════════════════════════════════════════════════════════════════════

/** Build a date+time picker modal for scheduling a single post. */
function buildSchedulePickerView({ queueId, currentScheduled, slotDate }) {
  const def = currentScheduled ? new Date(currentScheduled) : new Date(`${slotDate}T09:00:00Z`);
  const isoDate = def.toISOString().slice(0, 10);
  const isoTime = def.toISOString().slice(11, 16);

  return {
    type: 'modal',
    callback_id: 'schedule_picker',
    private_metadata: queueId,
    title: { type: 'plain_text', text: 'Schedule Post', emoji: true },
    submit: { type: 'plain_text', text: 'Save Schedule', emoji: true },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*When should this post go live?*\nDispatch will publish at this exact time.' },
      },
      {
        type: 'input',
        block_id: 'date_block',
        element: {
          type: 'datepicker',
          action_id: 'date_input',
          initial_date: isoDate,
          placeholder: { type: 'plain_text', text: 'Pick a date' },
        },
        label: { type: 'plain_text', text: 'Date' },
      },
      {
        type: 'input',
        block_id: 'time_block',
        element: {
          type: 'timepicker',
          action_id: 'time_input',
          initial_time: isoTime,
          placeholder: { type: 'plain_text', text: 'Pick a time' },
        },
        label: { type: 'plain_text', text: 'Time (UTC)' },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: '_Tip: 9 AM, 12 PM, 6 PM are the highest-engagement slots in most timezones._' }],
      },
    ],
  };
}

/** Build a feedback-text modal for rejecting a post. */
function buildRejectFeedbackView({ queueId }) {
  return {
    type: 'modal',
    callback_id: 'reject_feedback',
    private_metadata: queueId,
    title: { type: 'plain_text', text: 'Reject Post' },
    submit: { type: 'plain_text', text: 'Submit Rejection' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'feedback_block',
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'feedback_input',
          multiline: true,
          placeholder: { type: 'plain_text', text: "What's wrong with this post? (optional but helpful for the AI to improve)" },
          max_length: 1500,
        },
        label: { type: 'plain_text', text: 'Why are you rejecting?' },
      },
    ],
  };
}

function buildRegenerateView({ queueId }) {
  return {
    type: 'modal',
    callback_id: 'regenerate_image',
    private_metadata: queueId,
    title: { type: 'plain_text', text: 'Regenerate Image' },
    submit: { type: 'plain_text', text: 'Regenerate' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'prompt_block',
        element: {
          type: 'plain_text_input',
          action_id: 'prompt_input',
          multiline: true,
          placeholder: { type: 'plain_text', text: 'e.g. "warmer lighting, sunset palette, model facing camera"' },
          max_length: 1500,
        },
        label: { type: 'plain_text', text: 'How should the new image look?' },
      },
      {
        type: 'input',
        block_id: 'reference_block',
        optional: true,
        element: {
          type: 'file_input',
          action_id: 'reference_input',
          filetypes: ['png', 'jpg', 'jpeg', 'webp'],
          max_files: 1,
        },
        label: { type: 'plain_text', text: 'Reference image (optional)' },
        hint: { type: 'plain_text', text: 'Upload an inspiration image to guide style, lighting, mood. Max 5 MB.' },
      },
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: '🎨 _Regeneration takes ~30 seconds. For Reels, the video will auto-regenerate after the image (~3 min)._',
        }],
      },
    ],
  };
}

async function slackUploadImage(imageBuffer, filename, channelId) {
  const token = getSlackToken();

  // Step 1: Get upload URL
  const step1 = await fetch(
    `https://slack.com/api/files.getUploadURLExternal?filename=${encodeURIComponent(filename)}&length=${imageBuffer.length}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  const s1 = await step1.json();
  if (!s1.ok) throw new Error(`Slack upload step 1: ${s1.error}`);

  // Step 2: Upload
  const form = new FormData();
  form.append('file', new Blob([imageBuffer]), filename);
  await fetch(s1.upload_url, { method: 'POST', body: form });

  // Step 3: Complete
  const step3 = await fetch('https://slack.com/api/files.completeUploadExternal', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      files: [{ id: s1.file_id, title: filename }],
      channel_id: channelId,
    }),
  });
  const s3 = await step3.json();
  if (!s3.ok) throw new Error(`Slack upload step 3: ${s3.error}`);

  // Get the file's permalink for embedding in blocks
  const fileInfo = await fetch(`https://slack.com/api/files.info?file=${s1.file_id}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const fi = await fileInfo.json();
  return fi.file?.permalink_public || fi.file?.permalink || null;
}

// ══════════════════════════════════════════════════════════════════════════════
// Gemini image generation (matching geminiService.ts pattern)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Check if a product's imageDataUrl is usable server-side.
 * local:{id} references require localStorage (browser-only) so we skip them.
 * Only real data: URLs and http(s): URLs are usable.
 */
function isUsableImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.startsWith('local:')) return false;
  if (url.startsWith('data:') || url.startsWith('http:') || url.startsWith('https:')) return true;
  return false;
}

async function generateImage(prompt, visualDirection, aspectRatio = '1:1', product = null, userReferenceImage = null) {
  const geminiKey = getGeminiKey();
  if (!geminiKey) throw new Error('Gemini API key not configured');

  // Reference-image priority:
  //   1. userReferenceImage (regenerate flow — user uploaded a new visual)
  //   2. product.imageDataUrl (Priya/Review default — product lock)
  //   3. none → pure text-to-image
  const useUserReference = isUsableImageUrl(userReferenceImage);
  const useProductLock = !useUserReference && product && isUsableImageUrl(product.imageDataUrl);

  // Helper: convert any image URL/dataURL to a Gemini inlineData part
  async function imgToInlinePart(imageDataUrl) {
    if (imageDataUrl.startsWith('data:')) {
      const mimeMatch = imageDataUrl.match(/^data:(image\/\w+);base64,/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const base64Data = imageDataUrl.replace(/^data:image\/\w+;base64,/, '');
      return { inlineData: { mimeType, data: base64Data } };
    }
    const imgRes = await fetch(imageDataUrl);
    const imgBuf = await imgRes.arrayBuffer();
    const b64 = Buffer.from(imgBuf).toString('base64');
    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    return { inlineData: { mimeType: contentType, data: b64 } };
  }

  let fullPrompt;
  const parts = [];

  if (useUserReference) {
    // User uploaded a new reference: use it as composition guide.
    fullPrompt = `Use this uploaded image as the visual reference. ${prompt}. ${visualDirection || 'High quality, cinematic, professional photography.'} Match the style, lighting, and mood of the reference where it makes sense, but adapt the subject and scene per the prompt.`;
    try {
      parts.push(await imgToInlinePart(userReferenceImage));
    } catch (err) {
      console.warn('[Review] User reference image fetch failed, falling back to text-only:', err.message);
    }
    parts.push({ text: fullPrompt });
  } else if (useProductLock) {
    // Image-to-image: keep product, change only the scene around it
    fullPrompt = `Edit this image. Keep the product exactly as shown. Change ONLY the background and scene to: ${prompt}. ${visualDirection || 'High quality, cinematic, professional photography'}`;
    try {
      parts.push(await imgToInlinePart(product.imageDataUrl));
    } catch (err) {
      console.warn('[Review] Product image fetch failed, falling back to text-only:', err.message);
    }
    parts.push({ text: fullPrompt });
  } else {
    // No usable reference — pure lifestyle scene
    fullPrompt = `${prompt}. ${visualDirection || 'High quality, cinematic, professional photography'}`;
    parts.push({ text: fullPrompt });
  }

  // Temperature: low when locked to a reference (faithful), higher when freeform
  const temperature = (useProductLock || useUserReference) ? 0.15 : 0.7;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          temperature,
          imageConfig: { aspectRatio },
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[Review] Image gen ${res.status}:`, errText.slice(0, 300));
    throw new Error(`Image gen error ${res.status}`);
  }

  const data = await res.json();
  const imagePart = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
  if (!imagePart?.inlineData) throw new Error('No image returned');

  return Buffer.from(imagePart.inlineData.data, 'base64');
}

// ══════════════════════════════════════════════════════════════════════════════
// Build Block Kit message for a single slot
// ══════════════════════════════════════════════════════════════════════════════

const PLATFORM_BADGES = {
  instagram: '📸 Instagram',
  tiktok: '🎵 TikTok',
  facebook: '📘 Facebook',
  youtube: '📺 YouTube',
  linkedin: '💼 LinkedIn',
  x: '𝕏 X',
  pinterest: '📌 Pinterest',
  threads: '🧵 Threads',
};

/**
 * Build a Slack Block Kit message for one approval card.
 *
 * For Reel-format slots with a Kling-generated video URL, the message
 * includes a "▶️ Watch Reel" link button alongside the still image preview.
 * Reels without video yet show a "🎬 Video generating…" badge — the message
 * gets updated via chat.update once Kling finishes (see kickOffReelVideoInBackground).
 *
 * Three action buttons:
 *   ✅ Approve  → calls approve_<queueId> action_id
 *   ❌ Reject   → calls reject_<queueId> → opens feedback modal
 *   📅 Schedule → calls schedule_<queueId> → opens date/time picker modal
 */
function buildSlotMessage(slot, reviewId, queueId, channelId, options = {}) {
  const brief = slot.brief || {};
  const formatIcon = slot.format === 'reel' ? '🎬 Reel' : slot.format === 'story' ? '📱 Story' : '🖼️ Post';
  const platform = slot.platform || 'instagram';
  const platformBadge = PLATFORM_BADGES[platform] || `📱 ${platform}`;
  const hashtags = (brief.hashtags || []).slice(0, 8).map(t => `#${String(t).replace(/^#+/, '')}`).join(' ');
  const imageUrl = options.imageUrl || null;     // public URL of the generated still
  const videoUrl = options.videoUrl || null;     // Kling-generated video URL (reels only)
  const scheduledAt = options.scheduledAt || null;

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${platformBadge}  ·  📅 ${slot.slot_date}  ·  ${formatIcon}`, emoji: true },
    },
  ];

  // Image preview block (Slack supports image_url ≤ 1500px)
  if (imageUrl) {
    blocks.push({
      type: 'image',
      image_url: imageUrl,
      alt_text: `${platform} ${slot.format} preview`,
    });
  }

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Hook:*\n${brief.hook || '_No hook_'}\n\n*Caption:*\n${(brief.caption || '_No caption_').slice(0, 500)}\n\n*CTA:* _${brief.call_to_action || 'N/A'}_`,
    },
  });

  blocks.push({
    type: 'context',
    elements: [
      { type: 'mrkdwn', text: hashtags || '_No hashtags_' },
    ],
  });

  // Reel-specific: show video status / link
  if (slot.format === 'reel') {
    if (videoUrl) {
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `🎬 *Reel video ready* — preview below before approving:` }],
      });
    } else {
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `🎬 *Video generating via Kling 3.0…* This message will update when ready (~1–3 min).` }],
      });
    }
  }

  if (scheduledAt) {
    const dt = new Date(scheduledAt);
    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `📅 *Scheduled:* ${dt.toUTCString().replace(' GMT', ' UTC')}`,
      }],
    });
  }

  blocks.push({ type: 'divider' });

  // Action buttons row
  const actionElements = [];

  // Reel: optional watch button if we have a video URL
  if (slot.format === 'reel' && videoUrl) {
    actionElements.push({
      type: 'button',
      text: { type: 'plain_text', text: '▶️ Watch Reel', emoji: true },
      url: videoUrl,
      action_id: `watch_${queueId}`,
    });
  }

  actionElements.push(
    {
      type: 'button',
      text: { type: 'plain_text', text: '🎨 Regenerate', emoji: true },
      action_id: `regenerate_${queueId}`,
      value: JSON.stringify({ reviewId, queueId, action: 'regenerate' }),
    },
    {
      type: 'button',
      text: { type: 'plain_text', text: '📅 Schedule', emoji: true },
      action_id: `schedule_${queueId}`,
      value: JSON.stringify({ reviewId, queueId, action: 'schedule' }),
    },
    {
      type: 'button',
      text: { type: 'plain_text', text: '❌ Reject', emoji: true },
      style: 'danger',
      action_id: `reject_${queueId}`,
      value: JSON.stringify({ reviewId, queueId, action: 'reject' }),
    },
    {
      type: 'button',
      text: { type: 'plain_text', text: '✅ Approve', emoji: true },
      style: 'primary',
      action_id: `approve_${queueId}`,
      value: JSON.stringify({ reviewId, queueId, action: 'approve' }),
    }
  );

  blocks.push({
    type: 'actions',
    elements: actionElements,
  });

  return {
    channel: channelId,
    text: `Review: ${platformBadge} · ${slot.slot_date} ${slot.format}`,
    blocks,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Handle Slack button click (called from /api/slack/interactions)
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// computeScheduledAt — derive optimal posting time from Scout's strategy
// ══════════════════════════════════════════════════════════════════════════════

function computeScheduledAt(slot, scoutReport) {
  const platform = slot.platform || 'instagram';
  const strategies = scoutReport?.strategy_data?.platform_strategies || {};
  const optimalTimes = strategies[platform]?.optimal_posting_times || ['9am'];

  // Parse first time hint like "9am-10am" or "7-9am EST" → 9
  const first = Array.isArray(optimalTimes) ? optimalTimes[0] : optimalTimes;
  const hourMatch = String(first || '').match(/(\d{1,2})\s*(am|pm)?/i);
  let hour = hourMatch ? parseInt(hourMatch[1], 10) : 9;
  const meridian = hourMatch?.[2]?.toLowerCase();
  if (meridian === 'pm' && hour < 12) hour += 12;
  if (meridian === 'am' && hour === 12) hour = 0;
  if (hour > 23) hour = 9;

  // Combine with slot's date (UTC for simplicity; TODO: brand timezone)
  const [y, m, d] = String(slot.slot_date || new Date().toISOString().slice(0, 10)).split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1, hour, 0, 0)).toISOString();
}

// ══════════════════════════════════════════════════════════════════════════════
// Shared decision handler — called from Slack webhook AND in-app dashboard
// ══════════════════════════════════════════════════════════════════════════════

function updateReviewDecision(reviewId, queueItemId, decision, feedback) {
  const review = pendingReviews.get(reviewId);
  if (!review) {
    console.warn(`[Review] No pending review found for ${reviewId}`);
    return false;
  }

  // With cascade removed, every queue item (sample or remaining) is reviewed
  // individually. Look up across both lists.
  const entry =
    review.sampleItems.find(s => s.queueId === queueItemId) ||
    review.remainingItems.find(s => s.queueId === queueItemId);
  if (!entry) {
    console.warn(`[Review] Queue item ${queueItemId} not in pending review`);
    return false;
  }

  const sampleEntry = entry; // legacy variable name kept for log line below
  const platform = entry.slot.platform || 'instagram';
  review.decisions[queueItemId] = decision;
  if (feedback) {
    if (!review.feedback_by_item) review.feedback_by_item = {};
    review.feedback_by_item[queueItemId] = feedback;
  }

  console.log(`[Review] Decision: ${platform}/${sampleEntry.slot.slot_date}/${sampleEntry.slot.format} → ${decision}${feedback ? ` (feedback: ${feedback.slice(0, 50)})` : ''}`);

  // NOTE: Auto-threshold cascade removed (per user spec) — every post requires
  // an explicit approve/reject. checkPlatformThresholds is left in place but
  // no longer called from here; kept around in case we ever resurrect the
  // 2-of-3 sample heuristic for high-volume calendars.
  return true;
}

// Count decisions for a platform's sample, then act
function checkPlatformThresholds(review, platform) {
  if (!review.platformDecided) review.platformDecided = {};
  if (review.platformDecided[platform]) return; // already finalized

  const platformSamples = review.sampleItems.filter(s => (s.slot.platform || 'instagram') === platform);
  let approved = 0, rejected = 0;
  for (const s of platformSamples) {
    const d = review.decisions[s.queueId];
    if (d === 'approve') approved++;
    else if (d === 'reject') rejected++;
  }

  const channelId = review.channelId;

  if (approved >= 2) {
    review.platformDecided[platform] = 'approved';
    autoApproveRemainingForPlatform(review, platform);
    if (channelId) {
      slackPost('chat.postMessage', {
        channel: channelId,
        text: `✅ *${platform.toUpperCase()}* approved — ${approved}/${platformSamples.length} sample slots passed. All remaining ${platform} slots scheduled for publishing.`,
      }).catch(() => {});
    }
  } else if (rejected >= 2) {
    review.platformDecided[platform] = 'regenerating';
    const feedback = gatherRejectionFeedback(review, platform);
    triggerPriyaRegenerate(review, platform, feedback);
    if (channelId) {
      slackPost('chat.postMessage', {
        channel: channelId,
        text: `❌ *${platform.toUpperCase()}* rejected — ${rejected}/${platformSamples.length} sample slots rejected. Priya will regenerate with feedback.${feedback ? `\n\n_Feedback:_ ${feedback.slice(0, 300)}` : ''}`,
      }).catch(() => {});
    }
  }
}

function gatherRejectionFeedback(review, platform) {
  const feedback = [];
  for (const s of review.sampleItems) {
    if ((s.slot.platform || 'instagram') !== platform) continue;
    if (review.decisions[s.queueId] === 'reject') {
      const fb = review.feedback_by_item?.[s.queueId];
      if (fb) feedback.push(fb);
    }
  }
  return feedback.join('; ');
}

// Mark all remaining slots for a platform as approved + schedule them
function autoApproveRemainingForPlatform(review, platform) {
  const slotsFile = readSync('content_slots');
  const allSlots = Array.isArray(slotsFile?.data) ? slotsFile.data : [];
  const scoutReport = review.scoutReport;

  const affected = new Set();
  // Both sample slots (that were approved) and remaining slots for this platform get approved
  for (const s of review.sampleItems) {
    if ((s.slot.platform || 'instagram') !== platform) continue;
    if (review.decisions[s.queueId] === 'approve') affected.add(s.slot.id);
  }
  for (const s of review.remainingItems) {
    if ((s.slot.platform || 'instagram') !== platform) continue;
    affected.add(s.slot.id);
  }

  let updated = 0;
  for (let i = 0; i < allSlots.length; i++) {
    if (!affected.has(allSlots[i].id)) continue;
    const scheduledAt = computeScheduledAt(allSlots[i], scoutReport);
    // Persist approved sample image if we have it
    const sampleEntry = review.sampleItems.find(s => s.slot.id === allSlots[i].id);
    const imgBuf = sampleEntry?.imageBuffer;
    allSlots[i] = {
      ...allSlots[i],
      status: 'approved',
      approved: true,
      scheduled_at: scheduledAt,
      generated_image: imgBuf ? `data:image/png;base64,${imgBuf.toString('base64')}` : allSlots[i].generated_image,
      updated_at: new Date().toISOString(),
    };
    updated++;
  }
  writeSync('content_slots', { _updatedAt: new Date().toISOString(), data: allSlots });
  console.log(`[Review] Auto-approved ${updated} ${platform} slots with scheduled_at set from Scout's optimal times`);

  // Also update the approval_queue items for this platform
  try {
    const queueFile = readSync('approval_queue');
    const queueData = Array.isArray(queueFile?.data) ? queueFile.data : [];
    const updatedQueue = queueData.map(item => {
      if (item.review_id === review.reviewId && affected.has(item.slot_id)) {
        return { ...item, status: 'approved', resolved_at: new Date().toISOString() };
      }
      return item;
    });
    writeSync('approval_queue', { _updatedAt: new Date().toISOString(), data: updatedQueue });
  } catch (e) { console.warn('[Review] Failed to sync approval_queue approvals:', e.message); }
}

function triggerPriyaRegenerate(review, platform, feedback) {
  // Mark rejected sample + remaining slots for this platform as rejected in approval_queue
  try {
    const queueFile = readSync('approval_queue');
    const queueData = Array.isArray(queueFile?.data) ? queueFile.data : [];
    const platformSlotIds = new Set([
      ...review.sampleItems.filter(s => (s.slot.platform || 'instagram') === platform).map(s => s.slot.id),
      ...review.remainingItems.filter(s => (s.slot.platform || 'instagram') === platform).map(s => s.slot.id),
    ]);
    const updatedQueue = queueData.map(item => {
      if (item.review_id === review.reviewId && platformSlotIds.has(item.slot_id)) {
        return { ...item, status: 'rejected', reviewer_notes: feedback, resolved_at: new Date().toISOString() };
      }
      return item;
    });
    writeSync('approval_queue', { _updatedAt: new Date().toISOString(), data: updatedQueue });
  } catch (e) { console.warn('[Review] Failed to mark queue items rejected:', e.message); }

  // Mark the rejected slots in content_slots so Priya deletes them on regen
  try {
    const slotsFile = readSync('content_slots');
    const allSlots = Array.isArray(slotsFile?.data) ? slotsFile.data : [];
    const updated = allSlots.map(s => {
      if ((s.brand_id === review.brandId) && ((s.platform || 'instagram') === platform) && s.status !== 'approved' && s.status !== 'published') {
        return { ...s, status: 'rejected', review_feedback: feedback, updated_at: new Date().toISOString() };
      }
      return s;
    });
    writeSync('content_slots', { _updatedAt: new Date().toISOString(), data: updated });
  } catch (e) { console.warn('[Review] Failed to mark slots rejected:', e.message); }

  // Async-trigger Priya for this platform only. We don't await — the review returns.
  // The frontend polls or is notified via review-status endpoint.
  (async () => {
    try {
      const { executePriya } = await import('./priyaAgent.js');
      const campaign = {
        ...(review.campaign || {}),
        platforms: [platform],
        rejection_feedback: feedback,
      };
      console.log(`[Review] Triggering Priya regen for ${platform} with feedback: ${feedback?.slice(0, 80)}`);
      await executePriya(review.userId, review.brandId, { campaign });
    } catch (err) {
      console.error(`[Review] Priya regen failed for ${platform}:`, err.message);
    }
  })();
}

// ══════════════════════════════════════════════════════════════════════════════
// Slack webhook entry point (wraps updateReviewDecision)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Handle a Slack `block_actions` interaction payload — i.e. one of the three
 * buttons on an approval message was clicked.
 *
 * Three action_id prefixes:
 *   approve_<queueId>   → finalize approval (uses existing scheduled_at, default if none)
 *   reject_<queueId>    → opens reject-feedback modal via views.open
 *   schedule_<queueId>  → opens schedule date/time picker modal via views.open
 *
 * The trigger_id from the payload is required by views.open and is short-lived
 * (~3s), so we open modals synchronously without awaiting other DB work first.
 */
async function handleSlackAction(payload) {
  const action = payload.actions?.[0];
  if (!action) return;

  // Parse {reviewId, queueId, action} from button value (or fall back to action_id)
  let parsed = {};
  try { parsed = JSON.parse(action.value); } catch {}
  const decision = parsed.action || (action.action_id || '').split('_')[0];
  const queueId = parsed.queueId || (action.action_id || '').split('_').slice(1).join('_');
  const reviewId = parsed.reviewId;
  if (!queueId || !decision) return;

  // Look up the queue item to find its brand_id (needed for resolving the
  // brand-scoped Slack token and reading its current scheduled_at)
  const queueFile = readSync('approval_queue');
  const items = queueFile?.data || [];
  const item = items.find(i => i.id === queueId);
  if (!item) {
    console.warn(`[Review] handleSlackAction: queue item ${queueId} not found`);
    return;
  }

  // Resolve which Slack workspace's token to use (per-brand integration)
  let token = getSlackToken();
  try {
    const { resolveSlackForBrand } = await import('./slackIntegrationService.js');
    const resolved = await resolveSlackForBrand(item.brand_id);
    if (resolved.token) token = resolved.token;
  } catch {}

  // ── SCHEDULE action — open the date/time picker modal ─────────────
  if (decision === 'schedule') {
    try {
      await slackPost('views.open', {
        trigger_id: payload.trigger_id,
        view: buildSchedulePickerView({
          queueId,
          currentScheduled: item.scheduled_at,
          slotDate: item.slot_date,
        }),
      }, token);
    } catch (err) {
      console.warn('[Review] views.open (schedule) failed:', err.message);
    }
    return;
  }

  // ── REJECT action — open feedback modal ───────────────────────────
  if (decision === 'reject') {
    try {
      await slackPost('views.open', {
        trigger_id: payload.trigger_id,
        view: buildRejectFeedbackView({ queueId }),
      }, token);
    } catch (err) {
      console.warn('[Review] views.open (reject) failed:', err.message);
    }
    return;
  }

  // ── REGENERATE action — open prompt + file upload modal ───────────
  if (decision === 'regenerate') {
    try {
      await slackPost('views.open', {
        trigger_id: payload.trigger_id,
        view: buildRegenerateView({ queueId }),
      }, token);
    } catch (err) {
      console.warn('[Review] views.open (regenerate) failed:', err.message);
    }
    return;
  }

  // ── APPROVE action — finalize approval immediately ────────────────
  if (decision === 'approve') {
    // Make sure scheduled_at is set; default to 9 AM UTC of slot_date if missing
    let finalScheduledAt = item.scheduled_at;
    if (!finalScheduledAt) {
      const [y, m, d] = String(item.slot_date || '').split('-').map(Number);
      let when = (y && m && d) ? new Date(Date.UTC(y, m - 1, d, 9, 0, 0)) : null;
      if (!when || isNaN(when.getTime()) || when.getTime() < Date.now()) {
        when = new Date(Date.now() + 24 * 60 * 60 * 1000);
        when.setUTCHours(9, 0, 0, 0);
      }
      finalScheduledAt = when.toISOString();
    }
    finalizeApproval(queueId, finalScheduledAt, payload.user?.id);
    if (reviewId) updateReviewDecision(reviewId, queueId, 'approve', null);

    // Update the Slack message: replace buttons with final status line
    try {
      await slackPost('chat.update', {
        channel: payload.channel.id,
        ts: payload.message.ts,
        blocks: [
          ...payload.message.blocks.filter(b => b.type !== 'actions'),
          {
            type: 'context',
            elements: [{
              type: 'mrkdwn',
              text: `✅ *Approved* by <@${payload.user?.id || 'someone'}> · scheduled ${new Date(finalScheduledAt).toUTCString().replace(' GMT', ' UTC')}`,
            }],
          },
        ],
      }, token);
    } catch (err) {
      console.warn('[Review] chat.update (approve) failed:', err.message);
    }
  }
}

/**
 * Handle Slack `view_submission` — fires when the user submits one of the
 * Block Kit modals we opened (date picker or reject feedback).
 *
 * Returns a response object that Express should send back to Slack — Slack
 * uses this to close the modal or show validation errors.
 */
async function handleSlackViewSubmission(payload) {
  const view = payload.view;
  if (!view) return { response_action: 'clear' };

  const callbackId = view.callback_id;
  const queueId = view.private_metadata;
  if (!queueId) return { response_action: 'clear' };

  const queueFile = readSync('approval_queue');
  const items = queueFile?.data || [];
  const item = items.find(i => i.id === queueId);
  if (!item) return { response_action: 'clear' };

  // Resolve per-brand Slack token for chat.update
  let token = getSlackToken();
  try {
    const { resolveSlackForBrand } = await import('./slackIntegrationService.js');
    const resolved = await resolveSlackForBrand(item.brand_id);
    if (resolved.token) token = resolved.token;
  } catch {}

  // ── SCHEDULE picker submission ─────────────────────────────────────
  if (callbackId === 'schedule_picker') {
    const date = view.state.values?.date_block?.date_input?.selected_date;
    const time = view.state.values?.time_block?.time_input?.selected_time;
    if (!date || !time) {
      return {
        response_action: 'errors',
        errors: { date_block: 'Pick both a date and time' },
      };
    }
    const iso = new Date(`${date}T${time}:00Z`).toISOString();

    // Persist scheduled_at on both queue item and content_slot
    const updatedItems = items.map(i => i.id === queueId ? { ...i, scheduled_at: iso, slot_date: iso.slice(0, 10) } : i);
    writeSync('approval_queue', { _updatedAt: new Date().toISOString(), data: updatedItems });

    try {
      const slotsFile = readSync('content_slots');
      const slots = slotsFile?.data || [];
      const sIdx = slots.findIndex(s => s.id === item.slot_id);
      if (sIdx >= 0) {
        slots[sIdx].scheduled_at = iso;
        slots[sIdx].slot_date = iso.slice(0, 10);
        slots[sIdx].updated_at = new Date().toISOString();
        writeSync('content_slots', { _updatedAt: new Date().toISOString(), data: slots });
      }
    } catch {}

    // Reflect new scheduled time on the Slack message — find the message ts
    // we stored on the queue item when posting and update it.
    if (item.slack_message_ts && item.slack_channel_id) {
      try {
        // Re-fetch the slot for accurate brief data
        const slotsFile = readSync('content_slots');
        const slot = (slotsFile?.data || []).find(s => s.id === item.slot_id) || { ...item, brief: item.brief, slot_date: iso.slice(0, 10) };
        const msg = buildSlotMessage(
          slot,
          item.review_id,
          queueId,
          item.slack_channel_id,
          { imageUrl: item.slack_image_url || null, videoUrl: item.generated_video || null, scheduledAt: iso }
        );
        await slackPost('chat.update', { channel: item.slack_channel_id, ts: item.slack_message_ts, blocks: msg.blocks }, token);
      } catch (err) {
        console.warn('[Review] chat.update (schedule) failed:', err.message);
      }
    }
    return { response_action: 'clear' };
  }

  // ── REGENERATE submission — kick off image regen, ack the modal ───
  if (callbackId === 'regenerate_image') {
    const prompt = view.state.values?.prompt_block?.prompt_input?.value || '';
    const fileInput = view.state.values?.reference_block?.reference_input;
    const fileId = fileInput?.files?.[0]?.id || null;
    const fileUrl = fileInput?.files?.[0]?.url_private || null;

    if (!prompt.trim()) {
      return {
        response_action: 'errors',
        errors: { prompt_block: 'Please describe how the new image should look.' },
      };
    }

    // Run regen in background — don't block the modal close.
    // Slack expects view_submission response within 3s, so we ack
    // immediately and do the regeneration after.
    (async () => {
      try {
        let referenceImageBase64 = null;
        if (fileUrl) {
          // Download the Slack-hosted file using the bot token
          try {
            const dlRes = await fetch(fileUrl, { headers: { Authorization: `Bearer ${token}` } });
            if (dlRes.ok) {
              const buf = Buffer.from(await dlRes.arrayBuffer());
              if (buf.length > 5 * 1024 * 1024) {
                console.warn(`[Review] Slack reference image too large (${buf.length} bytes) — skipping`);
              } else {
                const ct = dlRes.headers.get('content-type') || 'image/jpeg';
                referenceImageBase64 = `data:${ct};base64,${buf.toString('base64')}`;
              }
            }
          } catch (err) {
            console.warn('[Review] Slack file download failed:', err.message);
          }
        }
        await runRegeneration({ queueId, prompt, referenceImageDataUrl: referenceImageBase64, triggeredBy: payload.user?.id || 'slack' });
      } catch (err) {
        console.error('[Review] Slack regeneration failed:', err.message);
      }
    })();

    return { response_action: 'clear' };
  }

  // ── REJECT feedback submission ─────────────────────────────────────
  if (callbackId === 'reject_feedback') {
    const feedback = view.state.values?.feedback_block?.feedback_input?.value || '';
    if (item.review_id) updateReviewDecision(item.review_id, queueId, 'reject', feedback);

    // Mark queue item rejected
    const updatedItems = items.map(i => i.id === queueId ? { ...i, status: 'rejected', reviewer_notes: feedback, resolved_at: new Date().toISOString() } : i);
    writeSync('approval_queue', { _updatedAt: new Date().toISOString(), data: updatedItems });

    // Update the original Slack message
    if (item.slack_message_ts && item.slack_channel_id) {
      try {
        const slotsFile = readSync('content_slots');
        const slot = (slotsFile?.data || []).find(s => s.id === item.slot_id) || item;
        const baseMsg = buildSlotMessage(
          slot,
          item.review_id,
          queueId,
          item.slack_channel_id,
          { imageUrl: item.slack_image_url || null, videoUrl: item.generated_video || null }
        );
        await slackPost('chat.update', {
          channel: item.slack_channel_id,
          ts: item.slack_message_ts,
          blocks: [
            ...baseMsg.blocks.filter(b => b.type !== 'actions'),
            {
              type: 'context',
              elements: [{
                type: 'mrkdwn',
                text: `❌ *Rejected* by <@${payload.user?.id || 'someone'}>${feedback ? `\n_Feedback:_ ${feedback.slice(0, 200)}` : ''}`,
              }],
            },
          ],
        }, token);
      } catch (err) {
        console.warn('[Review] chat.update (reject) failed:', err.message);
      }
    }
    return { response_action: 'clear' };
  }

  return { response_action: 'clear' };
}

/**
 * Core regeneration helper — shared by:
 *   - Dashboard endpoint  PUT /api/approval-queue/:id/regenerate
 *   - Slack regenerate modal submission
 *
 * Calls Gemini with the given prompt + optional reference image, persists
 * the new image to approval_queue + content_slots, fires Kling video
 * regen for Reels, and chat.update's the Slack message with the new
 * image. Throws on hard failure so callers can surface errors.
 */
async function runRegeneration({ queueId, prompt, referenceImageDataUrl = null, triggeredBy = null }) {
  const queueFile = readSync('approval_queue');
  const items = queueFile?.data || [];
  const idx = items.findIndex(i => i.id === queueId);
  if (idx < 0) throw new Error(`Queue item ${queueId} not found`);
  const item = items[idx];

  const slotsFile = readSync('content_slots');
  const slots = slotsFile?.data || [];
  const sIdx = slots.findIndex(s => s.id === item.slot_id);
  const slot = sIdx >= 0 ? slots[sIdx] : null;

  // Resolve brand for product context (used as a secondary lock if the user
  // didn't upload a reference image)
  const brandsFile = readSync('brand_profiles');
  const brand = (brandsFile?.data || brandsFile || []).find(b => b.id === item.brand_id);
  const products = brand?.products || [];
  let chosenProduct = null;
  if (slot?.selected_product) {
    const wanted = String(slot.selected_product).trim().toLowerCase();
    chosenProduct = products.find(p => String(p?.name || '').trim().toLowerCase() === wanted) || null;
  }
  if (!chosenProduct && products.length) chosenProduct = products[0];

  // Aspect ratio: reels = 9:16, stories = 9:16, posts = 1:1
  const format = String(slot?.format || item.format || 'post').toLowerCase();
  const aspectRatio = (format === 'reel' || format === 'story') ? '9:16' : '1:1';
  const visualDirection = item.brief?.visual_direction || slot?.brief?.visual_direction || '';

  console.log(`[Review] Regenerating image for ${queueId} (format=${format}, ref=${referenceImageDataUrl ? 'user-upload' : (chosenProduct ? 'product-lock' : 'none')})`);

  // Generate the new image
  const buffer = await generateImage(prompt, visualDirection, aspectRatio, chosenProduct, referenceImageDataUrl);
  const newDataUrl = `data:image/png;base64,${buffer.toString('base64')}`;

  // Persist to approval_queue + content_slots
  const now = new Date().toISOString();
  items[idx] = {
    ...item,
    generated_image: newDataUrl,
    last_regenerated_at: now,
    last_regenerated_by: triggeredBy,
    last_regenerate_prompt: prompt,
  };
  writeSync('approval_queue', { _updatedAt: now, data: items });
  if (sIdx >= 0) {
    slots[sIdx] = {
      ...slots[sIdx],
      generated_image: newDataUrl,
      updated_at: now,
    };
    writeSync('content_slots', { _updatedAt: now, data: slots });
  }

  // For Reels: kick off video regeneration in the background. Old video
  // is invalidated since the seed frame changed.
  if (format === 'reel') {
    try {
      const { kickOffReelVideoInBackground } = await import('./klingReelService.js');
      // Clear stale video so the UI shows "regenerating"
      items[idx].generated_video = null;
      writeSync('approval_queue', { _updatedAt: new Date().toISOString(), data: items });
      if (sIdx >= 0) {
        slots[sIdx].generated_video = null;
        writeSync('content_slots', { _updatedAt: new Date().toISOString(), data: slots });
      }
      const reelPrompt = item.brief?.reel_prompt || item.brief?.video_prompt || prompt || (item.brief?.hook || 'cinematic motion');
      kickOffReelVideoInBackground({
        slotId: item.slot_id,
        imageUrl: newDataUrl,
        prompt: reelPrompt,
        aspectRatio,
        readSyncFile: readSync,
        writeSyncFile: writeSync,
        queueItemId: queueId,
      });
    } catch (err) {
      console.warn('[Review] Failed to kick off Kling regen:', err.message);
    }
  }

  // Mirror the new image to the existing Slack card via chat.update
  if (item.slack_message_ts && item.slack_channel_id) {
    try {
      let token = getSlackToken();
      try {
        const { resolveSlackForBrand } = await import('./slackIntegrationService.js');
        const resolved = await resolveSlackForBrand(item.brand_id);
        if (resolved.token) token = resolved.token;
      } catch {}

      // Upload the new image to Slack and use the resulting public URL,
      // since chat.update can't reference a data: URI directly.
      let publicImageUrl = null;
      try {
        const fileMeta = await slackUploadImage(buffer, `regen_${queueId}.png`, item.slack_channel_id);
        publicImageUrl = fileMeta?.url_private || fileMeta?.permalink_public || null;
        items[idx].slack_image_url = publicImageUrl;
        writeSync('approval_queue', { _updatedAt: new Date().toISOString(), data: items });
      } catch (err) {
        console.warn('[Review] Slack image upload (regen) failed:', err.message);
      }

      const reloadedSlot = (readSync('content_slots')?.data || []).find(s => s.id === item.slot_id) || slot || items[idx];
      const updateMsg = buildSlotMessage(
        reloadedSlot,
        item.review_id,
        queueId,
        item.slack_channel_id,
        { imageUrl: publicImageUrl || item.slack_image_url || null, videoUrl: format === 'reel' ? null : items[idx].generated_video || null, scheduledAt: items[idx].scheduled_at }
      );
      await slackPost('chat.update', {
        channel: item.slack_channel_id,
        ts: item.slack_message_ts,
        blocks: [
          ...updateMsg.blocks,
          {
            type: 'context',
            elements: [{
              type: 'mrkdwn',
              text: `🎨 *Regenerated* by <@${triggeredBy || 'someone'}>${prompt ? ` — _"${prompt.slice(0, 120)}"_` : ''}`,
            }],
          },
        ],
      }, token);
    } catch (err) {
      console.warn('[Review] chat.update (regen) failed:', err.message);
    }
  }

  return items[idx];
}

/**
 * Set status='approved' + scheduled_at on an approval_queue item AND its
 * linked content_slot. Used by both Slack approve and dashboard approve.
 */
function finalizeApproval(queueId, scheduledAt, approverUserId) {
  try {
    const queueFile = readSync('approval_queue');
    const items = queueFile?.data || [];
    const idx = items.findIndex(i => i.id === queueId);
    if (idx < 0) return;
    items[idx] = {
      ...items[idx],
      status: 'approved',
      scheduled_at: scheduledAt || items[idx].scheduled_at,
      resolved_at: new Date().toISOString(),
      approved_by: approverUserId,
    };
    writeSync('approval_queue', { _updatedAt: new Date().toISOString(), data: items });

    const slotsFile = readSync('content_slots');
    const slots = slotsFile?.data || [];
    const sIdx = slots.findIndex(s => s.id === items[idx].slot_id);
    if (sIdx >= 0) {
      slots[sIdx] = {
        ...slots[sIdx],
        status: 'approved',
        approved: true,
        scheduled_at: scheduledAt || slots[sIdx].scheduled_at,
        updated_at: new Date().toISOString(),
      };
      writeSync('content_slots', { _updatedAt: new Date().toISOString(), data: slots });
    }
  } catch (err) {
    console.warn('[Review] finalizeApproval failed:', err.message);
  }
}

// ── Get review status (called by frontend polling) ────────────────────────
function getReviewStatus(reviewId) {
  const review = pendingReviews.get(reviewId);
  if (!review) return { status: 'not_found' };

  const sampleItems = review.sampleItems || [];
  const remainingItems = review.remainingItems || [];

  // Per-platform tally
  const platforms = {};
  for (const s of sampleItems) {
    const p = s.slot.platform || 'instagram';
    if (!platforms[p]) platforms[p] = { sample_total: 0, approved: 0, rejected: 0, pending: 0, remaining: 0, decided: null };
    platforms[p].sample_total++;
    const d = review.decisions[s.queueId];
    if (d === 'approve') platforms[p].approved++;
    else if (d === 'reject') platforms[p].rejected++;
    else platforms[p].pending++;
  }
  for (const s of remainingItems) {
    const p = s.slot.platform || 'instagram';
    if (!platforms[p]) platforms[p] = { sample_total: 0, approved: 0, rejected: 0, pending: 0, remaining: 0, decided: null };
    platforms[p].remaining++;
  }
  for (const [p, v] of Object.entries(platforms)) {
    v.decided = review.platformDecided?.[p] || null;
  }

  const totalApproved = Object.values(review.decisions).filter(d => d === 'approve').length;
  const totalRejected = Object.values(review.decisions).filter(d => d === 'reject').length;
  const totalSamples = sampleItems.length;
  const allPlatformsDecided = Object.keys(platforms).length > 0
    && Object.values(platforms).every(v => v.decided);

  return {
    status: allPlatformsDecided ? 'complete' : 'waiting',
    approved_count: totalApproved,
    rejected_count: totalRejected,
    total_reviewed: totalSamples,
    total_remaining: remainingItems.length,
    decided: totalApproved + totalRejected,
    platforms,
    started_at: review.startedAt,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Main: Execute Review Agent
// ══════════════════════════════════════════════════════════════════════════════

async function executeReview(userId, brandId, config = {}) {
  // ── Destination mode ─────────────────────────────────────────────────
  // Auto-detect: if this brand has a Slack workspace connected, post to
  // Slack AND the dashboard. Otherwise, dashboard-only. No modal needed.
  // Legacy callers can still pass `reviewMode` to force a mode.
  const requestedMode = (config.reviewMode || '').toLowerCase();

  // Resolve Slack token per-brand (OAuth integration) → falls back to env
  // vars if no per-brand row exists. So users with their own connected
  // workspace get THEIR channel; users without get the legacy single
  // workspace; users with neither get dashboard-only mode.
  let slackToken = '';
  let channelId = null;
  let slackTeamName = null;
  try {
    const { resolveSlackForBrand } = await import('./slackIntegrationService.js');
    const resolved = await resolveSlackForBrand(brandId);
    slackToken = resolved.token;
    channelId = resolved.channel;
    slackTeamName = resolved.teamName;
    if (resolved.perBrand) {
      console.log(`[Review] Using per-brand Slack workspace: ${slackTeamName || channelId}`);
    }
  } catch (err) {
    console.warn('[Review] Slack resolver failed, falling back to env vars:', err.message);
    slackToken = getSlackToken();
    channelId = getSlackChannel();
  }
  // Override the token getter for this run via a closure on the slackPost calls.
  // Existing slackPost() reads env directly — quickest fix is to set
  // process.env temporarily for the duration. Cleaner refactor would thread
  // the token through every call, but that's a bigger change.
  const _origToken = process.env.SLACK_BOT_TOKEN;
  if (slackToken && slackToken !== _origToken) process.env.SLACK_BOT_TOKEN = slackToken;

  // Slack is "enabled" only when the user explicitly chose Slack mode AND
  // the workspace is connected. Dashboard mode never posts to Slack even
  // if creds are present.
  const slackEnabled = requestedMode === 'dashboard'
    ? false
    : !!(slackToken && channelId);

  if (requestedMode === 'dashboard') {
    console.log('[Review] reviewMode=dashboard → skipping Slack entirely');
  } else if (requestedMode === 'slack' && !slackEnabled) {
    // User explicitly chose Slack but resolution failed — surface the cause
    // instead of silently writing to dashboard only.
    console.error(`[Review] reviewMode=slack but resolution failed: token=${!!slackToken} channel=${channelId || 'NULL'}. Posts will go to dashboard only. Reconnect Slack with the channel-picker.`);
  } else if (!slackEnabled) {
    console.log('[Review] Slack not configured — falling back to dashboard-only mode');
  } else {
    console.log(`[Review] reviewMode=slack → posting all approval cards to Slack channel ${channelId}`);
  }

  // Load brand + slots
  const brandsFile = readSync('brand_profiles');
  const allBrands = brandsFile?.data || brandsFile || [];
  const brand = allBrands.find(b => b.id === brandId);
  if (!brand) throw new Error(`Brand not found: ${brandId}`);

  // Per-slot product resolver — Priya auto-matches a product for each slot
  // and stores the name on `slot.selected_product`. Review should use THAT
  // product's image as the image-to-image base, NOT the first product.
  // Falls back to first product when slot has no selected_product (legacy
  // slots before the matcher existed).
  const brandProducts = Array.isArray(brand.products) ? brand.products : [];
  const firstProduct = brandProducts[0] || null;

  function pickProductForSlot(slot) {
    const wanted = (slot?.selected_product || '').trim().toLowerCase();
    if (wanted) {
      const match = brandProducts.find(p => (p.name || '').trim().toLowerCase() === wanted);
      if (match) return match;
      // Partial match fallback (e.g. slot says "Citrus Charge" but product is "Citrus Charge 250ml")
      const partial = brandProducts.find(p => {
        const n = (p.name || '').toLowerCase();
        return n.includes(wanted) || wanted.includes(n);
      });
      if (partial) return partial;
    }
    return firstProduct;
  }

  if (brandProducts.length === 0) {
    console.log(`[Review] No products on brand — generating pure lifestyle scenes`);
  } else {
    console.log(`[Review] ${brandProducts.length} products available for per-slot lock matching`);
  }

  const slotsFile = readSync('content_slots');
  const allSlots = Array.isArray(slotsFile?.data) ? slotsFile.data : [];

  // Find all upcoming briefed slots for this brand
  const today = new Date().toISOString().split('T')[0];
  const eligibleSlots = allSlots
    .filter(s => s.brand_id === brandId && s.status === 'briefed' && s.brief && s.slot_date >= today)
    .sort((a, b) => a.slot_date.localeCompare(b.slot_date));

  if (eligibleSlots.length === 0) {
    throw new Error('No briefed calendar slots found. Run Priya first.');
  }

  // ── Group by platform ──────────────────────────────────────────────────
  const slotsByPlatform = {};
  for (const slot of eligibleSlots) {
    const p = slot.platform || 'instagram';
    if (!slotsByPlatform[p]) slotsByPlatform[p] = [];
    slotsByPlatform[p].push(slot);
  }

  // Per platform: first 3 become "sample", the rest become "remaining" (auto-approve if sample passes)
  const reviewId = `review_${Date.now()}`;
  const sampleItems = []; // { queueId, slot, imageBuffer }
  const remainingItems = []; // { queueId, slot }

  const platforms = Object.keys(slotsByPlatform);
  console.log(`\n[Review] ═══ Starting Per-Platform Review for ${brand.name} ═══`);
  console.log(`[Review] Platforms: ${platforms.join(', ')}`);
  for (const p of platforms) {
    console.log(`[Review]   ${p}: ${slotsByPlatform[p].length} eligible (${Math.min(3, slotsByPlatform[p].length)} sample + ${Math.max(0, slotsByPlatform[p].length - 3)} remaining)`);
  }

  // Build queue-item skeletons per platform.
  // With cascade removed, every slot is treated as a "sample" (= must be
  // explicitly approved). We keep the sample/remaining split for backward-
  // compatibility with checkPlatformThresholds + UI badges, but every slot
  // now lives in `sampleItems` so each one gets its own Slack message and
  // independent approve/reject decision.
  let queueCounter = 0;
  for (const [platform, slots] of Object.entries(slotsByPlatform)) {
    for (const slot of slots) {
      sampleItems.push({ queueId: `${reviewId}_item_${queueCounter++}`, slot, imageBuffer: null });
    }
  }

  // ── Intro post (Slack) ────────────────────────────────────────────────
  if (slackEnabled) {
    try {
      await slackPost('chat.postMessage', {
        channel: channelId,
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: `🎨 Content Review — ${brand.name}`, emoji: true },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `Reviewing *${sampleItems.length} sample slots across ${platforms.length} platform${platforms.length > 1 ? 's' : ''}*.\n${platforms.map(p => `• ${PLATFORM_BADGES[p] || p}: 3 samples + ${slotsByPlatform[p].length - 3} auto-pending`).join('\n')}\n\n_2+ approvals per platform → rest auto-approved + scheduled._\n_2+ rejections per platform → Priya regenerates only that platform._`,
            },
          },
          { type: 'divider' },
        ],
      });
    } catch (err) {
      console.warn('[Review] Intro post failed:', err.message);
    }
  }

  // ── Generate images for ALL slots (samples + remaining) in parallel ──
  // Per user spec: every approval card needs a real image. Previously we
  // only generated for the 3 samples per platform; the remaining showed
  // "No image generated" placeholders.
  const allEntries = [...sampleItems, ...remainingItems];
  console.log(`[Review] Generating ${allEntries.length} images in parallel (samples + auto-pending)...`);

  // Helper used by image gen below + Kling video kick-off later
  const buildPrompt = (slot) => slot.brief?.image_prompt || slot.idea || 'brand content';
  const buildDirection = (slot) => slot.brief?.visual_direction || '';
  const buildAspect = (slot) => (slot.format === 'story' || slot.format === 'reel') ? '9:16' : '1:1';

  // Throttle: too many parallel Gemini calls cause 429s. Run in batches of 5.
  async function runInBatches(items, batchSize, fn) {
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      await Promise.all(batch.map(fn));
    }
  }

  await runInBatches(allEntries, 5, async (entry) => {
    const { slot } = entry;
    const prompt = buildPrompt(slot);
    const direction = buildDirection(slot);
    const aspectRatio = buildAspect(slot);
    const slotProduct = pickProductForSlot(slot);
    const productLabel = slotProduct
      ? (isUsableImageUrl(slotProduct.imageDataUrl)
          ? `🔒 ${slotProduct.name}`
          : `⚠ ${slotProduct.name} (unusable image — lifestyle fallback)`)
      : 'no product';
    try {
      const imageBuffer = await generateImage(prompt, direction, aspectRatio, slotProduct);
      entry.imageBuffer = imageBuffer;
      console.log(`[Review] ✓ ${slot.platform || 'instagram'}/${slot.slot_date}/${slot.format} [${productLabel}] (${imageBuffer.length}b)`);
    } catch (err) {
      console.error(`[Review] ✗ ${slot.platform || 'instagram'}/${slot.slot_date}/${slot.format} [${productLabel}] image failed:`, err.message);
    }
  });

  // ── Post each item to Slack as its own approve-card ───────────────────
  // Per user spec: every post (image + reel) gets its own Slack message
  // with Approve / Reject / Schedule buttons. We capture the returned `ts`
  // so view_submission handlers + the dashboard can chat.update it later
  // (e.g. when Kling video finishes, or the user approves from the dashboard).
  if (slackEnabled) {
    for (const entry of sampleItems) {
      try {
        let imagePermalink = null;
        if (entry.imageBuffer) {
          // Upload the still as a normal file (renders inline in the channel)
          imagePermalink = await slackUploadImage(
            entry.imageBuffer,
            `${entry.slot.platform || 'ig'}_${entry.slot.slot_date}_${entry.slot.format}.png`,
            channelId
          );
          // Tiny delay so the file message lands before the action card
          await new Promise(r => setTimeout(r, 1500));
        }
        const isReel = entry.slot.format === 'reel';
        const msg = buildSlotMessage(entry.slot, reviewId, entry.queueId, channelId, {
          // Block-kit image_url requires a publicly fetchable URL. Slack file
          // permalinks don't satisfy that without files.sharedPublicURL, so
          // we rely on the inline file message above for the preview and
          // skip the image block here.
          imageUrl: null,
          videoUrl: entry.slot.generated_video || null,
          scheduledAt: null,
        });
        const posted = await slackPost('chat.postMessage', msg);

        // Stash channel + ts on the entry; we'll persist them on the queue
        // item below so chat.update can target this exact message.
        entry.slack_message_ts = posted?.ts || null;
        entry.slack_channel_id = posted?.channel || channelId;
        entry.slack_image_url = imagePermalink;
        entry.slack_is_reel = isReel;
      } catch (err) {
        console.error(`[Review] Failed to post item ${entry.queueId}:`, err.message);
      }
    }
  }

  // ── Register pending review ───────────────────────────────────────────
  const review = {
    reviewId,
    userId,
    brandId,
    sampleItems,
    remainingItems,
    decisions: {},
    feedback_by_item: {},
    platformDecided: {}, // platform → 'approved' | 'regenerating'
    campaign: config.campaign || brand.priya_campaign || null,
    scoutReport: brand.scout_report || null,
    channelId,
    startedAt: Date.now(),
  };
  pendingReviews.set(reviewId, review);

  // ── Write all items to approval_queue.json for dashboard ──────────────
  try {
    const existingQueueFile = readSync('approval_queue');
    const existingQueue = Array.isArray(existingQueueFile?.data) ? existingQueueFile.data : [];

    const queueItemsForWrite = sampleItems.map((entry) => ({
      id: entry.queueId,
      brand_id: brandId,
      user_id: userId,
      slot_id: entry.slot.id,
      slot_date: entry.slot.slot_date,
      format: entry.slot.format,
      platform: entry.slot.platform || 'instagram',
      brief: entry.slot.brief,
      generated_image: entry.imageBuffer ? `data:image/png;base64,${entry.imageBuffer.toString('base64')}` : null,
      caption_preview: (entry.slot.brief?.caption || '').slice(0, 200),
      quality_scores: null,
      guardrail_flags: null,
      dedup_score: 0,
      status: 'pending',
      review_id: reviewId,
      review_batch_id: reviewId,
      review_sample: true,
      auto_approve_on_sample_pass: false,
      // ── Slack metadata (only set when reviewMode === 'slack') ──────
      // chat.update needs both ts and channel to target the right message.
      slack_message_ts: entry.slack_message_ts || null,
      slack_channel_id: entry.slack_channel_id || null,
      slack_image_url: entry.slack_image_url || null,
      review_destination: slackEnabled ? 'slack' : 'dashboard',
      created_at: new Date().toISOString(),
    }));

    writeSync('approval_queue', {
      _updatedAt: new Date().toISOString(),
      data: [...existingQueue, ...queueItemsForWrite],
    });
    console.log(`[Review] Wrote ${queueItemsForWrite.length} review items to approval_queue.json (mode=${slackEnabled ? 'slack' : 'dashboard'})`);

    // Persist generated images onto the linked content_slots so the calendar
    // shows them too. (Without this, only approval_queue has the image.)
    try {
      const slotsFile = readSync('content_slots');
      const slots = Array.isArray(slotsFile?.data) ? slotsFile.data : [];
      let touched = 0;
      for (const entry of allEntries) {
        if (!entry.imageBuffer) continue;
        const idx = slots.findIndex(s => s.id === entry.slot.id);
        if (idx >= 0) {
          slots[idx].generated_image = `data:image/png;base64,${entry.imageBuffer.toString('base64')}`;
          slots[idx].status = 'generated';
          slots[idx].updated_at = new Date().toISOString();
          touched++;
        }
      }
      if (touched > 0) {
        writeSync('content_slots', { _updatedAt: new Date().toISOString(), data: slots });
        console.log(`[Review] Synced ${touched} images back to content_slots`);
      }
    } catch (err) {
      console.warn('[Review] Failed to sync images into content_slots:', err.message);
    }

    // ── Kick off Kling 3.0 video gen for every Reel-format slot in parallel.
    // The video URL gets attached to both content_slots AND approval_queue
    // when it finishes (~60-180s per video). UI re-polls and renders the
    // <video> player when generated_video appears.
    const reelEntries = allEntries.filter(e => e.slot.format === 'reel' && e.imageBuffer);
    if (reelEntries.length > 0) {
      console.log(`[Review] Kicking off Kling 3.0 video gen for ${reelEntries.length} reel(s) in background`);
      try {
        const { kickOffReelVideoInBackground } = await import('./klingReelService.js');
        for (const entry of reelEntries) {
          const motionPrompt = [
            entry.slot.brief?.image_prompt,
            entry.slot.brief?.visual_direction,
          ].filter(Boolean).join('. ') || entry.slot.idea || 'cinematic motion';
          // Use the freshly-generated image as the start frame
          const imageDataUrl = `data:image/png;base64,${entry.imageBuffer.toString('base64')}`;
          kickOffReelVideoInBackground({
            slotId: entry.slot.id,
            imageUrl: imageDataUrl,
            prompt: motionPrompt,
            aspectRatio: '9:16',
            readSyncFile: readSync,
            writeSyncFile: writeSync,
            // Also patch approval_queue with the video URL when ready
            queueItemId: entry.queueId,
          });
        }
      } catch (err) {
        console.warn('[Review] Failed to start Kling video gen:', err.message);
      }
    }
  } catch (err) {
    console.error('[Review] Failed to write approval_queue.json:', err.message);
  }

  if (slackEnabled) {
    try {
      await slackPost('chat.postMessage', {
        channel: channelId,
        text: `⏳ _Waiting for approvals... (Slack OR in-app dashboard — either works)_`,
      });
    } catch (err) { console.warn('[Review] Waiting msg failed:', err.message); }
  }

  console.log(`[Review] Review ID: ${reviewId} — returning immediately, threshold logic fires on each decision`);

  return {
    brand_id: brandId,
    brand_name: brand.name,
    decision: 'waiting',
    review_id: reviewId,
    slack_enabled: slackEnabled,
    platforms,
    total_samples: sampleItems.length,
    total_remaining: remainingItems.length,
    approved_count: 0,
    rejected_count: 0,
    total_reviewed: sampleItems.length,
    feedback: [],
    slots_reviewed: sampleItems.map(s => ({
      queue_id: s.queueId,
      slot_id: s.slot.id,
      slot_date: s.slot.slot_date,
      format: s.slot.format,
      platform: s.slot.platform || 'instagram',
      status: 'pending',
    })),
    generated_at: new Date().toISOString(),
  };
}

// Internal helper exposed for klingReelService.updateSlackMessageWithVideo
// — returns the Block Kit `blocks` array (not the full chat.postMessage body)
// so callers can pass it to chat.update directly.
function _buildSlotMessageForExternalUpdate(slot, reviewId, queueId, channelId, options) {
  return buildSlotMessage(slot, reviewId, queueId, channelId, options).blocks;
}

/**
 * Two-way sync helper: when the user approves/rejects from the in-app
 * dashboard, mirror the status onto the Slack approval card by replacing
 * its action-buttons block with a "✅ Approved" / "❌ Rejected" footer.
 *
 * Called fire-and-forget from the /api/approval-queue/:id/approve|reject
 * routes. Errors are swallowed — approval flow stays working even if Slack
 * is down or the message was deleted.
 */
async function syncDashboardDecisionToSlack(queueItem, decision, opts) {
  if (!opts) opts = {};
  try {
    const { ts, channel } = { ts: queueItem.slack_message_ts, channel: queueItem.slack_channel_id };
    if (!ts || !channel) return;

    let token = process.env.SLACK_BOT_TOKEN || '';
    try {
      const { resolveSlackForBrand } = await import('./slackIntegrationService.js');
      const resolved = await resolveSlackForBrand(queueItem.brand_id);
      if (resolved?.token) token = resolved.token;
    } catch {}
    if (!token) return;

    // Re-render the original message blocks, but strip the action buttons
    // and append a status context block.
    const slot = {
      id: queueItem.slot_id,
      slot_date: queueItem.slot_date,
      format: queueItem.format,
      platform: queueItem.platform,
      brief: queueItem.brief,
      generated_video: queueItem.generated_video,
    };
    const baseBlocks = buildSlotMessage(slot, queueItem.review_id, queueItem.id, channel, {
      imageUrl: queueItem.slack_image_url || null,
      videoUrl: queueItem.generated_video || null,
      scheduledAt: opts.scheduledAt || queueItem.scheduled_at || null,
    }).blocks;

    let footer;
    let keepActions = false;
    if (decision === 'approve') {
      const when = opts.scheduledAt || queueItem.scheduled_at;
      const whenStr = when ? new Date(when).toUTCString().replace(' GMT', ' UTC') : 'next dispatch run';
      footer = {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `✅ *Approved from dashboard*${opts.approverName ? ` by ${opts.approverName}` : ''} · scheduled ${whenStr}` }],
      };
    } else if (decision === 'resubmitted') {
      // Item was rejected, then edited on the dashboard, and is now back to
      // pending. Keep the action buttons so the reviewer can decide again
      // straight from Slack. Append a banner showing the prior rejection
      // reason if we still have it on the queue item.
      keepActions = true;
      const priorReason = queueItem.reviewer_notes ? `\n_Previously rejected:_ ${String(queueItem.reviewer_notes).slice(0, 200)}` : '';
      footer = {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `🔁 *Resubmitted after edit* — ready for a new decision.${priorReason}` }],
      };
    } else {
      footer = {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `❌ *Rejected from dashboard*${opts.approverName ? ` by ${opts.approverName}` : ''}${opts.feedback ? `\n_Feedback:_ ${String(opts.feedback).slice(0, 200)}` : ''}` }],
      };
    }

    const blocks = keepActions
      ? [...baseBlocks, footer]                                 // keep the action buttons
      : [...baseBlocks.filter(b => b.type !== 'actions'), footer]; // strip them

    const res = await fetch('https://slack.com/api/chat.update', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ channel, ts, blocks }),
    });
    const data = await res.json();
    if (!data.ok) console.warn(`[Review] Dashboard→Slack chat.update failed: ${data.error}`);
  } catch (err) {
    console.warn('[Review] syncDashboardDecisionToSlack error:', err.message);
  }
}

export {
  executeReview,
  handleSlackAction,
  handleSlackViewSubmission,
  getReviewStatus,
  updateReviewDecision,
  finalizeApproval,
  pendingReviews,
  _buildSlotMessageForExternalUpdate,
  syncDashboardDecisionToSlack,
  generateImage,
  buildSlotMessage,
  runRegeneration,
};
