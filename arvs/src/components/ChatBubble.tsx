import { useState, useRef, useCallback } from 'react';
import { Browser } from '@capacitor/browser';
import { documentOutline } from 'ionicons/icons';
import { IonActionSheet, IonIcon } from '@ionic/react';
import type { Message, MessageStatus } from '../types/database';
import { formatFileSize } from '../services/conversationThemes';
import './ChatBubble.css';

interface ChatBubbleProps {
  message: Message;
  isMine: boolean;
  onMediaOpen?: (src: string, type: 'image' | 'video') => void;
  onEdit?: (message: Message) => void;
  onDelete?: (message: Message) => void;
}

function formatMessageTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatFullTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatusIcon({ status, onTap }: { status: MessageStatus; onTap: () => void }) {
  if (status === 'read') {
    return (
      <button type="button" className="bubble-status-btn" onClick={onTap} aria-label="Read receipt info">
        <svg className="bubble-status bubble-status-read" viewBox="0 0 16 11" width="16" height="11">
          <path d="M11.07.66L5.69 6.04 3.85 4.2a.75.75 0 1 0-1.06 1.06l2.37 2.37a.75.75 0 0 0 1.06 0l5.91-5.91A.75.75 0 0 0 11.07.66z" fill="currentColor"/>
          <path d="M15.07.66L9.69 6.04 8.85 5.2a.75.75 0 0 0-1.06 1.06l1.37 1.37a.75.75 0 0 0 1.06 0l5.91-5.91A.75.75 0 0 0 15.07.66z" fill="currentColor"/>
        </svg>
      </button>
    );
  }
  if (status === 'delivered') {
    return (
      <svg className="bubble-status" viewBox="0 0 16 11" width="16" height="11">
        <path d="M11.07.66L5.69 6.04 3.85 4.2a.75.75 0 1 0-1.06 1.06l2.37 2.37a.75.75 0 0 0 1.06 0l5.91-5.91A.75.75 0 0 0 11.07.66z" fill="currentColor"/>
        <path d="M15.07.66L9.69 6.04 8.85 5.2a.75.75 0 0 0-1.06 1.06l1.37 1.37a.75.75 0 0 0 1.06 0l5.91-5.91A.75.75 0 0 0 15.07.66z" fill="currentColor"/>
      </svg>
    );
  }
  return (
    <svg className="bubble-status" viewBox="0 0 12 11" width="12" height="11">
      <path d="M11.07.66L5.69 6.04 3.85 4.2a.75.75 0 1 0-1.06 1.06l2.37 2.37a.75.75 0 0 0 1.06 0l5.91-5.91A.75.75 0 0 0 11.07.66z" fill="currentColor"/>
    </svg>
  );
}

export default function ChatBubble({ message, isMine, onMediaOpen, onEdit, onDelete }: ChatBubbleProps) {
  const isMedia = message.message_type === 'image' || message.message_type === 'video' || message.message_type === 'file';
  const isTextOnly = message.message_type === 'text';
  const isStoryReply =
    message.media_name === 'Story reply'
    && (message.message_type === 'image' || message.message_type === 'video');
  const storyReplyLabel = isMine ? 'You replied to their story' : 'Replied to your story';

  const [showActions, setShowActions] = useState(false);
  const [showReadInfo, setShowReadInfo] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);

  const handleTouchStart = useCallback(() => {
    didLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true;
      setShowActions(true);
    }, 500);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setShowActions(true);
  }, []);

  const actionButtons = [];
  if (message.content) {
    actionButtons.push({
      text: 'Copy Text',
      handler: () => {
        void navigator.clipboard.writeText(message.content);
      },
    });
  }
  if (isMine && isTextOnly) {
    actionButtons.push({
      text: 'Edit Message',
      handler: () => {
        onEdit?.(message);
      },
    });
  }
  if (isMine) {
    actionButtons.push({
      text: 'Delete Message',
      role: 'destructive' as const,
      handler: () => {
        onDelete?.(message);
      },
    });
  }
  actionButtons.push({ text: 'Cancel', role: 'cancel' as const });

  return (
    <div
      className={`bubble-row ${isMine ? 'bubble-right' : 'bubble-left'}`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onContextMenu={handleContextMenu}
    >
      <div className={`bubble ${isMine ? 'bubble-mine' : 'bubble-theirs'} ${isMedia ? 'bubble-media' : ''}`}>
        {isStoryReply && (
          <div className="bubble-story-reply-label">
            {storyReplyLabel}
          </div>
        )}
        {message.message_type === 'image' && message.media_url && (
          <button
            type="button"
            className="bubble-image-button"
            onClick={() => onMediaOpen?.(message.media_url!, 'image')}
            aria-label="Open image"
          >
            <img
              className="bubble-image"
              src={message.media_url}
              alt="Photo"
              loading="lazy"
            />
          </button>
        )}
        {message.message_type === 'video' && message.media_url && (
          <video
            className="bubble-video"
            src={message.media_url}
            controls
            preload="metadata"
          />
        )}
        {message.message_type === 'file' && message.media_url && (
          <button
            type="button"
            className="bubble-file-button"
            onClick={() => {
              void Browser.open({ url: message.media_url! });
            }}
          >
            <span className="bubble-file-icon">
              <IonIcon icon={documentOutline} />
            </span>
            <span className="bubble-file-copy">
              <strong>{message.media_name || 'File attachment'}</strong>
              <small>{formatFileSize(message.media_size_bytes)}</small>
            </span>
          </button>
        )}
        {message.content && <p className="bubble-text">{message.content}</p>}
        <span className="bubble-time">
          {message.edited_at && <span className="bubble-edited">edited</span>}
          {formatMessageTime(message.created_at)}
          {isMine && (
            <StatusIcon
              status={message.status}
              onTap={() => setShowReadInfo((prev) => !prev)}
            />
          )}
        </span>

        {/* Read receipt detail popover */}
        {showReadInfo && isMine && message.read_at && (
          <div className="bubble-read-info">
            <span>Read {formatFullTime(message.read_at)}</span>
          </div>
        )}
      </div>

      <IonActionSheet
        isOpen={showActions}
        onDidDismiss={() => setShowActions(false)}
        header="Message"
        buttons={actionButtons}
      />
    </div>
  );
}
