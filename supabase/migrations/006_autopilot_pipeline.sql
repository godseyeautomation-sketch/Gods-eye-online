-- ══════════════════════════════════════════════════════════════════════════════
-- Gods Eye Studio — Autopilot Pipeline Tables
-- Migration 006: Pipeline runs, stage logs, approval queue, performance signals,
--                content embeddings (pgvector), content_slots extensions
-- ══════════════════════════════════════════════════════════════════════════════

-- Enable pgvector for embedding-based deduplication
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Pipeline Runs: tracks each full autopilot cycle ────────────────────────
CREATE TABLE IF NOT EXISTS public.pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'running', -- running, completed, failed, paused
  current_stage TEXT DEFAULT 'scout',     -- scout, create, review, approve, publish, analyze
  config JSONB DEFAULT '{}',              -- { platforms[], post_count, auto_approve_hours, enable_ab_test, competitors[] }
  stage_summary JSONB DEFAULT '{}',       -- brief summary per stage: { scout: {...}, create: {...}, ... }
  error_message TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own pipeline runs"
  ON public.pipeline_runs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own pipeline runs"
  ON public.pipeline_runs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own pipeline runs"
  ON public.pipeline_runs FOR UPDATE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_user ON public.pipeline_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_brand ON public.pipeline_runs(brand_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON public.pipeline_runs(status) WHERE status = 'running';

-- ── Pipeline Stage Logs: per-stage execution trace ─────────────────────────
CREATE TABLE IF NOT EXISTS public.pipeline_stage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_run_id UUID NOT NULL REFERENCES public.pipeline_runs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,     -- scout, create, review, approve, publish, analyze
  status TEXT NOT NULL DEFAULT 'pending', -- pending, running, completed, failed, skipped
  input JSONB DEFAULT '{}',
  output JSONB DEFAULT '{}',
  duration_ms INT DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

ALTER TABLE public.pipeline_stage_logs ENABLE ROW LEVEL SECURITY;

-- Stage logs are accessed through pipeline_runs, so policy checks the parent
CREATE POLICY "Users can view own stage logs"
  ON public.pipeline_stage_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.pipeline_runs pr
      WHERE pr.id = pipeline_run_id AND pr.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can insert own stage logs"
  ON public.pipeline_stage_logs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.pipeline_runs pr
      WHERE pr.id = pipeline_run_id AND pr.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_stage_logs_run ON public.pipeline_stage_logs(pipeline_run_id);

-- ── Approval Queue: HITL items with quality scores ─────────────────────────
CREATE TABLE IF NOT EXISTS public.approval_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL,
  pipeline_run_id UUID REFERENCES public.pipeline_runs(id) ON DELETE SET NULL,
  -- Slot reference (brand_id + slot_date + format uniquely identify a slot)
  slot_id TEXT,          -- ContentSlot.id
  slot_date TEXT,
  format TEXT,           -- post, story, reel
  -- A/B testing
  variant_group TEXT,    -- groups A/B variants together (UUID or slug)
  variant_label TEXT,    -- 'A', 'B', or null for non-AB items
  -- Content snapshot (so approvers see what was generated)
  brief JSONB,
  generated_image TEXT,
  caption_preview TEXT,  -- first 200 chars of built caption for quick scan
  -- Quality gate results
  quality_scores JSONB DEFAULT '{}',  -- { hook, brand_voice, cta_clarity, uniqueness, overall }
  guardrail_flags JSONB DEFAULT '{}', -- { compliance_ok, issues[] }
  dedup_score FLOAT DEFAULT 0,        -- max cosine similarity to existing content
  -- Status
  status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected, auto_approved, expired
  auto_approve_at TIMESTAMPTZ,        -- created_at + config.auto_approve_hours
  reviewer_notes TEXT,
  -- Publishing config (set on approval)
  publish_platforms TEXT[] DEFAULT '{}',
  publish_scheduled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

ALTER TABLE public.approval_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own approval queue"
  ON public.approval_queue FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own approval queue"
  ON public.approval_queue FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own approval queue"
  ON public.approval_queue FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own approval queue"
  ON public.approval_queue FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_approval_queue_user ON public.approval_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_approval_queue_brand ON public.approval_queue(brand_id);
CREATE INDEX IF NOT EXISTS idx_approval_queue_status ON public.approval_queue(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_approval_queue_variant ON public.approval_queue(variant_group) WHERE variant_group IS NOT NULL;

-- ── Performance Signals: distilled analytics for feedback loop ─────────────
CREATE TABLE IF NOT EXISTS public.performance_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  top_posts JSONB DEFAULT '[]',       -- [ { slot_date, format, engagement_rate, content_type, hook } ]
  bottom_posts JSONB DEFAULT '[]',    -- same structure for underperformers
  signals JSONB DEFAULT '{}',         -- { what_worked, what_to_stop, themes, best_formats, best_times }
  generated_briefs JSONB DEFAULT '[]', -- 4 winner-inspired + 1 experimental brief
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.performance_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own signals"
  ON public.performance_signals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own signals"
  ON public.performance_signals FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_perf_signals_brand ON public.performance_signals(brand_id);
CREATE INDEX IF NOT EXISTS idx_perf_signals_period ON public.performance_signals(period_end DESC);

-- ── Content Embeddings: server-side dedup via pgvector ─────────────────────
CREATE TABLE IF NOT EXISTS public.content_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL,
  content_hash TEXT NOT NULL,        -- SHA256 of hook + caption_prefix
  embedding VECTOR(768),             -- Gemini embedding-2-preview (768-dim)
  source_type TEXT DEFAULT 'brief',  -- brief, caption, idea
  source_date TEXT,                  -- ISO date the content is for
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.content_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own embeddings"
  ON public.content_embeddings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own embeddings"
  ON public.content_embeddings FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_embeddings_brand ON public.content_embeddings(brand_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_date ON public.content_embeddings(created_at DESC);

-- ── Extend content_slots with pipeline integration columns ─────────────────
ALTER TABLE public.content_slots ADD COLUMN IF NOT EXISTS pipeline_run_id UUID;
ALTER TABLE public.content_slots ADD COLUMN IF NOT EXISTS quality_scores JSONB;
ALTER TABLE public.content_slots ADD COLUMN IF NOT EXISTS guardrail_flags JSONB;
ALTER TABLE public.content_slots ADD COLUMN IF NOT EXISTS dedup_score FLOAT;
ALTER TABLE public.content_slots ADD COLUMN IF NOT EXISTS variant_of TEXT;
ALTER TABLE public.content_slots ADD COLUMN IF NOT EXISTS performance_data JSONB;

-- ── Helper function: cosine similarity search for dedup ────────────────────
CREATE OR REPLACE FUNCTION match_content_embeddings(
  query_embedding VECTOR(768),
  match_brand_id UUID,
  match_threshold FLOAT DEFAULT 0.85,
  match_count INT DEFAULT 5,
  days_back INT DEFAULT 30
)
RETURNS TABLE (
  id UUID,
  content_hash TEXT,
  source_type TEXT,
  source_date TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ce.id,
    ce.content_hash,
    ce.source_type,
    ce.source_date,
    (1 - (ce.embedding <=> query_embedding))::FLOAT AS similarity
  FROM public.content_embeddings ce
  WHERE ce.brand_id = match_brand_id
    AND ce.created_at > NOW() - (days_back || ' days')::INTERVAL
  ORDER BY ce.embedding <=> query_embedding ASC
  LIMIT match_count;
END;
$$;
