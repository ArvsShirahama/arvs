import { useState, useEffect, useCallback } from 'react';
import {
  IonPage,
  IonContent,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonList,
  IonFab,
  IonFabButton,
  IonIcon,
  IonSpinner,
  IonText,
} from '@ionic/react';
import { add } from 'ionicons/icons';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../supabaseClient';
import type { ConversationWithDetails, Profile, Message } from '../types/database';
import ChatListItem from '../components/ChatListItem';
import NewChatModal from '../components/NewChatModal';
import './ChatList.css';

const ChatList: React.FC = () => {
  const { user, onlineUsers } = useAuth();
  const [conversations, setConversations] = useState<ConversationWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewChat, setShowNewChat] = useState(false);

  const fetchConversations = useCallback(async () => {
    if (!user) return;

    const { data: participantRows } = await supabase
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', user.id);

    if (!participantRows || participantRows.length === 0) {
      setConversations([]);
      setLoading(false);
      return;
    }

    const conversationIds = participantRows.map((r) => r.conversation_id);

    const { data: convos } = await supabase
      .from('conversations')
      .select('*')
      .in('id', conversationIds)
      .order('updated_at', { ascending: false });

    if (!convos) {
      setConversations([]);
      setLoading(false);
      return;
    }

    const results: ConversationWithDetails[] = [];

    for (const conv of convos) {
      const { data: participants } = await supabase
        .from('conversation_participants')
        .select('user_id')
        .eq('conversation_id', conv.id)
        .neq('user_id', user.id);

      const otherUserId = participants?.[0]?.user_id;
      if (!otherUserId) continue;

      const { data: otherProfile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', otherUserId)
        .single();

      const { data: lastMsg } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Get user's read position for this conversation
      const { data: myParticipant } = await supabase
        .from('conversation_participants')
        .select('last_read_message_id')
        .eq('conversation_id', conv.id)
        .eq('user_id', user.id)
        .maybeSingle();

      // Count unread messages (from other user, after my last read)
      let unreadCount = 0;
      if (myParticipant?.last_read_message_id) {
        const { data: lastReadMsg } = await supabase
          .from('messages')
          .select('created_at')
          .eq('id', myParticipant.last_read_message_id)
          .maybeSingle();
        if (lastReadMsg) {
          const { count } = await supabase
            .from('messages')
            .select('*', { count: 'exact', head: true })
            .eq('conversation_id', conv.id)
            .neq('sender_id', user.id)
            .gt('created_at', lastReadMsg.created_at);
          unreadCount = count ?? 0;
        }
      } else {
        // Never read — count all messages from other user
        const { count } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('conversation_id', conv.id)
          .neq('sender_id', user.id);
        unreadCount = count ?? 0;
      }

      results.push({
        id: conv.id,
        updated_at: conv.updated_at,
        other_user: otherProfile as Profile,
        last_message: (lastMsg as Message) ?? null,
        unread_count: unreadCount,
      });
    }

    setConversations(results);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('chat-list-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        () => {
          fetchConversations();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        () => {
          fetchConversations();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchConversations]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Chats</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="chatlist-page">
        {loading ? (
          <div className="chatlist-loading">
            <IonSpinner name="crescent" />
          </div>
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
              <ChatListItem key={conv.id} conversation={conv} currentUserId={user!.id} isOnline={onlineUsers.has(conv.other_user.id)} />
            ))}
          </IonList>
        )}

        <IonFab vertical="bottom" horizontal="end" slot="fixed">
          <IonFabButton onClick={() => setShowNewChat(true)}>
            <IonIcon icon={add} />
          </IonFabButton>
        </IonFab>

        <NewChatModal
          isOpen={showNewChat}
          onDismiss={() => setShowNewChat(false)}
          onConversationCreated={() => {
            setShowNewChat(false);
            fetchConversations();
          }}
        />
      </IonContent>
    </IonPage>
  );
};

export default ChatList;
