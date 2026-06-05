-- =============================================================================
-- Instagram-Style Post Carousel Migration
-- Run after supabase-migration-posts-feed.sql.
-- =============================================================================

ALTER TABLE posts
ADD COLUMN IF NOT EXISTS aspect_ratio TEXT DEFAULT 'square' NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'posts_aspect_ratio_check'
      AND conrelid = 'posts'::regclass
  ) THEN
    ALTER TABLE posts
    ADD CONSTRAINT posts_aspect_ratio_check
    CHECK (aspect_ratio IN ('portrait', 'square', 'landscape'));
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS post_media (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  media_url TEXT NOT NULL,
  media_path TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  position INT NOT NULL CHECK (position >= 0 AND position < 10),
  width INT,
  height INT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE (post_id, position)
);

CREATE INDEX IF NOT EXISTS idx_post_media_post_id_position ON post_media(post_id, position);

ALTER TABLE post_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view post media" ON post_media;
DROP POLICY IF EXISTS "Users can create media for own posts" ON post_media;
DROP POLICY IF EXISTS "Users can delete media for own posts" ON post_media;

CREATE POLICY "Authenticated users can view post media"
  ON post_media FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = post_media.post_id
    )
  );

CREATE POLICY "Users can create media for own posts"
  ON post_media FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = post_media.post_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete media for own posts"
  ON post_media FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = post_media.post_id
        AND p.user_id = auth.uid()
    )
  );

INSERT INTO post_media (
  post_id,
  media_url,
  media_path,
  media_type,
  position,
  created_at
)
SELECT
  p.id,
  p.media_url,
  p.media_path,
  p.media_type,
  0,
  p.created_at
FROM posts p
WHERE NOT EXISTS (
  SELECT 1
  FROM post_media pm
  WHERE pm.post_id = p.id
    AND pm.position = 0
);

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE post_media;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;
