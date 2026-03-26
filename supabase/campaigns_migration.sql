-- Gods Eye Ad Campaigns — Track synced campaigns + pushed creatives per user
-- Run this migration after connectors_migration.sql

-- Campaigns synced from or created via Gods Eye
CREATE TABLE IF NOT EXISTS public.ad_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id UUID,
  platform TEXT NOT NULL,  -- 'google_ads' | 'meta_ads'
  external_campaign_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'PAUSED',
  objective TEXT,
  daily_budget_cents INTEGER,
  lifetime_budget_cents INTEGER,
  -- Cached metrics (refreshed on sync)
  impressions BIGINT DEFAULT 0,
  clicks BIGINT DEFAULT 0,
  spend_cents BIGINT DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  ctr NUMERIC(6,4) DEFAULT 0,
  cpc_cents INTEGER DEFAULT 0,
  roas NUMERIC(8,4) DEFAULT 0,
  metrics_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, platform, external_campaign_id)
);

ALTER TABLE public.ad_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own campaigns"
  ON public.ad_campaigns FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own campaigns"
  ON public.ad_campaigns FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own campaigns"
  ON public.ad_campaigns FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own campaigns"
  ON public.ad_campaigns FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ad_campaigns_user ON public.ad_campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_user_platform ON public.ad_campaigns(user_id, platform);
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_user_brand ON public.ad_campaigns(user_id, brand_id);

-- Creatives pushed from Gods Eye to ad platforms
CREATE TABLE IF NOT EXISTS public.ad_creatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id UUID,
  campaign_id UUID REFERENCES public.ad_campaigns(id) ON DELETE SET NULL,
  content_slot_id UUID,
  platform TEXT NOT NULL,
  external_asset_id TEXT,
  image_url TEXT NOT NULL,
  asset_name TEXT,
  status TEXT DEFAULT 'uploaded',  -- uploaded, active, rejected, removed
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.ad_creatives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own creatives"
  ON public.ad_creatives FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own creatives"
  ON public.ad_creatives FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own creatives"
  ON public.ad_creatives FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own creatives"
  ON public.ad_creatives FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ad_creatives_user ON public.ad_creatives(user_id);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_campaign ON public.ad_creatives(campaign_id);
