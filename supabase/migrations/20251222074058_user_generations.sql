-- User Generations Tracking
CREATE TABLE IF NOT EXISTS user_generations (
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

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_generations_user_date ON user_generations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_generations_type ON user_generations(user_id, type);

-- Enable RLS
ALTER TABLE user_generations ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own generations"
  ON user_generations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own generations"
  ON user_generations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own generations"
  ON user_generations FOR DELETE
  USING (auth.uid() = user_id);

-- Service role full access
CREATE POLICY "Service role full access to generations"
  ON user_generations FOR ALL
  USING (auth.role() = 'service_role');
