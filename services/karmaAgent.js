/**
 * Karma Agent — Analytics & Performance Insights
 *
 * Flow:
 *   1. Call upload-post.com API to get recent post history
 *   2. Match posts to content_slots via publish_request_id
 *   3. Calculate engagement metrics per slot (likes, comments, shares)
 *   4. Write performance_data to each slot in sync file
 *   5. Call Gemini to distill insights:
 *      - What content themes/formats worked best?
 *      - What to do more of / stop doing?
 *      - Best posting times?
 *      - Generate 5 winner-inspired content ideas for next cycle
 *   6. Write insights to performance_signals.json sync file
 *   7. Return summary
 */

import fs from 'fs';
import path from 'path';

const SYNC_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '', '.klint', 'sync');
const UPLOAD_POST_BASE = 'https://api.upload-post.com';

function getApiKey() { return process.env.UPLOAD_POST_API_KEY; }
function getGeminiKey() { return process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY; }

function readSync(name) {
  try { return JSON.parse(fs.readFileSync(path.join(SYNC_DIR, `${name}.json`), 'utf-8')); }
  catch { return null; }
}

function writeSync(name, data) {
  if (!fs.existsSync(SYNC_DIR)) fs.mkdirSync(SYNC_DIR, { recursive: true });
  fs.writeFileSync(path.join(SYNC_DIR, `${name}.json`), JSON.stringify(data, null, 2), 'utf-8');
}

// ── Gemini call (same pattern as priyaAgent.js) ─────────────────────────────

async function callGemini(prompt, { model = 'gemini-2.5-flash', temperature = 0.6, maxTokens = 8192 } = {}) {
  const geminiKey = getGeminiKey();
  if (!geminiKey) throw new Error('Gemini API key not configured');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);  // 2-minute timeout

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature, maxOutputTokens: maxTokens },
        }),
        signal: controller.signal,
      }
    );

    if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Gemini call timed out after 2 minutes');
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseJSON(text) {
  try { return JSON.parse(text); } catch {}
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) { try { return JSON.parse(match[1].trim()); } catch {} }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) { try { return JSON.parse(text.slice(start, end + 1)); } catch {} }
  return null;
}

// ── Fetch post history from upload-post.com ─────────────────────────────────

