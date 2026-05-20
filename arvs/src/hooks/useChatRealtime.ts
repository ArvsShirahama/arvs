import { useCallback, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from './useAuth';
import { invalidateMessageCache } from '../services/chatService';
import type { ConversationPreference, Message } from '../types/database';

export function useChatRealtime(
  conversationId: string,
  messages: Message[],
  loading: boolean,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  setPreference: React.Dispatch<React.SetStateAction<ConversationPreference | null>>,
  scrollToBottom: () => void
) {
  const { user } = useAuth();

  const markMessagesAsRead = useCallback(async (rows: Message[]) => {
    if (!user || !conversationId) return;

    const unreadFromOther = rows.filter((message) => message.sender_id !== user.id && message.status !== 'read');
    if (unreadFromOther.length === 0) return;

    const ids = unreadFromOther.map((message) => message.id);
    try {
      await supabase
        .from('messages')
        .update({ status: 'read', read_at: new Date().toISOString() })
        .in('id', ids);

      const lastMessage = unreadFromOther[unreadFromOther.length - 1];
      await supabase
        .from('conversation_participants')
        .update({ last_read_message_id: lastMessage.id, last_read_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .eq('user_id', user.id);
    } catch (error) {
      console.error('Failed to mark messages as read', error);
    }
  }, [conversationId, user]);

  // Mark messages as read when messages array or loading status changes
  useEffect(() => {
    if (!loading && messages.length > 0) {
      void markMessagesAsRead(messages);
    }
  }, [loading, markMessagesAsRead, messages]);

  // Handle Postgres realtime channel subscription
  useEffect(() => {
    if (!conversationId || !user) {
      return;
    }

    const channel = supabase
      .channel(`chat-${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        async (payload) => {
          const newMessage = payload.new as Message;

          // Invalidate cache to ensure fresh data on next load
          invalidateMessageCache(conversationId);

          setMessages((current) => {
            if (current.some((message) => message.id === newMessage.id)) {
              return current;
            }
            return [...current, newMessage];
          });
          scrollToBottom();

          if (newMessage.sender_id !== user.id && newMessage.status === 'sent') {
            try {
              await supabase
                .from('messages')
                .update({ status: 'read', read_at: new Date().toISOString() })
                .eq('id', newMessage.id);
              await supabase
                .from('conversation_participants')
                .update({ last_read_message_id: newMessage.id, last_read_at: new Date().toISOString() })
                .eq('conversation_id', conversationId)
                .eq('user_id', user.id);
            } catch (error) {
              console.error('Failed to update message status on realtime insert', error);
            }
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const updated = payload.new as Message;
          setMessages((current) => current.map((message) => (message.id === updated.id ? updated : message)));
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversation_preferences',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const nextRow = (payload.new || payload.old) as ConversationPreference | undefined;
          if (!nextRow || nextRow.user_id !== user.id) {
            return;
          }

          if (payload.eventType === 'DELETE') {
            setPreference(null);
            return;
          }

          setPreference(payload.new as ConversationPreference);
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, scrollToBottom, setMessages, setPreference, user]);
}
