import { supabase } from '../../../supabaseClient';
import type {
  ConversationBackgroundType,
  ConversationNickname,
  ConversationParticipantProfile,
  ConversationPreference,
  Message,
  MessageType,
  Profile,
} from '../../../types/database';

const DEFAULT_MEDIA_PAGE_SIZE = 36;
const CONVERSATION_BACKGROUND_BUCKET = 'conversation-backgrounds';

export interface ConversationContext {
  otherUser: Profile | null;
  preference: ConversationPreference | null;
  participants: ConversationParticipantProfile[];
  nicknames: Record<string, string | null>;
  otherUserNickname: string | null;
}

export interface ConversationPreferencePatch {
  peer_nickname?: string | null;
  theme_id?: string;
  background_type?: ConversationBackgroundType;
  background_image_url?: string | null;
  background_image_path?: string | null;
}

export type ConversationAppearancePatch = Required<
  Pick<
    ConversationPreferencePatch,
    'theme_id' | 'background_type' | 'background_image_url' | 'background_image_path'
  >
>;

export interface ConversationMediaPageOptions {
  beforeCreatedAt?: string | null;
  limit?: number;
  type?: 'all' | 'image' | 'video' | 'file';
}

function createEmptyPreference(conversationId: string, userId: string): ConversationPreference {
  const now = new Date().toISOString();
  return {
    conversation_id: conversationId,
    user_id: userId,
    peer_nickname: null,
    theme_id: 'system',
    background_type: 'gradient',
    background_image_url: null,
    background_image_path: null,
    created_at: now,
    updated_at: now,
  };
}

function createFilePath(userId: string, conversationId: string, fileName: string): string {
  const safeName = fileName.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  return `${userId}/${conversationId}/${Date.now()}-${safeName}`;
}

function mergeNicknameWithSharedAppearance(
  ownPreference: ConversationPreference | null,
  sharedPreference: ConversationPreference | null,
  conversationId: string,
  userId: string,
  legacyPeerNickname: string | null = null
): ConversationPreference | null {
  if (!ownPreference && !sharedPreference) {
    return legacyPeerNickname ? {
      ...createEmptyPreference(conversationId, userId),
      peer_nickname: legacyPeerNickname,
    } : null;
  }

  const source = ownPreference ?? sharedPreference!;
  return {
    ...source,
    conversation_id: conversationId,
    user_id: userId,
    peer_nickname: legacyPeerNickname ?? ownPreference?.peer_nickname ?? null,
    theme_id: sharedPreference?.theme_id ?? ownPreference?.theme_id ?? 'system',
    background_type: sharedPreference?.background_type ?? ownPreference?.background_type ?? 'gradient',
    background_image_url: sharedPreference?.background_image_url ?? ownPreference?.background_image_url ?? null,
    background_image_path: sharedPreference?.background_image_path ?? ownPreference?.background_image_path ?? null,
  };
}

function mapNicknames(rows: ConversationNickname[] | null): Record<string, string | null> {
  return (rows ?? []).reduce<Record<string, string | null>>((acc, row) => {
    acc[row.user_id] = row.nickname;
    return acc;
  }, {});
}

async function getConversationParticipantIds(conversationId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('conversation_participants')
    .select('user_id')
    .eq('conversation_id', conversationId);

  if (error) {
    throw error;
  }

  return data?.map((row) => row.user_id) ?? [];
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
  const [
    { data: participants, error: participantsError },
    { data: preferences, error: preferencesError },
    { data: nicknameRows, error: nicknamesError },
  ] = await Promise.all([
    supabase
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', conversationId),
    supabase
      .from('conversation_preferences')
      .select('*')
      .eq('conversation_id', conversationId),
    supabase
      .from('conversation_nicknames')
      .select('*')
      .eq('conversation_id', conversationId),
  ]);

  if (participantsError) {
    throw participantsError;
  }
  if (preferencesError) {
    throw preferencesError;
  }
  // Gracefully handle missing conversation_nicknames table
  if (nicknamesError) {
    console.warn('conversation_nicknames query failed (table may not exist yet):', nicknamesError.message);
  }

  const preferenceRows = (preferences as ConversationPreference[] | null) ?? [];
  const nicknameMap = mapNicknames(nicknameRows as ConversationNickname[] | null);
  const ownPreference = preferenceRows.find((row) => row.user_id === currentUserId) ?? null;
  const sharedAppearancePreference =
    preferenceRows.find((row) => row.background_image_url || row.background_image_path) ?? ownPreference ?? preferenceRows[0] ?? null;
  const otherUserId = participants?.find((participant) => participant.user_id !== currentUserId)?.user_id;
  const legacyPeerNickname = otherUserId ? (nicknameMap[otherUserId] ?? ownPreference?.peer_nickname ?? null) : null;
  const preference = mergeNicknameWithSharedAppearance(
    ownPreference,
    sharedAppearancePreference,
    conversationId,
    currentUserId,
    legacyPeerNickname
  );

  const participantIds = participants?.map((participant) => participant.user_id) ?? [];
  const { data: profiles, error: profilesError } = participantIds.length > 0
    ? await supabase.from('profiles').select('*').in('id', participantIds)
    : { data: [], error: null };

  if (profilesError) {
    throw profilesError;
  }

  const participantProfiles = ((profiles as Profile[] | null) ?? []).map((participantProfile) => ({
    profile: participantProfile,
    nickname: nicknameMap[participantProfile.id] ?? null,
  }));

  if (!otherUserId) {
    return {
      otherUser: null,
      preference,
      participants: participantProfiles,
      nicknames: nicknameMap,
      otherUserNickname: null,
    };
  }

  const profile = participantProfiles.find((participant) => participant.profile.id === otherUserId)?.profile ?? null;

  return {
    otherUser: profile,
    preference,
    participants: participantProfiles,
    nicknames: nicknameMap,
    otherUserNickname: nicknameMap[otherUserId] ?? legacyPeerNickname,
  };
}

