-- ============================================================
-- GODS EYE ONLINE — Full Database Migration
-- Run this in Supabase Dashboard > SQL Editor
-- ============================================================

-- ============================================================
-- 1. PROFILES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid references auth.users on delete cascade not null primary key,
  email text,
  full_name text,
  avatar_url text,
  credits int default 50,
  tier text default 'free',
  is_admin boolean default false,
  can_use_byok boolean default false,
  can_use_video boolean default false,
  can_use_spaces boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (new.id, new.email, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Admin check function (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND (is_admin = true OR tier = 'admin')
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- Admin policies for profiles
CREATE POLICY "Admins can view all profiles" ON public.profiles
  FOR SELECT USING (public.is_admin() OR auth.uid() = id);

CREATE POLICY "Admins can update all profiles" ON public.profiles
  FOR UPDATE USING (public.is_admin());

-- Indexes
CREATE INDEX IF NOT EXISTS idx_profiles_can_use_byok ON public.profiles(can_use_byok);

-- ============================================================
-- 2. GENERATIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.generations (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  type text not null,
  prompt text,
  model text,
  url text,
  credits_cost int default 0,
  created_at timestamp with time zone default now()
);

ALTER TABLE public.generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own generations" ON public.generations
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own generations" ON public.generations
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 3. USER GENERATIONS TABLE (extended)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('image', 'video', 'character')),
  content_url TEXT NOT NULL,
  thumbnail_url TEXT,
  title TEXT,
  prompt TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_generations_user_date ON user_generations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_generations_type ON user_generations(user_id, type);

ALTER TABLE user_generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own user_generations" ON user_generations
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own user_generations" ON user_generations
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own user_generations" ON user_generations
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to generations" ON user_generations
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- 4. BRAND PROFILES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.brand_profiles (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  tagline text not null default '',
  industry text not null default '',
  audience text not null default '',
  tone text[] not null default '{}',
  colors text[] not null default '{}',
  visual_style text not null default '',
  keywords text[] not null default '{}',
  avoid text[] not null default '{}',
  example_images text[] not null default '{}',
  product_images text[] not null default '{}',
  lifestyle_images text[] not null default '{}',
  products jsonb default '[]',
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique(user_id)
);

ALTER TABLE public.brand_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own brand" ON public.brand_profiles
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own brand" ON public.brand_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own brand" ON public.brand_profiles
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own brand" ON public.brand_profiles
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- 5. CONTENT SLOTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.content_slots (
  id uuid default gen_random_uuid() primary key,
  brand_id uuid references public.brand_profiles on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  slot_date date not null,
  format text not null check (format in ('post', 'story', 'reel')),
  status text not null default 'empty' check (status in ('empty', 'ideated', 'briefed', 'generated', 'approved')),
  idea text not null default '',
  brief jsonb,
  generated_image text,
  approved boolean not null default false,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique(brand_id, slot_date, format)
);

ALTER TABLE public.content_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own slots" ON public.content_slots
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own slots" ON public.content_slots
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own slots" ON public.content_slots
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own slots" ON public.content_slots
  FOR DELETE USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.handle_brand_updated_at()
RETURNS trigger AS $$
BEGIN
  new.updated_at = now();
  RETURN new;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_slot_updated
  BEFORE UPDATE ON public.content_slots
  FOR EACH ROW EXECUTE PROCEDURE public.handle_brand_updated_at();

-- ============================================================
-- 6. WORKFLOWS TABLE (Spaces)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.workflows (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null default 'Untitled Space',
  nodes jsonb not null default '[]'::jsonb,
  edges jsonb not null default '[]'::jsonb,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own workflows" ON public.workflows
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own workflows" ON public.workflows
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own workflows" ON public.workflows
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own workflows" ON public.workflows
  FOR DELETE USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.handle_workflow_updated_at()
RETURNS trigger AS $$
BEGIN
  new.updated_at = now();
  RETURN new;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_workflow_updated
  BEFORE UPDATE ON public.workflows
  FOR EACH ROW EXECUTE PROCEDURE public.handle_workflow_updated_at();

-- ============================================================
-- 7. CHARACTER SYSTEM
-- ============================================================
CREATE TABLE IF NOT EXISTS public.characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  thumbnail_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.character_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.character_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own characters" ON public.characters
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own characters" ON public.characters
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own characters" ON public.characters
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own characters" ON public.characters
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own character images" ON public.character_images
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.characters WHERE characters.id = character_images.character_id AND characters.user_id = auth.uid()
  ));
CREATE POLICY "Users can insert own character images" ON public.character_images
  FOR INSERT WITH CHECK (EXISTS (
    SELECT 1 FROM public.characters WHERE characters.id = character_images.character_id AND characters.user_id = auth.uid()
  ));
CREATE POLICY "Users can delete own character images" ON public.character_images
  FOR DELETE USING (EXISTS (
    SELECT 1 FROM public.characters WHERE characters.id = character_images.character_id AND characters.user_id = auth.uid()
  ));

CREATE INDEX IF NOT EXISTS idx_characters_user_id ON public.characters(user_id);
CREATE INDEX IF NOT EXISTS idx_character_images_character_id ON public.character_images(character_id);

-- ============================================================
-- 8. ADMIN SYSTEM (video effects, api config, analytics)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.video_effects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  thumbnail_url TEXT,
  prompt_template TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_effects_active ON video_effects(is_active, category);

CREATE TABLE IF NOT EXISTS public.api_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key TEXT UNIQUE NOT NULL,
  config_value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO api_config (config_key, config_value) VALUES
  ('default_model', '{"value": "gemini-3-pro-image-preview", "label": "Nano Banana Pro"}'),
  ('safety_filter', '{"value": "medium", "label": "Medium"}'),
  ('max_batch_size', '{"value": 4}')
