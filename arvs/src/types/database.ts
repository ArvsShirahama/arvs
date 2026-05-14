export interface Profile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  last_seen: string | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  created_at: string;
  updated_at: string;
}

export type ConversationBackgroundType = 'gradient' | 'image';

export interface ConversationPreference {
  conversation_id: string;
  user_id: string;
  peer_nickname: string | null;
  theme_id: string;
  background_type: ConversationBackgroundType;
  background_image_url: string | null;
  background_image_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationParticipant {
  conversation_id: string;
  user_id: string;
  last_read_message_id: string | null;
  last_read_at: string | null;
  created_at: string;
}

export interface PushToken {
  token: string;
  user_id: string;
  platform: string;
  app_id: string | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
}

export type MessageStatus = 'sent' | 'delivered' | 'read';
export type MessageType = 'text' | 'image' | 'video' | 'file';

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  message_type: MessageType;
  media_url: string | null;
  media_path: string | null;
  media_name: string | null;
  media_mime_type: string | null;
  media_size_bytes: number | null;
  thumbnail_url: string | null;
  status: MessageStatus;
  delivered_at: string | null;
  read_at: string | null;
  created_at: string;
}

export interface ConversationWithDetails {
  id: string;
  updated_at: string;
  other_user: Profile;
  last_message: Message | null;
  unread_count: number;
  preference: ConversationPreference | null;
}

export interface ConversationSummaryDTO {
  conversation_id: string;
  updated_at: string;
  other_user: Profile;
  last_message: Message | null;
  unread_count: number;
  preference: ConversationPreference | null;
}

export interface MessagePageCursor {
  beforeCreatedAt: string | null;
  limit: number;
}

export interface PaginatedMessagesState {
  conversationId: string;
  messages: Message[];
  oldestCursor: string | null;
  hasMore: boolean;
}

export interface ConversationMediaFilter {
  type: 'all' | 'image' | 'video' | 'file';
}
