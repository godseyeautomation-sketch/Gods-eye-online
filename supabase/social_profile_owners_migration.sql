-- ─────────────────────────────────────────────────────────────────────────────
-- social_profile_owners — per-user isolation for upload-post.com profiles
-- ─────────────────────────────────────────────────────────────────────────────
-- Context: Gods Eye Online uses a SINGLE shared upload-post.com workspace for
-- every user. Without a tenancy layer every Gods Eye user sees every other
-- user's connected profile (e.g. `bitan_marketing` appearing in someone else's
-- dashboard). This table maps each upload-post username to the Gods Eye user
-- who created it, so the server can filter the upload-post.com response down
-- to just what the caller owns.
--
-- How to apply:
--   Open Supabase Dashboard → SQL Editor → paste the contents of this file →
--   click Run. Safe to re-run (all CREATEs use IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.social_profile_owners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    upload_post_username TEXT NOT NULL UNIQUE,  -- each upload-post profile has one owner
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Fast lookups when filtering "which profiles does user X own"
CREATE INDEX IF NOT EXISTS idx_social_profile_owners_user_id
    ON public.social_profile_owners(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Access model (option b): RLS is intentionally NOT enabled on this table.
-- The table is never queried directly from the client. It's only read/written
-- by the Gods Eye server, which enforces per-user filtering using the caller's
-- x-user-id header in every query. This keeps the setup simple and works with
-- the existing anon-key server config (no service-role key required).
--
-- If direct client access is ever needed later, flip RLS on and add policies
-- that enforce auth.uid() = user_id for SELECT/INSERT/DELETE.
-- ─────────────────────────────────────────────────────────────────────────────

-- Done. Verify with:
--   SELECT user_id, upload_post_username, created_at FROM public.social_profile_owners;