ON CONFLICT (config_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.usage_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN ('image', 'video', 'character', 'edit')),
  model_used TEXT,
  quality TEXT,
  cost_inr DECIMAL(10, 2),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_date ON usage_analytics(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_analytics(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_type ON usage_analytics(action_type, created_at DESC);

-- Daily costs function
CREATE OR REPLACE FUNCTION get_daily_costs(days_back INT DEFAULT 7)
RETURNS TABLE(date DATE, total_cost_inr DECIMAL, image_count BIGINT, video_count BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT
    DATE(ua.created_at) as date,
    SUM(ua.cost_inr) as total_cost_inr,
    COUNT(*) FILTER (WHERE ua.action_type = 'image') as image_count,
    COUNT(*) FILTER (WHERE ua.action_type = 'video') as video_count
  FROM usage_analytics ua
  WHERE ua.created_at >= NOW() - (days_back || ' days')::INTERVAL
  GROUP BY DATE(ua.created_at)
  ORDER BY date DESC;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE video_effects ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active video effects" ON video_effects
  FOR SELECT USING (is_active = true);

CREATE POLICY "Admins can manage video effects" ON video_effects
  FOR ALL USING (public.is_admin());

CREATE POLICY "Admins can view api config" ON api_config
  FOR SELECT USING (public.is_admin());

CREATE POLICY "Admins can update api config" ON api_config
  FOR UPDATE USING (public.is_admin());

CREATE POLICY "Users can view own analytics" ON usage_analytics
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all analytics" ON usage_analytics
  FOR SELECT USING (public.is_admin());

CREATE POLICY "Service role full access to video effects" ON video_effects
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access to api config" ON api_config
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access to usage analytics" ON usage_analytics
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- 9. COST TRACKING TRIGGERS
-- ============================================================
CREATE OR REPLACE FUNCTION handle_generation_cost()
RETURNS TRIGGER AS $$
DECLARE
    user_tier TEXT;
    user_credits INTEGER;
    cost INTEGER;
    provider TEXT;
BEGIN
    provider := (NEW.metadata->>'provider');
    IF provider = 'external' THEN
        RETURN NEW;
    END IF;

    SELECT tier, credits INTO user_tier, user_credits
    FROM public.profiles WHERE id = NEW.user_id;

    IF user_tier = 'admin' THEN
        RETURN NEW;
    END IF;

    IF NEW.type = 'video' THEN
        cost := 5;
    ELSE
        cost := 1;
    END IF;

    IF user_credits < cost THEN
        RAISE EXCEPTION 'Insufficient credits. Required: %, Available: %', cost, user_credits;
    END IF;

    UPDATE public.profiles SET credits = credits - cost WHERE id = NEW.user_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_generation_created ON public.user_generations;
CREATE TRIGGER on_generation_created
  BEFORE INSERT ON public.user_generations
  FOR EACH ROW EXECUTE FUNCTION handle_generation_cost();

-- Analytics logging trigger
CREATE OR REPLACE FUNCTION log_generation_completion()
RETURNS TRIGGER AS $$
DECLARE
    gen_cost DECIMAL(10, 2);
    quality TEXT;
    model TEXT;
BEGIN
    quality := (NEW.metadata->>'quality');
    model := (NEW.metadata->>'model');

    IF NEW.type = 'video' THEN
        gen_cost := 66.64;
    ELSE
        gen_cost := 3.33;
    END IF;

    INSERT INTO public.usage_analytics (user_id, action_type, model_used, quality, cost_inr, metadata)
    VALUES (NEW.user_id, NEW.type, model, COALESCE(quality, 'Standard'), gen_cost, NEW.metadata);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_generation_completed ON public.user_generations;
CREATE TRIGGER on_generation_completed
  AFTER INSERT ON public.user_generations
  FOR EACH ROW EXECUTE FUNCTION log_generation_completion();

-- ============================================================
-- 10. EXPLORE ITEMS
-- ============================================================
DO $$ BEGIN
  CREATE TYPE explore_item_type AS ENUM ('hero', 'top_choice', 'visual_effect', 'quick_action');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.explore_items (
  id uuid not null default gen_random_uuid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone default now(),
  type explore_item_type not null,
  title text,
  subtitle text,
  image_url text,
  video_url text,
  prompt_template text,
  is_active boolean default true,
  display_order integer default 0,
  metadata jsonb default '{}'::jsonb,
  constraint explore_items_pkey primary key (id)
);

ALTER TABLE public.explore_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Explore items are viewable by everyone" ON public.explore_items
  FOR SELECT USING (true);

CREATE POLICY "Admins can insert explore items" ON public.explore_items
  FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update explore items" ON public.explore_items
  FOR UPDATE USING (public.is_admin());

CREATE POLICY "Admins can delete explore items" ON public.explore_items
  FOR DELETE USING (public.is_admin());

-- Seed explore data
INSERT INTO public.explore_items (type, title, subtitle, image_url, display_order, metadata)
VALUES
  ('hero', 'Unleash Creative Power', 'Get unlimited access to Nano Banana Pro and our new video generation models.', 'https://picsum.photos/1920/1080?random=hero', 0, '{"badge": "PROMO . v2", "tag": "Launch Special"}'::jsonb),
  ('top_choice', 'Gemini 3.0 Pro', 'Best 4K image model ever', 'https://picsum.photos/400/400?random=10', 0, '{"tag": "UNLIMITED"}'::jsonb)
ON CONFLICT DO NOTHING;

-- ============================================================
-- DONE! All tables, policies, triggers, and seed data created.
-- ============================================================
