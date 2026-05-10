import { supabase } from '../supabaseClient';
import type {
  ConversationSummaryDTO,
  ConversationWithDetails,
  Message,
  MessagePageCursor,
  PaginatedMessagesState,
  Profile,
} from '../types/database';

const DEFAULT_SUMMARY_PAGE_SIZE = 30;
const DEFAULT_MESSAGE_PAGE_SIZE = 30;

const messageCache = new Map<string, PaginatedMessagesState>();

function mapSummaryRow(row: ConversationSummaryDTO): ConversationWithDetails {
  return {
    id: row.conversation_id,
    updated_at: row.updated_at,
    other_user: row.other_user,
    last_message: row.last_message,
    unread_count: row.unread_count ?? 0,
  };
}

async function getConversationSummaryFallback(
  conversationId: string,
  currentUserId: string
): Promise<ConversationWithDetails | null> {
  const { data: participants } = await supabase
    .from('conversation_participants')
    .select('user_id')
    .eq('conversation_id', conversationId)
    .neq('user_id', currentUserId);

  const otherUserId = participants?.[0]?.user_id;
  if (!otherUserId) return null;

  const [{ data: otherProfile }, { data: lastMsg }, { data: myParticipant }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', otherUserId).single(),
    supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('conversation_participants')
      .select('last_read_message_id')
      .eq('conversation_id', conversationId)
      .eq('user_id', currentUserId)
      .maybeSingle(),
  ]);

  let unreadCount = 0;
  if (myParticipant?.last_read_message_id) {
    const { data: lastReadMsg } = await supabase
      .from('messages')
      .select('created_at')
      .eq('id', myParticipant.last_read_message_id)
      .maybeSingle();

    if (lastReadMsg?.created_at) {
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('conversation_id', conversationId)
        .neq('sender_id', currentUserId)
        .gt('created_at', lastReadMsg.created_at);
      unreadCount = count ?? 0;
    }
  } else {
    const { count } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .neq('sender_id', currentUserId);
    unreadCount = count ?? 0;
  }

  const updatedAt = lastMsg?.created_at ?? new Date().toISOString();
  return {
    id: conversationId,
    updated_at: updatedAt,
    other_user: otherProfile as Profile,
    last_message: (lastMsg as Message) ?? null,
    unread_count: unreadCount,
  };
}

async function getSummariesFallback(
  currentUserId: string,
  limit: number,
  before: string | null
): Promise<ConversationWithDetails[]> {
  const query = supabase
    .from('conversation_participants')
    .select('conversation_id')
    .eq('user_id', currentUserId);

  const { data: participantRows } = await query;
  const conversationIds = participantRows?.map((row) => row.conversation_id) ?? [];
  if (conversationIds.length === 0) return [];

  let convoQuery = supabase
    .from('conversations')
    .select('id,updated_at')
    .in('id', conversationIds)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (before) {
    convoQuery = convoQuery.lt('updated_at', before);
  }

  const { data: convos } = await convoQuery;
  if (!convos?.length) return [];

  const summaries = await Promise.all(
    convos.map((convo) => getConversationSummaryFallback(convo.id, currentUserId))
  );

  return summaries
    .filter((summary): summary is ConversationWithDetails => summary !== null)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
}

export async function getSummaries(
  currentUserId: string,
  limit = DEFAULT_SUMMARY_PAGE_SIZE,
  before: string | null = null
): Promise<ConversationWithDetails[]> {
  const { data, error } = await supabase.rpc('get_conversation_summaries', {
    p_user_id: currentUserId,
    p_limit: limit,
    p_before: before,
  });

  if (error) {
    return getSummariesFallback(currentUserId, limit, before);
  }

  return ((data as ConversationSummaryDTO[]) ?? []).map(mapSummaryRow);
}

export async function getConversationSummary(
  conversationId: string,
  currentUserId: string
): Promise<ConversationWithDetails | null> {
  return getConversationSummaryFallback(conversationId, currentUserId);
}

export function upsertSummaryFromRealtime(
  current: ConversationWithDetails[],
  nextSummary: ConversationWithDetails
): ConversationWithDetails[] {
  const filtered = current.filter((summary) => summary.id !== nextSummary.id);
  filtered.unshift(nextSummary);
  filtered.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  return filtered;
}

export async function getMessagesPage(
  conversationId: string,
  cursor: MessagePageCursor = { beforeCreatedAt: null, limit: DEFAULT_MESSAGE_PAGE_SIZE }
): Promise<{ messages: Message[]; oldestCursor: string | null; hasMore: boolean }> {
  let query = supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(cursor.limit);

  if (cursor.beforeCreatedAt) {
    query = query.lt('created_at', cursor.beforeCreatedAt);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = ((data as Message[]) ?? []).reverse();
  const hasMore = rows.length === cursor.limit;
  const oldestCursor = rows.length > 0 ? rows[0].created_at : cursor.beforeCreatedAt;

  return {
    messages: rows,
    oldestCursor,
    hasMore,
  };
}

export function getCachedMessages(conversationId: string): PaginatedMessagesState | null {
  const cached = messageCache.get(conversationId);
  if (!cached) return null;

  return {
    ...cached,
    messages: [...cached.messages],
  };
}

export function setCachedMessages(state: PaginatedMessagesState): void {
  messageCache.set(state.conversationId, {
    ...state,
    messages: [...state.messages],
  });
}
