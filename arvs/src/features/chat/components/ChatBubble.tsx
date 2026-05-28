import { useState, useRef, useCallback } from 'react';
import {
  documentOutline,
  expandOutline,
  pause,
  play,
  volumeHigh,
  volumeMute,
} from 'ionicons/icons';
import { IonActionSheet, IonIcon, useIonToast } from '@ionic/react';
import type { Message, MessageStatus } from '../../../types/database';
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

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const wholeSeconds = Math.floor(seconds);
  const mins = Math.floor(wholeSeconds / 60);
  const secs = wholeSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
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
  const [presentToast] = useIonToast();
  const isMedia = message.message_type === 'image' || message.message_type === 'video' || message.message_type === 'file';
  const isTextOnly = message.message_type === 'text';
  const isStoryReply =
    message.media_name === 'Story reply'
    && (message.message_type === 'image' || message.message_type === 'video');
  const storyReplyLabel = isMine ? 'You replied to their story' : 'Replied to your story';

  const [showActions, setShowActions] = useState(false);
  const [showReadInfo, setShowReadInfo] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoMuted, setVideoMuted] = useState(true);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
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

  const toggleVideoPlayback = useCallback(async () => {
    if (!videoRef.current) return;
    if (videoPlaying) {
      videoRef.current.pause();
      setVideoPlaying(false);
      return;
    }
    try {
      await videoRef.current.play();
      setVideoPlaying(true);
    } catch {
      setVideoPlaying(false);
    }
  }, [videoPlaying]);

  const handleVideoSeek = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    const nextTime = Number(event.target.value);
    videoRef.current.currentTime = nextTime;
    setVideoCurrentTime(nextTime);
  }, []);

  const toggleVideoMute = useCallback(() => {
    if (!videoRef.current) return;
    const nextMuted = !videoMuted;
    videoRef.current.muted = nextMuted;
    setVideoMuted(nextMuted);
  }, [videoMuted]);

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
          <div className="bubble-video-shell">
            <video
              ref={videoRef}
              className="bubble-video"
              src={message.media_url}
              muted={videoMuted}
              playsInline
              preload="metadata"
              onLoadedMetadata={(event) => {
                const duration = event.currentTarget.duration || 0;
                setVideoDuration(duration);
              }}
              onTimeUpdate={(event) => {
                setVideoCurrentTime(event.currentTarget.currentTime || 0);
              }}
              onPause={() => setVideoPlaying(false)}
              onPlay={() => setVideoPlaying(true)}
              onEnded={() => {
                setVideoPlaying(false);
                setVideoCurrentTime(0);
              }}
            />

            {!videoPlaying && (
              <button
                type="button"
                className="bubble-video-center-play"
                onClick={() => void toggleVideoPlayback()}
                aria-label="Play video"
              >
                <IonIcon icon={play} />
              </button>
            )}

            <div className="bubble-video-controls">
              <button
                type="button"
                className="bubble-video-control-btn"
                onClick={() => void toggleVideoPlayback()}
                aria-label={videoPlaying ? 'Pause video' : 'Play video'}
              >
                <IonIcon icon={videoPlaying ? pause : play} />
              </button>

              <button
                type="button"
                className="bubble-video-control-btn"
                onClick={toggleVideoMute}
                aria-label={videoMuted ? 'Unmute video' : 'Mute video'}
              >
                <IonIcon icon={videoMuted ? volumeMute : volumeHigh} />
              </button>

              <input
                type="range"
                min={0}
                max={Math.max(videoDuration, 0)}
                step={0.1}
                value={Math.min(videoCurrentTime, videoDuration || 0)}
                onChange={handleVideoSeek}
                className="bubble-video-seek"
                aria-label="Seek video"
              />

              <span className="bubble-video-time">
                {formatDuration(videoCurrentTime)} / {formatDuration(videoDuration)}
              </span>

              <button
                type="button"
                className="bubble-video-control-btn"
                onClick={() => onMediaOpen?.(message.media_url!, 'video')}
                aria-label="Open video"
              >
                <IonIcon icon={expandOutline} />
              </button>
            </div>
          </div>
        )}
        {message.message_type === 'file' && message.media_url && (
          <button
            type="button"
            className="bubble-file-button"
            onClick={() => {
              void presentToast({
                message: 'Auto-download is disabled in this app build.',
                duration: 1800,
                color: 'medium',
                position: 'top',
              });
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

