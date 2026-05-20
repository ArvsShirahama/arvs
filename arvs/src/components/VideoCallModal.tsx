/**
 * VideoCallModal
 *
 * Full-screen modal displayed during an active video call.
 * Shows remote video (large), local video (picture-in-picture),
 * and call controls (mute, camera toggle, hang up).
 */

import { useEffect, useRef, useCallback } from 'react';
import { IonIcon, IonModal } from '@ionic/react';
import {
  call as callIcon,
  mic,
  micOff,
  videocam,
  videocamOff,
} from 'ionicons/icons';
import type { CallStatus } from '../hooks/useVideoCall';
import './VideoCallModal.css';

interface VideoCallModalProps {
  isOpen: boolean;
  callStatus: CallStatus;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMuted: boolean;
  isVideoOff: boolean;
  callDuration: number;
  remoteName: string;
  remoteAvatarUrl: string | null;
  onHangUp: () => void;
  onToggleMute: () => void;
  onToggleVideo: () => void;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Binds a MediaStream to a <video> element with retry logic.
 * IonModal may delay DOM mounting due to its entrance animation,
 * so we retry after a short delay if the ref isn't available yet.
 */
function bindStreamToVideo(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  stream: MediaStream | null,
  retryCount = 0
): void {
  if (!stream) return;

  const el = videoRef.current;
  if (el) {
    // Only assign srcObject if it's not already set to this stream.
    // Re-assigning srcObject tears down the media pipeline and causes black screens on mobile WebViews.
    if (el.srcObject !== stream) {
      el.srcObject = stream;
    }
    
    // Always attempt play() to resume/start playback of newly added tracks
    el.play().catch((err) => {
      console.warn('[Call] Error playing video:', err);
    });
  } else if (retryCount < 5) {
    // Retry — modal may still be animating into the DOM
    setTimeout(() => {
      bindStreamToVideo(videoRef, stream, retryCount + 1);
    }, 100);
  }
}

export default function VideoCallModal({
  isOpen,
  callStatus,
  localStream,
  remoteStream,
  isMuted,
  isVideoOff,
  callDuration,
  remoteName,
  remoteAvatarUrl,
  onHangUp,
  onToggleMute,
  onToggleVideo,
}: VideoCallModalProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  // Bind local stream to video element
  useEffect(() => {
    if (isOpen && localStream) {
      bindStreamToVideo(localVideoRef, localStream);
    }
  }, [localStream, isOpen]);

  // Bind remote stream to video element
  useEffect(() => {
    if (!isOpen || !remoteStream) return;

    // Bind initially
    bindStreamToVideo(remoteVideoRef, remoteStream);

    // Re-bind (attempt play) when new tracks are added natively or unmute
    const handleTrackUpdate = () => {
      console.log('[CallModal] Remote stream track update, playing...');
      bindStreamToVideo(remoteVideoRef, remoteStream);
    };

    remoteStream.addEventListener('addtrack', handleTrackUpdate);
    remoteStream.addEventListener('removetrack', handleTrackUpdate);

    // Also listen to existing tracks in case they unmute/activate
    const tracks = remoteStream.getTracks();
    tracks.forEach((track) => {
      track.addEventListener('unmute', handleTrackUpdate);
      track.addEventListener('ended', handleTrackUpdate);
    });

    return () => {
      remoteStream.removeEventListener('addtrack', handleTrackUpdate);
      remoteStream.removeEventListener('removetrack', handleTrackUpdate);
      tracks.forEach((track) => {
        track.removeEventListener('unmute', handleTrackUpdate);
        track.removeEventListener('ended', handleTrackUpdate);
      });
    };
  }, [remoteStream, isOpen]);

  // Re-bind streams when modal finishes its entrance animation
  const handleDidPresent = useCallback(() => {
    if (localStream) {
      bindStreamToVideo(localVideoRef, localStream);
    }
    if (remoteStream) {
      bindStreamToVideo(remoteVideoRef, remoteStream);
    }
  }, [localStream, remoteStream]);

  const statusLabel =
    callStatus === 'calling'
      ? 'Calling...'
      : callStatus === 'ringing'
        ? 'Ringing...'
        : callStatus === 'active'
          ? formatDuration(callDuration)
          : callStatus === 'ended'
            ? 'Call ended'
            : '';

  return (
    <IonModal
      isOpen={isOpen}
      className="video-call-modal"
      backdropDismiss={false}
      onDidPresent={handleDidPresent}
    >
      <div className="video-call-container">
        {/* Remote video (full screen background) */}
        <video
          ref={remoteVideoRef}
          className="video-call-remote"
          autoPlay
          playsInline
          {...{ 'webkit-playsinline': 'true' } as React.HTMLAttributes<HTMLVideoElement>}
        />

        {/* Overlay when remote video not yet connected */}
        {callStatus !== 'active' && (
          <div className="video-call-connecting-overlay">
            {remoteAvatarUrl ? (
              <img
                className="video-call-avatar"
                src={remoteAvatarUrl}
                alt={remoteName}
              />
            ) : (
              <div className="video-call-avatar video-call-avatar-placeholder">
                {remoteName.charAt(0).toUpperCase()}
              </div>
            )}
            <span className="video-call-remote-name">{remoteName}</span>
            <span className="video-call-status-label">{statusLabel}</span>
          </div>
        )}

        {/* Active call status bar */}
        {callStatus === 'active' && (
          <div className="video-call-status-bar">
            <span className="video-call-status-dot" />
            <span className="video-call-status-text">{statusLabel}</span>
          </div>
        )}

        {/* Local video (picture-in-picture) */}
        <div className="video-call-local-wrap">
          <video
            ref={localVideoRef}
            className="video-call-local"
            autoPlay
            playsInline
            muted
            {...{ 'webkit-playsinline': 'true' } as React.HTMLAttributes<HTMLVideoElement>}
          />
          {isVideoOff && (
            <div className="video-call-local-off">
              <IonIcon icon={videocamOff} />
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="video-call-controls">
          <button
            className={`video-call-btn ${isMuted ? 'video-call-btn-active' : ''}`}
            onClick={onToggleMute}
            aria-label={isMuted ? 'Unmute' : 'Mute'}
          >
            <IonIcon icon={isMuted ? micOff : mic} />
          </button>

          <button
            className="video-call-btn video-call-btn-hangup"
            onClick={onHangUp}
            aria-label="Hang up"
          >
            <IonIcon icon={callIcon} />
          </button>

          <button
            className={`video-call-btn ${isVideoOff ? 'video-call-btn-active' : ''}`}
            onClick={onToggleVideo}
            aria-label={isVideoOff ? 'Turn camera on' : 'Turn camera off'}
          >
            <IonIcon icon={isVideoOff ? videocamOff : videocam} />
          </button>
        </div>
      </div>
    </IonModal>
  );
}
