import { supabase } from '../supabaseClient';
import type {
  ConversationBackgroundType,
  ConversationPreference,
  Message,
  MessageType,
  Profile,
} from '../types/database';

const DEFAULT_MEDIA_PAGE_SIZE = 36;
const CONVERSATION_BACKGROUND_BUCKET = 'conversation-backgrounds';

export interface ConversationContext {
  otherUser: Profile | null;
  preference: ConversationPreference | null;
}

export interface ConversationPreferencePatch {
  peer_nickname?: string | null;
  theme_id?: string;
  background_type?: ConversationBackgroundType;
  background_image_url?: string | null;
  background_image_path?: string | null;
}

export interface ConversationMediaPageOptions {
  beforeCreatedAt?: string | null;
  limit?: number;
  type?: 'all' | 'image' | 'video' | 'file';
}

function createFilePath(userId: string, conversationId: string, fileName: string): string {
  const safeName = fileName.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  return `${userId}/${conversationId}/${Date.now()}-${safeName}`;
}

export async function getConversationPreference(
  conversationId: string,
  userId: string
): Promise<ConversationPreference | null> {
  const { data, error } = await supabase
    .from('conversation_preferences')
    .select('*')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as ConversationPreference | null) ?? null;
}

export async function getConversationContext(
  conversationId: string,
  currentUserId: string
): Promise<ConversationContext> {
  const [{ data: participants, error: participantsError }, preference] = await Promise.all([
    supabase
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', conversationId)
      .neq('user_id', currentUserId),
    getConversationPreference(conversationId, currentUserId),
  ]);

  if (participantsError) {
    throw participantsError;
  }

  const otherUserId = participants?.[0]?.user_id;
  if (!otherUserId) {
    return { otherUser: null, preference };
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', otherUserId)
    .single();

  if (profileError) {
    throw profileError;
  }

  return {
    otherUser: (profile as Profile | null) ?? null,
    preference,
  };
}

export async function saveConversationPreference(
  conversationId: string,
  userId: string,
  patch: ConversationPreferencePatch
): Promise<ConversationPreference> {
  const payload = {
    conversation_id: conversationId,
    user_id: userId,
    updated_at: new Date().toISOString(),
    ...patch,
  };

  const { data, error } = await supabase
    .from('conversation_preferences')
    .upsert(payload, { onConflict: 'conversation_id,user_id' })
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data as ConversationPreference;
}

export async function deleteConversationBackgroundAsset(path: string | null): Promise<void> {
  if (!path) return;
  await supabase.storage.from(CONVERSATION_BACKGROUND_BUCKET).remove([path]);
}

export async function uploadConversationBackground(args: {
  conversationId: string;
  userId: string;
  blob: Blob;
  fileName: string;
  contentType?: string;
  previousPath?: string | null;
}): Promise<{ backgroundImageUrl: string; backgroundImagePath: string }> {
  const filePath = createFilePath(args.userId, args.conversationId, args.fileName);

  const { error } = await supabase.storage
    .from(CONVERSATION_BACKGROUND_BUCKET)
    .upload(filePath, args.blob, {
      contentType: args.contentType || args.blob.type || undefined,
      upsert: false,
    });

  if (error) {
    throw error;
  }

  if (args.previousPath) {
    await deleteConversationBackgroundAsset(args.previousPath);
  }

  const { data } = supabase.storage.from(CONVERSATION_BACKGROUND_BUCKET).getPublicUrl(filePath);
  return {
    backgroundImageUrl: data.publicUrl,
    backgroundImagePath: filePath,
  };
}

export async function getConversationMediaPage(
  conversationId: string,
  options: ConversationMediaPageOptions = {}
): Promise<{ messages: Message[]; oldestCursor: string | null; hasMore: boolean }> {
  const limit = options.limit ?? DEFAULT_MEDIA_PAGE_SIZE;
  const filterTypes: MessageType[] =
    options.type && options.type !== 'all' ? [options.type] : ['image', 'video', 'file'];

  let query = supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .in('message_type', filterTypes)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (options.beforeCreatedAt) {
    query = query.lt('created_at', options.beforeCreatedAt);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  const rows = (data as Message[]) ?? [];
  const oldestCursor = rows.length > 0 ? rows[rows.length - 1].created_at : options.beforeCreatedAt ?? null;

  return {
    messages: rows,
    oldestCursor,
    hasMore: rows.length === limit,
  };
}
