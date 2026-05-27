-- =============================================================================
-- Story Interactions Migration (Reactions + Replies)
-- Run after supabase-migration-stories.sql
-- =============================================================================

-- Reactions: one reaction per viewer per story (updatable)
CREATE TABLE IF NOT EXISTS story_reactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reaction TEXT NOT NULL CHECK (char_length(reaction) BETWEEN 1 AND 16),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE (story_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_story_reactions_story_id ON story_reactions(story_id);
CREATE INDEX IF NOT EXISTS idx_story_reactions_user_id ON story_reactions(user_id);

ALTER TABLE story_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read reactions for visible stories"
  ON story_reactions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM stories s
      WHERE s.id = story_reactions.story_id
        AND (
          s.user_id = auth.uid()
          OR story_reactions.user_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM conversation_participants cp1
            JOIN conversation_participants cp2
              ON cp1.conversation_id = cp2.conversation_id
            WHERE cp1.user_id = auth.uid()
              AND cp2.user_id = s.user_id
          )
        )
    )
  );

CREATE POLICY "Users can insert own reactions"
  ON story_reactions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own reactions"
  ON story_reactions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own reactions"
  ON story_reactions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Replies: can be multiple per viewer per story
CREATE TABLE IF NOT EXISTS story_replies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (char_length(trim(content)) BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_story_replies_story_id ON story_replies(story_id);
CREATE INDEX IF NOT EXISTS idx_story_replies_user_id ON story_replies(user_id);
CREATE INDEX IF NOT EXISTS idx_story_replies_created_at ON story_replies(created_at DESC);

ALTER TABLE story_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read replies for visible stories"
  ON story_replies FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM stories s
      WHERE s.id = story_replies.story_id
        AND (
          s.user_id = auth.uid()
          OR story_replies.user_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM conversation_participants cp1
            JOIN conversation_participants cp2
              ON cp1.conversation_id = cp2.conversation_id
            WHERE cp1.user_id = auth.uid()
              AND cp2.user_id = s.user_id
          )
        )
    )
  );

CREATE POLICY "Users can insert own replies"
  ON story_replies FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own replies"
  ON story_replies FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE story_reactions;
ALTER PUBLICATION supabase_realtime ADD TABLE story_replies;
