-- ============================================================
-- Migration: Add Online/Offline Status & Read Receipts
-- Run this in Supabase SQL Editor on your EXISTING database
-- ============================================================

-- 1. Add last_seen to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_seen timestamptz;

-- 2. Add status fields to messages
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'sent';
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS read_at timestamptz;

-- 3. Add read tracking to conversation_participants
ALTER TABLE public.conversation_participants ADD COLUMN IF NOT EXISTS last_read_message_id uuid;
ALTER TABLE public.conversation_participants ADD COLUMN IF NOT EXISTS last_read_at timestamptz;

-- 4. RLS policy: allow participants to update message status
DROP POLICY IF EXISTS "Participants can update message status" ON public.messages;
CREATE POLICY "Participants can update message status"
  ON public.messages FOR UPDATE
  TO authenticated
  USING (public.is_conversation_member(conversation_id))
  WITH CHECK (public.is_conversation_member(conversation_id));

-- 5. RLS policy: allow users to update their own read position
DROP POLICY IF EXISTS "Users can update their own read position" ON public.conversation_participants;
CREATE POLICY "Users can update their own read position"
  ON public.conversation_participants FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 6. Enable realtime on profiles (for last_seen updates)
-- Wrapped in exception handling to allow re-running without errors
do $$
begin
  begin
    alter publication supabase_realtime add table public.profiles;
  exception when duplicate_object then
    null;  -- Already added, ignore
  end;
end $$;

-- ============================================================
-- DONE! Now deploy the updated frontend code.
-- ============================================================
