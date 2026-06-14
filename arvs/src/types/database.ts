export interface Profile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string;
  status_message: string;
  last_seen: string | null;
  created_at: string;
  updated_at: string | null;
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

export interface ConversationNickname {
  conversation_id: string;
  user_id: string;
  nickname: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationParticipantProfile {
  profile: Profile;
  nickname: string | null;
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
export type MessageType = 'text' | 'image' | 'video' | 'file' | 'audio';

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
  edited_at: string | null;
  created_at: string;
}

export interface ConversationWithDetails {
  id: string;
  updated_at: string;
  other_user: Profile;
  last_message: Message | null;
  unread_count: number;
  preference: ConversationPreference | null;
  nicknames?: Record<string, string | null>;
  other_user_nickname?: string | null;
}

export interface ConversationSummaryDTO {
  conversation_id: string;
  updated_at: string;
  other_user: Profile;
  last_message: Message | null;
  unread_count: number;
  preference: ConversationPreference | null;
  nicknames?: Record<string, string | null>;
  other_user_nickname?: string | null;
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

export type StoryMediaType = 'image' | 'video';

export interface Story {
  id: string;
  user_id: string;
  media_url: string;
  media_path: string;
  media_type: StoryMediaType;
  caption: string;
  created_at: string;
  expires_at: string;
}

export interface StoryReaction {
  id: string;
  story_id: string;
  user_id: string;
  reaction: string;
  created_at: string;
}

export interface StoryReply {
  id: string;
  story_id: string;
  user_id: string;
  content: string;
  created_at: string;
}

export type PostMediaType = 'image' | 'video';
export type PostAspectRatio = 'portrait' | 'square' | 'landscape';

export interface Post {
  id: string;
  user_id: string;
  media_url: string;
  media_path: string;
  media_type: PostMediaType;
  aspect_ratio: PostAspectRatio;
  caption: string;
  created_at: string;
  updated_at: string;
}

export interface PostMedia {
  id: string;
  post_id: string;
  media_url: string;
  media_path: string;
  media_type: PostMediaType;
  position: number;
  width: number | null;
  height: number | null;
  created_at: string;
}

export interface CreatePostMediaInput {
  file: File;
  mediaType: PostMediaType;
  width: number | null;
  height: number | null;
}

export interface PostLike {
  id: string;
  post_id: string;
  user_id: string;
  created_at: string;
}

export interface Follow {
  follower_id: string;
  following_id: string;
  created_at: string;
}

export interface PostWithAuthor extends Post {
  author: Profile;
  media: PostMedia[];
  like_count: number;
  liked_by_me: boolean;
  is_following_author: boolean;
}

export interface FeedPageCursor {
  beforeCreatedAt: string | null;
  limit: number;
}
