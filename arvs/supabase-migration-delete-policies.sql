-- ============================================================
-- Migration: Add DELETE Policies for User Data Management
-- Run this in Supabase SQL Editor
-- ============================================================

-- This migration adds DELETE policies to allow users to:
-- 1. Delete their own messages
-- 2. Leave conversations (delete their participant record)
-- 3. Delete their own profile (cascades to all related data)

-- ============================================================
-- 1. MESSAGES: Allow users to delete their own messages
-- ============================================================

drop policy if exists "Users can delete their own messages" on public.messages;
create policy "Users can delete their own messages"
  on public.messages for delete
  to authenticated
  using (
    sender_id = auth.uid()
    and public.is_conversation_member(conversation_id)
  );

-- ============================================================
-- 2. CONVERSATION PARTICIPANTS: Allow users to leave conversations
-- ============================================================

drop policy if exists "Users can leave conversations" on public.conversation_participants;
create policy "Users can leave conversations"
  on public.conversation_participants for delete
  to authenticated
  using (user_id = auth.uid());

-- ============================================================
-- 3. PROFILES: Allow users to delete their own profile
--    Note: This will cascade delete all related data due to
--    foreign key constraints with ON DELETE CASCADE
-- ============================================================

drop policy if exists "Users can delete their own profile" on public.profiles;
create policy "Users can delete their own profile"
  on public.profiles for delete
  to authenticated
  using (id = auth.uid());

-- ============================================================
-- 4. CONVERSATIONS: Allow users to delete conversations they created
--    (only if they're the sole participant, or use admin function)
-- ============================================================

-- Note: We don't add a general DELETE policy for conversations
-- because conversations are shared resources. Instead, users can:
-- - Leave conversations (via conversation_participants DELETE)
-- - Delete their own messages (via messages DELETE)
-- The conversation will remain for other participants

-- ============================================================
-- 5. CONVERSATION PREFERENCES: Already has DELETE via ALL policy
--    (confirmed in supabase-migration-conversation-settings-push.sql)
-- ============================================================

-- ============================================================
-- 6. PUSH TOKENS: Already has DELETE policy
--    (confirmed in supabase-migration-conversation-settings-push.sql)
-- ============================================================

-- ============================================================
-- VERIFICATION QUERIES (run these to confirm policies exist)
-- ============================================================

-- SELECT policyname, tablename FROM pg_policies 
-- WHERE schemaname = 'public' AND cmd = 'DELETE'
-- ORDER BY tablename, policyname;

-- ============================================================
-- DONE
-- ============================================================
