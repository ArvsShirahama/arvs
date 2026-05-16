/**
 * Supabase Client Configuration
 * 
 * IMPORTANT: Database Migration Execution Order
 * 
 * When setting up or migrating the database, run these SQL files in EXACT ORDER:
 * 
 * 1. supabase-setup.sql
 *    - Creates all base tables (profiles, conversations, participants, messages)
 *    - Sets up Row Level Security (RLS) policies
 *    - Creates helper functions and triggers
 *    - Sets up storage buckets (avatars, chat-media)
 *    - Enables realtime on core tables
 * 
 * 2. supabase-migration-presence-receipts.sql
 *    - Adds online/offline status tracking (last_seen)
 *    - Adds message status fields (sent, delivered, read)
 *    - Adds read position tracking
 *    - Updates RLS policies for status updates
 * 
 * 3. supabase-migration-media-messages.sql
 *    - Adds media message support (images, videos, files)
 *    - Adds CHECK constraint for message_type validation
 *    - Creates chat-media storage policies
 * 
 * 4. supabase-migration-conversation-settings-push.sql
 *    - Creates conversation_preferences table (themes, backgrounds, nicknames)
 *    - Creates push_tokens table for FCM notifications
 *    - Adds media metadata columns to messages
 *    - Creates get_conversation_summaries() RPC function
 *    - Sets up conversation-backgrounds storage bucket
 *    - Enables realtime on conversation_preferences
 * 
 * 5. supabase-migration-delete-policies.sql
 *    - Adds DELETE RLS policies for messages, participants, profiles
 *    - Allows users to delete their own messages
 *    - Allows users to leave conversations
 *    - Allows users to delete their own profile
 * 
 * ⚠️ DO NOT RUN: supabase-migration-conversation-summaries-rpc.sql
 *    - This file is DEPRECATED and will break the app
 *    - The correct version is in file #4 above
 * 
 * For new database setup: Run files 1-5 in order
 * For existing database: Run only the migration files you haven't applied yet
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase environment variables. Check your .env file."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
