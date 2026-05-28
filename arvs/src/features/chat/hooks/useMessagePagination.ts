import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../auth/hooks';
import {
  getCachedMessages,
  getMessagesPage,
  setCachedMessages,
  getConversationContext,
} from '../services';
import type { ConversationPreference, Message, Profile } from '../../../types/database';

const MESSAGE_PAGE_SIZE = 30;

export function useMessagePagination(
  conversationId: string,
  scrollToBottom: () => void,
  showToast: (message: string, color?: 'danger' | 'warning' | 'success') => void
) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [otherUser, setOtherUser] = useState<Profile | null>(null);
  const [preference, setPreference] = useState<ConversationPreference | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [oldestCursor, setOldestCursor] = useState<string | null>(null);

  const loadConversation = useCallback(async () => {
    if (!user || !conversationId) {
      return;
    }

    setLoading(true);

    try {
      const context = await getConversationContext(conversationId, user.id);
      setOtherUser(context.otherUser);
      setPreference(context.preference);

      const cached = getCachedMessages(conversationId);
      if (cached) {
        setMessages(cached.messages);
        setOldestCursor(cached.oldestCursor);
        setHasMoreMessages(cached.hasMore);
        setLoading(false);
        scrollToBottom();
        return;
      }

      const page = await getMessagesPage(conversationId, { beforeCreatedAt: null, limit: MESSAGE_PAGE_SIZE });
      setMessages(page.messages);
      setOldestCursor(page.oldestCursor);
      setHasMoreMessages(page.hasMore);
      scrollToBottom();
    } catch (error) {
      console.error('Failed to load conversation context or messages', error);
      showToast('Failed to load this conversation. Please try again.');
      setMessages([]);
      setOldestCursor(null);
      setHasMoreMessages(false);
    } finally {
      setLoading(false);
    }
  }, [conversationId, scrollToBottom, showToast, user]);

  useEffect(() => {
    void loadConversation();
  }, [loadConversation]);

  // Sync state back to cache whenever messages change
  useEffect(() => {
    if (!conversationId || loading) return;
    setCachedMessages({
      conversationId,
      messages,
      oldestCursor,
      hasMore: hasMoreMessages,
    });
  }, [conversationId, hasMoreMessages, loading, messages, oldestCursor]);

  const loadOlderMessages = useCallback(async () => {
    if (!conversationId || loadingOlder || !hasMoreMessages || !oldestCursor) {
      return;
    }

    setLoadingOlder(true);
    try {
      const page = await getMessagesPage(conversationId, {
        beforeCreatedAt: oldestCursor,
        limit: MESSAGE_PAGE_SIZE,
      });

      setMessages((current) => {
        const existingIds = new Set(current.map((message) => message.id));
        const olderMessages = page.messages.filter((message) => !existingIds.has(message.id));
        return [...olderMessages, ...current];
      });
      setOldestCursor(page.oldestCursor);
      setHasMoreMessages(page.hasMore);
    } catch (error) {
      console.error('Could not load older messages', error);
      showToast('Could not load older messages.');
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, hasMoreMessages, loadingOlder, oldestCursor, showToast]);

  return {
    messages,
    setMessages,
    otherUser,
    preference,
    setPreference,
    loading,
    loadingOlder,
    hasMoreMessages,
    loadOlderMessages,
    loadConversation,
  };
}