async function fetchPostHistory(limit = 30) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('UPLOAD_POST_API_KEY not configured');

  const res = await fetch(`${UPLOAD_POST_BASE}/api/uploadposts/history?limit=${limit}`, {
    method: 'GET',
    headers: { 'Authorization': `Apikey ${apiKey}` },
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error');
    throw new Error(`Failed to fetch history (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  return data?.data || data?.posts || data?.history || (Array.isArray(data) ? data : []);
}

// ── Fetch analytics for a specific post ─────────────────────────────────────

async function fetchPostAnalytics(requestId) {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const res = await fetch(`${UPLOAD_POST_BASE}/api/uploadposts/post-analytics/${encodeURIComponent(requestId)}`, {
      method: 'GET',
      headers: { 'Authorization': `Apikey ${apiKey}` },
    });

    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── Match history posts to content slots ────────────────────────────────────

function matchPostsToSlots(posts, slots) {
  const matched = [];

  for (const slot of slots) {
    if (!slot.publish_request_id) continue;

    // Match by request_id
    const post = posts.find(p =>
      p.request_id === slot.publish_request_id ||
      p.id === slot.publish_request_id
    );

    if (post) {
      matched.push({ slot, post });
    }
  }

  return matched;
}

// ── Extract engagement metrics from a post object ───────────────────────────

function extractMetrics(post, analytics) {
  // Combine data from history post and per-post analytics
  const metrics = {
    likes: 0,
    comments: 0,
    shares: 0,
    saves: 0,
    impressions: 0,
    reach: 0,
    engagement_rate: 0,
    views: 0,
  };

  // From history post
  if (post) {
    metrics.likes = post.likes || post.like_count || 0;
    metrics.comments = post.comments || post.comment_count || 0;
    metrics.shares = post.shares || post.share_count || 0;
    metrics.saves = post.saves || post.save_count || 0;
    metrics.impressions = post.impressions || post.impression_count || 0;
    metrics.reach = post.reach || post.reach_count || 0;
    metrics.views = post.views || post.view_count || post.video_views || 0;
  }

  // Override with more detailed analytics if available
  if (analytics) {
    metrics.likes = analytics.likes || analytics.like_count || metrics.likes;
    metrics.comments = analytics.comments || analytics.comment_count || metrics.comments;
    metrics.shares = analytics.shares || analytics.share_count || metrics.shares;
    metrics.saves = analytics.saves || analytics.save_count || metrics.saves;
    metrics.impressions = analytics.impressions || analytics.impression_count || metrics.impressions;
    metrics.reach = analytics.reach || analytics.reach_count || metrics.reach;
    metrics.views = analytics.views || analytics.view_count || metrics.views;
  }

  // Calculate engagement rate
  const totalEngagement = metrics.likes + metrics.comments + metrics.shares + metrics.saves;
  if (metrics.impressions > 0) {
    metrics.engagement_rate = parseFloat(((totalEngagement / metrics.impressions) * 100).toFixed(2));
  } else if (metrics.reach > 0) {
    metrics.engagement_rate = parseFloat(((totalEngagement / metrics.reach) * 100).toFixed(2));
  }

  return metrics;
}

// ══════════════════════════════════════════════════════════════════════════════
// Main: Execute Karma Agent
// ══════════════════════════════════════════════════════════════════════════════

async function executeKarma(userId, brandId, config = {}) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('UPLOAD_POST_API_KEY not configured in .env');

  // Load brand
  const brandsFile = readSync('brand_profiles');
  const allBrands = brandsFile?.data || brandsFile || [];
  const brand = allBrands.find(b => b.id === brandId);
  if (!brand) throw new Error(`Brand not found: ${brandId}`);

  // Load content slots
  const slotsFile = readSync('content_slots');
  const allSlots = Array.isArray(slotsFile?.data) ? slotsFile.data : [];

  // Find published slots for this brand
  const publishedSlots = allSlots.filter(s =>
    s.brand_id === brandId &&
    s.status === 'published' &&
    s.publish_request_id
  );

  console.log(`\n[Karma] ═══ Analytics for ${brand.name} ═══`);
  console.log(`[Karma] Found ${publishedSlots.length} published slots with request IDs`);

  // ── Step 1: Fetch post history from upload-post.com ─────────────────────
  const historyLimit = config.history_limit || 30;
  let posts = [];
  try {
    posts = await fetchPostHistory(historyLimit);
    console.log(`[Karma] Fetched ${posts.length} posts from upload-post.com history`);
  } catch (err) {
    console.warn(`[Karma] Failed to fetch history:`, err.message);
    // Continue with whatever we have — slots may have stale data
  }

  // ── Step 2: Match posts to slots ────────────────────────────────────────
  const matched = matchPostsToSlots(posts, publishedSlots);
  console.log(`[Karma] Matched ${matched.length} posts to content slots`);

  // ── Step 3: Fetch per-post analytics and calculate metrics ──────────────
  let metricsCount = 0;
  for (const { slot, post } of matched) {
    let analytics = null;
    if (slot.publish_request_id) {
      analytics = await fetchPostAnalytics(slot.publish_request_id);
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));
    }

    const metrics = extractMetrics(post, analytics);

    // Update the slot in the allSlots array
    const idx = allSlots.findIndex(s => s.id === slot.id);
    if (idx >= 0) {
      allSlots[idx] = {
        ...allSlots[idx],
        performance_data: metrics,
        analytics_updated_at: new Date().toISOString(),
      };
      metricsCount++;
    }
  }

  // ── Step 4: Write updated slots back to sync file ───────────────────────
  if (metricsCount > 0) {
    writeSync('content_slots', { _updatedAt: new Date().toISOString(), data: allSlots });
    console.log(`[Karma] Updated performance_data for ${metricsCount} slots`);
  }

  // ── Step 5: Distill insights with Gemini ────────────────────────────────
  // Collect slots with performance data for analysis
  const slotsWithMetrics = allSlots.filter(s =>
    s.brand_id === brandId &&
    s.performance_data &&
    (s.performance_data.likes > 0 || s.performance_data.impressions > 0 || s.performance_data.views > 0)
  );

  let insights = null;
  let insightsCount = 0;

  if (slotsWithMetrics.length >= 3) {
    // Sort by engagement for analysis
    const sorted = [...slotsWithMetrics].sort((a, b) => {
      const aEng = a.performance_data?.engagement_rate || a.performance_data?.likes || 0;
      const bEng = b.performance_data?.engagement_rate || b.performance_data?.likes || 0;
      return bEng - aEng;
    });

    const top5 = sorted.slice(0, 5);
    const bottom5 = sorted.slice(-5);

    const prompt = `Analyze these social media post results for the brand "${brand.name}" (${brand.industry || 'general'}) and distill actionable insights.

TOP PERFORMERS (highest engagement):
${JSON.stringify(top5.map(s => ({
  date: s.slot_date,
  format: s.format,
  idea: s.idea,
  product: s.selected_product,
  hook: s.brief?.hook,
  caption_preview: (s.brief?.caption || '').slice(0, 150),
  emotion: s.brief?.target_emotion,
  pillar: s.scout_pillar,
  metrics: s.performance_data,
})), null, 2)}

UNDERPERFORMERS (lowest engagement):
${JSON.stringify(bottom5.map(s => ({
  date: s.slot_date,
  format: s.format,
  idea: s.idea,
  product: s.selected_product,
  hook: s.brief?.hook,
  caption_preview: (s.brief?.caption || '').slice(0, 150),
  emotion: s.brief?.target_emotion,
  pillar: s.scout_pillar,
  metrics: s.performance_data,
})), null, 2)}

TOTAL POSTS ANALYZED: ${slotsWithMetrics.length}

DISTILL (be specific and data-driven):
1. What content themes/formats/hooks consistently perform well?
2. What should the brand do MORE of?
3. What should the brand STOP doing or change?
4. Best posting formats (post vs story vs reel) based on actual metrics?
5. Best performing content pillars?
6. Generate 5 new content ideas INSPIRED by the winners:
   - 4 winner remixes (new angles on winning themes)
   - 1 experimental idea (something not yet tried)

Return ONLY valid JSON:
{
  "signals": {
    "what_worked": ["..."],
    "do_more": ["..."],
    "stop_doing": ["..."],
    "best_formats": ["..."],
    "best_themes": ["..."],
    "best_pillars": ["..."]
  },
  "generated_briefs": [
    { "topic": "...", "hook": "...", "format": "post|story|reel", "platform": "...", "type": "winner_remix|experimental", "reasoning": "..." }
  ],
  "summary": "2-3 sentence executive summary of performance"
}`;

    try {
      console.log(`[Karma] Calling Gemini to distill insights from ${slotsWithMetrics.length} posts...`);
      const geminiResponse = await callGemini(prompt);
      insights = parseJSON(geminiResponse);

      if (insights?.signals) {
        insightsCount = Object.values(insights.signals).flat().length;
        console.log(`[Karma] Gemini distilled ${insightsCount} signals`);
      } else {
        console.warn(`[Karma] Gemini response did not contain valid signals JSON`);
        insights = { raw_response: geminiResponse.slice(0, 1000) };
      }
    } catch (err) {
      console.error(`[Karma] Gemini insights failed:`, err.message);
      insights = { error: err.message };
    }
  } else {
    console.log(`[Karma] Not enough posts with metrics (${slotsWithMetrics.length}/3 minimum) — skipping Gemini analysis`);
    insights = {
      signals: null,
      message: `Need at least 3 published posts with engagement data to generate insights. Currently have ${slotsWithMetrics.length}.`,
    };
  }

  // ── Step 6: Write performance signals to sync file ──────────────────────
  const signalsPayload = {
    _updatedAt: new Date().toISOString(),
    brand_id: brandId,
    user_id: userId,
    period_start: slotsWithMetrics.length > 0
      ? slotsWithMetrics.reduce((min, s) => s.slot_date < min ? s.slot_date : min, slotsWithMetrics[0].slot_date)
      : new Date().toISOString().split('T')[0],
    period_end: new Date().toISOString().split('T')[0],
    posts_analyzed: slotsWithMetrics.length,
    insights: insights?.signals || null,
    generated_briefs: insights?.generated_briefs || [],
    summary: insights?.summary || null,
    top_posts: slotsWithMetrics.slice(0, 5).map(s => ({
      slot_date: s.slot_date,
      format: s.format,
      idea: s.idea,
      metrics: s.performance_data,
    })),
  };

  // Read existing signals and append
  const existingSignals = readSync('performance_signals');
  const signalsHistory = Array.isArray(existingSignals?.data) ? existingSignals.data : [];
  signalsHistory.push(signalsPayload);

  // Keep last 10 signal runs
  const trimmed = signalsHistory.slice(-10);
  writeSync('performance_signals', { _updatedAt: new Date().toISOString(), data: trimmed });
  console.log(`[Karma] Wrote performance signals to sync file`);

  console.log(`[Karma] ═══ Done: ${metricsCount} metrics updated, ${insightsCount} insights ═══\n`);

  return {
    brand_id: brandId,
    brand_name: brand.name,
    posts_fetched: posts.length,
    posts_matched: matched.length,
    metrics_updated: metricsCount,
    insights_count: insightsCount,
    insights: insights?.signals || null,
    generated_briefs: insights?.generated_briefs || [],
    summary: insights?.summary || null,
    generated_at: new Date().toISOString(),
  };
}

export { executeKarma };
