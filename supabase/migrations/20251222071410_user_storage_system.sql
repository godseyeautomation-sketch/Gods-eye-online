-- User Storage Quota Tracking
CREATE TABLE IF NOT EXISTS user_storage_quota (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  total_bytes BIGINT DEFAULT 0,
  max_bytes BIGINT DEFAULT 1073741824, -- 1GB limit
  last_cleanup TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Stored Media Files Tracking
CREATE TABLE IF NOT EXISTS stored_media_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_type TEXT NOT NULL CHECK (file_type IN ('image', 'video')),
  file_url TEXT NOT NULL,
  original_size BIGINT NOT NULL,
  compressed_size BIGINT NOT NULL,
  compression_ratio DECIMAL(5,2),
  ftp_path TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_storage_quota_total ON user_storage_quota(total_bytes);
CREATE INDEX IF NOT EXISTS idx_stored_media_user_date ON stored_media_files(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stored_media_user_size ON stored_media_files(user_id, compressed_size);

-- Function to update storage quota
CREATE OR REPLACE FUNCTION update_user_storage_quota()
RETURNS TRIGGER AS $$
BEGIN
  -- Update total bytes for the user
  INSERT INTO user_storage_quota (user_id, total_bytes)
  VALUES (NEW.user_id, NEW.compressed_size)
  ON CONFLICT (user_id)
  DO UPDATE SET
    total_bytes = user_storage_quota.total_bytes + NEW.compressed_size,
    updated_at = NOW();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update quota on file insert
CREATE TRIGGER trigger_update_storage_quota
AFTER INSERT ON stored_media_files
FOR EACH ROW
EXECUTE FUNCTION update_user_storage_quota();

-- Function to handle file deletion quota update
CREATE OR REPLACE FUNCTION decrease_user_storage_quota()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE user_storage_quota
  SET
    total_bytes = GREATEST(0, total_bytes - OLD.compressed_size),
    updated_at = NOW()
  WHERE user_id = OLD.user_id;
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-decrease quota on file delete
CREATE TRIGGER trigger_decrease_storage_quota
AFTER DELETE ON stored_media_files
FOR EACH ROW
EXECUTE FUNCTION decrease_user_storage_quota();

-- Enable RLS
ALTER TABLE user_storage_quota ENABLE ROW LEVEL SECURITY;
ALTER TABLE stored_media_files ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own storage quota"
  ON user_storage_quota FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own media files"
  ON stored_media_files FOR SELECT
  USING (auth.uid() = user_id);

-- Service role can do everything (for Edge Functions)
CREATE POLICY "Service role full access to storage quota"
  ON user_storage_quota FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access to media files"
  ON stored_media_files FOR ALL
  USING (auth.role() = 'service_role');
