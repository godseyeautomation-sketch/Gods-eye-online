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

async function slackPost(method, body) {
  const token = getSlackToken();
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

async function generateImage(prompt, visualDirection, aspectRatio = '1:1', product = null) {
  const geminiKey = getGeminiKey();
  if (!geminiKey) throw new Error('Gemini API key not configured');

  // Determine if we can use the product as a base image
  const useProductLock = product && isUsableImageUrl(product.imageDataUrl);

  let fullPrompt;
  const parts = [];

  if (useProductLock) {
    // Image-to-image: keep product, change only the scene around it
    fullPrompt = `Edit this image. Keep the product exactly as shown. Change ONLY the background and scene to: ${prompt}. ${visualDirection || 'High quality, cinematic, professional photography'}`;

    // Build inline image part from the product's imageDataUrl
    const imageDataUrl = product.imageDataUrl;
    if (imageDataUrl.startsWith('data:')) {
      const mimeMatch = imageDataUrl.match(/^data:(image\/\w+);base64,/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const base64Data = imageDataUrl.replace(/^data:image\/\w+;base64,/, '');
      parts.push({ inlineData: { mimeType, data: base64Data } });
    } else {
      // http(s) URL — fetch and convert to base64
      try {
        const imgRes = await fetch(imageDataUrl);
        const imgBuf = await imgRes.arrayBuffer();
        const b64 = Buffer.from(imgBuf).toString('base64');
        const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
        parts.push({ inlineData: { mimeType: contentType, data: b64 } });
      } catch (err) {
        console.warn(`[Review] Failed to fetch product image URL, falling back to text-only:`, err.message);
        // Fall through to text-only generation below
      }
    }
    parts.push({ text: fullPrompt });
  } else {
    // No usable product image — pure lifestyle scene
    fullPrompt = `${prompt}. ${visualDirection || 'High quality, cinematic, professional photography'}`;
    parts.push({ text: fullPrompt });
  }

  const temperature = useProductLock ? 0.1 : 0.7;

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

function buildSlotMessage(slot, reviewId, queueId) {
  const brief = slot.brief || {};
  const formatIcon = slot.format === 'reel' ? '🎬 Reel' : slot.format === 'story' ? '📱 Story' : '🖼️ Post';
  const platform = slot.platform || 'instagram';
  const platformBadge = PLATFORM_BADGES[platform] || `📱 ${platform}`;
  // Use global regex to strip ALL leading # characters before adding exactly one.
  // Without /g, "##tag" becomes "#tag" which still gets prefixed with # → "##tag" again.
  const hashtags = (brief.hashtags || []).slice(0, 8).map(t => `#${String(t).replace(/^#+/, '')}`).join(' ');

  return {
    channel: getSlackChannel(),
    text: `Review: ${platformBadge} · ${slot.slot_date} ${slot.format}`, // Fallback text
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${platformBadge}  ·  📅 ${slot.slot_date}  ·  ${formatIcon}`, emoji: true },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Hook:*\n${brief.hook || 'No hook'}\n\n*Caption:*\n${(brief.caption || '').slice(0, 500)}\n\n*CTA:* _${brief.call_to_action || 'N/A'}_`,
        },
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `*Visual:* ${brief.visual_direction || 'N/A'}` },
          { type: 'mrkdwn', text: `*Emotion:* ${brief.target_emotion || 'N/A'}` },
        ],
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: hashtags || '_No hashtags_' },
        ],
      },
      { type: 'divider' },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '✅ Approve', emoji: true },
            style: 'primary',
            action_id: `approve_${reviewId}_${queueId}`,
            value: JSON.stringify({ reviewId, queueId, action: 'approve' }),
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '❌ Reject', emoji: true },
            style: 'danger',
            action_id: `reject_${reviewId}_${queueId}`,
            value: JSON.stringify({ reviewId, queueId, action: 'reject' }),
          },
        ],
      },
    ],
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

  // Find the sample slot that matches this queue item
  const sampleEntry = review.sampleItems.find(s => s.queueId === queueItemId);
  if (!sampleEntry) {
    // Not a sample slot — just a remaining auto-approval slot being manually touched. Ignore.
    console.log(`[Review] Queue item ${queueItemId} is not a sample slot; no threshold effect`);
    return false;
  }

  const platform = sampleEntry.slot.platform || 'instagram';
  review.decisions[queueItemId] = decision;
  if (feedback) {
    if (!review.feedback_by_item) review.feedback_by_item = {};
    review.feedback_by_item[queueItemId] = feedback;
  }

  console.log(`[Review] Decision: ${platform}/${sampleEntry.slot.slot_date}/${sampleEntry.slot.format} → ${decision}${feedback ? ` (feedback: ${feedback.slice(0, 50)})` : ''}`);

  checkPlatformThresholds(review, platform);
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

