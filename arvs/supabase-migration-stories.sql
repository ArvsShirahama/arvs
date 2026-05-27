-- =============================================================================
-- Stories Feature Migration
-- Run this AFTER all previous migrations (files 1-5)
-- =============================================================================

-- 1. Create stories table
CREATE TABLE IF NOT EXISTS stories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  media_url TEXT NOT NULL,
  media_path TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  caption TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '24 hours') NOT NULL
);

-- 2. Create indexes
CREATE INDEX IF NOT EXISTS idx_stories_user_id ON stories(user_id);
CREATE INDEX IF NOT EXISTS idx_stories_expires_at ON stories(expires_at);
CREATE INDEX IF NOT EXISTS idx_stories_created_at ON stories(created_at DESC);

-- 3. Enable RLS
ALTER TABLE stories ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies

-- Users can insert their own stories
CREATE POLICY "Users can insert own stories"
  ON stories FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can view stories from users they share a conversation with (or their own)
CREATE POLICY "Users can view stories from contacts"
  ON stories FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM conversation_participants cp1
      JOIN conversation_participants cp2
        ON cp1.conversation_id = cp2.conversation_id
      WHERE cp1.user_id = auth.uid()
        AND cp2.user_id = stories.user_id
    )
  );

-- Users can delete their own stories
CREATE POLICY "Users can delete own stories"
  ON stories FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- 5. Create stories storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('stories', 'stories', true)
ON CONFLICT (id) DO NOTHING;

-- 6. Storage policies for stories bucket

-- Authenticated users can upload to their own folder
CREATE POLICY "Users can upload stories"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'stories'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Anyone can view stories (public bucket)
CREATE POLICY "Stories are publicly readable"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'stories');

-- Users can delete their own story files
CREATE POLICY "Users can delete own story files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'stories'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 7. Enable realtime for stories table
ALTER PUBLICATION supabase_realtime ADD TABLE stories;
