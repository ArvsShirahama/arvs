  -- =============================================================================
  -- Public Feed + Posts MVP Migration
  -- Run after profile/auth base setup and storage policies are available.
  -- =============================================================================

  CREATE TABLE IF NOT EXISTS posts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    media_url TEXT NOT NULL,
    media_path TEXT NOT NULL,
    media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
    aspect_ratio TEXT DEFAULT 'square' NOT NULL CHECK (aspect_ratio IN ('portrait', 'square', 'landscape')),
    caption TEXT DEFAULT '' NOT NULL CHECK (char_length(caption) <= 2200),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
  CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);

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

  CREATE TABLE IF NOT EXISTS post_likes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE (post_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_post_likes_post_id ON post_likes(post_id);
  CREATE INDEX IF NOT EXISTS idx_post_likes_user_id ON post_likes(user_id);

  CREATE TABLE IF NOT EXISTS follows (
    follower_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    following_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    PRIMARY KEY (follower_id, following_id),
    CHECK (follower_id <> following_id)
  );

  CREATE INDEX IF NOT EXISTS idx_follows_follower_id ON follows(follower_id);
  CREATE INDEX IF NOT EXISTS idx_follows_following_id ON follows(following_id);

  ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
  ALTER TABLE post_media ENABLE ROW LEVEL SECURITY;
  ALTER TABLE post_likes ENABLE ROW LEVEL SECURITY;
  ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS "Authenticated users can view public posts" ON posts;
  DROP POLICY IF EXISTS "Users can create own posts" ON posts;
  DROP POLICY IF EXISTS "Users can update own posts" ON posts;
  DROP POLICY IF EXISTS "Users can delete own posts" ON posts;
  DROP POLICY IF EXISTS "Authenticated users can view post media" ON post_media;
  DROP POLICY IF EXISTS "Users can create media for own posts" ON post_media;
  DROP POLICY IF EXISTS "Users can delete media for own posts" ON post_media;
  DROP POLICY IF EXISTS "Authenticated users can view post likes" ON post_likes;
  DROP POLICY IF EXISTS "Users can like posts as themselves" ON post_likes;
  DROP POLICY IF EXISTS "Users can remove own post likes" ON post_likes;
  DROP POLICY IF EXISTS "Authenticated users can view follows" ON follows;
  DROP POLICY IF EXISTS "Users can follow as themselves" ON follows;
  DROP POLICY IF EXISTS "Users can unfollow as themselves" ON follows;

  CREATE POLICY "Authenticated users can view public posts"
    ON posts FOR SELECT
    TO authenticated
    USING (true);

  CREATE POLICY "Users can create own posts"
    ON posts FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

  CREATE POLICY "Users can update own posts"
    ON posts FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

  CREATE POLICY "Users can delete own posts"
    ON posts FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

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

  CREATE POLICY "Authenticated users can view post likes"
    ON post_likes FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM posts p
        WHERE p.id = post_likes.post_id
      )
    );

  CREATE POLICY "Users can like posts as themselves"
    ON post_likes FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

  CREATE POLICY "Users can remove own post likes"
    ON post_likes FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

  CREATE POLICY "Authenticated users can view follows"
    ON follows FOR SELECT
    TO authenticated
    USING (true);

  CREATE POLICY "Users can follow as themselves"
    ON follows FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = follower_id AND follower_id <> following_id);

  CREATE POLICY "Users can unfollow as themselves"
    ON follows FOR DELETE
    TO authenticated
    USING (auth.uid() = follower_id);

  INSERT INTO storage.buckets (id, name, public)
  VALUES ('post-media', 'post-media', true)
  ON CONFLICT (id) DO NOTHING;

  DROP POLICY IF EXISTS "Users can upload post media" ON storage.objects;
  DROP POLICY IF EXISTS "Post media is publicly readable" ON storage.objects;
  DROP POLICY IF EXISTS "Users can delete own post media" ON storage.objects;

  CREATE POLICY "Users can upload post media"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'post-media'
      AND (storage.foldername(name))[1] = auth.uid()::text
    );

  CREATE POLICY "Post media is publicly readable"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (bucket_id = 'post-media');

  CREATE POLICY "Users can delete own post media"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'post-media'
      AND (storage.foldername(name))[1] = auth.uid()::text
    );

  DO $$
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE posts;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
  $$;

  DO $$
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE post_media;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
  $$;

  DO $$
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE post_likes;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
  $$;

  DO $$
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE follows;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
  $$;