function handleSlackAction(payload) {
  const action = payload.actions?.[0];
  if (!action) return;

  let parsed;
  try { parsed = JSON.parse(action.value); } catch { return; }
  const { reviewId, queueId, action: decision } = parsed;
  if (!reviewId || !queueId) return;

  // Slack doesn't give us a textarea natively — feedback collection is through in-app dashboard
  updateReviewDecision(reviewId, queueId, decision, null);

  // Also update the approval_queue.json sync file for the dashboard
  try {
    const queueFile = readSync('approval_queue');
    if (queueFile?.data) {
      const updatedData = queueFile.data.map(item => {
        if (item.id === queueId) {
          return { ...item, status: decision === 'approve' ? 'approved' : 'rejected', resolved_at: new Date().toISOString() };
        }
        return item;
      });
      writeSync('approval_queue', { _updatedAt: new Date().toISOString(), data: updatedData });
    }
  } catch (err) {
    console.warn('[Review] Failed to update approval_queue.json:', err.message);
  }

  // Update the Slack message to show decision (replace buttons with status)
  const statusEmoji = decision === 'approve' ? '✅ APPROVED' : '❌ REJECTED';
  slackPost('chat.update', {
    channel: payload.channel.id,
    ts: payload.message.ts,
    blocks: [
      ...payload.message.blocks.slice(0, -1), // Keep everything except the buttons
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${statusEmoji}* by <@${payload.user.id}>` },
      },
    ],
  }).catch(err => console.warn('[Review] Message update failed:', err.message));
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

  const slackEnabled = !!(slackToken && channelId);
  if (!slackEnabled) {
    console.log('[Review] Slack not configured — running in dashboard-only mode');
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

  // Build queue-item skeletons per platform
  let queueCounter = 0;
  for (const [platform, slots] of Object.entries(slotsByPlatform)) {
    const sample = slots.slice(0, 3);
    const remaining = slots.slice(3);
    for (const slot of sample) {
      sampleItems.push({ queueId: `${reviewId}_sample_${queueCounter++}`, slot, imageBuffer: null });
    }
    for (const slot of remaining) {
      remainingItems.push({ queueId: `${reviewId}_remaining_${queueCounter++}`, slot });
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

  // ── Generate images for all sample items in parallel per platform ─────
  console.log(`[Review] Generating ${sampleItems.length} sample images in parallel...`);
  await Promise.all(sampleItems.map(async (entry) => {
    const { slot } = entry;
    const prompt = slot.brief?.image_prompt || slot.idea || 'brand content';
    const direction = slot.brief?.visual_direction || '';
    const aspectRatio = (slot.format === 'story' || slot.format === 'reel') ? '9:16' : '1:1';
    // Pick the product matched to this slot's content (Priya sets selected_product)
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
  }));

  // ── Post each sample to Slack ─────────────────────────────────────────
  if (slackEnabled) {
    for (const entry of sampleItems) {
      try {
        if (entry.imageBuffer) {
          await slackUploadImage(entry.imageBuffer, `${entry.slot.platform || 'ig'}_${entry.slot.slot_date}_${entry.slot.format}.png`, channelId);
          await new Promise(r => setTimeout(r, 2000));
        }
        await slackPost('chat.postMessage', buildSlotMessage(entry.slot, reviewId, entry.queueId));
      } catch (err) {
        console.error(`[Review] Failed to post sample ${entry.queueId}:`, err.message);
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

    const sampleQueueItems = sampleItems.map((entry) => ({
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
      created_at: new Date().toISOString(),
    }));

    const remainingQueueItems = remainingItems.map((entry) => ({
      id: entry.queueId,
      brand_id: brandId,
      user_id: userId,
      slot_id: entry.slot.id,
      slot_date: entry.slot.slot_date,
      format: entry.slot.format,
      platform: entry.slot.platform || 'instagram',
      brief: entry.slot.brief,
      generated_image: null,
      caption_preview: (entry.slot.brief?.caption || '').slice(0, 200),
      quality_scores: null,
      guardrail_flags: null,
      dedup_score: 0,
      status: 'pending',
      review_id: reviewId,
      review_batch_id: reviewId,
      review_sample: false,
      auto_approve_on_sample_pass: true,
      created_at: new Date().toISOString(),
    }));

    writeSync('approval_queue', {
      _updatedAt: new Date().toISOString(),
      data: [...existingQueue, ...sampleQueueItems, ...remainingQueueItems],
    });
    console.log(`[Review] Wrote ${sampleQueueItems.length} samples + ${remainingQueueItems.length} remaining to approval_queue.json`);
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

export { executeReview, handleSlackAction, getReviewStatus, updateReviewDecision, pendingReviews };
