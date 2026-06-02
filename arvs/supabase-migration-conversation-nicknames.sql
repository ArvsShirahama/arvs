-- =============================================================================
-- Conversation Nicknames Migration
-- Creates the conversation_nicknames table referenced by the app code.
-- Run this in Supabase SQL Editor.
-- =============================================================================

-- 1. Create conversation_nicknames table
CREATE TABLE IF NOT EXISTS conversation_nicknames (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname TEXT DEFAULT NULL,
  updated_by UUID DEFAULT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);

-- 2. Create indexes
CREATE INDEX IF NOT EXISTS idx_conversation_nicknames_conversation
  ON conversation_nicknames(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_nicknames_user
  ON conversation_nicknames(user_id);

-- 3. Enable RLS
ALTER TABLE conversation_nicknames ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
DROP POLICY IF EXISTS "Users can view nicknames in their conversations" ON conversation_nicknames;
DROP POLICY IF EXISTS "Users can set nicknames in their conversations" ON conversation_nicknames;
DROP POLICY IF EXISTS "Users can update nicknames in their conversations" ON conversation_nicknames;
DROP POLICY IF EXISTS "Users can delete nicknames in their conversations" ON conversation_nicknames;

-- Users can view nicknames in conversations they participate in
CREATE POLICY "Users can view nicknames in their conversations"
  ON conversation_nicknames FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM conversation_participants cp
      WHERE cp.conversation_id = conversation_nicknames.conversation_id
        AND cp.user_id = auth.uid()
    )
  );

-- Users can insert/update nicknames in conversations they participate in
CREATE POLICY "Users can set nicknames in their conversations"
  ON conversation_nicknames FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversation_participants cp
      WHERE cp.conversation_id = conversation_nicknames.conversation_id
        AND cp.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM conversation_participants target_cp
      WHERE target_cp.conversation_id = conversation_nicknames.conversation_id
        AND target_cp.user_id = conversation_nicknames.user_id
    )
  );

CREATE POLICY "Users can update nicknames in their conversations"
  ON conversation_nicknames FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM conversation_participants cp
      WHERE cp.conversation_id = conversation_nicknames.conversation_id
        AND cp.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM conversation_participants target_cp
      WHERE target_cp.conversation_id = conversation_nicknames.conversation_id
        AND target_cp.user_id = conversation_nicknames.user_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversation_participants cp
      WHERE cp.conversation_id = conversation_nicknames.conversation_id
        AND cp.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM conversation_participants target_cp
      WHERE target_cp.conversation_id = conversation_nicknames.conversation_id
        AND target_cp.user_id = conversation_nicknames.user_id
    )
  );

CREATE POLICY "Users can delete nicknames in their conversations"
  ON conversation_nicknames FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM conversation_participants cp
      WHERE cp.conversation_id = conversation_nicknames.conversation_id
        AND cp.user_id = auth.uid()
    )
  );

-- 5. Create RPC function for saving nicknames (upsert)
CREATE OR REPLACE FUNCTION save_conversation_participant_nickname(
  p_conversation_id UUID,
  p_user_id UUID,
  p_nickname TEXT
)
RETURNS conversation_nicknames
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result conversation_nicknames;
BEGIN
  -- Verify caller is a participant
  IF NOT EXISTS (
    SELECT 1 FROM conversation_participants
    WHERE conversation_id = p_conversation_id
      AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not a participant in this conversation';
  END IF;

  -- Verify the user receiving the nickname also belongs to this conversation.
  IF NOT EXISTS (
    SELECT 1 FROM conversation_participants
    WHERE conversation_id = p_conversation_id
      AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Target user is not a participant in this conversation';
  END IF;

  INSERT INTO conversation_nicknames (conversation_id, user_id, nickname, updated_by, updated_at)
  VALUES (p_conversation_id, p_user_id, p_nickname, auth.uid(), now())
  ON CONFLICT (conversation_id, user_id)
  DO UPDATE SET
    nickname = EXCLUDED.nickname,
    updated_by = EXCLUDED.updated_by,
    updated_at = now()
  RETURNING * INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION save_conversation_participant_nickname(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_conversation_participant_nickname(UUID, UUID, TEXT) TO authenticated;

-- 6. Enable realtime
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE conversation_nicknames;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;
