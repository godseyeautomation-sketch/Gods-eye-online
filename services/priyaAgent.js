/**
 * Priya Agent — Creative Content Generator (Sequential Per-Platform)
 *
 * Reads Scout's strategy_data + campaign config, then:
 *   1) Runs ONE research call with web search (trends, formats, seasonal notes)
 *   2) Loops through config.campaign.platforms sequentially, generating ~N slots per platform
 *   3) Writes progress to priya_progress_${brandId}.json between platforms
 *
 * Each slot includes a full content brief (hook, caption, hashtags, CTA, image_prompt).
 */

import fs from 'fs';
import path from 'path';

// ── Lazy env access ──────────────────────────────────────────────────────────
function getGeminiKey() { return process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY; }

// Must match dev-server.js SYNC_DIR exactly
const SYNC_DIR = path.join(process.env.HOME || '', '.klint', 'sync');

function readSync(name) {
  try { return JSON.parse(fs.readFileSync(path.join(SYNC_DIR, `${name}.json`), 'utf-8')); }
  catch { return null; }
}

function writeSync(name, data) {
  if (!fs.existsSync(SYNC_DIR)) fs.mkdirSync(SYNC_DIR, { recursive: true });
  fs.writeFileSync(path.join(SYNC_DIR, `${name}.json`), JSON.stringify(data, null, 2), 'utf-8');
}

// ── Progress tracking (per-brand file) ───────────────────────────────────────
function writeProgress(brandId, progress) {
  writeSync(`priya_progress_${brandId}`, {
    _updatedAt: new Date().toISOString(),
    data: progress,
  });
}

// ── Gemini call with timeout and error handling ─────────────────────────────
async function callGemini(prompt, { model = 'gemini-2.5-flash', temperature = 0.8, maxTokens = 16384, useSearch = false, timeoutMs = 180000 } = {}) {
  const geminiKey = getGeminiKey();
  if (!geminiKey) throw new Error('Gemini API key not configured');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature, maxOutputTokens: maxTokens },
    };
    if (useSearch) {
      body.tools = [{ google_search: {} }];
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    );

    if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Gemini call timed out after ${Math.round(timeoutMs / 1000)}s`);
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

/**
 * Recover as many complete slot objects as possible from a truncated JSON response.
 * Works by finding every `{` inside "slots": [ ... ], and attempting to parse each one.
 */
function recoverPartialSlots(text) {
  // Strip markdown
  let cleaned = text.replace(/```(?:json)?/g, '').trim();
  // Find the slots array start
  const slotsStart = cleaned.search(/"slots"\s*:\s*\[/);
  if (slotsStart === -1) return [];
  const arrayStart = cleaned.indexOf('[', slotsStart);
  if (arrayStart === -1) return [];

  // Walk through the characters tracking braces to find complete objects
  const slots = [];
  let i = arrayStart + 1;
  let depth = 0;
  let objStart = -1;

  while (i < cleaned.length) {
    const c = cleaned[i];
    if (c === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && objStart !== -1) {
        // Found a complete object
        const objStr = cleaned.slice(objStart, i + 1);
        try {
          const parsed = JSON.parse(objStr);
          if (parsed && typeof parsed === 'object') slots.push(parsed);
        } catch { /* skip malformed */ }
        objStart = -1;
      }
    } else if (c === '"') {
      // Skip over string literals (handle escaped quotes)
      i++;
      while (i < cleaned.length && cleaned[i] !== '"') {
        if (cleaned[i] === '\\') i++;
        i++;
      }
    }
    i++;
  }

  return slots;
}

const arr = (v) => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []);

// ══════════════════════════════════════════════════════════════════════════════
// Step A: Research call (web search) — one call to inform all platforms
// ══════════════════════════════════════════════════════════════════════════════

