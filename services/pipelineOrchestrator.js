/**
 * Gods Eye Autopilot Pipeline Orchestrator
 *
 * Chains 5 autonomous agents in sequence: Scout → Create → Review → Approve → (Publish & Analyze run separately)
 * Each stage passes output to the next. Full execution is logged in pipeline_runs + pipeline_stage_logs.
 *
 * Integrates with existing systems:
 * - cronEngine.js helpers (callGemini, loadBrandContext, logExecution, pushCronResultToChat)
 * - brandService.ts patterns (ContentSlot, ContentBrief)
 * - uploadPostService.ts for publishing
 * - qualityGateService.js for scoring, guardrails, dedup
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// ── Supabase client (reuse same env vars as cronEngine) ───────────────────
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

const geminiKey = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const falKey = process.env.FAL_KEY;
const uploadPostKey = process.env.UPLOAD_POST_API_KEY;

// ══════════════════════════════════════════════════════════════════════════════
// GEMINI HELPERS (server-side, mirrors cronEngine's callGemini)
// ══════════════════════════════════════════════════════════════════════════════

async function callGemini(prompt, { useSearch = false, model = 'gemini-2.5-flash', temperature = 0.7, maxTokens = 8192 } = {}) {
  if (!geminiKey) throw new Error('Gemini API key not configured');

  const requestBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature, maxOutputTokens: maxTokens },
  };

  if (useSearch) {
    requestBody.tools = [{ google_search: {} }];
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';
  const sources = data.candidates?.[0]?.groundingMetadata?.groundingChunks
    ?.filter(c => c.web)
    ?.map(c => ({ title: c.web.title, url: c.web.uri })) || [];

  return { text, sources };
}

/** Call Gemini embedding API */
async function embedText(text) {
  if (!geminiKey) throw new Error('Gemini API key not configured');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/text-embedding-004',
        content: { parts: [{ text }] },
      }),
    }
  );

  if (!res.ok) throw new Error(`Embedding API error: ${res.status}`);
  const data = await res.json();
  return data.embedding?.values || [];
}

/** Load brand context */
async function loadBrandContext(brandId, userId) {
  if (!supabase) return null;
  const { data } = await supabase
    .from('brand_profiles')
    .select('*')
    .eq('id', brandId)
    .eq('user_id', userId)
    .single();
  return data;
}

/** Safe JSON parse from Gemini output */
function parseJSON(text) {
  // Try direct parse
  try { return JSON.parse(text); } catch {}

  // Try extracting JSON from markdown code blocks
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) {
    try { return JSON.parse(match[1].trim()); } catch {}
  }

  // Try finding first { or [ and matching
  const start = text.indexOf('{');
  const startArr = text.indexOf('[');
  const idx = start === -1 ? startArr : (startArr === -1 ? start : Math.min(start, startArr));
  if (idx !== -1) {
    const isArr = text[idx] === '[';
    const end = text.lastIndexOf(isArr ? ']' : '}');
    if (end > idx) {
      try { return JSON.parse(text.slice(idx, end + 1)); } catch {}
    }
  }

  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// PIPELINE RUN MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

async function createPipelineRun(userId, brandId, config) {
  if (!supabase) throw new Error('Database not connected');

  const { data, error } = await supabase.from('pipeline_runs').insert({
    user_id: userId,
    brand_id: brandId,
    status: 'running',
    current_stage: 'scout',
    config,
    started_at: new Date().toISOString(),
  }).select().single();

  if (error) throw new Error(`Failed to create pipeline run: ${error.message}`);
  return data;
}

async function updatePipelineRun(runId, updates) {
  if (!supabase) return;
  await supabase.from('pipeline_runs').update(updates).eq('id', runId);
}

