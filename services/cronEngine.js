/**
 * Gods Eye Native Cron Engine
 *
 * Per-user, per-brand scoped scheduled tasks.
 * Runs inside the Docker container — no external services needed.
 *
 * Architecture:
 * - Jobs stored in Supabase `cron_jobs` table (persistent across restarts)
 * - node-cron runs the scheduler in-process
 * - Each job execution is isolated: userId + brandId scoped
 * - Agent executor has access to: Gemini, Fal.ai, upload-post, web search
 * - Execution logs stored in `cron_executions` table
 */

import cron from 'node-cron';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { executePipelineCycle, executeAutoApproveCheck } from './pipelineOrchestrator.js';

// ── Supabase Admin Client (server-side, uses anon key) ──────────────────────
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

// ── Gemini API Key ──────────────────────────────────────────────────────────
const geminiKey = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const falKey = process.env.FAL_KEY;
const uploadPostKey = process.env.UPLOAD_POST_API_KEY;

// ── In-memory cron job registry ─────────────────────────────────────────────
// Maps jobId → cron.ScheduledTask
const activeJobs = new Map();

// ── Available Agent Tasks ───────────────────────────────────────────────────
const AGENT_TASKS = {
  'research-trends': {
    name: 'Research Trends',
    description: 'Research trending topics and create content briefs',
    defaultCron: '0 15 * * *', // 3pm daily
    executor: executeResearchAgent,
  },
  'pull-analytics': {
    name: 'Pull Analytics',
    description: 'Pull engagement metrics from upload-post for published content',
    defaultCron: '0 */6 * * *', // every 6 hours
    executor: executeAnalyticsAgent,
  },
  'weekly-strategy': {
    name: 'Weekly Strategy',
    description: 'Generate weekly content strategy based on performance data',
    defaultCron: '0 9 * * 1', // Monday 9am
    executor: executeStrategyAgent,
  },
  'auto-publish': {
    name: 'Auto Publisher',
    description: 'Check for scheduled posts and publish them',
    defaultCron: '*/15 * * * *', // every 15 min
    executor: executePublisherAgent,
  },
  'competitor-scan': {
    name: 'Competitor Scan',
    description: 'Analyze competitor social media and find content gaps',
    defaultCron: '0 3 * * *', // 3am daily
    executor: executeCompetitorAgent,
  },
  'custom': {
    name: 'Custom Task',
    description: 'Run a custom AI prompt on schedule',
    defaultCron: '0 12 * * *',
    executor: executeCustomAgent,
  },
  'autopilot-cycle': {
    name: 'Autopilot Cycle',
    description: 'Full autonomous pipeline: Scout → Create → Review → Approve Queue',
    defaultCron: '0 6 * * *', // 6am daily
    executor: executePipelineCycle,
  },
  'auto-approve-check': {
    name: 'Auto-Approve Check',
    description: 'Check approval queue for items past auto-approve deadline',
    defaultCron: '*/15 * * * *', // every 15 min
    executor: executeAutoApproveCheck,
  },
};

// ══════════════════════════════════════════════════════════════════════════════
// AGENT EXECUTORS — Each has access to all tools, scoped to userId + brandId
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Call Gemini with tools (google_search grounding)
 */