async function runResearch(brand, strategyData, campaign) {
  const pillars = arr(strategyData?.content_pillars);

  const prompt = `You are Priya, a creative strategist. Based on this brand context and campaign requirements, research current trends and best practices that will inform platform-specific content.

Brand: ${brand.name} (${brand.industry || 'General'})
Scout's strategy: ${JSON.stringify(pillars)}
Target audience: ${campaign.target_audience || 'General'}
Campaign goals: ${campaign.campaign_goals || 'Brand awareness'}
Themes: ${(campaign.themes || []).join(', ')}
Posts per platform: ${campaign.duration_days || 30} (each platform gets its own ${campaign.duration_days || 30}-piece calendar, spread over ${campaign.duration_days || 30} days)
Target platforms: ${(campaign.platforms || ['instagram']).join(', ')}

Research INDEPENDENTLY for each platform (each platform behaves differently — a TikTok hook will not work on LinkedIn, an Instagram Reel format won't fit a YouTube long-form audience):
1. Current trending topics specific to THIS BRAND'S industry on each platform
2. Best-performing content formats and lengths PER platform in the last 30 days
3. Seasonal / cultural relevance for the content calendar
4. Competitor content approaches to avoid or adapt — call out platform-specific patterns

Return JSON (every listed platform MUST appear as a key in trending_topics and best_formats):
{
  "trending_topics": { "instagram": ["..."], "tiktok": ["..."], "linkedin": ["..."] },
  "best_formats": { "instagram": ["..."], "tiktok": ["..."], "linkedin": ["..."] },
  "seasonal_notes": "...",
  "avoid_patterns": ["..."]
}

Return ONLY valid JSON. No markdown fences. No commentary.`;

  console.log('[Priya] Research call (web search)...');
  try {
    const text = await callGemini(prompt, {
      useSearch: true,
      temperature: 0.6,
      maxTokens: 8192,
      timeoutMs: 60000,
    });
    const parsed = parseJSON(text);
    if (parsed) {
      console.log('[Priya] ✓ Research complete');
      return parsed;
    }
    console.warn('[Priya] Research parse failed — using empty research');
  } catch (err) {
    console.warn('[Priya] Research call failed:', err.message);
  }
  return {
    trending_topics: {},
    best_formats: {},
    seasonal_notes: '',
    avoid_patterns: [],
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Platform-specific prompt guidance
// ══════════════════════════════════════════════════════════════════════════════

function getPlatformGuidance(platform) {
  const p = platform.toLowerCase();
  const guidance = {
    instagram: {
      rules: [
        'Visual-first — image_prompt is critical',
        '8-10 hashtags per post',
        'Mix formats: post / story / reel',
        'Captions: 1-2 short paragraphs, emoji-friendly',
        'Hook: scroll-stopping first line',
      ],
      formats: ['post', 'story', 'reel'],
      captionLimit: '125 words',
    },
    tiktok: {
      rules: [
        'Pattern-interrupt hooks in first 1-2 seconds',
        'Reference current trending sounds where relevant',
        'Write 15-60s video scripts as the brief content',
        '3-5 hashtags including trending + niche',
        'Native, raw, authentic tone — no polish',
      ],
      formats: ['reel', 'short'],
      captionLimit: '100 chars',
    },
    linkedin: {
      rules: [
        'Professional thought leadership voice',
        'Longer captions: 150-300 words',
        'NO hashtags (or max 3 subtle ones)',
        'Open with a strong personal hook or insight',
        'End with a thought-provoking question for comments',
      ],
      formats: ['post', 'article'],
      captionLimit: '300 words',
    },
    x: {
      rules: [
        '280-char punchy posts',
        'Use thread format for longer ideas (break into connected tweets)',
        'Minimal hashtags (0-2)',
        'Punchy, opinionated, conversational',
      ],
      formats: ['post', 'thread'],
      captionLimit: '280 chars',
    },
    twitter: {
      rules: [
        '280-char punchy posts',
        'Use thread format for longer ideas',
        'Minimal hashtags (0-2)',
      ],
      formats: ['post', 'thread'],
      captionLimit: '280 chars',
    },
    facebook: {
      rules: [
        'Conversational warmth — like talking to a friend',
        'Longer captions welcome (100-200 words)',
        '3-5 hashtags',
        'Community-oriented: invite discussion',
      ],
      formats: ['post', 'reel'],
      captionLimit: '200 words',
    },
    youtube: {
      rules: [
        'Focus on video description + Shorts script',
        'Long-form: no image_prompt needed (use thumbnail description)',
        'SEO-optimized title and description',
        'Timestamps and chapters for long-form',
      ],
      formats: ['short', 'video'],
      captionLimit: '500 words',
    },
    pinterest: {
      rules: [
        'SEO-keyword-rich titles and descriptions',
        'Aspirational, idea-driven',
        'Vertical 2:3 image prompts',
        'Link back to product / blog idea',
      ],
      formats: ['pin'],
      captionLimit: '500 chars',
    },
    threads: {
      rules: [
        'Casual conversation starters',
        'Authentic, off-the-cuff voice',
        'Short, punchy — max 500 chars',
        'No hashtags',
      ],
      formats: ['post'],
      captionLimit: '500 chars',
    },
  };
  return guidance[p] || guidance.instagram;
}

// ══════════════════════════════════════════════════════════════════════════════
// Step B: Generate calendar for ONE platform
// ══════════════════════════════════════════════════════════════════════════════

async function generatePlatformCalendar(brand, strategyData, enrichmentData, campaign, platform, count, rejectionFeedback = null) {
  const pillars = arr(strategyData?.content_pillars);
  const pillarNames = pillars.map(p => p.name).filter(Boolean);
  const hookBank = strategyData?.hook_bank || {};
  const allHooks = Object.values(hookBank).flat().filter(h => typeof h === 'string');
  const positioning = strategyData?.positioning_statement || '';

  const hasProducts = (brand.products || []).length > 0;
  const productList = (brand.products || []).map(p => p.name).join(', ');

  const guidance = getPlatformGuidance(platform);

  // Distribute dates evenly across the campaign window
  const duration = campaign.duration_days || 30;
  const startDate = new Date();
  startDate.setHours(0, 0, 0, 0);

  const stride = Math.max(1, Math.floor(duration / count));
  const dateSuggestions = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + Math.min(duration - 1, i * stride));
    dateSuggestions.push(d.toISOString().slice(0, 10));
  }

  // Enrichment specifics for THIS platform
  const trending = enrichmentData?.trending_topics?.[platform] || enrichmentData?.trending_topics?.[platform.toLowerCase()] || [];
  const bestFormats = enrichmentData?.best_formats?.[platform] || enrichmentData?.best_formats?.[platform.toLowerCase()] || [];
  const seasonalNotes = enrichmentData?.seasonal_notes || '';
  const avoidPatterns = enrichmentData?.avoid_patterns || [];

  const prompt = `You are Priya, a creative content generator for ${brand.name}. Generate a content calendar SPECIFICALLY for ${platform.toUpperCase()}.

═══ BRAND ═══
Name: ${brand.name}
Industry: ${brand.industry || 'General'}
Audience: ${brand.audience || 'General'}
Tone: ${(brand.tone || []).join(', ')}
Visual Style: ${brand.visual_style || ''}
Products: ${productList || 'No specific products — focus on brand values & lifestyle'}
Avoid: ${(brand.avoid || []).join(', ')}
Positioning: ${positioning}

═══ CAMPAIGN ═══
Duration: ${duration} days
Target audience: ${campaign.target_audience || 'General'}
Goals: ${campaign.campaign_goals || 'Brand awareness'}
Themes: ${(campaign.themes || []).join(', ')}

═══ SCOUT'S CONTENT STRATEGY ═══
Content Pillars: ${pillarNames.join(', ')}
${pillars.map(p => `  - ${p.name} (${p.percentage || 20}%): ${p.purpose || ''}`).join('\n')}

Top Hooks (inspiration, vary style):
${allHooks.slice(0, 8).map((h, i) => `  ${i + 1}. "${h}"`).join('\n')}

═══ RESEARCH — ${platform.toUpperCase()} ═══
Trending topics: ${trending.length ? trending.join(' | ') : '(none gathered)'}
Best-performing formats: ${bestFormats.length ? bestFormats.join(' | ') : '(none gathered)'}
Seasonal notes: ${seasonalNotes || '(none)'}
Avoid patterns: ${avoidPatterns.length ? avoidPatterns.join(' | ') : '(none)'}

═══ PLATFORM: ${platform.toUpperCase()} ═══
Allowed formats: ${guidance.formats.join(', ')}
Caption limit: ${guidance.captionLimit}
Rules:
${guidance.rules.map(r => `- ${r}`).join('\n')}

${rejectionFeedback ? `═══ REJECTION FEEDBACK (from previous iteration) ═══
The previous ${platform} content was REJECTED with the following feedback. You MUST address these concerns in this regeneration:
"${rejectionFeedback}"

Make the new content meaningfully different — different hook angles, sharper voice, fresh ideas. Do not repeat the patterns that failed.

` : ''}═══ TASK ═══
Generate EXACTLY ${count} content slots for ${platform}.

Date distribution — use these dates (one per slot, in order):
${dateSuggestions.map((d, i) => `  ${i + 1}. ${d}`).join('\n')}

RULES:
1. Every slot has "platform": "${platform}"
2. Format must be one of: ${guidance.formats.join(', ')}
3. Reference a Scout content pillar in "pillar"
4. Vary hooks — don't repeat patterns
5. Spread pillars proportionally
6. ${hasProducts ? `Feature products: ${productList}. Image prompt = background/setting ONLY (no product objects).` : 'No products — brand values & lifestyle only. NO product objects in image prompts.'}
7. Honor platform-specific rules above (caption length, hashtag count, voice)

KEEP BRIEFS CONCISE:
- hook: 1 line, max 15 words
- caption: follow platform caption limit (${guidance.captionLimit})
- hashtags: per platform rules (array of strings, or [] if none)
- image_prompt: 1 sentence, max 25 words (or "" for long-form YouTube)
- visual_direction: 1 sentence, max 15 words
- call_to_action: 1 short line
- target_emotion: 1-2 words

Return ONLY valid JSON (no markdown fences), exact schema:
{"slots":[{"date":"${dateSuggestions[0]}","platform":"${platform}","format":"${guidance.formats[0]}","pillar":"NAME","idea":"1 line","brief":{"hook":"...","caption":"...","hashtags":["t1"],"image_prompt":"...","visual_direction":"...","call_to_action":"...","target_emotion":"..."}}]}

Generate exactly ${count} slots. NO commentary. JSON only.`;

  console.log(`[Priya] Generating ${count} slots for ${platform}...`);
  const tokenBudget = 12288;
  const text = await callGemini(prompt, { temperature: 0.85, maxTokens: tokenBudget });
  console.log(`[Priya] ${platform} response length: ${text.length} chars`);

  let slots = [];

  // Try full parse first
  const parsed = parseJSON(text);
  if (parsed?.slots && Array.isArray(parsed.slots)) {
    slots = parsed.slots;
    console.log(`[Priya] ✓ ${platform} full parse: ${slots.length} slots`);
  } else {
    console.warn(`[Priya] ${platform} full parse failed, attempting partial recovery...`);
    slots = recoverPartialSlots(text);
    console.log(`[Priya] ✓ ${platform} partial recovery: ${slots.length} slots`);

    if (slots.length === 0) {
      console.error(`[Priya] ${platform} first 500 chars:`, text.slice(0, 500));
      console.error(`[Priya] ${platform} last 500 chars:`, text.slice(-500));
      throw new Error(`Priya failed to generate valid JSON for ${platform} (no slots recoverable)`);
    }
  }

  // Filter to valid slots and force platform field
  slots = slots
    .filter(s => s && s.date && s.format && s.brief)
    .map(s => ({ ...s, platform: platform.toLowerCase() }));

  console.log(`[Priya] ✓ ${platform} final valid slots: ${slots.length}/${count}`);
  return slots;
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN: Execute Priya Agent
// ══════════════════════════════════════════════════════════════════════════════

async function executePriya(userId, brandId, config = {}) {
  console.log(`\n[Priya] ═══ Starting Priya for brand ${brandId} ═══`);

  // Load brand from local sync file
  const brandsFile = readSync('brand_profiles');
  const allBrands = brandsFile?.data || brandsFile || [];
  const brand = allBrands.find(b => b.id === brandId);
  if (!brand) throw new Error(`Brand not found: ${brandId}`);

  // Read Scout's latest report
  let strategyData = brand.scout_report?.strategy_data;
  if (!strategyData) {
    const briefsFile = readSync('content_briefs');
    const allBriefs = briefsFile?.data || briefsFile || [];
    const scoutBriefs = allBriefs
      .filter(b => b.brand_id === brandId && b.created_by === 'scout_agent')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    if (scoutBriefs.length) {
      try {
        const parsed = JSON.parse(scoutBriefs[0].trend_summary || '{}');
        strategyData = parsed.strategy_data;
      } catch {}
    }
  }

  if (!strategyData) {
    throw new Error('No Scout research found. Run the Scout agent first.');
  }

  // ── Normalize campaign config ────────────────────────────────────────────
  const campaign = config.campaign || {
    duration_days: config.duration_days || 30,
    target_audience: config.target_audience || brand.audience || 'General',
    campaign_goals: config.campaign_goals || 'Brand awareness',
    themes: config.themes || [],
    platforms: config.platforms || ['instagram'],
  };
  const platforms = (campaign.platforms && campaign.platforms.length) ? campaign.platforms : ['instagram'];
  const duration = campaign.duration_days || 30;
  // The user picked 15/30/45 in the questionnaire — they want that many
  // pieces of content PER platform. So 3 platforms × 30 = 90 total slots,
  // each platform researched + generated independently (own hooks, own
  // trending topics, own platform-specific guidance — all already wired in
  // generatePlatformCalendar via getPlatformGuidance + per-platform
  // enrichmentData.trending_topics[platform]).
  const slotsPerPlatform = duration;
  const totalSlots = slotsPerPlatform * platforms.length;
  const rejectionFeedback = campaign.rejection_feedback || null;
  const isRegen = !!rejectionFeedback;

  console.log(`[Priya] ${slotsPerPlatform} posts × ${platforms.length} platform(s) [${platforms.join(', ')}] = ${totalSlots} total slots over ${duration} days${isRegen ? ` | REGEN with feedback: "${rejectionFeedback.slice(0, 80)}..."` : ''}`);

  // Initial progress write
  writeProgress(brandId, {
    brand_id: brandId,
    total_platforms: platforms.length,
    current_platform: 0,
    current_platform_name: null,
    status: 'researching',
    slots_created: Object.fromEntries(platforms.map(p => [p, 0])),
    started_at: new Date().toISOString(),
  });

  // ── Step A: Research call ───────────────────────────────────────────────
  const enrichmentData = await runResearch(brand, strategyData, campaign);

  // ── Step B: Generate sequentially per platform ──────────────────────────
  const newSlots = [];

  for (let i = 0; i < platforms.length; i++) {
    const platform = platforms[i];

    writeProgress(brandId, {
      brand_id: brandId,
      total_platforms: platforms.length,
      current_platform: i + 1,
      current_platform_name: platform,
      status: 'running',
      slots_created: Object.fromEntries(
        platforms.map(p => [p, newSlots.filter(s => s.platform === p).length])
      ),
    });

    try {
      const platformSlots = await generatePlatformCalendar(
        brand,
        strategyData,
        enrichmentData,
        campaign,
        platform,
        slotsPerPlatform,
        rejectionFeedback
      );
      newSlots.push(...platformSlots);
    } catch (err) {
      console.error(`[Priya] Failed to generate ${platform}:`, err.message);
      // Continue with other platforms — partial success is better than total failure
      writeProgress(brandId, {
        brand_id: brandId,
        total_platforms: platforms.length,
        current_platform: i + 1,
        current_platform_name: platform,
        status: 'running',
        last_error: `${platform}: ${err.message}`,
        slots_created: Object.fromEntries(
          platforms.map(p => [p, newSlots.filter(s => s.platform === p).length])
        ),
      });
    }
  }

  // ── Convert to ContentSlot format ───────────────────────────────────────
  const finalSlots = [];
  const now = new Date().toISOString();

  // ── Round-robin product assignment ────────────────────────────────────
  // Each slot gets ONE product from brand.products, cycled round-robin so
  // every product gets featured across the campaign (mix-and-match).
  // If the LLM's brief picked a specific product (g.selected_product or
  // g.brief.product), prefer that; otherwise fall through to round-robin.
  const brandProducts = Array.isArray(brand.products) ? brand.products : [];
  const productNames = brandProducts.map(p => String(p?.name || '').trim()).filter(Boolean);
  // Per-platform round-robin counter: keeps within-platform mix balanced
  // even when slot iteration order interleaves platforms.
  const rrCounter = {};
  function pickProductForSlotRR(g, platform) {
    if (!productNames.length) return null;
    // Honour an explicit pick from the LLM if the name actually matches
    const explicit = String(g.selected_product || g.brief?.product || '').trim().toLowerCase();
    if (explicit) {
      const match = productNames.find(p => p.toLowerCase() === explicit)
        || productNames.find(p => p.toLowerCase().includes(explicit) || explicit.includes(p.toLowerCase()));
      if (match) return match;
    }
    // Round-robin per platform
    const key = platform || 'default';
    const idx = rrCounter[key] || 0;
    rrCounter[key] = idx + 1;
    return productNames[idx % productNames.length];
  }

  for (const g of newSlots) {
    try {
      if (!g.date || !g.format) {
        console.warn('[Priya] Skipping invalid slot:', g);
        continue;
      }

      // Normalize format
      let format = String(g.format || 'post').toLowerCase();
      if (format.includes('reel') || format.includes('video')) format = 'reel';
      else if (format.includes('story')) format = 'story';
      else if (format.includes('short')) format = 'short';
      else if (format.includes('thread')) format = 'thread';
      else if (format.includes('pin')) format = 'pin';
      else if (format.includes('article')) format = 'article';
      else format = 'post';

      const platform = String(g.platform || 'instagram').toLowerCase();
      const selectedProduct = pickProductForSlotRR(g, platform);

      const slotId = `${brandId}_${g.date}_${format}_${platform}`;
      const slot = {
        id: slotId,
        brand_id: brandId,
        user_id: userId,
        slot_date: g.date,
        format,
        platform,
        status: 'briefed',
        idea: g.idea || g.brief?.hook || '',
        brief: g.brief || null,
        generated_image: null,
        approved: false,
        created_at: now,
        updated_at: now,
        created_by: 'priya_agent',
        scout_pillar: g.pillar || null,
        selected_product: selectedProduct,  // round-robin across brand.products
      };

      finalSlots.push(slot);
    } catch (err) {
      console.warn('[Priya] Slot conversion failed:', err.message);
    }
  }

  if (productNames.length) {
    const distribution = {};
    for (const s of finalSlots) {
      const p = s.selected_product || '(none)';
      distribution[p] = (distribution[p] || 0) + 1;
    }
    console.log(`[Priya] Product distribution across ${finalSlots.length} slots:`, distribution);
  }

  // ── Persist to local sync file (merge with existing — upsert by id) ─────
  const existing = readSync('content_slots');
  const existingData = Array.isArray(existing?.data) ? existing.data : [];
  const newSlotIds = new Set(finalSlots.map(s => s.id));
  const regenPlatforms = new Set(platforms.map(p => String(p).toLowerCase()));

  // If this is a regeneration (rejection_feedback present), FIRST wipe all
  // existing unapproved/unpublished slots for the target platform(s) so the
  // new content fully replaces the rejected batch. Approved/published slots
  // are preserved as-is.
  const filtered = existingData.filter(s => {
    // Always drop if the new batch upserts this id
    if (newSlotIds.has(s.id)) return false;
    if (!isRegen) return true;
    // Regen mode: drop same-platform, same-brand, non-approved slots
    if (s.brand_id !== brandId) return true;
    const slotPlatform = (s.platform || 'instagram').toLowerCase();
    if (!regenPlatforms.has(slotPlatform)) return true;
    if (s.status === 'approved' || s.status === 'published' || s.approved === true) return true;
    return false; // drop
  });
  if (isRegen) {
    const dropped = existingData.length - filtered.length - finalSlots.length;
    console.log(`[Priya] Regen mode: dropped ${Math.max(0, dropped)} old unapproved slots for platforms [${platforms.join(', ')}]`);
  }
  const merged = [...filtered, ...finalSlots];

  writeSync('content_slots', {
    _updatedAt: new Date().toISOString(),
    data: merged,
  });

  // ── Final progress write: complete ──────────────────────────────────────
  const slotsByPlatform = Object.fromEntries(
    platforms.map(p => [p, finalSlots.filter(s => s.platform === p).length])
  );

  writeProgress(brandId, {
    brand_id: brandId,
    total_platforms: platforms.length,
    current_platform: platforms.length,
    current_platform_name: platforms[platforms.length - 1] || null,
    status: 'complete',
    slots_created: slotsByPlatform,
    total_slots: finalSlots.length,
    completed_at: new Date().toISOString(),
  });

  console.log(`[Priya] ═══ Complete: ${finalSlots.length} slots across ${platforms.length} platforms ═══\n`);

  return {
    brand_id: brandId,
    brand_name: brand.name,
    slots_created: finalSlots.length,
    slots_by_platform: slotsByPlatform,
    campaign,
    generated_at: new Date().toISOString(),
    slots: finalSlots, // Frontend writes these to IndexedDB
  };
}

export { executePriya };