async function logStage(runId, stage, status, input = {}, output = {}, durationMs = 0) {
  if (!supabase) return;
  await supabase.from('pipeline_stage_logs').insert({
    pipeline_run_id: runId,
    stage,
    status,
    input,
    output,
    duration_ms: durationMs,
    started_at: status === 'running' ? new Date().toISOString() : undefined,
    completed_at: status !== 'running' && status !== 'pending' ? new Date().toISOString() : undefined,
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// STAGE 1: SCOUT — Enhanced Research + Competitive Intelligence
// ══════════════════════════════════════════════════════════════════════════════

async function executeScoutStage(brand, config, runId) {
  const start = Date.now();
  await logStage(runId, 'scout', 'running');
  await updatePipelineRun(runId, { current_stage: 'scout' });

  const platforms = config.platforms || ['instagram', 'tiktok', 'facebook'];
  const postCount = config.post_count || 15;
  const competitors = config.competitors || [];

  // Load previous performance signals for feedback injection
  let performanceContext = '';
  if (supabase) {
    const { data: signals } = await supabase
      .from('performance_signals')
      .select('signals, generated_briefs')
      .eq('brand_id', brand.id)
      .order('created_at', { ascending: false })
      .limit(1);

    if (signals?.[0]?.signals) {
      performanceContext = `\n\nPERFORMANCE INSIGHTS FROM PREVIOUS CYCLES:\n${JSON.stringify(signals[0].signals)}\n\nPreviously generated winner-inspired briefs (use as reference, don't repeat):\n${JSON.stringify(signals[0].generated_briefs?.slice(0, 3))}`;
    }
  }

  // Competitor context
  let competitorPrompt = '';
  if (competitors.length) {
    competitorPrompt = `\n\nCOMPETITOR ANALYSIS:\nResearch these competitor accounts and find content gaps:\n${competitors.map(c => `- @${c.handle} on ${c.platform || 'instagram'}`).join('\n')}\n\nFor each competitor, note: recent themes, posting frequency, engagement style, content gaps we can exploit.`;
  }

  const prompt = `You are a social media research agent for a creative studio.

BRAND CONTEXT:
Name: ${brand.name}
Industry: ${brand.industry || 'General'}
Audience: ${brand.audience || 'General'}
Tone: ${(brand.tone || []).join(', ') || 'Professional'}
Keywords: ${(brand.keywords || []).join(', ')}
Avoid: ${(brand.avoid || []).join(', ')}
Products: ${(brand.products || []).map(p => p.name).join(', ') || 'None specified'}
${performanceContext}
${competitorPrompt}

TODAY: ${new Date().toLocaleDateString()}

TASK: Research trending topics, viral formats, and emerging themes for these platforms: ${platforms.join(', ')}.

Generate exactly ${postCount} content briefs distributed across the platforms (roughly equal split).
For each brief, specify:
- platform: which social platform
- format: "post" | "story" | "reel"
- topic: what the content is about
- hook: the opening line / attention grabber
- why: why this topic is timely or relevant
- inspiration_source: "trend" | "competitor" | "winner_remix" | "experimental"
- priority: "high" | "medium" | "low"
- suggested_product: name of a brand product to feature (if applicable, or null)

Return ONLY a JSON object:
{
  "briefs": [ ... ],
  "competitor_insights": { "summary": "...", "gaps": [...] },
  "trend_sources": [...]
}`;

  const { text, sources } = await callGemini(prompt, { useSearch: true });
  const result = parseJSON(text);

  if (!result?.briefs?.length) {
    throw new Error('Scout failed to generate valid briefs');
  }

  // Store briefs in content_briefs table
  if (supabase) {
    await supabase.from('content_briefs').insert({
      brand_id: brand.id,
      user_id: brand.user_id,
      trend_summary: text,
      sources,
      keywords: result.briefs.map(b => b.topic).slice(0, 20),
      competitor_context: result.competitor_insights || null,
      status: 'pending',
      created_by: 'pipeline_scout',
    });
  }

  const duration = Date.now() - start;
  await logStage(runId, 'scout', 'completed', { platforms, postCount, competitors: competitors.length }, {
    briefCount: result.briefs.length,
    hasCompetitorInsights: !!result.competitor_insights,
    hasPerformanceFeedback: !!performanceContext,
  }, duration);

  console.log(`[Pipeline] Scout completed: ${result.briefs.length} briefs in ${duration}ms`);
  return result;
}

// ══════════════════════════════════════════════════════════════════════════════
// STAGE 2: CREATE — Generate ContentBriefs + Images for each scout brief
// ══════════════════════════════════════════════════════════════════════════════

async function executeCreateStage(scoutResult, brand, config, runId) {
  const start = Date.now();
  await logStage(runId, 'create', 'running');
  await updatePipelineRun(runId, { current_stage: 'create' });

  const briefs = scoutResult.briefs || [];
  const enableAB = config.enable_ab_test || false;
  const createdSlots = [];

  // Determine which briefs get A/B variants (top 20% by priority)
  const highPriorityBriefs = briefs.filter(b => b.priority === 'high');
  const abCandidateCount = enableAB ? Math.max(1, Math.floor(briefs.length * 0.2)) : 0;
  const abCandidates = new Set(highPriorityBriefs.slice(0, abCandidateCount).map((_, i) => i));

  // Build brand context string for brief generation
  const brandDNA = `Brand: ${brand.name}
Industry: ${brand.industry || ''}
Audience: ${brand.audience || ''}
Tone: ${(brand.tone || []).join(', ')}
Colors: ${(brand.colors || []).join(', ')}
Visual Style: ${brand.visual_style || ''}
Avoid: ${(brand.avoid || []).join(', ')}
Products: ${(brand.products || []).map(p => p.name).join(', ')}`;

  // Generate full brief + image for each scout brief
  for (let i = 0; i < briefs.length; i++) {
    const scoutBrief = briefs[i];
    const isAB = abCandidates.has(i);
    const variantGroup = isAB ? crypto.randomUUID() : null;
    const variants = isAB ? ['A', 'B'] : [null];

    for (const variantLabel of variants) {
      try {
        // Generate full ContentBrief via Gemini
        const briefPrompt = `You are a content creator for ${brand.name}.

${brandDNA}

Create a detailed content brief for this topic:
Platform: ${scoutBrief.platform}
Format: ${scoutBrief.format}
Topic: ${scoutBrief.topic}
Hook idea: ${scoutBrief.hook}
${scoutBrief.suggested_product ? `Feature product: ${scoutBrief.suggested_product}` : 'No specific product — general brand content'}
${variantLabel === 'B' ? '\nIMPORTANT: This is VARIANT B. Create a significantly different angle/hook/visual direction from the standard approach. Be creative and experimental.' : ''}

${brand.products?.length ? 'PRODUCT RULE: The image_prompt must describe ONLY the background/setting. Do NOT include any product objects in the scene description — the product photo will be composited separately.' : 'No product images — describe the full scene including any objects.'}

Return ONLY a JSON object:
{
  "hook": "opening line that grabs attention",
  "caption": "2-3 paragraphs of engaging caption text",
  "hashtags": ["tag1", "tag2", ...],
  "image_prompt": "detailed scene description for AI image generation",
  "visual_direction": "art direction notes",
  "call_to_action": "clear CTA",
  "target_emotion": "primary emotion to evoke"
}`;

        const { text: briefText } = await callGemini(briefPrompt, { temperature: 0.7 });
        const brief = parseJSON(briefText);

        if (!brief?.hook) {
          console.warn(`[Pipeline] Create: failed to parse brief for ${scoutBrief.topic}, skipping`);
          continue;
        }

        // Generate image via Gemini
        let generatedImage = null;
        try {
          const aspectRatio = scoutBrief.format === 'story' || scoutBrief.format === 'reel' ? '9:16' : '1:1';
          const imagePrompt = brief.image_prompt + (brand.visual_style_rules ? `\n\nVisual style: ${brand.visual_style_rules}` : '');

          // Use Gemini image generation (same pattern as geminiService)
          const imageRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${geminiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: `Generate an image: ${imagePrompt}` }] }],
                generationConfig: {
                  responseModalities: ['TEXT', 'IMAGE'],
                  temperature: brand.products?.length ? 0.3 : 0.7,
                },
              }),
            }
          );

          if (imageRes.ok) {
            const imageData = await imageRes.json();
            const imagePart = imageData.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
            if (imagePart?.inlineData) {
              generatedImage = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
            }
          }
        } catch (imgErr) {
          console.warn(`[Pipeline] Create: image generation failed for ${scoutBrief.topic}:`, imgErr.message);
          // Continue without image — can be regenerated manually
        }

        // Calculate a slot date (spread across next 7-14 days)
        const slotDate = new Date();
        slotDate.setDate(slotDate.getDate() + 1 + Math.floor(i / Math.ceil(briefs.length / 14)));
        const slotDateStr = slotDate.toISOString().split('T')[0];

        // Create ContentSlot
        const slot = {
          id: crypto.randomUUID(),
          brand_id: brand.id,
          user_id: brand.user_id,
          slot_date: slotDateStr,
          format: scoutBrief.format || 'post',
          status: generatedImage ? 'generated' : 'briefed',
          idea: scoutBrief.topic,
          brief,
          generated_image: generatedImage,
          selected_product: scoutBrief.suggested_product || null,
          approved: false,
          pipeline_run_id: runId,
          variant_of: variantLabel === 'B' ? createdSlots[createdSlots.length - 1]?.id || null : null,
        };

        // Save to Supabase
        if (supabase) {
          await supabase.from('content_slots').upsert(slot, { onConflict: 'brand_id,slot_date,format' });
        }

        createdSlots.push({
          ...slot,
          variant_group: variantGroup,
          variant_label: variantLabel,
          scout_brief: scoutBrief,
        });

        console.log(`[Pipeline] Create: slot ${slotDateStr}/${scoutBrief.format} ${variantLabel ? `(${variantLabel})` : ''} — ${generatedImage ? 'with image' : 'brief only'}`);

      } catch (err) {
        console.error(`[Pipeline] Create: error for brief ${i}:`, err.message);
      }
    }
  }

  const duration = Date.now() - start;
  await logStage(runId, 'create', 'completed', { briefCount: briefs.length, enableAB }, {
    slotsCreated: createdSlots.length,
    withImages: createdSlots.filter(s => s.generated_image).length,
    abVariants: createdSlots.filter(s => s.variant_label).length,
  }, duration);

  console.log(`[Pipeline] Create completed: ${createdSlots.length} slots in ${duration}ms`);
  return createdSlots;
}

