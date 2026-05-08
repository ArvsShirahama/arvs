-- ============================================================
-- Migration: Add Media Messages (Images & Videos)
-- Run this in Supabase SQL Editor on your EXISTING database
-- ============================================================

-- 1. Add media columns to messages
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS message_type text NOT NULL DEFAULT 'text';
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_url text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS thumbnail_url text;

-- 2. Allow content to be empty for media-only messages
ALTER TABLE public.messages ALTER COLUMN content SET DEFAULT '';

-- 3. Create chat-media storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-media', 'chat-media', true)
ON CONFLICT (id) DO NOTHING;

-- 4. Storage policies for chat-media bucket

-- Anyone can view chat media (public bucket)
DROP POLICY IF EXISTS "Anyone can view chat media" ON storage.objects;
CREATE POLICY "Anyone can view chat media"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'chat-media');

-- Authenticated users can upload chat media
DROP POLICY IF EXISTS "Authenticated users can upload chat media" ON storage.objects;
CREATE POLICY "Authenticated users can upload chat media"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'chat-media');

-- Users can delete their own chat media (folder = user_id)
DROP POLICY IF EXISTS "Users can delete their own chat media" ON storage.objects;
CREATE POLICY "Users can delete their own chat media"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'chat-media' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================
-- DONE! Now deploy the updated frontend code.
-- ============================================================
