/**
 * GlobalVideoCallPiP
 *
 * App-level component that persists across all page navigations.
 * Renders the floating in-app PiP window and the hidden <video> element
 * for native browser PiP — both survive route changes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useIonRouter } from '@ionic/react';
import { useLocation } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { VideoCallPiP } from '../features/calls/components';
import {
  getActiveCallState,
  endCall,
  cleanupCall,
  setCallModalOpen,
  setInAppPiPHidden,
  setNativePiPActive,
  type ActiveCallState,
} from '../features/calls/services';
import { getStoredPipEnabled } from '../services/pipService';
import type { CallStatus } from '../features/calls/hooks/useVideoCall';

function deriveCallStatus(state: ActiveCallState): CallStatus {
  if (!state.callId) return 'idle';
  const pc = state.peerConnectionState;
  const ice = state.iceConnectionState;
  if (pc === 'connected' || ice === 'connected' || ice === 'completed') return 'active';
  if (pc === 'connecting' || ice === 'checking' || ice === 'new') return 'connecting';
  if (pc === 'failed' || ice === 'failed' || ice === 'disconnected') return 'connecting';
  if (pc === 'closed') return 'ended';
  return 'calling';
}

export default function GlobalVideoCallPiP() {
  const router = useIonRouter();
  const location = useLocation();
  const hiddenVideoRef = useRef<HTMLVideoElement>(null);

  const [callState, setCallState] = useState<ActiveCallState>(getActiveCallState());

  // Listen for any call state change events
  useEffect(() => {
    const handleChange = () => {
      setCallState(getActiveCallState());
    };
    window.addEventListener('arvs-call-state-change', handleChange);
    return () => window.removeEventListener('arvs-call-state-change', handleChange);
  }, []);

  // Sync native PiP state by listening to video element events
  useEffect(() => {
    const el = hiddenVideoRef.current;
    if (!el) return;

    const onEnter = () => {
      setNativePiPActive(true);
      setCallModalOpen(false); // Close full screen call modal when entering native PiP
    };
    const onLeave = () => {
      setNativePiPActive(false);
    };

    el.addEventListener('enterpictureinpicture', onEnter);
    el.addEventListener('leavepictureinpicture', onLeave);

    return () => {
      el.removeEventListener('enterpictureinpicture', onEnter);
      el.removeEventListener('leavepictureinpicture', onLeave);
    };
  }, [callState.callId]);

  // Determine derived values
  const hasActiveCall =
    !!callState.callId &&
    (callState.peerConnectionState === 'connected' ||
      callState.peerConnectionState === 'connecting' ||
      callState.iceConnectionState === 'connected' ||
      callState.iceConnectionState === 'checking' ||
      callState.iceConnectionState === 'new');

  const callStatus = deriveCallStatus(callState);

  // If user is on the chat page for this call AND the modal is open, don't render global PiP
  const isOnCallChatPage =
    location.pathname === `/chat/${callState.conversationId}`;

  // Render in-app PiP if call is active, it's not hidden, native PiP is not showing,
  // and we are not currently viewing the active call's chat page with its full modal open.
  const showFloatingPiP =
    hasActiveCall &&
    !callState.isInAppPiPHidden &&
    !callState.isNativePiPActive &&
    !(isOnCallChatPage && callState.isModalOpen);

  // Bind remote stream to the hidden video element (for native browser PiP)
  useEffect(() => {
    const el = hiddenVideoRef.current;
    if (!el) return;
    if (callState.remoteStream) {
      if (el.srcObject !== callState.remoteStream) {
        el.srcObject = callState.remoteStream;
      }
      el.play().catch((err) => {
        console.warn('[GlobalPiP] Error playing hidden video:', err);
      });
    } else {
      el.srcObject = null;
    }
  }, [callState.remoteStream, callState.callId]);

  // Handle manual native PiP trigger event
  useEffect(() => {
    const handleTrigger = async () => {
      const el = hiddenVideoRef.current;
      if (el && callState.remoteStream && typeof document !== 'undefined') {
        const hasPipSupport = 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled;
        if (hasPipSupport && typeof el.requestPictureInPicture === 'function') {
          try {
            if (document.pictureInPictureElement !== el) {
              await el.requestPictureInPicture();
            }
          } catch (err) {
            console.warn('[GlobalPiP] Failed to enter native PiP via event:', err);
          }
        }
      }
    };

    window.addEventListener('arvs-trigger-native-pip', handleTrigger);
    return () => window.removeEventListener('arvs-trigger-native-pip', handleTrigger);
  }, [callState.remoteStream]);

  // Auto-trigger native browser PiP when app goes to background
  useEffect(() => {
    if (!hasActiveCall) return;

    const handleEnterPiP = async () => {
      if (!getStoredPipEnabled()) return;
      const el = hiddenVideoRef.current;
      if (el && callState.remoteStream && typeof document !== 'undefined') {
        const hasPipSupport = 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled;
        if (hasPipSupport && typeof el.requestPictureInPicture === 'function') {
          try {
            if (document.pictureInPictureElement !== el) {
              await el.requestPictureInPicture();
            }
          } catch (err) {
            console.warn('[GlobalPiP] Failed to enter native PiP:', err);
          }
        }
      }
    };

    const handleExitPiP = async () => {
      if (typeof document !== 'undefined' && document.pictureInPictureElement) {
        try {
          await document.exitPictureInPicture();
        } catch (err) {
          console.warn('[GlobalPiP] Failed to exit native PiP:', err);
        }
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        void handleEnterPiP();
      } else {
        void handleExitPiP();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    let capListenerPromise: Promise<{ remove: () => void }> | null = null;
    if (Capacitor.isNativePlatform()) {
      capListenerPromise = CapApp.addListener('appStateChange', (state) => {
        if (!state.isActive) {
          void handleEnterPiP();
        } else {
          void handleExitPiP();
        }
      });
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (capListenerPromise) {
        capListenerPromise.then((handle) => handle.remove());
      }
    };
  }, [hasActiveCall, callState.remoteStream]);

  const handleMaximize = useCallback(() => {
    if (callState.conversationId) {
      // Ensure hidden state is reset when maximizing
      setInAppPiPHidden(false);
      setCallModalOpen(true);
      router.push(`/chat/${callState.conversationId}`, 'forward', 'push');
    }
  }, [callState.conversationId, router]);

  const handleHangUp = useCallback(() => {
    void endCall('hangup');
    cleanupCall();
  }, []);

  const handleHide = useCallback(() => {
    setInAppPiPHidden(true);
  }, []);

  return (
    <>
      {/* Hidden video element — always present when a call exists, survives navigation */}
      {hasActiveCall && (
        <video
          ref={hiddenVideoRef}
          style={{
            position: 'absolute',
            width: '1px',
            height: '1px',
            opacity: 0.001,
            pointerEvents: 'none',
            top: '-9999px',
            left: '-9999px',
          }}
          autoPlay
          playsInline
          muted
        />
      )}

      {/* Floating in-app PiP window — shows when modal is NOT visible */}
      {showFloatingPiP && (
        <VideoCallPiP
          localStream={callState.localStream}
          remoteStream={callState.remoteStream}
          callStatus={callStatus}
          isVideoOff={false}
          onMaximize={handleMaximize}
          onHangUp={handleHangUp}
          onHide={handleHide}
        />
      )}
    </>
  );
}