// ══════════════════════════════════════════════════════════════════════════════
// STAGE 3: REVIEW — Quality Scoring, Guardrails, Dedup
// ══════════════════════════════════════════════════════════════════════════════

async function executeReviewStage(slots, brand, config, runId) {
  const start = Date.now();
  await logStage(runId, 'review', 'running');
  await updatePipelineRun(runId, { current_stage: 'review' });

  const reviewedSlots = [];
  const MAX_RETRIES = 2;

  for (const slot of slots) {
    if (!slot.brief) {
      reviewedSlots.push({ ...slot, quality_scores: null, guardrail_flags: null, dedup_score: 0 });
      continue;
    }

    let currentBrief = slot.brief;
    let qualityScores = null;
    let retryCount = 0;

    // ── Reflection Scoring (with retry loop) ───────────────────────────
    while (retryCount <= MAX_RETRIES) {
      const scorePrompt = `You are a content quality reviewer for ${brand.name}.

BRAND VOICE: ${(brand.tone || []).join(', ') || 'Professional'}
AUDIENCE: ${brand.audience || 'General'}
AVOID: ${(brand.avoid || []).join(', ')}

Rate this content brief on 4 dimensions (1-10 each):

BRIEF:
Hook: ${currentBrief.hook}
Caption: ${currentBrief.caption}
CTA: ${currentBrief.call_to_action}
Hashtags: ${(currentBrief.hashtags || []).join(', ')}
Emotion: ${currentBrief.target_emotion}

SCORING CRITERIA:
1. hook (1-10): Is the opening line attention-grabbing, specific, and emotionally compelling?
2. brand_voice (1-10): Does the content match the brand tone and avoid prohibited topics?
3. cta_clarity (1-10): Is the call-to-action clear, specific, and benefit-driven?
4. uniqueness (1-10): Is this a fresh angle, not generic or repetitive?

Return ONLY JSON: { "hook": N, "brand_voice": N, "cta_clarity": N, "uniqueness": N, "overall": N, "feedback": "brief note if any score < 7" }`;

      const { text: scoreText } = await callGemini(scorePrompt, { temperature: 0.2 });
      qualityScores = parseJSON(scoreText);

      if (!qualityScores) {
        qualityScores = { hook: 5, brand_voice: 5, cta_clarity: 5, uniqueness: 5, overall: 5, feedback: 'Failed to parse scores' };
        break;
      }

      // Calculate overall if not provided
      if (!qualityScores.overall) {
        qualityScores.overall = Math.round(
          (qualityScores.hook + qualityScores.brand_voice + qualityScores.cta_clarity + qualityScores.uniqueness) / 4
        );
      }

      // If quality is sufficient, break
      if (qualityScores.overall >= 7 || retryCount >= MAX_RETRIES) break;

      // Retry: regenerate brief with feedback
      console.log(`[Pipeline] Review: score ${qualityScores.overall}/10 for ${slot.slot_date}/${slot.format}, retrying (${retryCount + 1}/${MAX_RETRIES})...`);

      const retryPrompt = `Improve this content brief based on quality feedback.

ORIGINAL BRIEF: ${JSON.stringify(currentBrief)}

QUALITY FEEDBACK:
Hook score: ${qualityScores.hook}/10
Brand voice: ${qualityScores.brand_voice}/10
CTA clarity: ${qualityScores.cta_clarity}/10
Uniqueness: ${qualityScores.uniqueness}/10
Notes: ${qualityScores.feedback || 'Scores need improvement'}

Brand: ${brand.name}, Tone: ${(brand.tone || []).join(', ')}, Audience: ${brand.audience}

Rewrite the brief to address the weak areas. Return ONLY JSON with the same structure: { "hook", "caption", "hashtags", "image_prompt", "visual_direction", "call_to_action", "target_emotion" }`;

      const { text: retryText } = await callGemini(retryPrompt, { temperature: 0.8 });
      const retried = parseJSON(retryText);
      if (retried?.hook) currentBrief = retried;

      retryCount++;
    }

    // ── Guardrail Checks ──────────────────────────────────────────────
    const guardrailPrompt = `Review this social media content for brand safety and compliance.

BRAND: ${brand.name}
INDUSTRY: ${brand.industry || 'General'}
AVOID TOPICS: ${(brand.avoid || []).join(', ')}

CONTENT:
Hook: ${currentBrief.hook}
Caption: ${currentBrief.caption}
CTA: ${currentBrief.call_to_action}

CHECK FOR:
1. Unverified health/medical claims (especially for supplements, beauty, wellness)
2. Incorrect discount codes or prices (if mentioned)
3. Off-brand tone or messaging that contradicts brand values
4. Unintended competitor mentions
5. Culturally insensitive or potentially offensive content
6. Regulatory risks (FTC disclosure missing for sponsored content, etc.)

Return ONLY JSON: { "compliance_ok": true/false, "issues": ["issue description 1", ...] }`;

    const { text: guardText } = await callGemini(guardrailPrompt, { temperature: 0.1 });
    const guardrailFlags = parseJSON(guardText) || { compliance_ok: true, issues: [] };

    // ── Embedding Dedup ───────────────────────────────────────────────
    let dedupScore = 0;
    try {
      const contentText = `${currentBrief.hook} ${(currentBrief.caption || '').slice(0, 200)}`;
      const embedding = await embedText(contentText);

      if (embedding.length && supabase) {
        // Check similarity against existing embeddings
        const { data: matches } = await supabase.rpc('match_content_embeddings', {
          query_embedding: `[${embedding.join(',')}]`,
          match_brand_id: brand.id,
          match_threshold: 0.5,
          match_count: 1,
          days_back: 30,
        });

        if (matches?.length) {
          dedupScore = matches[0].similarity;
        }

        // Store this embedding for future dedup
        const contentHash = crypto.createHash('sha256').update(contentText).digest('hex');
        await supabase.from('content_embeddings').insert({
          user_id: brand.user_id,
          brand_id: brand.id,
          content_hash: contentHash,
          embedding: `[${embedding.join(',')}]`,
          source_type: 'brief',
          source_date: slot.slot_date,
        });
      }
    } catch (dedupErr) {
      console.warn(`[Pipeline] Review: dedup check failed:`, dedupErr.message);
    }

    // Update the slot with review results
    const reviewedSlot = {
      ...slot,
      brief: currentBrief,
      quality_scores: qualityScores,
      guardrail_flags: guardrailFlags,
      dedup_score: dedupScore,
      status: 'reviewed',
    };

    // Persist to DB
    if (supabase) {
      await supabase.from('content_slots').update({
        brief: currentBrief,
        quality_scores: qualityScores,
        guardrail_flags: guardrailFlags,
        dedup_score: dedupScore,
        status: 'reviewed',
      }).eq('id', slot.id);
    }

    reviewedSlots.push(reviewedSlot);
    console.log(`[Pipeline] Review: ${slot.slot_date}/${slot.format} — score ${qualityScores?.overall || '?'}/10, dedup ${(dedupScore * 100).toFixed(1)}%, ${guardrailFlags.compliance_ok ? 'compliant' : 'FLAGGED'}`);
  }

  const duration = Date.now() - start;
  const passedCount = reviewedSlots.filter(s => s.quality_scores?.overall >= 7).length;
  const flaggedCount = reviewedSlots.filter(s => !s.guardrail_flags?.compliance_ok).length;
  const dupCount = reviewedSlots.filter(s => s.dedup_score > 0.85).length;

  await logStage(runId, 'review', 'completed', { slotCount: slots.length }, {
    passed: passedCount,
    flagged: flaggedCount,
    duplicates: dupCount,
    avgScore: reviewedSlots.reduce((sum, s) => sum + (s.quality_scores?.overall || 0), 0) / (reviewedSlots.length || 1),
  }, duration);

  console.log(`[Pipeline] Review completed: ${passedCount}/${reviewedSlots.length} passed, ${flaggedCount} flagged, ${dupCount} near-duplicates`);
  return reviewedSlots;
}

