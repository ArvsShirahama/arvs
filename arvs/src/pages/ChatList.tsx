import { useCallback, useEffect, useState } from 'react';
import {
  IonContent,
  IonFab,
  IonFabButton,
  IonHeader,
  IonIcon,
  IonInfiniteScroll,
  IonInfiniteScrollContent,
  IonList,
  IonPage,
  IonSkeletonText,
  IonText,
  IonTitle,
  IonToolbar,
  useIonRouter,
} from '@ionic/react';
import { add } from 'ionicons/icons';
import ChatListItem from '../components/ChatListItem';
import NewChatModal from '../components/NewChatModal';
import { useAuth } from '../hooks/useAuth';
import {
  getConversationSummary,
  getSummaries,
  upsertSummaryFromRealtime,
} from '../services/chatService';
import { supabase } from '../supabaseClient';
import type { ConversationWithDetails, Message } from '../types/database';
import './ChatList.css';

const SUMMARY_PAGE_SIZE = 30;

const ChatList: React.FC = () => {
  const { user, onlineUsers } = useAuth();
  const router = useIonRouter();
  const [conversations, setConversations] = useState<ConversationWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [showNewChat, setShowNewChat] = useState(false);

  const fetchConversations = useCallback(async (reset = false) => {
    if (!user) return;

    if (reset) {
      setLoading(true);
      const firstPage = await getSummaries(user.id, SUMMARY_PAGE_SIZE, null);
      setConversations(firstPage);
      setHasMore(firstPage.length === SUMMARY_PAGE_SIZE);
      setNextCursor(firstPage.length > 0 ? firstPage[firstPage.length - 1].updated_at : null);
      setLoading(false);
      return;
    }

    if (loadingMore || !hasMore || !nextCursor) return;

    setLoadingMore(true);
    try {
      const nextPage = await getSummaries(user.id, SUMMARY_PAGE_SIZE, nextCursor);
      setConversations((prev) => {
        const ids = new Set(prev.map((item) => item.id));
        const deduped = nextPage.filter((item) => !ids.has(item.id));
        return [...prev, ...deduped];
      });
      setHasMore(nextPage.length === SUMMARY_PAGE_SIZE);
      setNextCursor(nextPage.length > 0 ? nextPage[nextPage.length - 1].updated_at : nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }, [user, hasMore, loadingMore, nextCursor]);

  useEffect(() => {
    fetchConversations(true);
  }, [fetchConversations]);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('chat-list-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        async (payload) => {
          const message = payload.new as Message;
          const summary = await getConversationSummary(message.conversation_id, user.id);
          if (!summary) return;
          setConversations((prev) => upsertSummaryFromRealtime(prev, summary));
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        async (payload) => {
          const message = payload.new as Message;
          const summary = await getConversationSummary(message.conversation_id, user.id);
          if (!summary) return;
          setConversations((prev) => upsertSummaryFromRealtime(prev, summary));
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversation_preferences',
          filter: `user_id=eq.${user.id}`,
        },
        async (payload) => {
          const conversationId = (payload.new as { conversation_id?: string } | null)?.conversation_id
            ?? (payload.old as { conversation_id?: string } | null)?.conversation_id;
          if (!conversationId) return;

          const summary = await getConversationSummary(conversationId, user.id);
          if (!summary) return;
          setConversations((prev) => upsertSummaryFromRealtime(prev, summary));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Chats</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="chatlist-page">
        {loading ? (
          <IonList lines="none" className="chatlist-list">
            {[...Array(6)].map((_, idx) => (
              <div key={idx} className="chatlist-skeleton-row">
                <IonSkeletonText animated className="chatlist-skeleton-avatar" />
                <div className="chatlist-skeleton-body">
                  <IonSkeletonText animated className="chatlist-skeleton-line-lg" />
                  <IonSkeletonText animated className="chatlist-skeleton-line-sm" />
                </div>
              </div>
            ))}
          </IonList>
        ) : conversations.length === 0 ? (
          <div className="chatlist-empty">
            <IonText color="medium">
              <p>No conversations yet</p>
              <p className="chatlist-empty-hint">Tap + to start chatting</p>
            </IonText>
          </div>
        ) : (
          <IonList lines="none" className="chatlist-list">
            {conversations.map((conv) => (
              <ChatListItem
                key={conv.id}
                conversation={conv}
                currentUserId={user!.id}
                isOnline={onlineUsers.has(conv.other_user.id)}
              />
            ))}
          </IonList>
        )}

        <IonInfiniteScroll
          disabled={loading || !hasMore}
          threshold="100px"
          onIonInfinite={async (event) => {
            await fetchConversations(false);
            (event.target as HTMLIonInfiniteScrollElement).complete();
          }}
        >
          <IonInfiniteScrollContent
            loadingSpinner="crescent"
            loadingText={loadingMore ? 'Loading more chats...' : 'Loading more'}
          />
        </IonInfiniteScroll>

        <IonFab vertical="bottom" horizontal="end" slot="fixed">
          <IonFabButton onClick={() => setShowNewChat(true)}>
            <IonIcon icon={add} />
          </IonFabButton>
        </IonFab>

        <NewChatModal
          isOpen={showNewChat}
          onDismiss={() => setShowNewChat(false)}
          onConversationCreated={(conversationId) => {
            setShowNewChat(false);
            router.push(`/chat/${conversationId}`, 'forward');
          }}
        />
      </IonContent>
    </IonPage>
  );
};

export default ChatList;
