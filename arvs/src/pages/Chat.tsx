import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IonActionSheet,
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonPage,
  IonSpinner,
  IonTitle,
  IonToolbar,
  useIonToast,
} from '@ionic/react';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { useParams } from 'react-router-dom';
import Avatar from '../components/Avatar';
import ChatBubble from '../components/ChatBubble';
import MediaPreview from '../components/MediaPreview';
import MediaViewerModal from '../components/MediaViewerModal';
import MessageInput from '../components/MessageInput';
import { useAuth } from '../hooks/useAuth';
import {
  getCachedMessages,
  getMessagesPage,
  setCachedMessages,
} from '../services/chatService';
import { supabase } from '../supabaseClient';
import type { Message, MessageType, Profile } from '../types/database';
import './Chat.css';

interface ChatParams {
  conversationId: string;
}

const MESSAGE_PAGE_SIZE = 30;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE = 50 * 1024 * 1024;

const Chat: React.FC = () => {
  const { conversationId } = useParams<ChatParams>();
  const { user, onlineUsers } = useAuth();
  const [presentToast] = useIonToast();

  const [messages, setMessages] = useState<Message[]>([]);
  const [otherUser, setOtherUser] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [oldestCursor, setOldestCursor] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const [mediaPreview, setMediaPreview] = useState<{ src: string; blob: Blob; type: 'image' | 'video' } | null>(null);
  const [mediaViewer, setMediaViewer] = useState<{ src: string; type: 'image' | 'video' } | null>(null);
  const [showCaptureSheet, setShowCaptureSheet] = useState(false);
  const [showGallerySheet, setShowGallerySheet] = useState(false);

  const contentRef = useRef<HTMLIonContentElement>(null);
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const galleryVideoInputRef = useRef<HTMLInputElement>(null);
  const captureVideoInputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((message: string, color: 'danger' | 'warning' | 'success' = 'danger') => {
    presentToast({ message, color, duration: 2200, position: 'top' });
  }, [presentToast]);

  const revokePreviewUrl = useCallback((src: string) => {
    if (src.startsWith('blob:')) {
      URL.revokeObjectURL(src);
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      contentRef.current?.scrollToBottom(200);
    });
  }, []);

  const applyMediaPreview = useCallback((blob: Blob, type: 'image' | 'video', src: string) => {
    const maxSize = type === 'video' ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
    if (blob.size > maxSize) {
      showToast(`File is too large. Max size: ${type === 'video' ? '50' : '10'} MB`, 'warning');
      return;
    }

    setMediaPreview((prev) => {
      if (prev) revokePreviewUrl(prev.src);
      return { src, blob, type };
    });
  }, [revokePreviewUrl, showToast]);

  const fetchBlobFromWebPath = useCallback(async (webPath: string): Promise<Blob | null> => {
    try {
      const response = await fetch(webPath);
      return await response.blob();
    } catch {
      return null;
    }
  }, []);

  const loadConversation = useCallback(async () => {
    if (!user || !conversationId) return;

    setLoading(true);

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

    const cached = getCachedMessages(conversationId);
    if (cached) {
      setMessages(cached.messages);
      setOldestCursor(cached.oldestCursor);
      setHasMoreMessages(cached.hasMore);
      setLoading(false);
      scrollToBottom();
      return;
    }

    try {
      const page = await getMessagesPage(conversationId, { beforeCreatedAt: null, limit: MESSAGE_PAGE_SIZE });
      setMessages(page.messages);
      setOldestCursor(page.oldestCursor);
      setHasMoreMessages(page.hasMore);
      scrollToBottom();
    } catch {
      showToast('Failed to load messages. Please try again.');
      setMessages([]);
      setOldestCursor(null);
      setHasMoreMessages(false);
    } finally {
      setLoading(false);
    }
  }, [conversationId, scrollToBottom, showToast, user]);

  useEffect(() => {
    loadConversation();
  }, [loadConversation]);

  useEffect(() => {
    if (!conversationId || loading) return;
    setCachedMessages({
      conversationId,
      messages,
      oldestCursor,
      hasMore: hasMoreMessages,
    });
  }, [conversationId, hasMoreMessages, loading, messages, oldestCursor]);

  const markMessagesAsRead = useCallback(async (msgs: Message[]) => {
    if (!user || !conversationId) return;

    const unreadFromOther = msgs.filter((m) => m.sender_id !== user.id && m.status !== 'read');
    if (unreadFromOther.length === 0) return;

    const ids = unreadFromOther.map((m) => m.id);
    await supabase
      .from('messages')
      .update({ status: 'read', read_at: new Date().toISOString() })
      .in('id', ids);

    const lastMsg = unreadFromOther[unreadFromOther.length - 1];
    await supabase
      .from('conversation_participants')
      .update({ last_read_message_id: lastMsg.id, last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', user.id);
  }, [conversationId, user]);

  useEffect(() => {
    if (!loading && messages.length > 0) {
      markMessagesAsRead(messages);
    }
  }, [loading, markMessagesAsRead, messages]);

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
          setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, scrollToBottom, user]);

  useEffect(() => {
    return () => {
      if (mediaPreview) {
        revokePreviewUrl(mediaPreview.src);
      }
    };
  }, [mediaPreview, revokePreviewUrl]);

  const loadOlderMessages = async () => {
    if (!conversationId || loadingOlder || !hasMoreMessages || !oldestCursor) return;

    setLoadingOlder(true);
    try {
      const page = await getMessagesPage(conversationId, {
        beforeCreatedAt: oldestCursor,
        limit: MESSAGE_PAGE_SIZE,
      });

      setMessages((prev) => {
        const existing = new Set(prev.map((message) => message.id));
        const older = page.messages.filter((message) => !existing.has(message.id));
        return [...older, ...prev];
      });
      setOldestCursor(page.oldestCursor);
      setHasMoreMessages(page.hasMore);
    } catch {
      showToast('Could not load older messages.');
    } finally {
      setLoadingOlder(false);
    }
  };

  const uploadMedia = useCallback(async (blob: Blob, mediaType: 'image' | 'video'): Promise<string | null> => {
    if (!user || !conversationId) return null;

    const ext = mediaType === 'image' ? 'jpg' : (blob.type.includes('mp4') ? 'mp4' : 'webm');
    const filePath = `${user.id}/${conversationId}/${Date.now()}.${ext}`;

    const { error } = await supabase.storage
      .from('chat-media')
      .upload(filePath, blob, { contentType: blob.type || undefined });
    if (error) return null;

    const { data: urlData } = supabase.storage.from('chat-media').getPublicUrl(filePath);
    return urlData.publicUrl;
  }, [conversationId, user]);

  const handleSend = async (text: string) => {
    if (!user || !conversationId || sending) return;

    setSending(true);
    const { error } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: user.id,
      content: text,
    });
    setSending(false);

    if (error) {
      showToast('Message failed to send.');
    }
  };

  const handleSendMedia = async (caption: string) => {
    if (!user || !conversationId || !mediaPreview || sending) return;

    setSending(true);
    const url = await uploadMedia(mediaPreview.blob, mediaPreview.type);
    if (!url) {
      setSending(false);
      showToast('Unable to upload media.');
      return;
    }

    const { error } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: user.id,
      content: caption,
      message_type: mediaPreview.type as MessageType,
      media_url: url,
    });

    revokePreviewUrl(mediaPreview.src);
    setMediaPreview(null);
    setSending(false);

    if (error) {
      showToast('Unable to send media.');
    }
  };

  const takePhoto = async () => {
    try {
      const photo = await Camera.getPhoto({
        quality: 85,
        source: CameraSource.Camera,
        resultType: CameraResultType.Uri,
      });

      if (!photo.webPath) return;

      const blob = await fetchBlobFromWebPath(photo.webPath);
      if (!blob) {
        showToast('Could not process captured photo.');
        return;
      }

      applyMediaPreview(blob, 'image', photo.webPath);
    } catch {
      // user cancellation is expected and should stay silent
    }
  };

  const pickImageFromGallery = async () => {
    if (!Capacitor.isNativePlatform()) {
      imageFileInputRef.current?.click();
      return;
    }

    try {
      const result = await Camera.pickImages({ quality: 85, limit: 1 });
      const selected = result.photos?.[0];
      if (!selected?.webPath) return;

      const blob = await fetchBlobFromWebPath(selected.webPath);
      if (!blob) {
        showToast('Could not process selected image.');
        return;
      }

      applyMediaPreview(blob, 'image', selected.webPath);
    } catch {
      // user cancellation is expected and should stay silent
    }
  };

  const handleImageFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    e.target.value = '';
    applyMediaPreview(file, 'image', URL.createObjectURL(file));
  };

  const handleVideoFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    e.target.value = '';
    applyMediaPreview(file, 'video', URL.createObjectURL(file));
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
  }, [isOnline, otherUser]);

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

      <IonContent ref={contentRef} className="chat-page" fullscreen>
        {loading ? (
          <div className="chat-loading">
            <IonSpinner name="crescent" />
          </div>
        ) : (
          <>
            {hasMoreMessages && (
              <div className="chat-load-more-wrap">
                <IonButton fill="clear" size="small" onClick={loadOlderMessages} disabled={loadingOlder}>
                  {loadingOlder ? <IonSpinner name="crescent" /> : 'Load older messages'}
                </IonButton>
              </div>
            )}

            {messages.length === 0 ? (
              <div className="chat-empty">
                <p>No messages yet. Say hi!</p>
              </div>
            ) : (
              <div className="chat-messages">
                {messages.map((msg) => (
                  <ChatBubble
                    key={msg.id}
                    message={msg}
                    isMine={msg.sender_id === user?.id}
                    onMediaOpen={(src, type) => setMediaViewer({ src, type })}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </IonContent>

      <MessageInput
        onSend={handleSend}
        onPickGallery={() => setShowGallerySheet(true)}
        onOpenCamera={() => setShowCaptureSheet(true)}
        disabled={sending}
      />

      <input
        ref={imageFileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleImageFileSelected}
      />

      <input
        ref={galleryVideoInputRef}
        type="file"
        accept="video/*"
        style={{ display: 'none' }}
        onChange={handleVideoFileSelected}
      />

      <input
        ref={captureVideoInputRef}
        type="file"
        accept="video/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleVideoFileSelected}
      />

      <IonActionSheet
        isOpen={showCaptureSheet}
        onDidDismiss={() => setShowCaptureSheet(false)}
        header="Capture"
        buttons={[
          {
            text: 'Take Photo',
            handler: () => {
              void takePhoto();
            },
          },
          {
            text: 'Record Video (fallback)',
            handler: () => {
              captureVideoInputRef.current?.click();
            },
          },
          {
            text: 'Cancel',
            role: 'cancel',
          },
        ]}
      />

      <IonActionSheet
        isOpen={showGallerySheet}
        onDidDismiss={() => setShowGallerySheet(false)}
        header="Attach"
        buttons={[
          {
            text: 'Photo from Library',
            handler: () => {
              void pickImageFromGallery();
            },
          },
          {
            text: 'Video from Library',
            handler: () => {
              galleryVideoInputRef.current?.click();
            },
          },
          {
            text: 'Cancel',
            role: 'cancel',
          },
        ]}
      />

      <MediaPreview
        isOpen={!!mediaPreview}
        src={mediaPreview?.src ?? ''}
        type={mediaPreview?.type ?? 'image'}
        sending={sending}
        onSend={handleSendMedia}
        onCancel={() => {
          if (!mediaPreview) return;
          revokePreviewUrl(mediaPreview.src);
          setMediaPreview(null);
        }}
      />

      <MediaViewerModal
        isOpen={!!mediaViewer}
        src={mediaViewer?.src ?? ''}
        type={mediaViewer?.type ?? 'image'}
        onClose={() => setMediaViewer(null)}
      />
    </IonPage>
  );
};

export default Chat;