// ══════════════════════════════════════════════════════════════════════════════
// STAGE 4: APPROVE — Create approval queue items
// ══════════════════════════════════════════════════════════════════════════════

async function executeApproveStage(reviewedSlots, brand, config, runId) {
  const start = Date.now();
  await logStage(runId, 'approve', 'running');
  await updatePipelineRun(runId, { current_stage: 'approve' });

  const autoApproveHours = config.auto_approve_hours ?? 4; // 0 = fully autonomous
  const queueItems = [];

  for (const slot of reviewedSlots) {
    // Skip slots flagged as near-duplicates
    if (slot.dedup_score > 0.85) {
      console.log(`[Pipeline] Approve: skipping ${slot.slot_date}/${slot.format} — too similar to existing content (${(slot.dedup_score * 100).toFixed(1)}%)`);
      continue;
    }

    const autoApproveAt = autoApproveHours > 0
      ? new Date(Date.now() + autoApproveHours * 60 * 60 * 1000).toISOString()
      : new Date().toISOString(); // Immediate auto-approve

    // Build caption preview
    const brief = slot.brief || {};
    const captionPreview = [brief.hook, brief.caption?.slice(0, 100)].filter(Boolean).join(' — ');

    const item = {
      user_id: brand.user_id,
      brand_id: brand.id,
      pipeline_run_id: runId,
      slot_id: slot.id,
      slot_date: slot.slot_date,
      format: slot.format,
      variant_group: slot.variant_group || null,
      variant_label: slot.variant_label || null,
      brief: slot.brief,
      generated_image: slot.generated_image,
      caption_preview: captionPreview.slice(0, 200),
      quality_scores: slot.quality_scores,
      guardrail_flags: slot.guardrail_flags,
      dedup_score: slot.dedup_score,
      status: autoApproveHours === 0 ? 'auto_approved' : 'pending',
      auto_approve_at: autoApproveAt,
    };

    if (supabase) {
      const { data } = await supabase.from('approval_queue').insert(item).select().single();
      if (data) queueItems.push(data);
    }

    // If fully autonomous (auto_approve_hours === 0), immediately mark slot as approved
    if (autoApproveHours === 0 && supabase) {
      await supabase.from('content_slots').update({
        status: 'approved',
        approved: true,
      }).eq('id', slot.id);
    }
  }

  const duration = Date.now() - start;
  await logStage(runId, 'approve', 'completed', { slotCount: reviewedSlots.length }, {
    queued: queueItems.length,
    autoApproved: queueItems.filter(q => q.status === 'auto_approved').length,
    pending: queueItems.filter(q => q.status === 'pending').length,
    skippedDuplicates: reviewedSlots.length - queueItems.length,
    autoApproveHours,
  }, duration);

  console.log(`[Pipeline] Approve completed: ${queueItems.length} items queued (${autoApproveHours === 0 ? 'auto-approved' : `HITL, auto-approve in ${autoApproveHours}h`})`);
  return queueItems;
}

