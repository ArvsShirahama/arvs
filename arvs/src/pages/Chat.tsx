import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import {
  IonActionSheet,
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonList,
  IonPage,
  IonPopover,
  IonSpinner,
  IonTitle,
  IonToolbar,
  useIonRouter,
  useIonToast,
} from '@ionic/react';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { ellipsisVertical, imageOutline, settingsOutline } from 'ionicons/icons';
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
import { getConversationContext } from '../services/conversationService';
import {
  getConversationDisplayName,
  getConversationTheme,
} from '../services/conversationThemes';
import { sendChatPush } from '../services/pushService';
import { supabase } from '../supabaseClient';
import type {
  ConversationPreference,
  Message,
  MessageType,
  Profile,
} from '../types/database';
import './Chat.css';

interface ChatParams {
  conversationId: string;
}

interface MediaDraft {
  src: string;
  blob: Blob;
  type: 'image' | 'video' | 'file';
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

const MESSAGE_PAGE_SIZE = 30;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE = 50 * 1024 * 1024;
const MAX_FILE_SIZE = 25 * 1024 * 1024;

function sanitizeFileName(fileName: string): string {
  return fileName.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
}

function fallbackFileName(type: MediaDraft['type'], mimeType: string): string {
  if (type === 'image') {
    return mimeType.includes('png') ? 'photo.png' : 'photo.jpg';
  }
  if (type === 'video') {
    return mimeType.includes('webm') ? 'video.webm' : 'video.mp4';
  }
  return 'attachment';
}

const Chat: React.FC = () => {
  const { conversationId } = useParams<ChatParams>();
  const { user, onlineUsers } = useAuth();
  const router = useIonRouter();
  const [presentToast] = useIonToast();

  const [messages, setMessages] = useState<Message[]>([]);
  const [otherUser, setOtherUser] = useState<Profile | null>(null);
  const [preference, setPreference] = useState<ConversationPreference | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [oldestCursor, setOldestCursor] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [showChatMenu, setShowChatMenu] = useState(false);

  const [mediaPreview, setMediaPreview] = useState<MediaDraft | null>(null);
  const [mediaViewer, setMediaViewer] = useState<{ src: string; type: 'image' | 'video' } | null>(null);
  const [showCaptureSheet, setShowCaptureSheet] = useState(false);
  const [showGallerySheet, setShowGallerySheet] = useState(false);

  const contentRef = useRef<HTMLIonContentElement>(null);
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const galleryVideoInputRef = useRef<HTMLInputElement>(null);
  const captureVideoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const notifyPush = useCallback(async (messageId: string) => {
    try {
      await sendChatPush(messageId);
    } catch (error) {
      console.warn('Push dispatch failed', error);
    }
  }, []);

  const applyMediaPreview = useCallback((draft: MediaDraft) => {
    const maxSize = draft.type === 'image'
      ? MAX_IMAGE_SIZE
      : draft.type === 'video'
        ? MAX_VIDEO_SIZE
        : MAX_FILE_SIZE;

    if (draft.sizeBytes > maxSize) {
      const maxSizeLabel = draft.type === 'image' ? '10 MB' : draft.type === 'video' ? '50 MB' : '25 MB';
      showToast(`File is too large. Max size: ${maxSizeLabel}`, 'warning');
      if (draft.src.startsWith('blob:')) {
        URL.revokeObjectURL(draft.src);
      }
      return;
    }

    setMediaPreview((previous) => {
      if (previous) {
        revokePreviewUrl(previous.src);
      }
      return draft;
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
    } catch {
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

  useEffect(() => {
    if (!conversationId || loading) return;
    setCachedMessages({
      conversationId,
      messages,
      oldestCursor,
      hasMore: hasMoreMessages,
    });
  }, [conversationId, hasMoreMessages, loading, messages, oldestCursor]);

  const markMessagesAsRead = useCallback(async (rows: Message[]) => {
    if (!user || !conversationId) return;

    const unreadFromOther = rows.filter((message) => message.sender_id !== user.id && message.status !== 'read');
    if (unreadFromOther.length === 0) return;

    const ids = unreadFromOther.map((message) => message.id);
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
  }, [conversationId, user]);

  useEffect(() => {
    if (!loading && messages.length > 0) {
      void markMessagesAsRead(messages);
    }
  }, [loading, markMessagesAsRead, messages]);

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
          setMessages((current) => {
            if (current.some((message) => message.id === newMessage.id)) {
              return current;
            }
            return [...current, newMessage];
          });
          scrollToBottom();

          if (newMessage.sender_id !== user.id && newMessage.status === 'sent') {
            await supabase
              .from('messages')
              .update({ status: 'read', read_at: new Date().toISOString() })
              .eq('id', newMessage.id);
            await supabase
              .from('conversation_participants')
              .update({ last_read_message_id: newMessage.id, last_read_at: new Date().toISOString() })
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
  }, [conversationId, scrollToBottom, user]);

  useEffect(() => {
    return () => {
      if (mediaPreview) {
        revokePreviewUrl(mediaPreview.src);
      }
    };
  }, [mediaPreview, revokePreviewUrl]);

  const loadOlderMessages = async () => {
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
    } catch {
      showToast('Could not load older messages.');
    } finally {
      setLoadingOlder(false);
    }
  };

  const uploadMedia = useCallback(async (draft: MediaDraft): Promise<{ url: string; path: string } | null> => {
    if (!user || !conversationId) {
      return null;
    }

    const fileName = sanitizeFileName(draft.fileName || fallbackFileName(draft.type, draft.mimeType));
    const filePath = `${user.id}/${conversationId}/${Date.now()}-${fileName}`;

    const { error } = await supabase.storage
      .from('chat-media')
      .upload(filePath, draft.blob, {
        contentType: draft.mimeType || undefined,
      });

    if (error) {
      return null;
    }

    const { data } = supabase.storage.from('chat-media').getPublicUrl(filePath);
    return { url: data.publicUrl, path: filePath };
  }, [conversationId, user]);

  const handleSend = async (text: string) => {
    if (!user || !conversationId || sending) {
      return;
    }

    setSending(true);
    const { data, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: user.id,
        content: text,
      })
      .select('id')
      .single();
    setSending(false);

    if (error) {
      showToast('Message failed to send.');
      return;
    }

    if (data?.id) {
      void notifyPush(data.id);
    }
  };

  const handleSendMedia = async (caption: string) => {
    if (!user || !conversationId || !mediaPreview || sending) {
      return;
    }

    setSending(true);
    const uploaded = await uploadMedia(mediaPreview);
    if (!uploaded) {
      setSending(false);
      showToast('Unable to upload attachment.');
      return;
    }

    const { data, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: user.id,
        content: caption,
        message_type: mediaPreview.type as MessageType,
        media_url: uploaded.url,
        media_path: uploaded.path,
        media_name: mediaPreview.fileName,
        media_mime_type: mediaPreview.mimeType,
        media_size_bytes: mediaPreview.sizeBytes,
      })
      .select('id')
      .single();

    revokePreviewUrl(mediaPreview.src);
    setMediaPreview(null);
    setSending(false);

    if (error) {
      showToast('Unable to send attachment.');
      return;
    }

    if (data?.id) {
      void notifyPush(data.id);
    }
  };

  const takePhoto = async () => {
    try {
      const photo = await Camera.getPhoto({
        quality: 85,
        source: CameraSource.Camera,
        resultType: CameraResultType.Uri,
      });

      if (!photo.webPath) {
        return;
      }

      const blob = await fetchBlobFromWebPath(photo.webPath);
      if (!blob) {
        showToast('Could not process captured photo.');
        return;
      }

      applyMediaPreview({
        src: photo.webPath,
        blob,
        type: 'image',
        fileName: `photo.${photo.format || 'jpg'}`,
        mimeType: blob.type || 'image/jpeg',
        sizeBytes: blob.size,
      });
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
      if (!selected?.webPath) {
        return;
      }

      const blob = await fetchBlobFromWebPath(selected.webPath);
      if (!blob) {
        showToast('Could not process selected image.');
        return;
      }

      applyMediaPreview({
        src: selected.webPath,
        blob,
        type: 'image',
        fileName: `photo.${selected.format || 'jpg'}`,
        mimeType: blob.type || 'image/jpeg',
        sizeBytes: blob.size,
      });
    } catch {
      // user cancellation is expected and should stay silent
    }
  };

  const handleImageFileSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    event.target.value = '';
    applyMediaPreview({
      src: URL.createObjectURL(file),
      blob: file,
      type: 'image',
      fileName: file.name,
      mimeType: file.type || 'image/jpeg',
      sizeBytes: file.size,
    });
  };

