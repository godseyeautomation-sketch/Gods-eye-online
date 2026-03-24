-- Gods Eye Connectors — OAuth token storage per user
-- Run this migration to add connector support

CREATE TABLE IF NOT EXISTS public.user_connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  auth_type TEXT NOT NULL DEFAULT 'oauth',
  access_token TEXT,
  refresh_token TEXT,
  api_key TEXT,
  token_expires_at TIMESTAMPTZ,
  account_info JSONB DEFAULT '{}',
  scopes TEXT[] DEFAULT '{}',
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, platform)
);

ALTER TABLE public.user_connectors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own connectors"
  ON public.user_connectors FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own connectors"
  ON public.user_connectors FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own connectors"
  ON public.user_connectors FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own connectors"
  ON public.user_connectors FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_user_connectors_user ON public.user_connectors(user_id);
CREATE INDEX IF NOT EXISTS idx_user_connectors_platform ON public.user_connectors(user_id, platform);
