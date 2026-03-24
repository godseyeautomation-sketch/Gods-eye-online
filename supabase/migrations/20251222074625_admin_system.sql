-- Video Effects Library
CREATE TABLE IF NOT EXISTS video_effects (
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

-- API Configuration
CREATE TABLE IF NOT EXISTS api_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key TEXT UNIQUE NOT NULL,
  config_value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default API config
INSERT INTO api_config (config_key, config_value) VALUES
  ('default_model', '{"value": "gemini-3-pro-image-preview", "label": "Nano Banana Pro"}'),
  ('safety_filter', '{"value": "medium", "label": "Medium"}'),
  ('max_batch_size', '{"value": 4}')
ON CONFLICT (config_key) DO NOTHING;

-- Usage Analytics
CREATE TABLE IF NOT EXISTS usage_analytics (
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

-- Function to calculate daily costs
CREATE OR REPLACE FUNCTION get_daily_costs(days_back INT DEFAULT 7)
RETURNS TABLE(date DATE, total_cost_inr DECIMAL, image_count BIGINT, video_count BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    DATE(created_at) as date,
    SUM(cost_inr) as total_cost_inr,
    COUNT(*) FILTER (WHERE action_type = 'image') as image_count,
    COUNT(*) FILTER (WHERE action_type = 'video') as video_count
  FROM usage_analytics
  WHERE created_at >= NOW() - (days_back || ' days')::INTERVAL
  GROUP BY DATE(created_at)
  ORDER BY date DESC;
END;
$$ LANGUAGE plpgsql;

-- Enable RLS
ALTER TABLE video_effects ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_analytics ENABLE ROW LEVEL SECURITY;

-- RLS Policies for video_effects (public read, admin write)
CREATE POLICY "Anyone can view active video effects"
  ON video_effects FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admins can manage video effects"
  ON video_effects FOR ALL
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true
  ));

-- RLS Policies for api_config (admin only)
CREATE POLICY "Admins can view api config"
  ON api_config FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true
  ));

CREATE POLICY "Admins can update api config"
  ON api_config FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true
  ));

-- RLS Policies for usage_analytics
CREATE POLICY "Users can view own analytics"
  ON usage_analytics FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all analytics"
  ON usage_analytics FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true
  ));

-- Service role full access
CREATE POLICY "Service role full access to video effects"
  ON video_effects FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access to api config"
  ON api_config FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access to usage analytics"
  ON usage_analytics FOR ALL
  USING (auth.role() = 'service_role');
