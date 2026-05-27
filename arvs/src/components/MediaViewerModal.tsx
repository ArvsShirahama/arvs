import { useCallback, useEffect, useRef, useState } from 'react';
import { IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonModal, IonTitle, IonToolbar } from '@ionic/react';
import { close, expandOutline, pause, play, volumeHigh, volumeMute } from 'ionicons/icons';
import './MediaViewerModal.css';

interface MediaViewerModalProps {
  isOpen: boolean;
  src: string;
  type: 'image' | 'video';
  onClose: () => void;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const value = Math.floor(seconds);
  const mins = Math.floor(value / 60);
  const secs = value % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function MediaViewerModal({ isOpen, src, type, onClose }: MediaViewerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoMuted, setVideoMuted] = useState(false);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);

  useEffect(() => {
    if (!isOpen || type !== 'video' || !videoRef.current) return;

    const video = videoRef.current;
    video.currentTime = 0;
    video.muted = videoMuted;
    const playPromise = video.play();
    if (playPromise?.catch) {
      playPromise.catch(() => {
        setVideoPlaying(false);
      });
    }
  }, [isOpen, type, videoMuted]);

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

  const toggleVideoMute = useCallback(() => {
    if (!videoRef.current) return;
    const nextMuted = !videoMuted;
    videoRef.current.muted = nextMuted;
    setVideoMuted(nextMuted);
  }, [videoMuted]);

  const handleVideoSeek = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    const nextTime = Number(event.target.value);
    videoRef.current.currentTime = nextTime;
    setVideoCurrentTime(nextTime);
  }, []);

  const handleFullscreen = useCallback(() => {
    if (!videoRef.current) return;
    void videoRef.current.requestFullscreen?.();
  }, []);

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose} className="media-viewer-modal">
      <IonHeader translucent>
        <IonToolbar className="media-viewer-toolbar">
          <IonTitle>Media</IonTitle>
          <IonButtons slot="end">
            <IonButton fill="clear" onClick={onClose} aria-label="Close media viewer">
              <IonIcon icon={close} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="media-viewer-content" fullscreen>
        <div className="media-viewer-frame">
          {type === 'image' ? (
            <img src={src} alt="Media" />
          ) : (
            <div className="media-viewer-video-shell">
              <video
                ref={videoRef}
                src={src}
                preload="metadata"
                playsInline
                className="media-viewer-video"
                onLoadedMetadata={(event) => {
                  setVideoDuration(event.currentTarget.duration || 0);
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
                  className="media-viewer-video-center-play"
                  onClick={() => void toggleVideoPlayback()}
                  aria-label="Play video"
                >
                  <IonIcon icon={play} />
                </button>
              )}

              <div className="media-viewer-video-controls">
                <button
                  type="button"
                  className="media-viewer-video-control-btn"
                  onClick={() => void toggleVideoPlayback()}
                  aria-label={videoPlaying ? 'Pause video' : 'Play video'}
                >
                  <IonIcon icon={videoPlaying ? pause : play} />
                </button>

                <button
                  type="button"
                  className="media-viewer-video-control-btn"
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
                  className="media-viewer-video-seek"
                  aria-label="Seek video"
                />

                <span className="media-viewer-video-time">
                  {formatDuration(videoCurrentTime)} / {formatDuration(videoDuration)}
                </span>

                <button
                  type="button"
                  className="media-viewer-video-control-btn"
                  onClick={handleFullscreen}
                  aria-label="Fullscreen"
                >
                  <IonIcon icon={expandOutline} />
                </button>
              </div>
            </div>
          )}
        </div>
      </IonContent>
    </IonModal>
  );
}
