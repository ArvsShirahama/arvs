import { Browser } from '@capacitor/browser';
import { documentOutline } from 'ionicons/icons';
import { IonIcon } from '@ionic/react';
import type { Message, MessageStatus } from '../types/database';
import { formatFileSize } from '../services/conversationThemes';
import './ChatBubble.css';

interface ChatBubbleProps {
  message: Message;
  isMine: boolean;
  onMediaOpen?: (src: string, type: 'image' | 'video') => void;
}

function formatMessageTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function StatusIcon({ status }: { status: MessageStatus }) {
  if (status === 'read') {
    return (
      <svg className="bubble-status bubble-status-read" viewBox="0 0 16 11" width="16" height="11">
        <path d="M11.07.66L5.69 6.04 3.85 4.2a.75.75 0 1 0-1.06 1.06l2.37 2.37a.75.75 0 0 0 1.06 0l5.91-5.91A.75.75 0 0 0 11.07.66z" fill="currentColor"/>
        <path d="M15.07.66L9.69 6.04 8.85 5.2a.75.75 0 0 0-1.06 1.06l1.37 1.37a.75.75 0 0 0 1.06 0l5.91-5.91A.75.75 0 0 0 15.07.66z" fill="currentColor"/>
      </svg>
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

export default function ChatBubble({ message, isMine, onMediaOpen }: ChatBubbleProps) {
  const isMedia = message.message_type === 'image' || message.message_type === 'video' || message.message_type === 'file';

  return (
    <div className={`bubble-row ${isMine ? 'bubble-right' : 'bubble-left'}`}>
      <div className={`bubble ${isMine ? 'bubble-mine' : 'bubble-theirs'} ${isMedia ? 'bubble-media' : ''}`}>
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
          {formatMessageTime(message.created_at)}
          {isMine && <StatusIcon status={message.status} />}
        </span>
      </div>
    </div>
  );
}