  const handleVideoFileSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    event.target.value = '';
    applyMediaPreview({
      src: URL.createObjectURL(file),
      blob: file,
      type: 'video',
      fileName: file.name,
      mimeType: file.type || 'video/mp4',
      sizeBytes: file.size,
    });
  };

  const handleFileSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    event.target.value = '';
    applyMediaPreview({
      src: URL.createObjectURL(file),
      blob: file,
      type: 'file',
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
    });
  };

  const isOnline = otherUser ? onlineUsers.has(otherUser.id) : false;
  const activeTheme = useMemo(() => getConversationTheme(preference?.theme_id), [preference?.theme_id]);

  const themeVars = useMemo(() => ({
    '--conversation-bubble-mine': activeTheme.bubbleMine,
    '--conversation-bubble-theirs': activeTheme.bubbleTheirs,
    '--conversation-bubble-theirs-text': activeTheme.bubbleTheirsText,
    '--conversation-toolbar-surface': activeTheme.toolbarSurface,
    '--conversation-input-surface': activeTheme.inputSurface,
    '--conversation-input-border': activeTheme.inputBorder,
  }) as CSSProperties, [activeTheme]);

  const chatBackgroundStyle = useMemo(() => ({
    backgroundImage: preference?.background_image_url
      ? `${activeTheme.overlay}, url(${preference.background_image_url})`
      : activeTheme.gradient,
  }), [activeTheme, preference?.background_image_url]);

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

  const displayName = getConversationDisplayName(otherUser, preference);

  return (
    <IonPage style={themeVars}>
      <IonHeader>
        <IonToolbar className="chat-toolbar">
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
          <IonButtons slot="end">
            <IonButton fill="clear" onClick={() => setShowChatMenu(true)} aria-label="Conversation options">
              <IonIcon icon={ellipsisVertical} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent ref={contentRef} className="chat-page" fullscreen>
        {loading ? (
          <div className="chat-loading">
            <IonSpinner name="crescent" />
          </div>
        ) : (
          <div className="chat-stage" style={chatBackgroundStyle}>
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
                {messages.map((message) => (
                  <ChatBubble
                    key={message.id}
                    message={message}
                    isMine={message.sender_id === user?.id}
                    onMediaOpen={(src, type) => setMediaViewer({ src, type })}
                  />
                ))}
              </div>
            )}
          </div>
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

      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={handleFileSelected}
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
            text: 'File',
            handler: () => {
              fileInputRef.current?.click();
            },
          },
          {
            text: 'Cancel',
            role: 'cancel',
          },
        ]}
      />

      <IonPopover isOpen={showChatMenu} onDidDismiss={() => setShowChatMenu(false)} className="chat-menu-popover">
        <IonList lines="none">
          <IonItem
            button
            detail={false}
            onClick={() => {
              setShowChatMenu(false);
              router.push(`/chat/${conversationId}/settings`, 'forward');
            }}
          >
            <IonIcon icon={settingsOutline} slot="start" />
            Conversation Settings
          </IonItem>
          <IonItem
            button
            detail={false}
            onClick={() => {
              setShowChatMenu(false);
              router.push(`/chat/${conversationId}/media`, 'forward');
            }}
          >
            <IonIcon icon={imageOutline} slot="start" />
            View All Media
          </IonItem>
        </IonList>
      </IonPopover>

      <MediaPreview
        isOpen={!!mediaPreview}
        src={mediaPreview?.src ?? ''}
        type={mediaPreview?.type ?? 'image'}
        fileName={mediaPreview?.fileName}
        fileSizeBytes={mediaPreview?.sizeBytes ?? null}
        sending={sending}
        onSend={handleSendMedia}
        onCancel={() => {
          if (!mediaPreview) {
            return;
          }
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
