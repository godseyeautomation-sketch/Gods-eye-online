-- ─────────────────────────────────────────────────────────────────────────────
-- brand_slack_integrations — per-brand Slack OAuth connection storage
-- ─────────────────────────────────────────────────────────────────────────────
-- One row per (brand_id, slack_team_id) pair. Stores the bot token issued
-- to that team via OAuth so the Review agent can post to the user's chosen
-- channel without us having to hold a single workspace-wide token.
--
-- Once a row exists, Review uses THIS token instead of the SLACK_BOT_TOKEN
-- env var. So users connecting their own workspace via the "Add to Slack"
-- button don't share a workspace with anyone else.
--
-- Apply: paste into Supabase SQL Editor → Run.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.brand_slack_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    brand_id TEXT NOT NULL,
    slack_team_id TEXT NOT NULL,
    slack_team_name TEXT,
    slack_channel_id TEXT NOT NULL,
    slack_channel_name TEXT,
    bot_token TEXT NOT NULL,         -- xoxb-... per workspace
    bot_user_id TEXT,
    authed_user_id TEXT,
    scopes TEXT[],
    installed_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(brand_id, slack_team_id)
);

CREATE INDEX IF NOT EXISTS idx_brand_slack_integrations_brand_id
    ON public.brand_slack_integrations(brand_id);
CREATE INDEX IF NOT EXISTS idx_brand_slack_integrations_user_id
    ON public.brand_slack_integrations(user_id);

-- RLS off — server-only access via service role (same pattern as
-- social_profile_owners). bot_token is sensitive; never expose to clients.

-- Verify with:
--   SELECT brand_id, slack_team_name, slack_channel_name, installed_at
--   FROM public.brand_slack_integrations;