// ══════════════════════════════════════════════════════════════════════════════
// AUTO-APPROVE CHECK — Runs every 15 min, approves expired items
// ══════════════════════════════════════════════════════════════════════════════

async function executeAutoApproveCheck(job) {
  if (!supabase) return { text: 'Database not connected', status: 'skipped' };

  const now = new Date().toISOString();

  // Find pending items past their auto-approve deadline
  const { data: expired } = await supabase
    .from('approval_queue')
    .select('id, slot_id, user_id, brand_id, brief, format')
    .eq('user_id', job.user_id)
    .eq('status', 'pending')
    .lte('auto_approve_at', now);

  if (!expired?.length) return { text: 'No items to auto-approve', autoApproved: 0 };

  let approved = 0;
  for (const item of expired) {
    try {
      // Mark approval queue item
      await supabase.from('approval_queue').update({
        status: 'auto_approved',
        resolved_at: now,
      }).eq('id', item.id);

      // Mark content slot as approved
      if (item.slot_id) {
        await supabase.from('content_slots').update({
          status: 'approved',
          approved: true,
        }).eq('id', item.slot_id);
      }

      approved++;
    } catch (err) {
      console.error(`[Pipeline] Auto-approve failed for ${item.id}:`, err.message);
    }
  }

  console.log(`[Pipeline] Auto-approve check: approved ${approved}/${expired.length} expired items`);
  return { text: `Auto-approved ${approved} items that passed their review deadline`, autoApproved: approved };
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN PIPELINE EXECUTOR — Called by cronEngine
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Execute a full autopilot pipeline cycle: Scout → Create → Review → Approve Queue
 * Publish and Analyze stages run separately (on approval or analytics cron).
 *
 * @param {Object} job - The cron job object from cronEngine (user_id, brand_id, config)
 * @returns {Object} Pipeline result summary
 */
async function executePipelineCycle(job) {
  const userId = job.user_id;
  const brandId = job.brand_id;
  const config = job.config || {};

  if (!brandId) throw new Error('Autopilot requires a brand_id. Configure a brand for this job.');
  if (!supabase) throw new Error('Database not connected');

  const brand = await loadBrandContext(brandId, userId);
  if (!brand) throw new Error(`Brand not found: ${brandId}`);

  console.log(`\n[Pipeline] ═══ Starting Autopilot Cycle for ${brand.name} ═══`);

  // Create pipeline run
  const run = await createPipelineRun(userId, brandId, config);
  const runId = run.id;

  try {
    // ── Stage 1: Scout ──
    const scoutResult = await executeScoutStage(brand, config, runId);

    // ── Stage 2: Create ──
    const createdSlots = await executeCreateStage(scoutResult, brand, config, runId);

    if (!createdSlots.length) {
      await updatePipelineRun(runId, {
        status: 'completed',
        current_stage: 'approve',
        completed_at: new Date().toISOString(),
        stage_summary: { scout: { briefs: scoutResult.briefs?.length || 0 }, create: { slots: 0 }, review: { skipped: true }, approve: { skipped: true } },
      });
      return { text: `Scout generated ${scoutResult.briefs?.length || 0} briefs but no slots could be created.`, runId };
    }

    // ── Stage 3: Review ──
    const reviewedSlots = await executeReviewStage(createdSlots, brand, config, runId);

    // ── Stage 4: Approve (queue for HITL or auto-approve) ──
    const approvalItems = await executeApproveStage(reviewedSlots, brand, config, runId);

    // Mark pipeline as completed (publish + analyze run separately)
    const summary = {
      scout: { briefs: scoutResult.briefs?.length || 0 },
      create: { slots: createdSlots.length, images: createdSlots.filter(s => s.generated_image).length },
      review: {
        passed: reviewedSlots.filter(s => s.quality_scores?.overall >= 7).length,
        flagged: reviewedSlots.filter(s => !s.guardrail_flags?.compliance_ok).length,
        avgScore: (reviewedSlots.reduce((sum, s) => sum + (s.quality_scores?.overall || 0), 0) / (reviewedSlots.length || 1)).toFixed(1),
      },
      approve: {
        queued: approvalItems.length,
        autoApproved: approvalItems.filter(q => q.status === 'auto_approved').length,
      },
    };

    await updatePipelineRun(runId, {
      status: 'completed',
      current_stage: 'approve',
      completed_at: new Date().toISOString(),
      stage_summary: summary,
    });

    const resultText = `Autopilot cycle completed for ${brand.name}:
• Scout: ${summary.scout.briefs} briefs researched
• Create: ${summary.create.slots} content slots (${summary.create.images} with images)
• Review: ${summary.review.passed} passed quality gates (avg score: ${summary.review.avgScore}/10)
• Approve: ${summary.approve.queued} items in queue (${summary.approve.autoApproved} auto-approved)`;

    console.log(`[Pipeline] ═══ Cycle Complete ═══\n${resultText}\n`);

    return { text: resultText, runId, summary };

  } catch (err) {
    console.error(`[Pipeline] ═══ Cycle FAILED ═══`, err.message);

    await updatePipelineRun(runId, {
      status: 'failed',
      error_message: err.message,
      completed_at: new Date().toISOString(),
    });

    throw err;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// APPROVAL ACTIONS — Called by server routes
// ══════════════════════════════════════════════════════════════════════════════

async function approveItem(itemId, userId, { platforms = [], scheduledAt = null } = {}) {
  if (!supabase) throw new Error('Database not connected');

  const { data: item } = await supabase
    .from('approval_queue')
    .select('*')
    .eq('id', itemId)
    .eq('user_id', userId)
    .single();

  if (!item) throw new Error('Approval item not found');
  if (item.status !== 'pending') throw new Error(`Item already ${item.status}`);

  // Update approval queue
  await supabase.from('approval_queue').update({
    status: 'approved',
    publish_platforms: platforms,
    publish_scheduled_at: scheduledAt,
    resolved_at: new Date().toISOString(),
  }).eq('id', itemId);

  // Update content slot
  if (item.slot_id) {
    await supabase.from('content_slots').update({
      status: 'approved',
      approved: true,
    }).eq('id', item.slot_id);
  }

  // If A/B test, reject the other variant
  if (item.variant_group) {
    await supabase.from('approval_queue').update({
      status: 'rejected',
      reviewer_notes: 'Lost A/B test — other variant was selected',
      resolved_at: new Date().toISOString(),
    })
      .eq('variant_group', item.variant_group)
      .eq('user_id', userId)
      .neq('id', itemId)
      .eq('status', 'pending');
  }

  // TODO: Trigger publish if platforms are specified (integrate with auto-publisher)

  return { success: true, approved: item.slot_id };
}

async function rejectItem(itemId, userId, reason = '') {
  if (!supabase) throw new Error('Database not connected');

  const { data: item } = await supabase
    .from('approval_queue')
    .select('*')
    .eq('id', itemId)
    .eq('user_id', userId)
    .single();

  if (!item) throw new Error('Approval item not found');

  await supabase.from('approval_queue').update({
    status: 'rejected',
    reviewer_notes: reason,
    resolved_at: new Date().toISOString(),
  }).eq('id', itemId);

  return { success: true, rejected: item.slot_id };
}

async function getApprovalQueue(userId, { brandId = null, status = 'pending', limit = 50 } = {}) {
  if (!supabase) return [];

  let query = supabase
    .from('approval_queue')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (brandId) query = query.eq('brand_id', brandId);
  if (status && status !== 'all') query = query.eq('status', status);

  const { data } = await query;
  return data || [];
}

async function bulkApprove(itemIds, userId, { platforms = [], scheduledAt = null } = {}) {
  const results = [];
  for (const id of itemIds) {
    try {
      const result = await approveItem(id, userId, { platforms, scheduledAt });
      results.push({ id, ...result });
    } catch (err) {
      results.push({ id, success: false, error: err.message });
    }
  }
  return results;
}

// ══════════════════════════════════════════════════════════════════════════════
// PIPELINE STATUS QUERIES
// ══════════════════════════════════════════════════════════════════════════════

async function getPipelineRuns(userId, { brandId = null, limit = 10 } = {}) {
  if (!supabase) return [];

  let query = supabase
    .from('pipeline_runs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (brandId) query = query.eq('brand_id', brandId);

  const { data } = await query;
  return data || [];
}

async function getPipelineStageLogs(runId) {
  if (!supabase) return [];

  const { data } = await supabase
    .from('pipeline_stage_logs')
    .select('*')
    .eq('pipeline_run_id', runId)
    .order('started_at', { ascending: true });

  return data || [];
}

// ══════════════════════════════════════════════════════════════════════════════
// ENHANCED ANALYTICS — Performance signal distillation
// ══════════════════════════════════════════════════════════════════════════════

async function distillPerformanceSignals(userId, brandId) {
  if (!supabase) return null;

  // Get published slots with performance data from last 7 days
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const { data: slots } = await supabase
    .from('content_slots')
    .select('slot_date, format, brief, performance_data, idea, selected_product')
    .eq('brand_id', brandId)
    .eq('user_id', userId)
    .not('performance_data', 'is', null)
    .gte('slot_date', weekAgo)
    .order('slot_date', { ascending: false });

  if (!slots?.length || slots.length < 3) {
    return { text: 'Not enough performance data to distill signals (need at least 3 published posts with metrics)' };
  }

  // Sort by engagement rate (if available in performance_data)
  const sorted = slots.sort((a, b) => {
    const aEng = a.performance_data?.engagement_rate || a.performance_data?.likes || 0;
    const bEng = b.performance_data?.engagement_rate || b.performance_data?.likes || 0;
    return bEng - aEng;
  });

  const top5 = sorted.slice(0, 5);
  const bottom5 = sorted.slice(-5);

  const prompt = `Analyze these social media post results and distill actionable insights.

TOP PERFORMERS (highest engagement):
${JSON.stringify(top5.map(s => ({
  date: s.slot_date, format: s.format, idea: s.idea, product: s.selected_product,
  hook: s.brief?.hook, emotion: s.brief?.target_emotion,
  metrics: s.performance_data,
})), null, 2)}

UNDERPERFORMERS (lowest engagement):
${JSON.stringify(bottom5.map(s => ({
  date: s.slot_date, format: s.format, idea: s.idea, product: s.selected_product,
  hook: s.brief?.hook, emotion: s.brief?.target_emotion,
  metrics: s.performance_data,
})), null, 2)}

DISTILL:
1. What content themes/formats/hooks consistently perform well?
2. What should we do MORE of?
3. What should we STOP doing?
4. Best posting formats (post vs story vs reel)?
5. Generate 4 new content briefs INSPIRED by the winners (new angles on winning themes)
6. Generate 1 EXPERIMENTAL brief (something we haven't tried)

Return JSON:
{
  "signals": {
    "what_worked": ["..."],
    "do_more": ["..."],
    "stop_doing": ["..."],
    "best_formats": ["..."],
    "best_themes": ["..."]
  },
  "generated_briefs": [
    { "topic": "...", "hook": "...", "format": "post|story|reel", "platform": "...", "type": "winner_remix|experimental" }
  ]
}`;

  const { text } = await callGemini(prompt);
  const result = parseJSON(text);

  if (result?.signals) {
    // Store performance signals
    await supabase.from('performance_signals').insert({
      user_id: userId,
      brand_id: brandId,
      period_start: weekAgo,
      period_end: new Date().toISOString().split('T')[0],
      top_posts: top5.map(s => ({ slot_date: s.slot_date, format: s.format, metrics: s.performance_data })),
      bottom_posts: bottom5.map(s => ({ slot_date: s.slot_date, format: s.format, metrics: s.performance_data })),
      signals: result.signals,
      generated_briefs: result.generated_briefs || [],
    });
  }

  return result;
}

// ══════════════════════════════════════════════════════════════════════════════
// SINGLE AGENT EXECUTION — Run one agent stage independently
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Run a single agent stage without the full pipeline.
 * Useful for testing or manual triggering from the UI.
 *
 * @param {string} agentId - 'scout' | 'creative' | 'reviewer' | 'dispatcher' | 'analyst'
 * @param {string} userId
 * @param {string} brandId
 * @param {object} config - Pipeline config (platforms, post_count, competitors, etc.)
 * @returns {object} Result from the agent
 */
async function runSingleAgent(agentId, userId, brandId, config = {}) {
  if (!supabase) throw new Error('Database not connected');

  const brand = await loadBrandContext(brandId, userId);
  if (!brand) throw new Error(`Brand not found: ${brandId}`);

  console.log(`[Pipeline] Running single agent: ${agentId} for ${brand.name}`);

  // Create a lightweight pipeline run to track this
  const run = await createPipelineRun(userId, brandId, { ...config, single_agent: agentId });
  const runId = run.id;

  try {
    let result;

    switch (agentId) {
      case 'scout': {
        result = await executeScoutStage(brand, config, runId);
        await updatePipelineRun(runId, {
          status: 'completed',
          current_stage: 'scout',
          completed_at: new Date().toISOString(),
          stage_summary: { scout: { briefs: result?.briefs?.length || 0 } },
        });
        return { text: `Scout found ${result?.briefs?.length || 0} content briefs`, runId, result };
      }

      case 'creative': {
        // Creative needs scout briefs — check for pending briefs or use latest scout result
        const { data: latestBriefs } = await supabase
          .from('content_briefs')
          .select('trend_summary')
          .eq('brand_id', brandId)
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(1);

        let scoutResult;
        if (latestBriefs?.[0]?.trend_summary) {
          scoutResult = parseJSON(latestBriefs[0].trend_summary);
        }
        if (!scoutResult?.briefs?.length) {
          // Run scout first
          scoutResult = await executeScoutStage(brand, config, runId);
        }

        result = await executeCreateStage(scoutResult, brand, config, runId);
        await updatePipelineRun(runId, {
          status: 'completed',
          current_stage: 'create',
          completed_at: new Date().toISOString(),
          stage_summary: { create: { slots: result?.length || 0, images: result?.filter(s => s.generated_image).length || 0 } },
        });
        return { text: `Creative generated ${result?.length || 0} content slots`, runId, slotsCreated: result?.length || 0 };
      }

      case 'reviewer': {
        // Review needs generated slots — fetch unreviewed slots for this brand
        const { data: unreviewedSlots } = await supabase
          .from('content_slots')
          .select('*')
          .eq('brand_id', brandId)
          .eq('user_id', userId)
          .eq('status', 'generated')
          .order('created_at', { ascending: false })
          .limit(20);

        if (!unreviewedSlots?.length) {
          await updatePipelineRun(runId, { status: 'completed', completed_at: new Date().toISOString() });
          return { text: 'No unreviewed slots found — run Creative first', runId };
        }

        result = await executeReviewStage(unreviewedSlots, brand, config, runId);
        const passed = result?.filter(s => s.quality_scores?.overall >= 7).length || 0;
        await updatePipelineRun(runId, {
          status: 'completed',
          current_stage: 'review',
          completed_at: new Date().toISOString(),
          stage_summary: { review: { passed, total: result?.length || 0 } },
        });
        return { text: `Reviewed ${result?.length || 0} slots — ${passed} passed quality gates`, runId };
      }

      case 'dispatcher': {
        // Dispatch = approve reviewed slots and queue them
        const { data: reviewedSlots } = await supabase
          .from('content_slots')
          .select('*')
          .eq('brand_id', brandId)
          .eq('user_id', userId)
          .eq('status', 'reviewed')
          .order('created_at', { ascending: false })
          .limit(20);

        if (!reviewedSlots?.length) {
          await updatePipelineRun(runId, { status: 'completed', completed_at: new Date().toISOString() });
          return { text: 'No reviewed slots found — run Review first', runId };
        }

        result = await executeApproveStage(reviewedSlots, brand, config, runId);
        await updatePipelineRun(runId, {
          status: 'completed',
          current_stage: 'approve',
          completed_at: new Date().toISOString(),
          stage_summary: { approve: { queued: result?.length || 0 } },
        });
        return { text: `Queued ${result?.length || 0} items for approval`, runId };
      }

      case 'analyst': {
        result = await distillPerformanceSignals(userId, brandId);
        await updatePipelineRun(runId, {
          status: 'completed',
          current_stage: 'analyze',
          completed_at: new Date().toISOString(),
          stage_summary: { analyze: { hasSignals: !!result?.signals } },
        });
        return { text: result?.signals ? 'Performance signals distilled successfully' : (result?.text || 'Not enough data for analysis'), runId };
      }

      default:
        throw new Error(`Unknown agent: ${agentId}`);
    }
  } catch (err) {
    await updatePipelineRun(runId, { status: 'failed', error_message: err.message, completed_at: new Date().toISOString() });
    throw err;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════════════════════════

export {
  executePipelineCycle,
  executeAutoApproveCheck,
  runSingleAgent,
  approveItem,
  rejectItem,
  getApprovalQueue,
  bulkApprove,
  getPipelineRuns,
  getPipelineStageLogs,
  distillPerformanceSignals,
};