export async function getConversationNicknames(conversationId: string): Promise<Record<string, string | null>> {
  const { data, error } = await supabase
    .from('conversation_nicknames')
    .select('*')
    .eq('conversation_id', conversationId);

  if (error) {
    throw error;
  }

  return mapNicknames(data as ConversationNickname[] | null);
}

export async function saveConversationParticipantNickname(
  conversationId: string,
  participantUserId: string,
  nickname: string | null
): Promise<ConversationNickname> {
  const { data, error } = await supabase.rpc('save_conversation_participant_nickname', {
    p_conversation_id: conversationId,
    p_user_id: participantUserId,
    p_nickname: nickname?.trim() || null,
  });

  if (error) {
    throw error;
  }

  return data as ConversationNickname;
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

export async function saveSharedConversationAppearance(
  conversationId: string,
  currentUserId: string,
  patch: ConversationAppearancePatch
): Promise<ConversationPreference> {
  const { data: rpcData, error: rpcError } = await supabase.rpc('save_shared_conversation_appearance', {
    p_conversation_id: conversationId,
    p_theme_id: patch.theme_id,
    p_background_type: patch.background_type,
    p_background_image_url: patch.background_image_url,
    p_background_image_path: patch.background_image_path,
  });

  if (!rpcError && rpcData) {
    return rpcData as ConversationPreference;
  }

  const [participantIds, { data: preferences, error: preferencesError }] = await Promise.all([
    getConversationParticipantIds(conversationId),
    supabase
      .from('conversation_preferences')
      .select('*')
      .eq('conversation_id', conversationId),
  ]);

  if (preferencesError) {
    throw preferencesError;
  }
  if (!participantIds.includes(currentUserId)) {
    throw new Error('You are not a participant in this conversation.');
  }

  const existingPreferences = ((preferences as ConversationPreference[] | null) ?? [])
    .reduce<Record<string, ConversationPreference>>((acc, preference) => {
      acc[preference.user_id] = preference;
      return acc;
    }, {});

  const updatedAt = new Date().toISOString();
  const payload = participantIds.map((participantId) => ({
    conversation_id: conversationId,
    user_id: participantId,
    peer_nickname: existingPreferences[participantId]?.peer_nickname ?? null,
    updated_at: updatedAt,
    ...patch,
  }));

  const { data, error } = await supabase
    .from('conversation_preferences')
    .upsert(payload, { onConflict: 'conversation_id,user_id' })
    .select('*');

  if (error) {
    throw error;
  }

  const rows = (data as ConversationPreference[] | null) ?? [];
  const currentUserPreference = rows.find((row) => row.user_id === currentUserId) ?? rows[0];
  if (!currentUserPreference) {
    throw new Error('Unable to save conversation appearance.');
  }

  return currentUserPreference;
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

export async function uploadConversationBackgroundWithProgress(args: {
  conversationId: string;
  userId: string;
  blob: Blob;
  fileName: string;
  contentType?: string;
  previousPath?: string | null;
  onProgress?: (percent: number) => void;
}): Promise<{ backgroundImageUrl: string; backgroundImagePath: string }> {
  const filePath = createFilePath(args.userId, args.conversationId, args.fileName);
  
  // Supabase JS doesn't support upload progress natively
  // Simulate progress for better UX
  let progressInterval: ReturnType<typeof setInterval> | null = null;
  if (args.onProgress) {
    let progress = 0;
    progressInterval = setInterval(() => {
      progress += Math.random() * 15;
      if (progress > 90) {
        if (progressInterval) clearInterval(progressInterval);
        return;
      }
      args.onProgress!(Math.min(progress, 90));
    }, 200);
  }
  
  const { error } = await supabase.storage
    .from(CONVERSATION_BACKGROUND_BUCKET)
    .upload(filePath, args.blob, {
      contentType: args.contentType || args.blob.type || undefined,
      upsert: false,
    });
  
  if (progressInterval) {
    clearInterval(progressInterval);
  }
  
  if (args.onProgress) {
    args.onProgress(100);
  }
  
  if (error) throw error;
  
  if (args.previousPath) {
    await deleteConversationBackgroundAsset(args.previousPath);
  }
  
  const { data } = supabase.storage
    .from(CONVERSATION_BACKGROUND_BUCKET)
    .getPublicUrl(filePath);
    
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


