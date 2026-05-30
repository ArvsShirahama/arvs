/**
 * useVideoCall Hook
 *
 * React bridge for callSignaling service.
 * Uses transport-level state (ICE/PC) to decide when call is truly active.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Haptics } from '@capacitor/haptics';
import {
  acceptCall,
  cleanupCall,
  endCall,
  onSignal,
  startCall,
  subscribeToCallSignals,
  toggleMute,
  toggleVideo,
  getActiveCallState,
  setCallModalOpen,
  switchCamera,
  callSoundManager,
} from '../services';
import type { SignalPayload } from '../services';
import { sendCallPush } from '../../../services/pushService';


export type CallStatus = 'idle' | 'calling' | 'ringing' | 'connecting' | 'active' | 'ended';

export interface IncomingCallInfo {
  callId: string;
  from: string;
  conversationId: string;
  offerSdp: string;
}

export interface UseVideoCallReturn {
  callStatus: CallStatus;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  incomingCall: IncomingCallInfo | null;
  isMuted: boolean;
  isVideoOff: boolean;
  callDuration: number;
  facingMode: 'user' | 'environment';
  initiateCall: (remoteUserId: string) => Promise<void>;
  acceptIncomingCall: () => Promise<void>;
  rejectIncomingCall: () => void;
  hangUp: () => void;
  toggleMuteAudio: () => void;
  toggleCameraOff: () => void;
  flipCamera: () => Promise<void>;
}


const OUTGOING_RING_TIMEOUT_MS = 30_000;

export function useVideoCall(conversationId: string, localUserId: string | undefined): UseVideoCallReturn {
  const [callStatus, setCallStatus] = useState<CallStatus>('idle');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCallInfo | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');


  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unansweredTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callStatusRef = useRef<CallStatus>('idle');
  const activeCallIdRef = useRef<string | null>(null);

  // Restore ongoing call state on mount if it matches the current conversationId
  useEffect(() => {
    const activeState = getActiveCallState();
    if (
      activeState.conversationId === conversationId &&
      activeState.callId &&
      (activeState.peerConnectionState === 'connected' ||
        activeState.peerConnectionState === 'connecting' ||
        activeState.iceConnectionState === 'connected' ||
        activeState.iceConnectionState === 'checking')
    ) {
      activeCallIdRef.current = activeState.callId;
      setLocalStream(activeState.localStream);
      setRemoteStream(activeState.remoteStream);
      setFacingMode(activeState.facingMode);
      
      const isConnected =
        activeState.peerConnectionState === 'connected' ||
        activeState.iceConnectionState === 'connected';
      setCallStatus(isConnected ? 'active' : 'connecting');
      setCallModalOpen(true);
    }
  }, [conversationId]);

  // Sync state reactively with global callState changes
  useEffect(() => {
    const handleStateChange = () => {
      const activeState = getActiveCallState();
      
      if (activeState.localStream) {
        setLocalStream(new MediaStream(activeState.localStream.getTracks()));
      } else {
        setLocalStream(null);
      }
      
      if (activeState.remoteStream) {
        setRemoteStream(new MediaStream(activeState.remoteStream.getTracks()));
      } else {
        setRemoteStream(null);
      }

      setFacingMode(activeState.facingMode);
    };
    window.addEventListener('arvs-call-state-change', handleStateChange);
    return () => window.removeEventListener('arvs-call-state-change', handleStateChange);
  }, []);


  useEffect(() => {
    callStatusRef.current = callStatus;
  }, [callStatus]);

  const clearUnansweredTimeout = useCallback(() => {
    if (unansweredTimeoutRef.current) {
      clearTimeout(unansweredTimeoutRef.current);
      unansweredTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (callStatus === 'active') {
      setCallDuration(0);
      durationIntervalRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    return () => {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
    };
  }, [callStatus]);

  useEffect(() => {
    if (callStatus !== 'calling') {
      clearUnansweredTimeout();
      return;
    }

    unansweredTimeoutRef.current = setTimeout(() => {
      if (callStatusRef.current === 'calling' || callStatusRef.current === 'connecting') {
        void endCall('hangup');
        cleanupCall();
        setCallStatus('ended');
        setIncomingCall(null);
        setLocalStream(null);
        setRemoteStream(null);
        setTimeout(() => {
          setCallStatus('idle');
        }, 1200);
      }
    }, OUTGOING_RING_TIMEOUT_MS);

    return clearUnansweredTimeout;
  }, [callStatus, clearUnansweredTimeout]);

  // Manage ringtone and vibration lifecycles based on callStatus
  useEffect(() => {
    let vibeInterval: any = null;

    const canVibrateWeb = () => {
      if (typeof navigator === 'undefined' || !navigator.vibrate) return false;
      const ua = (navigator as any).userActivation;
      if (ua && !ua.hasBeenActive) return false;
      return true;
    };

    const triggerVibration = () => {
      if (Capacitor.isNativePlatform()) {
        Haptics.vibrate({ duration: 1000 }).catch((err) => {
          console.warn('[Haptics] Vibration failed:', err);
        });
      } else if (canVibrateWeb()) {
        try {
          navigator.vibrate([500, 250, 500]);
        } catch (e) {
          // ignore web vibration blocks
        }
      }
    };

    if (callStatus === 'ringing') {
      // Play incoming ringtone
      callSoundManager.startIncomingRingtone();
      // Start haptic vibration
      triggerVibration();
      vibeInterval = setInterval(triggerVibration, 3000);
    } else if (callStatus === 'calling' || callStatus === 'connecting') {
      // Play outgoing ringback tone
      callSoundManager.startOutgoingRingback();
    } else {
      // Stop all sounds and haptics
      callSoundManager.stopAll();
      if (canVibrateWeb()) {
        try {
          navigator.vibrate(0); // Stop active web vibration
        } catch (e) {
          // ignore
        }
      }
    }

    return () => {
      callSoundManager.stopAll();
      if (vibeInterval) {
        clearInterval(vibeInterval);
      }
      if (canVibrateWeb()) {
        try {
          navigator.vibrate(0);
        } catch (e) {
          // ignore
        }
      }
    };
  }, [callStatus]);



  const resetToEnded = useCallback(() => {
    clearUnansweredTimeout();
    setCallStatus('ended');
    setIncomingCall(null);
    setLocalStream(null);
    setRemoteStream(null);
    setIsMuted(false);
    setIsVideoOff(false);
    activeCallIdRef.current = null;

    setTimeout(() => {
      setCallStatus('idle');
    }, 1500);
  }, [clearUnansweredTimeout]);

  useEffect(() => {
    if (!conversationId || !localUserId) return;

    void subscribeToCallSignals(conversationId, localUserId).catch((error) => {
      console.error('[Call] Failed to subscribe to signaling channel:', error);
    });

    const unsubscribe = onSignal((signal: SignalPayload) => {
      switch (signal.type) {
        case 'offer': {
          if (!signal.sdp || !signal.callId) return;

          if (callStatusRef.current === 'idle') {
            activeCallIdRef.current = signal.callId;
            setIncomingCall({
              callId: signal.callId,
              from: signal.from,
              conversationId: signal.conversationId,
              offerSdp: signal.sdp,
            });
            setCallStatus('ringing');
          } else {
            void endCall('busy');
          }
          break;
        }

        case 'answer': {
          if (signal.callId && activeCallIdRef.current && signal.callId !== activeCallIdRef.current) {
            return;
          }
          if (callStatusRef.current === 'calling') {
            setCallStatus('connecting');
          }
          break;
        }

        case 'connection-state': {
          if (signal.callId && activeCallIdRef.current && signal.callId !== activeCallIdRef.current) {
            return;
          }

          const iceState = signal.iceConnectionState;
          const pcState = signal.peerConnectionState;

          if (pcState === 'connected' || iceState === 'connected' || iceState === 'completed') {
            setCallStatus('active');
            clearUnansweredTimeout();
            break;
          }

          if (pcState === 'connecting' || iceState === 'checking' || iceState === 'new') {
            // Do NOT downgrade 'active' to 'connecting' — ICE state events can
            // fire out of order on mobile, and this would make the UI stuck at
            // "connecting" even though the WebRTC connection is already established.
            if (callStatusRef.current === 'calling' || callStatusRef.current === 'ringing') {
              setCallStatus('connecting');
            }
            break;
          }

          if (pcState === 'failed' || iceState === 'failed') {
            // ICE restart is attempted in callSignaling.ts — don't end the call.
            // Only transition UI if we aren't already active (avoid downgrade).
            if (callStatusRef.current === 'active') {
              // Stay active — ICE restart may recover the connection.
            } else {
              setCallStatus('connecting');
            }
          } else if (pcState === 'closed') {
            cleanupCall();
            resetToEnded();
          }
          break;
        }

        case 'hangup':
        case 'reject':
        case 'busy': {
          if (signal.callId && activeCallIdRef.current && signal.callId !== activeCallIdRef.current) {
            return;
          }
          if (callStatusRef.current !== 'idle' && callStatusRef.current !== 'ended') {
            cleanupCall();
            resetToEnded();
          }
          break;
        }

        case 'remote-stream': {
          if (signal.callId && activeCallIdRef.current && signal.callId !== activeCallIdRef.current) {
            return;
          }
          if (signal.stream) {
            setRemoteStream(signal.stream);
          }
          break;
        }

        default:
          break;
      }
    });

    return () => {
      unsubscribe();
    };
  }, [conversationId, localUserId, resetToEnded, clearUnansweredTimeout]);

  useEffect(() => {
    return () => {
      clearUnansweredTimeout();
      // Do NOT end the call or cleanup on unmount.
      // The call should persist even when navigating away from the Chat page
      // or when the app is backgrounded. Only explicit hangUp() ends the call.
    };
  }, [clearUnansweredTimeout]);

  const initiateCall = useCallback(async (remoteUserId: string) => {
    if (!localUserId || !conversationId) return;

    try {
      setCallStatus('calling');
      setCallModalOpen(true);
      const { callId, localStream: ls, remoteStream: rs } = await startCall(
        conversationId,
        localUserId,
        remoteUserId
      );
      activeCallIdRef.current = callId;
      setLocalStream(ls);
      setRemoteStream(rs);

      // Wake the callee's device with a high-priority push so they ring even
      // if their app is backgrounded or closed. Fire-and-forget — a failure
      // here must not interrupt the in-progress WebRTC call.
      void sendCallPush(conversationId, callId, true).catch((err) => {
        console.warn('[Call] Failed to dispatch call push:', err);
      });
    } catch (err) {
      console.error('[Call] Failed to start call:', err);
      setCallStatus('idle');
      cleanupCall();
    }
  }, [conversationId, localUserId]);

  const acceptIncomingCall = useCallback(async () => {
    if (!localUserId || !incomingCall) return;

    try {
      setCallModalOpen(true);
      const { callId, localStream: ls, remoteStream: rs } = await acceptCall(
        incomingCall.conversationId,
        localUserId,
        incomingCall.from,
        incomingCall.callId,
        incomingCall.offerSdp
      );
      activeCallIdRef.current = callId;
      setLocalStream(ls);
      setRemoteStream(rs);
      setCallStatus('connecting');
      setIncomingCall(null);
    } catch (err) {
      console.error('[Call] Failed to accept call:', err);
      setCallStatus('idle');
      setIncomingCall(null);
      cleanupCall();
    }
  }, [localUserId, incomingCall]);

  const rejectIncomingCall = useCallback(() => {
    void endCall('reject');
    setCallStatus('idle');
    setIncomingCall(null);
    activeCallIdRef.current = null;
  }, []);

  const hangUp = useCallback(() => {
    void endCall('hangup');
    resetToEnded();
  }, [resetToEnded]);

  const toggleMuteAudio = useCallback(() => {
    setIsMuted((prev) => {
      toggleMute(!prev);
      return !prev;
    });
  }, []);

  const toggleCameraOff = useCallback(() => {
    setIsVideoOff((prev) => {
      toggleVideo(!prev);
      return !prev;
    });
  }, []);

  const flipCamera = useCallback(async () => {
    try {
      const mode = await switchCamera();
      setFacingMode(mode);
    } catch (err) {
      console.error('[Call] Failed to switch camera:', err);
    }
  }, []);

  return {
    callStatus,
    localStream,
    remoteStream,
    incomingCall,
    isMuted,
    isVideoOff,
    callDuration,
    facingMode,
    initiateCall,
    acceptIncomingCall,
    rejectIncomingCall,
    hangUp,
    toggleMuteAudio,
    toggleCameraOff,
    flipCamera,
  };
}


