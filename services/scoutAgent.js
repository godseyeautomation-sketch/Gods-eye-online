/**
 * Scout Agent — Research & Strategy Document Generator
 *
 * Multi-step Gemini pipeline that:
 * 1. Scans brand website + Instagram for DNA
 * 2. Scans competitor websites + Instagrams
 * 3. Generates comprehensive competitor intelligence + strategy
 * 4. Compiles everything into a downloadable .docx document
 *
 * Uses Supabase REST API (same approach as dev-server.js) to bypass RLS.
 */

import { scrapeInstagramProfiles, extractProfileStats } from './apifyService.js';
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  PageBreak, Header, Footer, PageNumber,
} from 'docx';
import fs from 'fs';
import path from 'path';

// ── Lazy env access ──────────────────────────────────────────────────────────
function getGeminiKey() { return process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY; }
function getSupabaseUrl() { return process.env.VITE_SUPABASE_URL; }
function getSupabaseKey() { return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY; }

// ── Supabase REST helper (same pattern as dev-server.js, bypasses RLS) ───────
async function supabaseRest(tablePath, method = 'GET', body = null) {
  const url = getSupabaseUrl();
  const key = getSupabaseKey();
  if (!url || !key) throw new Error('Supabase not configured — check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');

  const fullUrl = `${url}/rest/v1/${tablePath}`;
  const opts = {
    method,
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(fullUrl, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${method} ${tablePath}: ${res.status} ${text}`);
  }
  if (method === 'GET' || method === 'POST') {
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  return null;
}

// ── Gemini call ──────────────────────────────────────────────────────────────
async function callGemini(prompt, { useSearch = false, model = 'gemini-2.5-flash', temperature = 0.7, maxTokens = 16384 } = {}) {
  const geminiKey = getGeminiKey();
  if (!geminiKey) throw new Error('Gemini API key not configured');

  const requestBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature, maxOutputTokens: maxTokens },
  };
  if (useSearch) requestBody.tools = [{ google_search: {} }];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) }
  );

  if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';
  const sources = data.candidates?.[0]?.groundingMetadata?.groundingChunks
    ?.filter(c => c.web)?.map(c => ({ title: c.web.title, url: c.web.uri })) || [];
  return { text, sources };
}

/** Safe JSON parse from Gemini output */
function parseJSON(text) {
  try { return JSON.parse(text); } catch {}
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) { try { return JSON.parse(match[1].trim()); } catch {} }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) { try { return JSON.parse(text.slice(start, end + 1)); } catch {} }
  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// STEP 1: Brand + Competitor Intelligence Scan
// ══════════════════════════════════════════════════════════════════════════════

async function scanBrandAndCompetitors(brand, competitors) {
  console.log(`[Scout] Step 1: Scanning brand (${brand.website_url || 'no website'}, ${brand.instagram_handle || 'no IG'}) + ${competitors.length} competitors...`);

  // ── REAL DATA: Scrape Instagram via Apify ──────────────────────────────
  let apifyData = {};
  const allUsernames = [];
  if (brand.instagram_handle) allUsernames.push(brand.instagram_handle.replace('@', ''));
  for (const c of competitors) {
    const ig = (c.instagram || c.handle || '').replace('@', '');
    if (ig) allUsernames.push(ig);
  }

  if (allUsernames.length && process.env.APIFY_TOKEN) {
    try {
      console.log(`[Scout] Scraping ${allUsernames.length} Instagram profiles via Apify: ${allUsernames.join(', ')}`);
      const rawProfiles = await scrapeInstagramProfiles(allUsernames, 12);
      for (const raw of rawProfiles) {
        apifyData[raw.username?.toLowerCase()] = extractProfileStats(raw);
      }
      console.log(`[Scout] Apify returned ${Object.keys(apifyData).length} profiles with real data`);
    } catch (err) {
      console.warn(`[Scout] Apify scrape failed (falling back to Gemini): ${err.message}`);
    }
  } else {
    console.log(`[Scout] No Apify token or no IG handles — using Gemini web search only`);
  }

  // Build real data context for the Gemini prompt
  const brandIG = brand.instagram_handle ? apifyData[brand.instagram_handle.replace('@', '').toLowerCase()] : null;
  const competitorIGs = competitors.map(c => {
    const ig = (c.instagram || c.handle || '').replace('@', '').toLowerCase();
    return { ...c, scraped: apifyData[ig] || null };
  });

  const realDataSection = brandIG ? `
═══ REAL SCRAPED DATA (from Instagram API — these numbers are ACCURATE, do NOT change them) ═══

OUR BRAND @${brand.instagram_handle}:
- Followers: ${brandIG.followers.toLocaleString()}
- Following: ${brandIG.following.toLocaleString()}
- Posts: ${brandIG.posts_count.toLocaleString()}
- Engagement Rate: ${brandIG.engagement_rate}
- Avg Likes: ${brandIG.avg_likes.toLocaleString()}
- Avg Comments: ${brandIG.avg_comments.toLocaleString()}
- Bio: "${brandIG.bio}"
- Verified: ${brandIG.verified}
- Business Category: ${brandIG.business_category || 'N/A'}
- Top Posts:
${brandIG.top_posts.map(p => `  ${p.type}: ${p.likes.toLocaleString()} likes, ${p.comments.toLocaleString()} comments${p.video_views ? ', ' + p.video_views.toLocaleString() + ' views' : ''} — "${p.caption.slice(0, 80)}"`).join('\n')}
` : '';

  const competitorDataSection = competitorIGs.filter(c => c.scraped).map(c => `
COMPETITOR @${c.scraped.username}:
- Followers: ${c.scraped.followers.toLocaleString()}
- Following: ${c.scraped.following.toLocaleString()}
- Posts: ${c.scraped.posts_count.toLocaleString()}
- Engagement Rate: ${c.scraped.engagement_rate}
- Avg Likes: ${c.scraped.avg_likes.toLocaleString()}
- Avg Comments: ${c.scraped.avg_comments.toLocaleString()}
- Bio: "${c.scraped.bio}"
- Verified: ${c.scraped.verified}
- Content Mix: ${c.scraped.content_types.videos} videos, ${c.scraped.content_types.images} images, ${c.scraped.content_types.carousels} carousels
- Top Posts:
${c.scraped.top_posts.map(p => `  ${p.type}: ${p.likes.toLocaleString()} likes, ${p.comments.toLocaleString()} comments${p.video_views ? ', ' + p.video_views.toLocaleString() + ' views' : ''} — "${p.caption.slice(0, 80)}"`).join('\n')}
`).join('\n');

  const prompt = `You are an elite social media intelligence analyst. Analyze this brand AND its competitors.

═══ OUR BRAND ═══
Name: ${brand.name}
Website: ${brand.website_url || 'Not provided'}
Instagram: ${brand.instagram_handle ? '@' + brand.instagram_handle : 'Not provided'}
Industry: ${brand.industry || 'General'}
Audience: ${brand.audience || 'General'}
Products: ${(brand.products || []).map(p => p.name).join(', ') || 'Not specified'}
${realDataSection}
${competitorDataSection}

IMPORTANT: The numbers above are REAL scraped data. Use them EXACTLY as provided. Do NOT make up different numbers.

Use web search ONLY for: website content analysis, positioning insights, content strategy analysis, and visual aesthetic description. NOT for follower counts or engagement rates (those are already provided above).

Return detailed JSON:
{
  "brand_analysis": {
    "instagram_stats": { "followers": "${brandIG?.followers || '?'}", "posts": "${brandIG?.posts_count || '?'}", "engagement_rate": "${brandIG?.engagement_rate || '?'}", "avg_likes": "${brandIG?.avg_likes || '?'}", "avg_comments": "${brandIG?.avg_comments || '?'}", "verified": ${brandIG?.verified || false}, "bio": "${brandIG?.bio || ''}" },
    "website_insights": "analyze their website positioning, products, messaging",
    "current_content_strategy": "based on the real post data above, describe their strategy",
    "visual_aesthetic": "describe their visual identity",
    "strengths": ["based on real data..."],
    "weaknesses": ["based on real data..."]
  },
  "competitors": [${competitorIGs.map(c => `
    {
      "handle": "@${c.scraped?.username || c.instagram || c.handle}",
      "stats": { "followers": "${c.scraped?.followers || '?'}", "posts": "${c.scraped?.posts_count || '?'}", "engagement_rate": "${c.scraped?.engagement_rate || '?'}", "avg_likes": "${c.scraped?.avg_likes || '?'}", "avg_comments": "${c.scraped?.avg_comments || '?'}" },
      "bio": "${c.scraped?.bio || ''}",
      "positioning_summary": "analyze based on bio and content...",
      "target_audience": "...",
      "content_pillars": [{ "name": "...", "type": "...", "purpose": "..." }],
      "top_content": [${(c.scraped?.top_posts || []).slice(0, 5).map(p => `{ "description": "${p.caption.slice(0, 60).replace(/"/g, "'")}", "likes": "${p.likes}", "comments": "${p.comments}", "type": "${p.type}", "what_worked": "..." }`).join(',')}],
      "caption_strategy": { "hook_style": "...", "cta_pattern": "...", "hashtag_strategy": "..." },
      "visual_aesthetic": "...",
      "posting_frequency": "..."
    }`).join(',')}
  ],
  "scrape_date": "${new Date().toLocaleDateString()}",
  "data_source": "apify_instagram_scraper"
}`;

  const { text, sources } = await callGemini(prompt, { useSearch: true, maxTokens: 16384 });
  const result = parseJSON(text);
  console.log(`[Scout] Step 1 complete: brand analyzed + ${result?.competitors?.length || 0} competitors`);
  return { data: result, rawText: text, sources };
}

// ══════════════════════════════════════════════════════════════════════════════
// STEP 2: Weakness Analysis & Opportunities
// ══════════════════════════════════════════════════════════════════════════════

async function analyzeWeaknesses(brand, scanData) {
  console.log(`[Scout] Step 2: Analyzing weaknesses & opportunities...`);

  const prompt = `You are a brand strategist. Based on this intelligence, identify weaknesses and opportunities.

OUR BRAND: ${brand.name}
INDUSTRY: ${brand.industry || 'General'}
AUDIENCE: ${brand.audience || 'General'}
TONE: ${(brand.tone || []).join(', ')}
PRODUCTS: ${(brand.products || []).map(p => p.name).join(', ') || 'Not specified'}
BRAND VALUES: ${(brand.brand_values || []).join(', ')}

BRAND ANALYSIS:
${JSON.stringify(scanData?.brand_analysis || {}, null, 2)}

COMPETITOR DATA:
${JSON.stringify(scanData?.competitors || [], null, 2)}

Return JSON:
{
  "weaknesses_opportunities": [
    { "their_weakness": "...", "our_opportunity": "...", "priority": "high|medium|low" }
  ],
  "positioning_statement": "1-2 sentence brand positioning for social media",
  "target_audience": {
    "primary": { "description": "...", "demographics": "...", "psychographics": "...", "follows_accounts_like": ["..."] },
    "secondary": { "description": "..." }
  },
  "key_differentiators": ["..."],
  "competitive_moat": "What makes our brand defensible"
}`;

  const { text } = await callGemini(prompt, { temperature: 0.5, maxTokens: 8192 });
  const result = parseJSON(text);
  console.log(`[Scout] Step 2 complete: ${result?.weaknesses_opportunities?.length || 0} opportunities`);
  return result;
}

// ══════════════════════════════════════════════════════════════════════════════
// STEP 3: Content Strategy + Calendar + Hooks + Scripts
// ══════════════════════════════════════════════════════════════════════════════

async function generateStrategy(brand, scanData, weaknessData) {
  console.log(`[Scout] Step 3: Generating content strategy...`);

  const prompt = `You are a world-class social media content strategist. Create a comprehensive content strategy.

BRAND: ${brand.name}
WEBSITE: ${brand.website_url || 'N/A'}
INSTAGRAM: ${brand.instagram_handle ? '@' + brand.instagram_handle : 'N/A'}
INDUSTRY: ${brand.industry || 'General'}
POSITIONING: ${weaknessData?.positioning_statement || 'Premium brand'}
TARGET AUDIENCE: ${JSON.stringify(weaknessData?.target_audience || {})}
DIFFERENTIATORS: ${JSON.stringify(weaknessData?.key_differentiators || [])}
PRODUCTS: ${(brand.products || []).map(p => p.name).join(', ') || 'Not specified'}
TONE: ${(brand.tone || []).join(', ')}
GAPS TO EXPLOIT: ${(weaknessData?.weaknesses_opportunities || []).map(w => w.our_opportunity).join('; ')}

Create:
1. 5 CONTENT PILLARS with % distribution, purpose, examples
2. WEEKLY CALENDAR (7 days: day, format, pillar, content idea, posting time)
3. 3 REEL SCRIPTS (second-by-second: timestamp, action, text_on_screen, caption, hashtags)
4. 30 HOOKS (5 each: pattern_interrupt, curiosity, authority, social_proof, comparison, lifestyle)
5. PROFILE OPTIMIZATION (bio rewrite, 6 highlights, grid strategy)
6. ACTION PRIORITIES (immediate, this_week, next_week)

Return JSON:
{
  "content_pillars": [{ "name": "...", "percentage": 25, "purpose": "...", "examples": ["..."] }],
  "weekly_calendar": [{ "day": "Monday", "format": "Reel (30-45s)", "pillar": "...", "content_idea": "...", "posting_time": "..." }],
  "reel_scripts": [{ "title": "...", "pillar": "...", "format": "...", "duration": "...", "hook": "...", "scenes": [{ "timestamp": "0-3s", "action": "...", "text_on_screen": "..." }], "caption": "...", "hashtags": ["..."] }],
  "hook_bank": { "pattern_interrupt": ["..."], "curiosity": ["..."], "authority": ["..."], "social_proof": ["..."], "comparison": ["..."], "lifestyle": ["..."] },
  "profile_optimization": { "bio": "...", "highlights": [{ "name": "...", "content": "..." }], "grid_strategy": "..." },
  "action_priorities": { "immediate": [{ "task": "...", "timeline": "Today" }], "this_week": [{ "task": "...", "timeline": "Day 2-3" }], "next_week": [{ "task": "...", "timeline": "Week 2" }] }
}`;

  const { text } = await callGemini(prompt, { temperature: 0.7, maxTokens: 16384 });
  const result = parseJSON(text);
  console.log(`[Scout] Step 3 complete: ${result?.content_pillars?.length || 0} pillars, ${result?.reel_scripts?.length || 0} scripts`);
  return result;
}

// ══════════════════════════════════════════════════════════════════════════════
// STEP 4: Build .docx Document
// ══════════════════════════════════════════════════════════════════════════════

// Helper: coerce any value to a safe array for forEach iteration
const arr = (v) => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []);

function buildDocument(brand, scanData, weaknessData, strategyData) {
  console.log(`[Scout] Step 4: Building .docx...`);

  const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };
  const TW = 9360;

  const cell = (text, opts = {}) => new TableCell({
    borders, width: { size: opts.width || Math.floor(TW / 2), type: WidthType.DXA },
    shading: opts.shading ? { fill: opts.shading, type: ShadingType.CLEAR } : undefined,
    margins: cellMargins,
    children: [new Paragraph({ children: [new TextRun({ text: String(text || ''), bold: opts.bold || false, size: opts.size || 20, font: 'Arial' })] })],
  });

  const h1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 200 }, children: [new TextRun({ text, bold: true, font: 'Arial' })] });
  const h2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 }, children: [new TextRun({ text, bold: true, font: 'Arial' })] });
  const p = (text, opts = {}) => new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: String(text || ''), size: 22, font: 'Arial', ...opts })] });
  const bullet = (text) => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 60 }, children: [new TextRun({ text: String(text || ''), size: 22, font: 'Arial' })] });
  const spacer = () => new Paragraph({ spacing: { after: 200 }, children: [] });
  const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

  const children = [];

  // ── TITLE ──
  children.push(
    new Paragraph({ spacing: { before: 2400 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: brand.name, size: 56, bold: true, font: 'Arial' })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [new TextRun({ text: 'Competitor Intelligence Report + Content Strategy', size: 28, font: 'Arial', color: '666666' })] }),
    spacer(),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Generated: ${new Date().toLocaleDateString()} | Gods Eye Studio`, size: 18, font: 'Arial', color: '999999' })] }),
    pageBreak(),
  );

  // ── BRAND ANALYSIS ──
  const ba = scanData?.brand_analysis || {};
  children.push(h1('PART 1 — BRAND ANALYSIS'));
  if (ba.instagram_stats && typeof ba.instagram_stats === 'object') {
    const rows = Object.entries(ba.instagram_stats).map(([k, v]) =>
      new TableRow({ children: [cell(String(k).replace(/_/g, ' ').toUpperCase(), { bold: true, width: 4000, shading: 'F0F0F0' }), cell(typeof v === 'object' ? JSON.stringify(v) : String(v ?? 'N/A'), { width: 5360 })] })
    );
    if (rows.length) children.push(h2('Instagram Stats'), new Table({ width: { size: TW, type: WidthType.DXA }, columnWidths: [4000, 5360], rows }), spacer());
  }
  if (ba.website_insights) children.push(h2('Website Insights'), p(ba.website_insights), spacer());
  if (ba.current_content_strategy) children.push(h2('Current Content Strategy'), p(ba.current_content_strategy), spacer());
  if (arr(ba.strengths).length) { children.push(h2('Strengths')); arr(ba.strengths).forEach(s => children.push(bullet(String(s)))); children.push(spacer()); }
  if (arr(ba.weaknesses).length) { children.push(h2('Weaknesses')); arr(ba.weaknesses).forEach(s => children.push(bullet(String(s)))); children.push(spacer()); }
  children.push(pageBreak());

  // ── COMPETITOR PROFILES ──
  const comps = arr(scanData?.competitors);
  for (let i = 0; i < comps.length; i++) {
    const c = comps[i];
    children.push(h1(`PART ${i + 2} — ${String(c.handle || 'COMPETITOR').toUpperCase()} INTELLIGENCE`));

    if (c.stats && typeof c.stats === 'object') {
      const rows = Object.entries(c.stats).map(([k, v]) =>
        new TableRow({ children: [cell(String(k).replace(/_/g, ' ').toUpperCase(), { bold: true, width: 4000, shading: 'F0F0F0' }), cell(typeof v === 'object' ? JSON.stringify(v) : String(v ?? 'N/A'), { width: 5360 })] })
      );
      children.push(h2('Account Stats'), new Table({ width: { size: TW, type: WidthType.DXA }, columnWidths: [4000, 5360], rows }), spacer());
    }
    if (c.bio) children.push(p(`Bio: "${c.bio}"`, { italics: true }));
    if (c.positioning_summary) children.push(p(`Positioning: ${c.positioning_summary}`));
    if (c.target_audience) children.push(p(`Target: ${c.target_audience}`));
    children.push(spacer());

    if (arr(c.content_pillars).length) { children.push(h2('Content Pillars')); arr(c.content_pillars).forEach(cp => children.push(bullet(`${cp.name || ''} (${cp.type || ''}) — ${cp.purpose || ''}`))); children.push(spacer()); }
    if (arr(c.top_content).length) { children.push(h2('Top Performing Content')); arr(c.top_content).forEach(tc => children.push(bullet(`${tc.description || ''} — Views: ${tc.views || 'N/A'}, Likes: ${tc.likes || 'N/A'}. ${tc.what_worked || ''}`))); children.push(spacer()); }
    if (c.caption_strategy) {
      children.push(h2('Caption Strategy'));
      const cs = c.caption_strategy;
      if (cs.hook_style) children.push(bullet(`Hook: ${cs.hook_style}`));
      if (cs.cta_pattern) children.push(bullet(`CTA: ${cs.cta_pattern}`));
      if (cs.hashtag_strategy) children.push(bullet(`Hashtags: ${cs.hashtag_strategy}`));
      children.push(spacer());
    }
    if (i < comps.length - 1) children.push(pageBreak());
  }
  if (comps.length) children.push(pageBreak());

  // ── WEAKNESSES & OPPORTUNITIES ──
  const wos = arr(weaknessData?.weaknesses_opportunities);
  if (wos.length) {
    children.push(h1('COMPETITOR WEAKNESSES — YOUR OPPORTUNITIES'));
    const rows = [
      new TableRow({ children: [cell('Their Weakness', { bold: true, shading: 'E8E8E8', width: 4680 }), cell('Your Opportunity', { bold: true, shading: 'E8E8E8', width: 4680 })] }),
      ...wos.map(w => new TableRow({ children: [cell(w.their_weakness || '', { width: 4680 }), cell(w.our_opportunity || '', { width: 4680 })] })),
    ];
    children.push(new Table({ width: { size: TW, type: WidthType.DXA }, columnWidths: [4680, 4680], rows }), spacer());
  }
  if (weaknessData?.positioning_statement) children.push(h2('Brand Positioning'), p(weaknessData.positioning_statement, { bold: true, size: 24 }), spacer());
  if (weaknessData?.target_audience?.primary) {
    const ta = weaknessData.target_audience.primary;
    children.push(h2('Target Audience'), p(`Primary: ${ta.description || ''}`));
    if (ta.demographics) children.push(bullet(`Demographics: ${ta.demographics}`));
    if (ta.psychographics) children.push(bullet(`Psychographics: ${ta.psychographics}`));
    const follows = arr(ta.follows_accounts_like);
    if (follows.length) children.push(bullet(`Follows: ${follows.join(', ')}`));
    children.push(spacer());
  }
  children.push(pageBreak());

  // ── CONTENT PILLARS ──
  const pillars = arr(strategyData?.content_pillars);
  if (pillars.length) {
    children.push(h1('CONTENT PILLARS'));
    const rows = [
      new TableRow({ children: [cell('Pillar', { bold: true, shading: 'E8E8E8', width: 2000 }), cell('%', { bold: true, shading: 'E8E8E8', width: 800 }), cell('Purpose', { bold: true, shading: 'E8E8E8', width: 3000 }), cell('Examples', { bold: true, shading: 'E8E8E8', width: 3560 })] }),
      ...pillars.map(pi => new TableRow({ children: [cell(pi.name || '', { bold: true, width: 2000 }), cell(`${pi.percentage || 0}%`, { width: 800 }), cell(pi.purpose || '', { width: 3000 }), cell(arr(pi.examples).join(', '), { width: 3560 })] })),
    ];
    children.push(new Table({ width: { size: TW, type: WidthType.DXA }, columnWidths: [2000, 800, 3000, 3560], rows }), spacer());
  }

  // ── WEEKLY CALENDAR ──
  const cal = arr(strategyData?.weekly_calendar);
  if (cal.length) {
    children.push(h1('WEEKLY POSTING CALENDAR'));
    const rows = [
      new TableRow({ children: [cell('Day', { bold: true, shading: 'E8E8E8', width: 1200 }), cell('Format', { bold: true, shading: 'E8E8E8', width: 1800 }), cell('Pillar', { bold: true, shading: 'E8E8E8', width: 1500 }), cell('Content Idea', { bold: true, shading: 'E8E8E8', width: 4860 })] }),
      ...cal.map(c => new TableRow({ children: [cell(c.day || '', { bold: true, width: 1200 }), cell(c.format || '', { width: 1800 }), cell(c.pillar || '', { width: 1500 }), cell(c.content_idea || '', { width: 4860 })] })),
    ];
    children.push(new Table({ width: { size: TW, type: WidthType.DXA }, columnWidths: [1200, 1800, 1500, 4860], rows }), spacer());
  }
  children.push(pageBreak());

  // ── REEL SCRIPTS ──
  const scripts = arr(strategyData?.reel_scripts);
  if (scripts.length) {
    children.push(h1('REEL SCRIPTS'));
    scripts.forEach((s, i) => {
      children.push(h2(`REEL ${i + 1} — ${(s.pillar || s.title || '').toUpperCase()}`));
      children.push(p(`Hook: "${s.hook || ''}"`, { bold: true }));
      children.push(p(`Format: ${s.format || ''} | Duration: ${s.duration || ''}`));
      arr(s.scenes).forEach(sc => {
        children.push(p(`[${sc.timestamp || ''}] ${sc.action || ''}`, { bold: true }));
        if (sc.text_on_screen) children.push(p(`  "${sc.text_on_screen}"`, { italics: true }));
      });
      if (s.caption) { children.push(spacer(), p('Caption:', { bold: true }), p(s.caption)); }
      const hashtags = arr(s.hashtags);
      if (hashtags.length) children.push(p(hashtags.map(h => `#${String(h).replace('#', '')}`).join(' '), { color: '0066CC' }));
      children.push(spacer());
    });
  }
  children.push(pageBreak());

  // ── HOOK BANK ──
  const hooks = strategyData?.hook_bank || {};
  if (hooks && typeof hooks === 'object' && Object.keys(hooks).length) {
    children.push(h1('HOOK BANK (30 Hooks)'));
    for (const [cat, list] of Object.entries(hooks)) {
      children.push(h2(String(cat).replace(/_/g, ' ').toUpperCase()));
      arr(list).forEach(h => children.push(bullet(`"${String(h)}"`)));
      children.push(spacer());
    }
  }
  children.push(pageBreak());

  // ── PROFILE OPTIMIZATION ──
  const prof = strategyData?.profile_optimization;
  if (prof) {
    children.push(h1('PROFILE OPTIMIZATION'));
    if (prof.bio) { children.push(h2('Recommended Bio'), p(prof.bio), spacer()); }
    const highlights = arr(prof.highlights);
    if (highlights.length) { children.push(h2('Highlights')); highlights.forEach(h => children.push(bullet(`${h.name || ''}: ${h.content || ''}`))); children.push(spacer()); }
    if (prof.grid_strategy) children.push(h2('Grid Strategy'), p(prof.grid_strategy), spacer());
  }

  // ── ACTIONS ──
  const act = strategyData?.action_priorities;
  if (act) {
    children.push(h1('ACTION PRIORITIES'));
    const immediate = arr(act.immediate);
    const thisWeek = arr(act.this_week);
    const nextWeek = arr(act.next_week);
    if (immediate.length) { children.push(h2('Immediate')); immediate.forEach(a => children.push(bullet(`${a.task || ''} — ${a.timeline || 'Today'}`))); }
    if (thisWeek.length) { children.push(h2('This Week')); thisWeek.forEach(a => children.push(bullet(`${a.task || ''} — ${a.timeline || ''}`))); }
    if (nextWeek.length) { children.push(h2('Next Week')); nextWeek.forEach(a => children.push(bullet(`${a.task || ''} — ${a.timeline || ''}`))); }
  }

  children.push(spacer(), new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Generated by Gods Eye Studio for ${brand.name} on ${new Date().toLocaleDateString()}`, size: 18, font: 'Arial', color: '999999', italics: true })] }));

  return new Document({
    numbering: { config: [{ reference: 'bullets', levels: [{ level: 0, format: 'bullet', text: '\u2022', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }] },
    styles: {
      default: { document: { run: { font: 'Arial', size: 22 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 32, bold: true, font: 'Arial' }, paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, font: 'Arial' }, paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
      ],
    },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `${brand.name} — Intelligence Report`, size: 16, font: 'Arial', color: 'AAAAAA' })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Page ', size: 16, font: 'Arial', color: 'AAAAAA' }), new TextRun({ children: [PageNumber.CURRENT], size: 16, font: 'Arial', color: 'AAAAAA' }), new TextRun({ text: ' | Gods Eye Studio', size: 16, font: 'Arial', color: 'AAAAAA' })] })] }) },
      children,
    }],
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN: Execute Scout Agent
// ══════════════════════════════════════════════════════════════════════════════

async function executeScout(userId, brandId, config = {}) {
  // Load brand from local sync file (primary) or Supabase REST (fallback)
  let brand = null;

  // Try local sync file first (where dev-server.js stores brand_profiles)
  // Must match dev-server.js SYNC_DIR exactly: process.env.HOME || '' (no USERPROFILE fallback on Windows!)
  const syncDir = path.join(process.env.HOME || '', '.klint', 'sync');
  const syncFile = path.join(syncDir, 'brand_profiles.json');
  try {
    if (fs.existsSync(syncFile)) {
      const syncData = JSON.parse(fs.readFileSync(syncFile, 'utf-8'));
      const allBrands = syncData?.data || syncData || [];
      brand = allBrands.find(b => b.id === brandId);
      if (brand) console.log(`[Scout] Loaded brand "${brand.name}" from local sync`);
    }
  } catch (e) {
    console.warn('[Scout] Local sync read failed:', e.message);
  }

  // Fallback to Supabase REST
  if (!brand) {
    try {
      const brands = await supabaseRest(`brand_profiles?id=eq.${brandId}&select=*`);
      if (brands?.length) brand = brands[0];
    } catch (e) {
      console.warn('[Scout] Supabase fallback failed:', e.message);
    }
  }

  if (!brand) throw new Error(`Brand not found: ${brandId}`);

  const competitors = config.competitors || [];
  console.log(`\n[Scout] ═══ Starting Scout for "${brand.name}" ═══`);
  console.log(`[Scout] Website: ${brand.website_url || 'none'}, IG: ${brand.instagram_handle || 'none'}, Competitors: ${competitors.length}`);

  // Step 1: Scan brand + competitors
  const step1 = await scanBrandAndCompetitors(brand, competitors);
  const scanData = step1.data || { brand_analysis: {}, competitors: [] };

  // Step 2: Weakness analysis
  const weaknessData = await analyzeWeaknesses(brand, scanData);

  // Step 3: Content strategy
  const strategyData = await generateStrategy(brand, scanData, weaknessData);

  // Step 4: Build .docx
  const doc = buildDocument(brand, scanData, weaknessData, strategyData);
  const buffer = await Packer.toBuffer(doc);

  // Save to disk
  const docsDir = path.join(process.env.HOME || process.env.USERPROFILE || '', '.klint', 'scout-reports');
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
  const filename = `${brand.name.replace(/[^a-zA-Z0-9]/g, '_')}_Scout_Report_${new Date().toISOString().split('T')[0]}.docx`;
  const filepath = path.join(docsDir, filename);
  fs.writeFileSync(filepath, buffer);

  // Store in content_briefs
  const result = {
    brand_id: brandId,
    brand_name: brand.name,
    filename,
    filepath,
    file_size: buffer.length,
    competitors_analyzed: scanData.competitors?.length || 0,
    opportunities: weaknessData?.weaknesses_opportunities?.length || 0,
    content_pillars: strategyData?.content_pillars?.length || 0,
    reel_scripts: strategyData?.reel_scripts?.length || 0,
    hooks_generated: Object.values(strategyData?.hook_bank || {}).flat().length,
    sources: step1.sources || [],
    generated_at: new Date().toISOString(),
    strategy_data: strategyData,
    weakness_data: weaknessData,
    scan_data: scanData,
  };

  // Save scout_report to local brand profile sync file (so Priya can read it)
  try {
    if (fs.existsSync(syncFile)) {
      const syncData = JSON.parse(fs.readFileSync(syncFile, 'utf-8'));
      const allBrands = Array.isArray(syncData?.data) ? syncData.data : (Array.isArray(syncData) ? syncData : []);
      const idx = allBrands.findIndex(b => b.id === brandId);
      if (idx >= 0) {
        allBrands[idx] = {
          ...allBrands[idx],
          scout_report: {
            filename,
            generated_at: result.generated_at,
            scan_data: scanData,
            weakness_data: weaknessData,
            strategy_data: strategyData,
            sources: step1.sources || [],
            competitors_analyzed: result.competitors_analyzed,
            content_pillars: result.content_pillars,
            hooks_generated: result.hooks_generated,
          },
          updated_at: new Date().toISOString(),
        };
        const updatedSyncData = Array.isArray(syncData?.data)
          ? { ...syncData, data: allBrands, _updatedAt: new Date().toISOString() }
          : allBrands;
        fs.writeFileSync(syncFile, JSON.stringify(updatedSyncData, null, 2), 'utf-8');
        console.log(`[Scout] Saved scout_report to brand "${brand.name}" in local sync`);
      }
    }
  } catch (e) { console.warn('[Scout] Failed to save scout_report to sync file:', e.message); }

  // Try Supabase REST as secondary store
  try {
    await supabaseRest('content_briefs', 'POST', {
      user_id: userId, brand_id: brandId,
      trend_summary: JSON.stringify(result),
      sources: step1.sources || [],
      keywords: (strategyData?.content_pillars || []).map(p => p.name),
      status: 'completed', created_by: 'scout_agent',
    });
  } catch (e) { console.warn('[Scout] Brief save failed:', e.message); }

  // Also save to content_briefs sync file as fallback for Priya
  try {
    const briefsSyncFile = path.join(syncDir, 'content_briefs.json');
    let briefsData = { _updatedAt: new Date().toISOString(), data: [] };
    if (fs.existsSync(briefsSyncFile)) {
      try {
        const existing = JSON.parse(fs.readFileSync(briefsSyncFile, 'utf-8'));
        briefsData = Array.isArray(existing?.data) ? existing : { _updatedAt: new Date().toISOString(), data: Array.isArray(existing) ? existing : [] };
      } catch {}
    }
    briefsData.data.push({
      id: crypto.randomUUID ? crypto.randomUUID() : `brief-${Date.now()}`,
      user_id: userId,
      brand_id: brandId,
      trend_summary: JSON.stringify(result),
      sources: step1.sources || [],
      keywords: (strategyData?.content_pillars || []).map(p => p.name),
      status: 'completed',
      created_by: 'scout_agent',
      created_at: new Date().toISOString(),
    });
    briefsData._updatedAt = new Date().toISOString();
    fs.writeFileSync(briefsSyncFile, JSON.stringify(briefsData, null, 2), 'utf-8');
  } catch (e) { console.warn('[Scout] Local briefs sync save failed:', e.message); }

  console.log(`[Scout] ═══ Complete: ${filename} (${(buffer.length / 1024).toFixed(0)}KB) ═══\n`);
  return result;
}

export { executeScout };
