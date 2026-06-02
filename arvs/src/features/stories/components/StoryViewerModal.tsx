import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonModal,
  IonToolbar,
} from '@ionic/react';
import { chevronBack, chevronForward, close, send, trash } from 'ionicons/icons';
import type { StoryMediaType } from '../../../types/database';
import './StoryViewerModal.css';

export interface StoryViewerItem {
  id: string;
  media_url: string;
  media_type: StoryMediaType;
  created_at: string;
  caption: string | null;
}

export interface StoryReactionView {
  id: string;
  story_id: string;
  user_id: string;
  reaction: string;
  created_at: string;
  author_name: string;
}

export interface StoryReplyView {
  id: string;
  story_id: string;
  user_id: string;
  content: string;
  created_at: string;
  author_name: string;
}

interface StoryViewerModalProps {
  isOpen: boolean;
  stories: StoryViewerItem[];
  ownerName: string;
  ownerAvatarUrl?: string | null;
  initialIndex?: number;
  canDelete?: boolean;
  canInteract?: boolean;
  reactionsByStoryId?: Record<string, StoryReactionView[]>;
  repliesByStoryId?: Record<string, StoryReplyView[]>;
  onReactStory?: (storyId: string, reaction: string) => Promise<void> | void;
  onReplyStory?: (storyId: string, replyText: string) => Promise<void> | void;
  onDeleteStory?: (storyId: string) => Promise<void> | void;
  onClose: () => void;
}

const STORY_DURATION_MS = 10_000;
const SWIPE_THRESHOLD_PX = 45;
const QUICK_REACTIONS = ['\u2764', '\ud83d\udd25', '\ud83d\ude02', '\ud83d\ude2e', '\ud83d\udc4f'];

