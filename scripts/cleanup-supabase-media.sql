-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- This permanently deletes all base64 image blobs stored in Supabase.
-- Safe to run — generated images are now stored locally on the user's computer (IndexedDB).

-- 1. Delete all rows from user_generations (base64 images stored here before the fix)
DELETE FROM user_generations;

-- 2. Clear generated_image column in content_slots (brand calendar images)
--    Rows are kept so calendar structure is preserved, only the image blob is removed.
UPDATE content_slots SET generated_image = NULL WHERE generated_image IS NOT NULL;

-- 3. (Optional) Check remaining data sizes
SELECT
  'user_generations' AS table_name,
  COUNT(*) AS rows,
  pg_size_pretty(pg_total_relation_size('user_generations')) AS size
UNION ALL
SELECT
  'content_slots',
  COUNT(*),
  pg_size_pretty(pg_total_relation_size('content_slots'))
FROM content_slots;
