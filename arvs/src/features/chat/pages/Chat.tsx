import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  IonActionSheet,
  IonAlert,
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonPage,
  IonSpinner,
  IonTitle,
  IonToolbar,
  useIonRouter,
  useIonToast,
} from '@ionic/react';
import { ellipsisVertical, videocamOutline } from 'ionicons/icons';
import { useParams } from 'react-router-dom';
import Avatar from '../../../components/Avatar';
import { ChatBubble, MediaPreview, MediaViewerModal, MessageInput } from '../components';
import ErrorBoundary from '../../../components/ErrorBoundary';
import { IncomingCallOverlay, VideoCallModal } from '../../calls/components';
import { useVideoCall } from '../../calls/hooks';
import { useAuth } from '../../auth/hooks';
import { getActiveCallState, setCallModalOpen, triggerNativePiP } from '../../calls/services';
import { Capacitor } from '@capacitor/core';
import {
  useChatRealtime,
  useMediaCapture,
  useMessagePagination,
  useTypingIndicator,
} from '../hooks';
import { supabase } from '../../../supabaseClient';
import {
  getDisplayNameForParticipant,
  getConversationTheme,
} from '../services';
import type { Message } from '../../../types/database';
import './Chat.css';

interface ChatParams {
  conversationId: string;
}

