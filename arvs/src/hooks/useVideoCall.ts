/**
 * useVideoCall Hook
 *
 * Bridges the callSignaling service to React component state.
 * Manages the call state machine: idle → calling → ringing → active → ended.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  startCall,
  acceptCall,
  endCall,
  cleanup,
  cleanupCall,
  onSignal,
  subscribeToCallSignals,
  toggleMute,
  toggleVideo,
} from '../services/callSignaling';
import type { SignalPayload } from '../services/callSignaling';

export type CallStatus = 'idle' | 'calling' | 'ringing' | 'active' | 'ended';

export interface IncomingCallInfo {
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

export function useVideoCall(conversationId: string, localUserId: string | undefined): UseVideoCallReturn {
  const [callStatus, setCallStatus] = useState<CallStatus>('idle');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCallInfo | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callStatusRef = useRef<CallStatus>('idle');

  // Keep ref in sync with state for use in signal callback
  useEffect(() => {
    callStatusRef.current = callStatus;
  }, [callStatus]);

  // Start duration timer when call becomes active
  useEffect(() => {
    if (callStatus === 'active') {
      setCallDuration(0);
      durationIntervalRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }
    }

    return () => {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
    };
  }, [callStatus]);

  // Subscribe to signaling channel and listen for signals
  useEffect(() => {
    if (!conversationId || !localUserId) return;

    subscribeToCallSignals(conversationId, localUserId);

    const unsubscribe = onSignal((signal: SignalPayload) => {
      switch (signal.type) {
        case 'offer': {
          // Someone is calling us
          if (callStatusRef.current === 'idle') {
            setIncomingCall({
              from: signal.from,
              conversationId: signal.conversationId,
              offerSdp: signal.sdp ?? '',
            });
            setCallStatus('ringing');
          } else {
            // We're already in a call — send busy signal
            endCall('busy');
          }
          break;
        }

        case 'answer': {
          // Our call was accepted — transition to active
          if (callStatusRef.current === 'calling') {
            setCallStatus('active');
          }
          break;
        }

        case 'hangup': {
          // Remote peer hung up or connection failed
          setCallStatus('ended');
          setIncomingCall(null);
          setLocalStream(null);
          setRemoteStream(null);
          setIsMuted(false);
          setIsVideoOff(false);
          cleanupCall();

          // Auto-reset to idle after a brief pause
          setTimeout(() => {
            setCallStatus('idle');
          }, 1500);
          break;
        }

        case 'reject': {
          // Our call was rejected
          setCallStatus('ended');
          setLocalStream(null);
          setRemoteStream(null);
          cleanupCall();

          setTimeout(() => {
            setCallStatus('idle');
          }, 1500);
          break;
        }

        case 'busy': {
          // Remote peer is already in a call
          setCallStatus('ended');
          setLocalStream(null);
          setRemoteStream(null);
          cleanupCall();

          setTimeout(() => {
            setCallStatus('idle');
          }, 1500);
          break;
        }

        case 'remote-stream': {
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
  }, [conversationId, localUserId]);

  // Full cleanup on unmount (including signaling channel)
  useEffect(() => {
    return () => {
      if (callStatusRef.current !== 'idle') {
        endCall('hangup');
      }
      cleanup();
    };
  }, []);

  const initiateCall = useCallback(async (remoteUserId: string) => {
    if (!localUserId || !conversationId) return;

    try {
      setCallStatus('calling');
      const { localStream: ls, remoteStream: rs } = await startCall(
        conversationId,
        localUserId,
        remoteUserId
      );
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
      const { localStream: ls, remoteStream: rs } = await acceptCall(
        incomingCall.conversationId,
        localUserId,
        incomingCall.from,
        incomingCall.offerSdp
      );
      setLocalStream(ls);
      setRemoteStream(rs);
      setCallStatus('active');
      setIncomingCall(null);
    } catch (err) {
      console.error('[Call] Failed to accept call:', err);
      setCallStatus('idle');
      setIncomingCall(null);
      cleanupCall();
    }
  }, [localUserId, incomingCall]);

  const rejectIncomingCall = useCallback(() => {
    endCall('reject');
    setCallStatus('idle');
    setIncomingCall(null);
  }, []);

  const hangUp = useCallback(() => {
    endCall('hangup');
    setCallStatus('ended');
    setLocalStream(null);
    setRemoteStream(null);
    setIncomingCall(null);
    setIsMuted(false);
    setIsVideoOff(false);

    setTimeout(() => {
      setCallStatus('idle');
    }, 1500);
  }, []);

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