export default function StoryViewerModal({
  isOpen,
  stories,
  ownerName,
  ownerAvatarUrl,
  initialIndex = 0,
  canDelete = false,
  canInteract = false,
  reactionsByStoryId = {},
  repliesByStoryId = {},
  onReactStory,
  onReplyStory,
  onDeleteStory,
  onClose,
}: StoryViewerModalProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const [replyInput, setReplyInput] = useState('');
  const animationFrameRef = useRef<number | null>(null);
  const timerStartRef = useRef<number | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const currentStory = stories[currentIndex];
  const currentStoryId = currentStory?.id;
  const currentStoryReactions = useMemo(
    () => (currentStoryId ? (reactionsByStoryId[currentStoryId] || []) : []),
    [currentStoryId, reactionsByStoryId]
  );
  const currentStoryReplies = useMemo(
    () => (currentStoryId ? (repliesByStoryId[currentStoryId] || []) : []),
    [currentStoryId, repliesByStoryId]
  );
  const reactionCountMap = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of currentStoryReactions) {
      counts[item.reaction] = (counts[item.reaction] || 0) + 1;
    }
    return counts;
  }, [currentStoryReactions]);

  const resetTimer = useCallback(() => {
    timerStartRef.current = null;
    setElapsedMs(0);
  }, []);

  const clearTimerFrame = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const goNext = useCallback(() => {
    if (currentIndex >= stories.length - 1) {
      onClose();
      return;
    }
    setCurrentIndex((prev) => Math.min(prev + 1, stories.length - 1));
    setReplyInput('');
    resetTimer();
  }, [currentIndex, onClose, resetTimer, stories.length]);

  const goPrev = useCallback(() => {
    setCurrentIndex((prev) => Math.max(0, prev - 1));
    setReplyInput('');
    resetTimer();
  }, [resetTimer]);

  useEffect(() => {
    if (!isOpen) {
      clearTimerFrame();
      resetTimer();
      return;
    }

    const boundedInitial = Math.max(0, Math.min(initialIndex, Math.max(stories.length - 1, 0)));
    setCurrentIndex(boundedInitial);
    setReplyInput('');
    resetTimer();
  }, [clearTimerFrame, initialIndex, isOpen, resetTimer, stories.length]);

  useEffect(() => {
    if (!isOpen || stories.length === 0 || !currentStory) return;

    const tick = (timestamp: number) => {
      if (timerStartRef.current === null) {
        timerStartRef.current = timestamp;
      }

      const elapsed = timestamp - timerStartRef.current;
      setElapsedMs(elapsed);

      if (elapsed >= STORY_DURATION_MS) {
        goNext();
        return;
      }

      animationFrameRef.current = requestAnimationFrame(tick);
    };

    clearTimerFrame();
    animationFrameRef.current = requestAnimationFrame(tick);

    return () => {
      clearTimerFrame();
      timerStartRef.current = null;
    };
  }, [clearTimerFrame, currentStory, goNext, isOpen, stories.length]);

  useEffect(() => {
    if (!isOpen) return;

    if (stories.length === 0) {
      onClose();
      return;
    }

    if (currentIndex > stories.length - 1) {
      setCurrentIndex(Math.max(0, stories.length - 1));
      resetTimer();
    }
  }, [currentIndex, isOpen, onClose, resetTimer, stories.length]);

  useEffect(() => {
    if (!isOpen || !currentStory || currentStory.media_type !== 'video') return;
    const videoElement = videoRef.current;
    if (!videoElement) return;

    videoElement.currentTime = 0;
    videoElement.muted = false;
    const playPromise = videoElement.play();
    if (playPromise?.catch) {
      playPromise.catch(() => {
        // Browser may block autoplay with audio until explicit media interaction.
      });
    }
  }, [currentStory, isOpen]);

  const progressRatio = useMemo(() => {
    if (!isOpen) return 0;
    return Math.min(1, Math.max(0, elapsedMs / STORY_DURATION_MS));
  }, [elapsedMs, isOpen]);

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    touchStartXRef.current = event.touches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartXRef.current === null) return;
    const endX = event.changedTouches[0]?.clientX ?? touchStartXRef.current;
    const deltaX = endX - touchStartXRef.current;
    touchStartXRef.current = null;

    if (Math.abs(deltaX) < SWIPE_THRESHOLD_PX) return;
    if (deltaX < 0) {
      goNext();
    } else {
      goPrev();
    }
  };

  const handleDeleteCurrent = async () => {
    if (!canDelete || !onDeleteStory || !currentStory || deleting) return;
    setDeleting(true);
    try {
      await onDeleteStory(currentStory.id);
    } finally {
      setDeleting(false);
    }
  };

  const handleReact = async (reaction: string) => {
    if (!canInteract || !onReactStory || !currentStory) return;
    await onReactStory(currentStory.id, reaction);
  };

  const handleReply = async () => {
    if (!canInteract || !onReplyStory || !currentStory) return;
    const text = replyInput.trim();
    if (!text || sendingReply) return;

    setSendingReply(true);
    try {
      await onReplyStory(currentStory.id, text);
      setReplyInput('');
    } finally {
      setSendingReply(false);
    }
  };

  if (!currentStory) {
    return null;
  }

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose} className="story-viewer-modal">
      <IonHeader translucent>
        <IonToolbar className="story-viewer-toolbar">
          <div className="story-progress-row" aria-hidden="true">
            {stories.map((story, idx) => {
              const fill = idx < currentIndex ? 1 : idx === currentIndex ? progressRatio : 0;
              return (
                <span key={story.id} className="story-progress-track">
                  <span className="story-progress-fill" style={{ transform: `scaleX(${fill})` }} />
                </span>
              );
            })}
          </div>
          <div className="story-viewer-meta">
            <div className="story-viewer-user">
              {ownerAvatarUrl ? <img src={ownerAvatarUrl} alt={ownerName} className="story-viewer-avatar" /> : null}
              <span className="story-viewer-name">{ownerName}</span>
            </div>
            <IonButtons slot="end" className="story-viewer-actions">
              {canDelete && (
                <IonButton
                  fill="clear"
                  onClick={handleDeleteCurrent}
                  disabled={deleting}
                  aria-label="Delete story"
                >
                  <IonIcon icon={trash} />
                </IonButton>
              )}
              <IonButton fill="clear" onClick={onClose} aria-label="Close story viewer">
                <IonIcon icon={close} />
              </IonButton>
            </IonButtons>
          </div>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen className="story-viewer-content">
        <div
          className="story-viewer-stage"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {currentStory.media_type === 'video' ? (
            <video
              key={currentStory.id}
              ref={videoRef}
              src={currentStory.media_url}
              autoPlay
              controls
              playsInline
              preload="metadata"
              className="story-viewer-media"
            />
          ) : (
            <img
              key={currentStory.id}
              src={currentStory.media_url}
              alt={currentStory.caption || `${ownerName} story`}
              className="story-viewer-media"
            />
          )}

          <button
            type="button"
            className="story-nav-btn story-nav-prev"
            onClick={goPrev}
            aria-label="Previous story"
            disabled={currentIndex === 0}
          >
            <IonIcon icon={chevronBack} />
          </button>

          <button
            type="button"
            className="story-nav-btn story-nav-next"
            onClick={goNext}
            aria-label="Next story"
          >
            <IonIcon icon={chevronForward} />
          </button>
        </div>

        {canInteract && (
          <div className="story-interact-bar">
            <div className="story-reaction-row">
              {QUICK_REACTIONS.map((reaction) => (
                <button
                  key={reaction}
                  type="button"
                  className="story-reaction-chip"
                  onClick={() => void handleReact(reaction)}
                >
                  {reaction}
                  {reactionCountMap[reaction] ? (
                    <span className="story-reaction-count">{reactionCountMap[reaction]}</span>
                  ) : null}
                </button>
              ))}
            </div>
            <div className="story-reply-row">
              <IonInput
                value={replyInput}
                onIonInput={(event) => setReplyInput(event.detail.value ?? '')}
                placeholder={`Reply to ${ownerName}`}
                className="story-reply-input"
                maxlength={300}
              />
              <IonButton
                fill="solid"
                color="primary"
                onClick={() => void handleReply()}
                disabled={sendingReply || replyInput.trim().length === 0}
                aria-label="Send story reply"
              >
                <IonIcon icon={send} />
              </IonButton>
            </div>
          </div>
        )}

        {canDelete && (
          <div className="story-owner-interactions">
            <div className="story-owner-interactions-header">Reactions & Replies</div>
            <div className="story-owner-interactions-summary">
              {currentStoryReactions.length} reactions &bull; {currentStoryReplies.length} replies
            </div>
            {currentStoryReplies.length > 0 ? (
              <div className="story-owner-reply-list">
                {currentStoryReplies.slice(-5).reverse().map((reply) => (
                  <div key={reply.id} className="story-owner-reply-item">
                    <span className="story-owner-reply-author">{reply.author_name}</span>
                    <span className="story-owner-reply-text">{reply.content}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="story-owner-empty">No replies yet.</div>
            )}
          </div>
        )}
      </IonContent>
    </IonModal>
  );
}

