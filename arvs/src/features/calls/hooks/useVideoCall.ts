/**
 * useVideoCall Hook
 *
 * React bridge for callSignaling service.
 * Uses transport-level state (ICE/PC) to decide when call is truly active.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  acceptCall,
  cleanup,
  cleanupCall,
  endCall,
  onSignal,
  startCall,
  subscribeToCallSignals,
  toggleMute,
  toggleVideo,
} from '../services';
import type { SignalPayload } from '../services';

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
  initiateCall: (remoteUserId: string) => Promise<void>;
  acceptIncomingCall: () => Promise<void>;
  rejectIncomingCall: () => void;
  hangUp: () => void;
  toggleMuteAudio: () => void;
  toggleCameraOff: () => void;
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

  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unansweredTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callStatusRef = useRef<CallStatus>('idle');
  const activeCallIdRef = useRef<string | null>(null);

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
            if (callStatusRef.current === 'calling' || callStatusRef.current === 'ringing' || callStatusRef.current === 'active') {
              setCallStatus('connecting');
            }
            break;
          }

          if (pcState === 'failed' || pcState === 'closed' || iceState === 'failed') {
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
      if (callStatusRef.current !== 'idle') {
        void endCall('hangup');
      }
      void cleanup();
    };
  }, [clearUnansweredTimeout]);

  const initiateCall = useCallback(async (remoteUserId: string) => {
    if (!localUserId || !conversationId) return;

    try {
      setCallStatus('calling');
      const { callId, localStream: ls, remoteStream: rs } = await startCall(
        conversationId,
        localUserId,
        remoteUserId
      );
      activeCallIdRef.current = callId;
      setLocalStream(ls);
      setRemoteStream(rs);
    } catch (err) {
      console.error('[Call] Failed to start call:', err);
      setCallStatus('idle');
      cleanupCall();
    }
  }, [conversationId, localUserId]);

  const acceptIncomingCall = useCallback(async () => {
    if (!localUserId || !incomingCall) return;

    try {
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

  return {
    callStatus,
    localStream,
    remoteStream,
    incomingCall,
    isMuted,
    isVideoOff,
    callDuration,
    initiateCall,
    acceptIncomingCall,
    rejectIncomingCall,
    hangUp,
    toggleMuteAudio,
    toggleCameraOff,
  };
}