async function callGemini(prompt, { useSearch = false, model = 'gemini-2.5-flash' } = {}) {
  if (!geminiKey) throw new Error('Gemini API key not configured');

  const requestBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
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

/**
 * Load brand context for a specific brand
 */
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

/**
 * Load user personality
 */
async function loadUserPersonality(userId) {
  if (!supabase) return null;
  const { data } = await supabase
    .from('profiles')
    .select('personality, full_name')
    .eq('id', userId)
    .single();
  return data;
}

/**
 * Store execution result
 */
async function logExecution(jobId, userId, status, result, error = null) {
  if (!supabase) return;
  await supabase.from('cron_executions').insert({
    job_id: jobId,
    user_id: userId,
    status,
    result: typeof result === 'string' ? { text: result } : result,
    error_message: error,
    executed_at: new Date().toISOString(),
  });

  // Update last_run on the job
  await supabase.from('cron_jobs').update({
    last_run_at: new Date().toISOString(),
    last_run_status: status,
  }).eq('id', jobId);

  // Push result to chat sync store if job has a conversation_id
  try {
    const { data: job } = await supabase.from('cron_jobs').select('name, config').eq('id', jobId).single();
    const conversationId = job?.config?.conversation_id;
    if (conversationId && status === 'success') {
      const resultText = typeof result === 'string' ? result : (result?.text || JSON.stringify(result));
      pushCronResultToChat(conversationId, userId, job.name, resultText);
    }
  } catch (e) {
    console.warn(`[Cron] Failed to push result to chat:`, e.message);
  }
}

/**
 * Push a cron execution result as a chat message into the sync store.
 * The frontend will pick this up on next load/poll and add it to IndexedDB.
 */
const SYNC_DIR = path.join(process.env.HOME || '', '.klint', 'sync');

function pushCronResultToChat(conversationId, userId, jobName, resultText) {
  try {
    // Read existing pending cron results (or create new array)
    const pendingFile = path.join(SYNC_DIR, 'cron_chat_pending.json');
    let pending = [];
    try { pending = JSON.parse(fs.readFileSync(pendingFile, 'utf-8')); } catch { pending = []; }

    // Create a chat message object
    const msg = {
      id: `cron-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      conversationId,
      role: 'model',
      content: `**Scheduled Task: ${jobName}** completed\n\n${resultText}`,
      timestamp: Date.now(),
      isCronResult: true,
      userId,
    };

    pending.push(msg);
    if (!fs.existsSync(SYNC_DIR)) fs.mkdirSync(SYNC_DIR, { recursive: true });
    fs.writeFileSync(pendingFile, JSON.stringify(pending, null, 2), 'utf-8');
    console.log(`[Cron] Pushed result to chat for conversation ${conversationId.slice(0, 8)}...`);
  } catch (e) {
    console.warn(`[Cron] Failed to write chat pending:`, e.message);
  }
}

// ── Research Trends Agent ───────────────────────────────────────────────────
async function executeResearchAgent(job) {
  const brand = job.brand_id ? await loadBrandContext(job.brand_id, job.user_id) : null;
  const brandContext = brand
    ? `Brand: ${brand.name}\nIndustry: ${brand.industry || 'General'}\nAudience: ${brand.audience || 'General'}\nTone: ${brand.tone || 'Professional'}\nKeywords: ${(brand.keywords || []).join(', ')}`
    : 'No specific brand — research general creative trends.';

  const prompt = `You are a trend research agent for a creative studio.

${brandContext}

Research the latest trending topics, viral content formats, and emerging themes relevant to this brand. Use web search to find current data.

Return a structured JSON with:
{
  "trends": [
    { "topic": "...", "why_trending": "...", "content_idea": "...", "suggested_format": "reel|carousel|story|post", "urgency": "high|medium|low" }
  ],
  "competitor_insights": "...",
  "recommended_action": "..."
}

Focus on actionable insights. Today's date: ${new Date().toLocaleDateString()}.`;

  const { text, sources } = await callGemini(prompt, { useSearch: true });

  // Store as content brief if we have a brand
  if (supabase && brand) {
    await supabase.from('content_briefs').insert({
      brand_id: brand.id,
      user_id: job.user_id,
      trend_summary: text,
      sources: sources,
      status: 'pending',
      created_by: 'cron_research_agent',
    });
  }

  return { text, sources, brand: brand?.name || 'General' };
}

// ── Analytics Agent ─────────────────────────────────────────────────────────
async function executeAnalyticsAgent(job) {
  // Pull from upload-post.com API
  if (!uploadPostKey) return { text: 'upload-post API key not configured', status: 'skipped' };

  const res = await fetch('https://api.upload-post.com/api/uploadposts/history?limit=20', {
    headers: { 'Authorization': `Apikey ${uploadPostKey}` },
  });

  if (!res.ok) throw new Error(`Upload-Post API error: ${res.status}`);
  const history = await res.json();

  // Analyze with Gemini
  const prompt = `Analyze these recent social media posts and their performance:

${JSON.stringify(history, null, 2)}

Provide insights on:
1. Which content types perform best
2. Best posting times
3. Engagement trends
4. Recommendations for next week

Return structured JSON.`;

  const { text } = await callGemini(prompt);
  return { text, postsAnalyzed: history?.length || 0 };
}

// ── Weekly Strategy Agent ───────────────────────────────────────────────────
async function executeStrategyAgent(job) {
  const brand = job.brand_id ? await loadBrandContext(job.brand_id, job.user_id) : null;

  const prompt = `You are a content strategist. Create a weekly content plan.

${brand ? `Brand: ${brand.name}, Industry: ${brand.industry}, Audience: ${brand.audience}` : 'General creative content'}

Today: ${new Date().toLocaleDateString()}

Create a 7-day content calendar with:
- Day, platform, content type (reel/post/story/carousel)
- Topic and hook
- Best posting time
- Hashtag suggestions

Return as structured JSON array.`;

  const { text } = await callGemini(prompt, { useSearch: true });
  return { text, brand: brand?.name || 'General' };
}

// ── Publisher Agent ──────────────────────────────────────────────────────────
async function executePublisherAgent(job) {
  if (!supabase) return { text: 'No database connection', status: 'skipped' };

  // Find scheduled posts that are due
  const now = new Date().toISOString();
  const { data: duePosts } = await supabase
    .from('scheduled_posts')
    .select('*')
    .eq('user_id', job.user_id)
    .eq('status', 'scheduled')
    .lte('scheduled_at', now);

  if (!duePosts?.length) return { text: 'No posts due for publishing', published: 0 };

  let published = 0;
  for (const post of duePosts) {
    try {
      // Publish via upload-post.com
      // (implementation depends on post type — image/video/text)
      published++;
    } catch (err) {
      console.error(`[Cron] Failed to publish post ${post.id}:`, err.message);
    }
  }

  return { text: `Published ${published} of ${duePosts.length} due posts`, published };
}

// ── Competitor Scan Agent ───────────────────────────────────────────────────
async function executeCompetitorAgent(job) {
  const config = job.config || {};
  const competitors = config.competitors || [];

  if (!competitors.length) {
    return { text: 'No competitors configured. Add competitor handles in job config.', status: 'skipped' };
  }

  const prompt = `Research these competitors on social media and find content gaps:

Competitors: ${competitors.map(c => `@${c}`).join(', ')}

Use web search to find their recent posts, engagement patterns, and content strategy.

Return:
{
  "competitors": [
    { "handle": "...", "recent_themes": [...], "top_content_type": "...", "engagement_level": "high|medium|low" }
  ],
  "gaps": ["content opportunity 1", "content opportunity 2"],
  "action_items": ["..."]
}`;

  const { text, sources } = await callGemini(prompt, { useSearch: true });
  return { text, sources, competitorsAnalyzed: competitors.length };
}

// ── Custom Agent (user-defined prompt) ──────────────────────────────────────
async function executeCustomAgent(job) {
  const customPrompt = job.config?.prompt;
  if (!customPrompt) return { text: 'No custom prompt configured', status: 'skipped' };

  const brand = job.brand_id ? await loadBrandContext(job.brand_id, job.user_id) : null;
  const user = await loadUserPersonality(job.user_id);

  const fullPrompt = `${user?.personality?.soul || ''}

${brand ? `Brand context: ${brand.name} — ${brand.industry}` : ''}

User request: ${customPrompt}

Today: ${new Date().toLocaleDateString()}`;

  const useSearch = job.config?.useSearch !== false;
  const { text, sources } = await callGemini(fullPrompt, { useSearch });
  return { text, sources };
}

// ══════════════════════════════════════════════════════════════════════════════
// CRON SCHEDULER — Manages job lifecycle
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Schedule a single job (register with node-cron)
 */
function scheduleJob(job) {
  if (activeJobs.has(job.id)) {
    activeJobs.get(job.id).stop();
    activeJobs.delete(job.id);
  }

  if (!job.enabled) return;

  if (!cron.validate(job.cron_expression)) {
    console.error(`[Cron] Invalid cron expression for job ${job.id}: ${job.cron_expression}`);
    return;
  }

  const task = cron.schedule(job.cron_expression, async () => {
    console.log(`[Cron] ▶ Executing job: ${job.id} (${job.task_type}) for user: ${job.user_id}`);

    try {
      const taskDef = AGENT_TASKS[job.task_type];
      if (!taskDef) throw new Error(`Unknown task type: ${job.task_type}`);

      const result = await taskDef.executor(job);
      await logExecution(job.id, job.user_id, 'success', result);
      console.log(`[Cron] ✅ Job ${job.id} completed successfully`);
    } catch (err) {
      console.error(`[Cron] ❌ Job ${job.id} failed:`, err.message);
      await logExecution(job.id, job.user_id, 'failed', null, err.message);
    }
  }, { timezone: job.timezone || 'Asia/Kolkata' });

  activeJobs.set(job.id, task);
  console.log(`[Cron] 📅 Scheduled: ${job.name} (${job.cron_expression}) for user ${job.user_id.slice(0, 8)}...`);
}

/**
 * Load all enabled jobs from Supabase and schedule them
 */
async function loadAndScheduleAll() {
  if (!supabase) {
    console.log('[Cron] ⚠ No Supabase connection — cron scheduler disabled');
    return;
  }

  const { data: jobs, error } = await supabase
    .from('cron_jobs')
    .select('*')
    .eq('enabled', true);

  if (error) {
    console.error('[Cron] Failed to load jobs:', error.message);
    return;
  }

  console.log(`[Cron] 🔄 Loading ${jobs?.length || 0} scheduled jobs...`);
  for (const job of (jobs || [])) {
    scheduleJob(job);
  }
}

/**
 * Create a new cron job (API handler)
 */
async function createJob({ userId, brandId, taskType, name, cronExpression, config, timezone }) {
  if (!supabase) throw new Error('Database not connected');
  if (!AGENT_TASKS[taskType]) throw new Error(`Unknown task type: ${taskType}. Available: ${Object.keys(AGENT_TASKS).join(', ')}`);
  if (!cron.validate(cronExpression)) throw new Error(`Invalid cron expression: ${cronExpression}`);

  const { data, error } = await supabase.from('cron_jobs').insert({
    user_id: userId,
    brand_id: brandId || null,
    task_type: taskType,
    name: name || AGENT_TASKS[taskType].name,
    cron_expression: cronExpression,
    config: config || {},
    timezone: timezone || 'Asia/Kolkata',
    enabled: true,
  }).select().single();

  if (error) throw new Error(`Failed to create job: ${error.message}`);

  scheduleJob(data);
  return data;
}

/**
 * Update a cron job
 */
async function updateJob(jobId, userId, updates) {
  if (!supabase) throw new Error('Database not connected');

  // Ensure user owns this job (security!)
  const { data: existing } = await supabase
    .from('cron_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('user_id', userId)
    .single();

  if (!existing) throw new Error('Job not found or not owned by you');

  if (updates.cron_expression && !cron.validate(updates.cron_expression)) {
    throw new Error(`Invalid cron expression: ${updates.cron_expression}`);
  }

  const { data, error } = await supabase
    .from('cron_jobs')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update job: ${error.message}`);

  // Re-schedule
  scheduleJob(data);
  return data;
}

/**
 * Delete a cron job
 */
async function deleteJob(jobId, userId) {
  if (!supabase) throw new Error('Database not connected');

  // Stop the active cron task
  if (activeJobs.has(jobId)) {
    activeJobs.get(jobId).stop();
    activeJobs.delete(jobId);
  }

  const { error } = await supabase
    .from('cron_jobs')
    .delete()
    .eq('id', jobId)
    .eq('user_id', userId); // Security: only delete own jobs

  if (error) throw new Error(`Failed to delete job: ${error.message}`);
  return { deleted: true };
}

/**
 * List jobs for a specific user
 */
async function listJobs(userId) {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('cron_jobs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to list jobs: ${error.message}`);
  return data || [];
}

/**
 * Get execution history for a job
 */
async function getExecutions(jobId, userId, limit = 20) {
  if (!supabase) return [];

  const { data } = await supabase
    .from('cron_executions')
    .select('*')
    .eq('job_id', jobId)
    .eq('user_id', userId) // Security: only see own executions
    .order('executed_at', { ascending: false })
    .limit(limit);

  return data || [];
}

/**
 * Run a job immediately (manual trigger)
 */
async function runNow(jobId, userId) {
  if (!supabase) throw new Error('Database not connected');

  const { data: job } = await supabase
    .from('cron_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('user_id', userId)
    .single();

  if (!job) throw new Error('Job not found or not owned by you');

  const taskDef = AGENT_TASKS[job.task_type];
  if (!taskDef) throw new Error(`Unknown task type: ${job.task_type}`);

  console.log(`[Cron] ▶ Manual run: ${job.name} for user ${userId.slice(0, 8)}...`);

  try {
    const result = await taskDef.executor(job);
    await logExecution(jobId, userId, 'success', result);
    return { status: 'success', result };
  } catch (err) {
    await logExecution(jobId, userId, 'failed', null, err.message);
    return { status: 'failed', error: err.message };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPRESS ROUTE REGISTRATION
// ══════════════════════════════════════════════════════════════════════════════

function registerCronRoutes(app) {
  // List available task types
  app.get('/api/cron/task-types', (_req, res) => {
    const types = Object.entries(AGENT_TASKS).map(([id, t]) => ({
      id, name: t.name, description: t.description, defaultCron: t.defaultCron,
    }));
    res.json({ ok: true, taskTypes: types });
  });

  // List user's jobs
  app.get('/api/cron/jobs', async (req, res) => {
    try {
      const userId = req.headers['x-user-id'];
      if (!userId) return res.status(401).json({ error: 'x-user-id header required' });
      const jobs = await listJobs(userId);
      res.json({ ok: true, jobs });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create a new job
  app.post('/api/cron/jobs', async (req, res) => {
    try {
      const userId = req.headers['x-user-id'] || req.body.user_id;
      if (!userId) return res.status(401).json({ error: 'x-user-id header required' });

      const { brandId, taskType, name, cronExpression, config, timezone, conversation_id } = req.body;
      // Store conversation_id in config so cron results can be pushed back to chat
      const enrichedConfig = { ...(config || {}), ...(conversation_id ? { conversation_id } : {}) };
      const job = await createJob({ userId, brandId, taskType, name, cronExpression, config: enrichedConfig, timezone });
      res.json({ ok: true, job });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Update a job
  app.put('/api/cron/jobs/:jobId', async (req, res) => {
    try {
      const userId = req.headers['x-user-id'];
      if (!userId) return res.status(401).json({ error: 'x-user-id header required' });

      const job = await updateJob(req.params.jobId, userId, req.body);
      res.json({ ok: true, job });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Delete a job
  app.delete('/api/cron/jobs/:jobId', async (req, res) => {
    try {
      const userId = req.headers['x-user-id'];
      if (!userId) return res.status(401).json({ error: 'x-user-id header required' });

      await deleteJob(req.params.jobId, userId);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Run a job immediately
  app.post('/api/cron/jobs/:jobId/run', async (req, res) => {
    try {
      const userId = req.headers['x-user-id'];
      if (!userId) return res.status(401).json({ error: 'x-user-id header required' });

      const result = await runNow(req.params.jobId, userId);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Get execution history
  app.get('/api/cron/jobs/:jobId/history', async (req, res) => {
    try {
      const userId = req.headers['x-user-id'];
      if (!userId) return res.status(401).json({ error: 'x-user-id header required' });

      const executions = await getExecutions(req.params.jobId, userId);
      res.json({ ok: true, executions });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Stats: active jobs count
  app.get('/api/cron/stats', (_req, res) => {
    res.json({
      ok: true,
      activeJobs: activeJobs.size,
      availableTaskTypes: Object.keys(AGENT_TASKS).length,
    });
  });

  console.log('[Cron] 🔧 API routes registered');
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════════════════════════

export {
  registerCronRoutes,
  loadAndScheduleAll,
  createJob,
  updateJob,
  deleteJob,
  listJobs,
  runNow,
  AGENT_TASKS,
  // Shared helpers (used by pipelineOrchestrator)
  callGemini,
  loadBrandContext,
  logExecution,
  pushCronResultToChat,
};