const Chat: React.FC = () => {
  const { conversationId } = useParams<ChatParams>();
  const { user, onlineUsers } = useAuth();
  const router = useIonRouter();
  const [presentToast] = useIonToast();

  const showToast = useCallback((message: string, color: 'danger' | 'warning' | 'success' = 'danger') => {
    presentToast({ message, color, duration: 2200, position: 'top' });
  }, [presentToast]);

  const videoCall = useVideoCall(conversationId, user?.id);
  const [callState, setCallState] = useState(getActiveCallState());

  // Listen for global call state changes to control call modal visibility
  useEffect(() => {
    const handleStateChange = () => {
      setCallState(getActiveCallState());
    };
    window.addEventListener('arvs-call-state-change', handleStateChange);
    return () => window.removeEventListener('arvs-call-state-change', handleStateChange);
  }, []);

  const handleManualPiP = useCallback(() => {
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
      triggerNativePiP();
    } else {
      // Dispatch custom event to enter native Picture-in-Picture on the persistent video element
      window.dispatchEvent(new CustomEvent('arvs-trigger-native-pip'));
    }
  }, []);

  const [mediaViewer, setMediaViewer] = useState<{ src: string; type: 'image' | 'video' } | null>(null);
  const [showCaptureSheet, setShowCaptureSheet] = useState(false);
  const [showGallerySheet, setShowGallerySheet] = useState(false);

  // Edit state
  const [editingMessage, setEditingMessage] = useState<{ id: string; content: string } | null>(null);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<Message | null>(null);

  const contentRef = useRef<HTMLIonContentElement>(null);
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const galleryVideoInputRef = useRef<HTMLInputElement>(null);
  const captureVideoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);



  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      contentRef.current?.scrollToBottom(200);
    });
  }, []);

  // Hook 1: Pagination, caching, and chat metadata fetching
  const {
    messages,
    setMessages,
    otherUser,
    preference,
    setPreference,
    nicknames,
    setNicknames,
    loading,
    loadingOlder,
    hasMoreMessages,
    loadOlderMessages,
  } = useMessagePagination(conversationId, scrollToBottom, showToast);

  // Hook 2: Live realtime database updates and message receipts
  useChatRealtime(conversationId, messages, loading, setMessages, setPreference, setNicknames, scrollToBottom);

  // Hook 3: Native & Web media capture, storage uploading, and message dispatch
  const {
    mediaPreview,
    sending,
    takePhoto,
    pickImageFromGallery,
    handleImageFileSelected,
    handleVideoFileSelected,
    handleFileSelected,
    handleSend: handleSendNewMessage,
    handleSendMedia,
    cancelMedia,
  } = useMediaCapture(
    conversationId,
    showToast,
    imageFileInputRef
  );

  // Hook 4: Typing indicators
  const { peerIsTyping, sendTyping } = useTypingIndicator(conversationId);

  // ---- Message editing ----
  const handleEditRequest = useCallback((message: Message) => {
    setEditingMessage({ id: message.id, content: message.content });
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingMessage(null);
  }, []);

  const handleSend = useCallback(async (text: string) => {
    if (editingMessage) {
      // Save edit
      const { error } = await supabase
        .from('messages')
        .update({ content: text, edited_at: new Date().toISOString() })
        .eq('id', editingMessage.id);

      if (error) {
        showToast('Failed to edit message.');
      } else {
        showToast('Message edited.', 'success');
      }
      setEditingMessage(null);
    } else {
      // Normal send
      handleSendNewMessage(text);
    }
  }, [editingMessage, handleSendNewMessage, showToast]);

  // ---- Message deletion ----
  const handleDeleteRequest = useCallback((message: Message) => {
    setDeleteTarget(message);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;

    const { error } = await supabase
      .from('messages')
      .delete()
      .eq('id', deleteTarget.id);

    if (error) {
      showToast('Failed to delete message.');
    } else {
      setMessages((current) => current.filter((m) => m.id !== deleteTarget.id));
      showToast('Message deleted.', 'success');
    }
    setDeleteTarget(null);
  }, [deleteTarget, setMessages, showToast]);

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

  const chatBackgroundStyle = useMemo<CSSProperties>(() => {
    const bgImage = preference?.background_image_url
      ? `${activeTheme.overlay}, url(${preference.background_image_url})`
      : activeTheme.gradient;

    return {
      backgroundImage: bgImage,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    };
  }, [activeTheme, preference?.background_image_url]);

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

  const displayName = getDisplayNameForParticipant(
    otherUser,
    otherUser ? nicknames[otherUser.id] ?? preference?.peer_nickname : null
  );

  // Compute subtitle text: typing indicator > online status
  const subtitleText = peerIsTyping ? 'typing...' : lastSeenText;
  const subtitleClass = peerIsTyping
    ? 'chat-header-status status-typing'
    : `chat-header-status ${isOnline ? 'status-online' : ''}`;

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
              <span className={subtitleClass}>{subtitleText}</span>
            </div>
          </div>
          <IonButtons slot="end">
            <IonButton
              fill="clear"
              onClick={() => otherUser && videoCall.initiateCall(otherUser.id)}
              disabled={videoCall.callStatus !== 'idle' || !otherUser}
              aria-label="Video call"
              className="chat-call-btn"
            >
              <IonIcon icon={videocamOutline} />
            </IonButton>
            <IonButton fill="clear" onClick={() => router.push(`/chat/${conversationId}/settings`, 'forward')} aria-label="Conversation options">
              <IonIcon icon={ellipsisVertical} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent ref={contentRef} className="chat-page" fullscreen>
        {/* Fixed background layer */}
        <div className="chat-background-fixed" style={chatBackgroundStyle} />

        <ErrorBoundary>
          {loading ? (
            <div className="chat-loading">
              <IonSpinner name="crescent" />
            </div>
          ) : (
            <div className="chat-stage">
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
                      onEdit={handleEditRequest}
                      onDelete={handleDeleteRequest}
                    />
                  ))}

                  {/* Typing indicator dots */}
                  {peerIsTyping && (
                    <div className="bubble-row bubble-left">
                      <div className="bubble bubble-theirs bubble-typing">
                        <div className="typing-dots">
                          <span className="typing-dot" />
                          <span className="typing-dot" />
                          <span className="typing-dot" />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </ErrorBoundary>
      </IonContent>

      <MessageInput
        onSend={handleSend}
        onPickGallery={() => setShowGallerySheet(true)}
        onOpenCamera={() => setShowCaptureSheet(true)}
        onTyping={sendTyping}
        disabled={sending}
        editingMessage={editingMessage}
        onCancelEdit={handleCancelEdit}
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

      <MediaPreview
        isOpen={!!mediaPreview}
        src={mediaPreview?.src ?? ''}
        type={mediaPreview?.type ?? 'image'}
        fileName={mediaPreview?.fileName}
        fileSizeBytes={mediaPreview?.sizeBytes ?? null}
        sending={sending}
        onSend={handleSendMedia}
        onCancel={cancelMedia}
      />

      <MediaViewerModal
        isOpen={!!mediaViewer}
        src={mediaViewer?.src ?? ''}
        type={mediaViewer?.type ?? 'image'}
        onClose={() => setMediaViewer(null)}
      />

      <VideoCallModal
        isOpen={
          callState.isModalOpen && (
            videoCall.callStatus === 'calling'
            || videoCall.callStatus === 'connecting'
            || videoCall.callStatus === 'active'
            || videoCall.callStatus === 'ended'
          )
        }
        callStatus={videoCall.callStatus}
        localStream={videoCall.localStream}
        remoteStream={videoCall.remoteStream}
        isMuted={videoCall.isMuted}
        isVideoOff={videoCall.isVideoOff}
        callDuration={videoCall.callDuration}
        remoteName={displayName}
        remoteAvatarUrl={otherUser?.avatar_url ?? null}
        onHangUp={videoCall.hangUp}
        onToggleMute={videoCall.toggleMuteAudio}
        onToggleVideo={videoCall.toggleCameraOff}
        onMinimize={() => setCallModalOpen(false)}
        onTriggerPiP={handleManualPiP}
        onSwitchCamera={videoCall.flipCamera}
        facingMode={videoCall.facingMode}
      />


      <IncomingCallOverlay
        isOpen={videoCall.callStatus === 'ringing'}
        callerName={displayName}
        callerAvatarUrl={otherUser?.avatar_url ?? null}
        onAccept={videoCall.acceptIncomingCall}
        onReject={videoCall.rejectIncomingCall}
      />

      {/* Delete confirmation alert */}
      <IonAlert
        isOpen={!!deleteTarget}
        onDidDismiss={() => setDeleteTarget(null)}
        header="Delete Message"
        message="Are you sure you want to delete this message? This cannot be undone."
        buttons={[
          { text: 'Cancel', role: 'cancel' },
          { text: 'Delete', role: 'destructive', handler: () => void handleConfirmDelete() },
        ]}
      />
    </IonPage>
  );
};

export default Chat;
