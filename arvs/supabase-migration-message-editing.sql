-- ============================================================
-- Migration: Message Editing Support
-- Date: 2026-05-20
-- Description: Adds edited_at column and UPDATE RLS policy
--              for message content editing by the sender.
-- ============================================================

-- 1. Add edited_at column to messages table
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Add UPDATE policy so users can edit their own message content
-- Drop first to make migration idempotent
DROP POLICY IF EXISTS "Users can edit their own messages" ON public.messages;

CREATE POLICY "Users can edit their own messages"
  ON public.messages
  FOR UPDATE
  USING (
    sender_id = auth.uid()
    AND is_conversation_member(conversation_id)
  )
  WITH CHECK (
    sender_id = auth.uid()
    AND is_conversation_member(conversation_id)
  );
