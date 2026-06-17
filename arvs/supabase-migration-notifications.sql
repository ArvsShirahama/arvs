-- =============================================================================
-- Notifications System Migration
-- Run after supabase-migration-posts-feed.sql
-- =============================================================================

-- 1. Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  recipient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('like', 'comment', 'follow')),
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  is_read BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread
  ON notifications(recipient_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created
  ON notifications(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_actor
  ON notifications(actor_id);

-- 2. Enable RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if re-running
DROP POLICY IF EXISTS "Users can view own notifications" ON notifications;
DROP POLICY IF EXISTS "Authenticated users can create notifications" ON notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can delete own notifications" ON notifications;

-- Users can only read their own notifications
CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT
  TO authenticated
  USING (auth.uid() = recipient_id);

-- Any authenticated user can insert a notification (for triggers / app logic)
CREATE POLICY "Authenticated users can create notifications"
  ON notifications FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Users can mark their own notifications as read
CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  TO authenticated
  USING (auth.uid() = recipient_id)
  WITH CHECK (auth.uid() = recipient_id);

-- Users can delete their own notifications
CREATE POLICY "Users can delete own notifications"
  ON notifications FOR DELETE
  TO authenticated
  USING (auth.uid() = recipient_id);

-- 3. Trigger: auto-create notification when a post is liked
CREATE OR REPLACE FUNCTION create_notification_on_like()
RETURNS TRIGGER AS $$
DECLARE
  post_owner UUID;
BEGIN
  -- Get the owner of the liked post
  SELECT user_id INTO post_owner FROM posts WHERE id = NEW.post_id;

  -- Don't notify if the user liked their own post
  IF post_owner IS NOT NULL AND post_owner <> NEW.user_id THEN
    INSERT INTO notifications (recipient_id, actor_id, type, post_id)
    VALUES (post_owner, NEW.user_id, 'like', NEW.post_id)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_notification_on_like ON post_likes;
CREATE TRIGGER trg_notification_on_like
  AFTER INSERT ON post_likes
  FOR EACH ROW
  EXECUTE FUNCTION create_notification_on_like();

-- 4. Trigger: auto-create notification when someone is followed
CREATE OR REPLACE FUNCTION create_notification_on_follow()
RETURNS TRIGGER AS $$
BEGIN
  -- Don't notify if somehow following yourself (constraint should prevent this)
  IF NEW.follower_id <> NEW.following_id THEN
    INSERT INTO notifications (recipient_id, actor_id, type)
    VALUES (NEW.following_id, NEW.follower_id, 'follow')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_notification_on_follow ON follows;
CREATE TRIGGER trg_notification_on_follow
  AFTER INSERT ON follows
  FOR EACH ROW
  EXECUTE FUNCTION create_notification_on_follow();

-- 5. Enable realtime for notifications
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;
