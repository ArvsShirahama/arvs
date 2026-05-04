import { useState, useEffect, useRef, useCallback } from 'react';
import {
  IonPage,
  IonContent,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonBackButton,
  IonSpinner,
} from '@ionic/react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../supabaseClient';
import type { Message, Profile } from '../types/database';
import ChatBubble from '../components/ChatBubble';
import MessageInput from '../components/MessageInput';
import Avatar from '../components/Avatar';
import './Chat.css';

interface ChatParams {
  conversationId: string;
}

const Chat: React.FC = () => {
  const { conversationId } = useParams<ChatParams>();
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [otherUser, setOtherUser] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const contentRef = useRef<HTMLIonContentElement>(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      contentRef.current?.scrollToBottom(200);
    }, 100);
  }, []);

  useEffect(() => {
    if (!user || !conversationId) return;

    const fetchData = async () => {
      // Fetch other participant
      const { data: participants } = await supabase
        .from('conversation_participants')
        .select('user_id')
        .eq('conversation_id', conversationId)
        .neq('user_id', user.id);

      const otherUserId = participants?.[0]?.user_id;
      if (otherUserId) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', otherUserId)
          .single();
        setOtherUser(profile as Profile | null);
      }

      // Fetch messages
      const { data: msgs } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      setMessages((msgs as Message[]) ?? []);
      setLoading(false);
      scrollToBottom();
    };

    fetchData();
  }, [user, conversationId, scrollToBottom]);

  // Realtime subscription
  useEffect(() => {
    if (!conversationId) return;

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
        (payload) => {
          const newMsg = payload.new as Message;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
          scrollToBottom();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, scrollToBottom]);

  const handleSend = async (text: string) => {
    if (!user || !conversationId || sending) return;
    setSending(true);

    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: user.id,
      content: text,
    });

    setSending(false);
  };

  const displayName = otherUser?.display_name || otherUser?.username || 'Chat';

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/tabs/chats" text="" />
          </IonButtons>
          <div className="chat-header-info">
            {otherUser && (
              <Avatar
                src={otherUser.avatar_url}
                name={displayName}
                size="small"
              />
            )}
            <IonTitle className="chat-header-title">{displayName}</IonTitle>
          </div>
        </IonToolbar>
      </IonHeader>

      <IonContent ref={contentRef} className="chat-page" scrollEvents>
        {loading ? (
          <div className="chat-loading">
            <IonSpinner name="crescent" />
          </div>
        ) : messages.length === 0 ? (
          <div className="chat-empty">
            <p>No messages yet. Say hi!</p>
          </div>
        ) : (
          <div className="chat-messages">
            {messages.map((msg) => (
              <ChatBubble key={msg.id} message={msg} isMine={msg.sender_id === user?.id} />
            ))}
          </div>
        )}
      </IonContent>

      <MessageInput onSend={handleSend} disabled={sending} />
    </IonPage>
  );
};

export default Chat;
