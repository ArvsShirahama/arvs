import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonModal,
  IonToolbar,
} from '@ionic/react';
import { chevronBack, chevronForward, close, trash } from 'ionicons/icons';
import type { StoryMediaType } from '../types/database';
import './StoryViewerModal.css';

export interface StoryViewerItem {
  id: string;
  media_url: string;
  media_type: StoryMediaType;
  created_at: string;
  caption: string | null;
}

interface StoryViewerModalProps {
  isOpen: boolean;
  stories: StoryViewerItem[];
  ownerName: string;
  ownerAvatarUrl?: string | null;
  initialIndex?: number;
  canDelete?: boolean;
  onDeleteStory?: (storyId: string) => Promise<void> | void;
  onClose: () => void;
}

const STORY_DURATION_MS = 10_000;
const SWIPE_THRESHOLD_PX = 45;

export default function StoryViewerModal({
  isOpen,
  stories,
  ownerName,
  ownerAvatarUrl,
  initialIndex = 0,
  canDelete = false,
  onDeleteStory,
  onClose,
}: StoryViewerModalProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const animationFrameRef = useRef<number | null>(null);
  const timerStartRef = useRef<number | null>(null);
  const touchStartXRef = useRef<number | null>(null);

  const currentStory = stories[currentIndex];

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
    setCurrentIndex((prev) => {
      if (prev < stories.length - 1) {
        return prev + 1;
      }
      onClose();
      return prev;
    });
    resetTimer();
  }, [onClose, resetTimer, stories.length]);

  const goPrev = useCallback(() => {
    setCurrentIndex((prev) => Math.max(0, prev - 1));
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
    if (!isOpen || stories.length === 0) return;

    if (currentIndex > stories.length - 1) {
      setCurrentIndex(Math.max(0, stories.length - 1));
      resetTimer();
    }

    if (stories.length === 0) {
      onClose();
    }
  }, [currentIndex, isOpen, onClose, resetTimer, stories.length]);

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
              src={currentStory.media_url}
              autoPlay
              muted
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
      </IonContent>
    </IonModal>
  );
}
