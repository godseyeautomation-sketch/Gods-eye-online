/**
 * Priya Agent — Creative Content Generator
 *
 * Reads Scout's strategy_data and generates a FULL MONTH calendar in ONE Gemini call.
 * Distributes 15/30/45 posts across the month with proper format mix (post/story/reel).
 * Each slot includes a full content brief (hook, caption, hashtags, CTA, image_prompt).
 *
 * Flow:
 *   Scout's strategy (pillars, hooks, calendar template)
 *          ↓
 *   ONE Gemini call: "Generate N slots distributed across the month"
 *          ↓
 *   Parse JSON → ContentSlot[] with briefs
 *          ↓
 *   Write to content_slots.json sync file (for server)
 *   + return slots array (for frontend to write to IndexedDB)
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

// ── Gemini call with timeout and error handling ─────────────────────────────
async function callGemini(prompt, { model = 'gemini-2.5-flash', temperature = 0.8, maxTokens = 16384 } = {}) {
  const geminiKey = getGeminiKey();
  if (!geminiKey) throw new Error('Gemini API key not configured');

  // 3-minute timeout for long generations
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000);

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
    if (err.name === 'AbortError') throw new Error('Gemini call timed out after 3 minutes');
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
// Build the monthly calendar in ONE Gemini call
// ══════════════════════════════════════════════════════════════════════════════

async function generateMonthlyCalendar(brand, strategyData, postCount, year, month, platforms = ['instagram']) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const startDay = Math.max(1, new Date().getDate()); // Start from today if current month

  // Format distribution based on postCount (matching the old generateMonthPlan)
  let distribution;
  if (postCount <= 15) {
    distribution = { post: 6, story: 6, reel: 3 };
  } else if (postCount <= 30) {
    distribution = { post: 12, story: 11, reel: 7 };
  } else {
    distribution = { post: 15, story: 15, reel: 15 };
  }

  const pillars = arr(strategyData?.content_pillars);
  const pillarNames = pillars.map(p => p.name).filter(Boolean);
  const hookBank = strategyData?.hook_bank || {};
  const allHooks = Object.values(hookBank).flat().filter(h => typeof h === 'string');
  const weeklyTemplate = arr(strategyData?.weekly_calendar);
  const positioning = strategyData?.positioning_statement || '';

  const hasProducts = (brand.products || []).length > 0;
  const productList = (brand.products || []).map(p => p.name).join(', ');

  const monthName = new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Build platform-specific instructions
  const isMultiPlatform = platforms.length > 1;
  const platformInstructions = isMultiPlatform ? `
═══ MULTI-PLATFORM CONTENT ═══
Generate content for these platforms: ${platforms.join(', ')}
Instagram and Facebook share the same posts — reuse the same brief for both.
For each slot, include a "platform" field indicating which platform it targets.
Adapt tone and format per platform:
- Instagram: posts, stories, reels with hashtags and visual hooks
- TikTok: punchy hooks, trending sounds references, pattern-interrupt, short-form video scripts
- Facebook: longer conversational posts, group engagement, community questions
- LinkedIn: professional, thought leadership, longer form with industry insights
- X: short & punchy (280 char limit), thread format for longer content
- Pinterest: SEO keywords, aspirational descriptions, pin titles
- YouTube: video descriptions with timestamps, shorts scripts
- Threads: casual conversation starters, authentic voice

Distribute the ${postCount} slots across platforms based on reach potential:
${platforms.map(p => {
    const weights = { instagram: 30, tiktok: 25, facebook: 15, youtube: 15, linkedin: 10, x: 10, pinterest: 10, threads: 5 };
    return `- ${p}: ~${weights[p.toLowerCase()] || 10}% of posts`;
  }).join('\n')}
` : `Each slot targets platform: "instagram".`;

  const prompt = `You are Priya, a creative content generator for ${brand.name}. Generate a full monthly content calendar.

═══ BRAND ═══
Name: ${brand.name}
Industry: ${brand.industry || 'General'}
Audience: ${brand.audience || 'General'}
Tone: ${(brand.tone || []).join(', ')}
Visual Style: ${brand.visual_style || ''}
Products: ${productList || 'No specific products — focus on brand values & lifestyle'}
Avoid: ${(brand.avoid || []).join(', ')}
Positioning: ${positioning}

═══ SCOUT'S CONTENT STRATEGY ═══
Content Pillars: ${pillarNames.join(', ')}
${pillars.map(p => `  - ${p.name} (${p.percentage || 20}%): ${p.purpose || ''}`).join('\n')}

Weekly Template (from Scout's research):
${weeklyTemplate.map(w => `  ${w.day || ''}: ${w.format || 'post'} — ${w.pillar || ''} — ${w.content_idea || ''}`).join('\n')}

Top Hooks (inspiration, vary style):
${allHooks.slice(0, 10).map((h, i) => `  ${i + 1}. "${h}"`).join('\n')}

${platformInstructions}

═══ TASK ═══
Generate EXACTLY ${postCount} content slots for ${monthName}.

RULES:
1. Distribute ACROSS the month: day 1 to day ${daysInMonth} (start from day ${startDay})
2. Format distribution: ${distribution.post} posts, ${distribution.story} stories, ${distribution.reel} reels
3. Each slot references one of the content pillars from Scout's strategy
4. Each slot has a concise content brief (brief and tight — save tokens)
5. ${hasProducts ? `Product rule: Feature ${productList}. Image prompt = background/setting ONLY.` : 'No products — brand values & lifestyle only. NO product objects in image prompts.'}
6. Vary hooks — don't repeat
7. Spread pillars proportionally
8. Each slot MUST include a "platform" field (one of: ${platforms.join(', ')})

KEEP BRIEFS CONCISE (important for response size):
- hook: 1 line, max 15 words
- caption: 1 paragraph only, max 60 words
- hashtags: 8-10 tags max (or keywords for Pinterest/YouTube)
- image_prompt: 1 sentence, max 25 words
- visual_direction: 1 sentence, max 15 words
- call_to_action: 1 short line
- target_emotion: 1-2 words

Return ONLY valid JSON (no markdown fences), exact schema:
{"slots":[{"date":"${year}-${String(month).padStart(2, '0')}-01","format":"post","platform":"instagram","pillar":"NAME","idea":"1 line","brief":{"hook":"...","caption":"...","hashtags":["t1","t2"],"image_prompt":"...","visual_direction":"...","call_to_action":"...","target_emotion":"..."}}]}

Generate exactly ${postCount} slots. NO commentary. JSON only.`;

  console.log(`[Priya] Calling Gemini to generate ${postCount} slots for ${monthName}...`);
  // Use aggressive token budget — Gemini 2.5 Flash supports up to 65K output tokens
  // ~1200 tokens per slot to have safety margin
  const tokenBudget = Math.min(65536, Math.max(12288, postCount * 1200));
  console.log(`[Priya] Token budget: ${tokenBudget}`);

  const text = await callGemini(prompt, { temperature: 0.85, maxTokens: tokenBudget });
  console.log(`[Priya] Gemini response length: ${text.length} chars`);

  let slots = [];

  // Try full parse first
  const parsed = parseJSON(text);
  if (parsed?.slots && Array.isArray(parsed.slots)) {
    slots = parsed.slots;
    console.log(`[Priya] ✓ Full parse succeeded: ${slots.length} slots`);
  } else {
    // Full parse failed — try partial recovery
    console.warn('[Priya] Full parse failed, attempting partial recovery...');
    slots = recoverPartialSlots(text);
    console.log(`[Priya] ✓ Partial recovery: ${slots.length} slots extracted`);

    if (slots.length === 0) {
      console.error('[Priya] First 500 chars:', text.slice(0, 500));
      console.error('[Priya] Last 500 chars:', text.slice(-500));
      throw new Error('Priya failed to generate valid JSON calendar (no slots recoverable)');
    }
  }

  // Filter to only valid slots (must have date + format + brief)
  slots = slots.filter(s => s && s.date && s.format && s.brief);
  console.log(`[Priya] ✓ Final valid slots: ${slots.length}/${postCount}`);

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

  // Determine target month (current month from config or default to current)
  const today = new Date();
  const targetYear = config.year || today.getFullYear();
  const targetMonth = config.month || (today.getMonth() + 1); // 1-indexed
  const postCount = config.post_count || 15;
  const platforms = config.platforms || ['instagram'];

  console.log(`[Priya] Target: ${postCount} slots for ${targetYear}-${String(targetMonth).padStart(2, '0')}`);
  console.log(`[Priya] Platforms: ${platforms.join(', ')}`);

  // ── Generate the full calendar in ONE Gemini call ──────────────────────
  const generatedSlots = await generateMonthlyCalendar(brand, strategyData, postCount, targetYear, targetMonth, platforms);

  // ── Convert to ContentSlot format ───────────────────────────────────────
  const newSlots = [];
  const now = new Date().toISOString();

  for (const g of generatedSlots) {
    try {
      // Validate required fields
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

      // Normalize platform — default to instagram if missing
      const platform = String(g.platform || 'instagram').toLowerCase();

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
      };

      newSlots.push(slot);
    } catch (err) {
      console.warn('[Priya] Slot conversion failed:', err.message);
    }
  }

  // ── Persist to local sync file (merge with existing) ────────────────────
  const existing = readSync('content_slots');
  const existingData = Array.isArray(existing?.data) ? existing.data : [];
  const newSlotIds = new Set(newSlots.map(s => s.id));
  const filtered = existingData.filter(s => !newSlotIds.has(s.id));
  const merged = [...filtered, ...newSlots];

  writeSync('content_slots', {
    _updatedAt: new Date().toISOString(),
    data: merged,
  });

  console.log(`[Priya] ═══ Complete: ${newSlots.length}/${postCount} slots created for ${targetYear}-${targetMonth} ═══\n`);

  return {
    brand_id: brandId,
    brand_name: brand.name,
    slots_created: newSlots.length,
    slots_total: postCount,
    year: targetYear,
    month: targetMonth,
    platforms,
    strategy_pillars: arr(strategyData.content_pillars).length,
    generated_at: new Date().toISOString(),
    slots: newSlots, // Frontend writes these to IndexedDB
  };
}

export { executePriya };
