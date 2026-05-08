import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
import type { Message, Profile, MessageType } from '../types/database';
import ChatBubble from '../components/ChatBubble';
import MessageInput from '../components/MessageInput';
import Avatar from '../components/Avatar';
import MediaPreview from '../components/MediaPreview';
import CameraModal from '../components/CameraModal';
import './Chat.css';

interface ChatParams {
  conversationId: string;
}

const Chat: React.FC = () => {
  const { conversationId } = useParams<ChatParams>();
  const { user, onlineUsers } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [otherUser, setOtherUser] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [mediaPreview, setMediaPreview] = useState<{ src: string; blob: Blob; type: 'image' | 'video' } | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const contentRef = useRef<HTMLIonContentElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
  const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50 MB

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

  // Mark unread messages as read when the conversation is open
  const markMessagesAsRead = useCallback(async (msgs: Message[]) => {
    if (!user || !conversationId) return;
    const unreadFromOther = msgs.filter(
      (m) => m.sender_id !== user.id && m.status !== 'read'
    );
    if (unreadFromOther.length === 0) return;

    const ids = unreadFromOther.map((m) => m.id);
    await supabase
      .from('messages')
      .update({ status: 'read', read_at: new Date().toISOString() })
      .in('id', ids);

    // Update read position
    const lastMsg = unreadFromOther[unreadFromOther.length - 1];
    await supabase
      .from('conversation_participants')
      .update({ last_read_message_id: lastMsg.id, last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', user.id);
  }, [user, conversationId]);

  // Mark messages as read on initial load
  useEffect(() => {
    if (!loading && messages.length > 0) {
      markMessagesAsRead(messages);
    }
  }, [loading, messages, markMessagesAsRead]);

  // Realtime subscription (INSERT + UPDATE)
  useEffect(() => {
    if (!conversationId || !user) return;

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
          const newMsg = payload.new as Message;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
          scrollToBottom();

          // Mark as delivered if it's from the other user
          if (newMsg.sender_id !== user.id && newMsg.status === 'sent') {
            await supabase
              .from('messages')
              .update({ status: 'read', read_at: new Date().toISOString() })
              .eq('id', newMsg.id);
            await supabase
              .from('conversation_participants')
              .update({ last_read_message_id: newMsg.id, last_read_at: new Date().toISOString() })
              .eq('conversation_id', conversationId)
              .eq('user_id', user.id);
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
          setMessages((prev) =>
            prev.map((m) => (m.id === updated.id ? updated : m))
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, user, scrollToBottom]);

  const uploadMedia = useCallback(async (blob: Blob, mediaType: 'image' | 'video'): Promise<string | null> => {
    if (!user || !conversationId) return null;
    const ext = mediaType === 'image' ? 'jpg' : (blob.type.includes('mp4') ? 'mp4' : 'webm');
    const filePath = `${user.id}/${conversationId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from('chat-media')
      .upload(filePath, blob, { contentType: blob.type });
    if (error) return null;
    const { data: urlData } = supabase.storage.from('chat-media').getPublicUrl(filePath);
    return urlData.publicUrl;
  }, [user, conversationId]);

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

  const handleSendMedia = async (caption: string) => {
    if (!user || !conversationId || !mediaPreview || sending) return;
    setSending(true);
    const url = await uploadMedia(mediaPreview.blob, mediaPreview.type);
    if (url) {
      await supabase.from('messages').insert({
        conversation_id: conversationId,
        sender_id: user.id,
        content: caption,
        message_type: mediaPreview.type as MessageType,
        media_url: url,
      });
    }
    // Revoke object URL to free memory
    if (mediaPreview.src.startsWith('blob:')) URL.revokeObjectURL(mediaPreview.src);
    setMediaPreview(null);
    setSending(false);
  };

  const handlePickGallery = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so the same file can be re-selected
    e.target.value = '';

    const isVideo = file.type.startsWith('video');
    const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
    if (file.size > maxSize) {
      alert(`File is too large. Max size: ${isVideo ? '50' : '10'} MB`);
      return;
    }

    const type: 'image' | 'video' = isVideo ? 'video' : 'image';
    const src = URL.createObjectURL(file);
    setMediaPreview({ src, blob: file, type });
  };

  const handleCameraCapture = (blob: Blob, type: 'image' | 'video') => {
    const maxSize = type === 'video' ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
    if (blob.size > maxSize) {
      alert(`Captured file is too large. Max size: ${type === 'video' ? '50' : '10'} MB`);
      return;
    }
    const src = URL.createObjectURL(blob);
    setMediaPreview({ src, blob, type });
    setShowCamera(false);
  };

  const isOnline = otherUser ? onlineUsers.has(otherUser.id) : false;

  const lastSeenText = useMemo(() => {
    if (!otherUser) return '';
    if (isOnline) return 'Online';
    if (!otherUser.last_seen) return 'Offline';
    const date = new Date(otherUser.last_seen);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Last seen just now';
    if (diffMins < 60) return `Last seen ${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `Last seen ${diffHours}h ago`;
    return `Last seen ${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  }, [otherUser, isOnline]);

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
                showStatus
                isOnline={isOnline}
              />
            )}
            <div className="chat-header-text">
              <IonTitle className="chat-header-title">{displayName}</IonTitle>
              <span className={`chat-header-status ${isOnline ? 'status-online' : ''}`}>{lastSeenText}</span>
            </div>
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

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        style={{ display: 'none' }}
        onChange={handleFileSelected}
      />

      <MessageInput
        onSend={handleSend}
        onPickGallery={handlePickGallery}
        onOpenCamera={() => setShowCamera(true)}
        disabled={sending}
      />

      {mediaPreview && (
        <MediaPreview
          src={mediaPreview.src}
          type={mediaPreview.type}
          onSend={handleSendMedia}
          onCancel={() => {
            if (mediaPreview.src.startsWith('blob:')) URL.revokeObjectURL(mediaPreview.src);
            setMediaPreview(null);
          }}
        />
      )}

      {showCamera && (
        <CameraModal
          onCapture={handleCameraCapture}
          onClose={() => setShowCamera(false)}
        />
      )}
    </IonPage>
  );
};

export default Chat;
