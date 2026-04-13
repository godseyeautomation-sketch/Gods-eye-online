/**
 * Review Agent — Slack HITL with Block Kit buttons
 *
 * Flow:
 *   1. Pick first 3 upcoming calendar slots from Priya's output
 *   2. Generate images for those specific slots
 *   3. Post to Slack with Block Kit: image + full brief + Approve/Reject buttons
 *   4. Wait for button clicks via webhook (ngrok → /api/slack/interactions)
 *   5. After all 3 decided OR timeout:
 *      - 2+ approved → mark slots approved, proceed
 *      - 2+ rejected → collect feedback, trigger Priya re-run
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

async function generateImage(prompt, visualDirection, aspectRatio = '1:1') {
  const geminiKey = getGeminiKey();
  if (!geminiKey) throw new Error('Gemini API key not configured');

  const fullPrompt = `${prompt}. ${visualDirection || 'High quality, cinematic, professional photography'}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          temperature: 0.7,
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

function buildSlotMessage(slot, reviewId, slotIndex) {
  const brief = slot.brief || {};
  const formatIcon = slot.format === 'reel' ? '🎬 Reel' : slot.format === 'story' ? '📱 Story' : '🖼️ Post';
  const hashtags = (brief.hashtags || []).slice(0, 8).map(t => `#${String(t).replace('#', '')}`).join(' ');

  return {
    channel: getSlackChannel(),
    text: `Review: ${slot.slot_date} ${slot.format}`, // Fallback text
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `📅 ${slot.slot_date}  ·  ${formatIcon}  ·  ${slot.scout_pillar || 'Content'}`, emoji: true },
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
            action_id: `approve_${reviewId}_${slotIndex}`,
            value: JSON.stringify({ reviewId, slotIndex, action: 'approve' }),
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '❌ Reject', emoji: true },
            style: 'danger',
            action_id: `reject_${reviewId}_${slotIndex}`,
            value: JSON.stringify({ reviewId, slotIndex, action: 'reject' }),
          },
        ],
      },
    ],
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Handle Slack button click (called from /api/slack/interactions)
// ══════════════════════════════════════════════════════════════════════════════

function handleSlackAction(payload) {
  const action = payload.actions?.[0];
  if (!action) return;

  let parsed;
  try { parsed = JSON.parse(action.value); } catch { return; }
  const { reviewId, slotIndex, action: decision } = parsed;

  const review = pendingReviews.get(reviewId);
  if (!review) {
    console.warn(`[Review] No pending review found for ${reviewId}`);
    return;
  }

  // Store the decision
  review.decisions[slotIndex] = decision;
  console.log(`[Review] Slack button: slot ${slotIndex} → ${decision} (review ${reviewId})`);

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

  // Check if enough decisions to finalize
  const approved = Object.values(review.decisions).filter(d => d === 'approve').length;
  const rejected = Object.values(review.decisions).filter(d => d === 'reject').length;
  const decidedCount = approved + rejected;

  if (approved >= 2 || rejected >= 2 || decidedCount >= review.slots.length) {
    // Finalize the review
    const finalDecision = approved >= 2 ? 'approved' : rejected >= 2 ? 'rejected' : (approved > rejected ? 'approved' : 'rejected');
    review.finalDecision = finalDecision;
    review.finalApproved = approved;
    review.finalRejected = rejected;
    review.completedAt = new Date().toISOString();

    console.log(`[Review] ═══ Complete: ${finalDecision} (${approved} approved, ${rejected} rejected) ═══`);

    // Post summary to Slack
    let summaryText;
    if (finalDecision === 'approved') {
      summaryText = `✅ *APPROVED* — ${approved}/${review.slots.length} slots approved! Proceeding to generate the full calendar.`;

      // Mark approved slots in sync file
      const allSlots = review.allSlots;
      for (let i = 0; i < review.slots.length; i++) {
        if (review.decisions[i] === 'approve') {
          const idx = allSlots.findIndex(s => s.id === review.slots[i].id);
          if (idx >= 0) {
            const imgBuf = review.imageResults[i]?.imageBuffer;
            allSlots[idx] = {
              ...allSlots[idx],
              status: 'approved',
              approved: true,
              generated_image: imgBuf ? `data:image/png;base64,${imgBuf.toString('base64')}` : allSlots[idx].generated_image,
              updated_at: new Date().toISOString(),
            };
          }
        }
      }
      writeSync('content_slots', { _updatedAt: new Date().toISOString(), data: allSlots });
    } else {
      summaryText = `❌ *REJECTED* — ${rejected}/${review.slots.length} slots rejected. Priya will regenerate with feedback.`;
    }

    slackPost('chat.postMessage', { channel: review.channelId, text: summaryText })
      .catch(err => console.warn('[Review] Summary post failed:', err.message));
  }
}

// ── Get review status (called by frontend polling) ────────────────────────
function getReviewStatus(reviewId) {
  const review = pendingReviews.get(reviewId);
  if (!review) return { status: 'not_found' };

  const approved = Object.values(review.decisions).filter(d => d === 'approve').length;
  const rejected = Object.values(review.decisions).filter(d => d === 'reject').length;

  if (review.finalDecision) {
    return {
      status: 'complete',
      decision: review.finalDecision,
      approved_count: review.finalApproved,
      rejected_count: review.finalRejected,
      total_reviewed: review.slots.length,
      completed_at: review.completedAt,
    };
  }

  return {
    status: 'waiting',
    approved_count: approved,
    rejected_count: rejected,
    total_reviewed: review.slots.length,
    decided: approved + rejected,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Main: Execute Review Agent
// ══════════════════════════════════════════════════════════════════════════════

async function executeReview(userId, brandId, config = {}) {
  const channelId = getSlackChannel();
  if (!getSlackToken()) throw new Error('SLACK_BOT_TOKEN not set in .env');
  if (!channelId) throw new Error('SLACK_CHANNEL_ID not set in .env');

  // Load brand + slots
  const brandsFile = readSync('brand_profiles');
  const allBrands = brandsFile?.data || brandsFile || [];
  const brand = allBrands.find(b => b.id === brandId);
  if (!brand) throw new Error(`Brand not found: ${brandId}`);

  const slotsFile = readSync('content_slots');
  const allSlots = Array.isArray(slotsFile?.data) ? slotsFile.data : [];

  // Find first 3 upcoming briefed slots for this brand (sorted by date)
  const today = new Date().toISOString().split('T')[0];
  const eligibleSlots = allSlots
    .filter(s => s.brand_id === brandId && s.status === 'briefed' && s.brief && s.slot_date >= today)
    .sort((a, b) => a.slot_date.localeCompare(b.slot_date));

  if (eligibleSlots.length === 0) {
    throw new Error('No briefed calendar slots found. Run Priya first.');
  }

  const reviewSlots = eligibleSlots.slice(0, 3);
  const reviewId = `review_${Date.now()}`;

  console.log(`\n[Review] ═══ Starting Review for ${brand.name} ═══`);
  console.log(`[Review] Sending ${reviewSlots.length} calendar slots to Slack for approval`);
  console.log(`[Review] Slots: ${reviewSlots.map(s => `${s.slot_date}/${s.format}`).join(', ')}`);

  // ── Step 1: Post intro ──────────────────────────────────────────────────
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
          text: `Reviewing *${reviewSlots.length} upcoming calendar slots*.\nClick *Approve* or *Reject* on each post below.\n\n_Need 2+ approvals to proceed with full calendar generation._`,
        },
      },
      { type: 'divider' },
    ],
  });

  // ── Step 2: Generate images for the 3 slots ─────────────────────────────
  console.log(`[Review] Generating images for ${reviewSlots.length} slots...`);
  const imageResults = [];
  for (let i = 0; i < reviewSlots.length; i++) {
    const slot = reviewSlots[i];
    const prompt = slot.brief?.image_prompt || slot.idea || 'brand content';
    const direction = slot.brief?.visual_direction || '';
    const aspectRatio = (slot.format === 'story' || slot.format === 'reel') ? '9:16' : '1:1';

    try {
      console.log(`[Review] Generating image ${i + 1}/${reviewSlots.length}: ${slot.slot_date}/${slot.format}`);
      const imageBuffer = await generateImage(prompt, direction, aspectRatio);
      console.log(`[Review] ✓ Image ${i + 1} generated (${imageBuffer.length} bytes)`);
      imageResults.push({ slot, imageBuffer, index: i });
    } catch (err) {
      console.error(`[Review] ✗ Image ${i + 1} failed:`, err.message);
      // Still send the slot to Slack without an image
      imageResults.push({ slot, imageBuffer: null, index: i });
    }
  }

  // ── Step 3: Upload images + post Block Kit messages ──────────────────────
  for (const { slot, imageBuffer, index } of imageResults) {
    try {
      // Upload image first (if generated)
      if (imageBuffer) {
        await slackUploadImage(imageBuffer, `${slot.slot_date}_${slot.format}.png`, channelId);
        // Small delay to let the image settle in the channel
        await new Promise(r => setTimeout(r, 2000));
      }

      // Post the Block Kit message with Approve/Reject buttons
      await slackPost('chat.postMessage', buildSlotMessage(slot, reviewId, index));
      console.log(`[Review] Posted slot ${index + 1}: ${slot.slot_date}/${slot.format}`);
    } catch (err) {
      console.error(`[Review] Failed to post slot ${index + 1}:`, err.message);
    }
  }

  // ── Step 4: Register pending review (non-blocking) ───────────────────────
  // Store the review state so webhook clicks can update it
  const review = {
    slots: reviewSlots,
    decisions: {},
    feedback: [],
    brandId,
    allSlots,
    imageResults,
    channelId,
    startedAt: Date.now(),
  };
  pendingReviews.set(reviewId, review);

  await slackPost('chat.postMessage', {
    channel: channelId,
    text: `⏳ _Waiting for your approval... Click Approve or Reject on each post above._`,
  });

  console.log(`[Review] Posted to Slack. Returning immediately — button clicks handled by webhook.`);
  console.log(`[Review] Review ID: ${reviewId}`);

  // Return immediately — don't wait for clicks
  return {
    brand_id: brandId,
    brand_name: brand.name,
    decision: 'waiting',
    review_id: reviewId,
    approved_count: 0,
    rejected_count: 0,
    total_reviewed: reviewSlots.length,
    feedback: [],
    slots_reviewed: reviewSlots.map((s, i) => ({
      slot_id: s.id,
      slot_date: s.slot_date,
      format: s.format,
      status: 'pending',
    })),
    generated_at: new Date().toISOString(),
  };
}

export { executeReview, handleSlackAction, getReviewStatus, pendingReviews };
