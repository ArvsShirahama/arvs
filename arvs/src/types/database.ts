export interface Profile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationParticipant {
  conversation_id: string;
  user_id: string;
  created_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

export interface ConversationWithDetails {
  id: string;
  updated_at: string;
  other_user: Profile;
  last_message: Message | null;
}
