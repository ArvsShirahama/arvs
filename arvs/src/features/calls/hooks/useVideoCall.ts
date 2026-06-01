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
  startCall,
  toggleMute,
  toggleVideo,
  getActiveCallState,
  setCallModalOpen,
  switchCamera,
  callSoundManager,
  type CallStatus,
} from '../services';
import { sendCallPush } from '../../../services/pushService';


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
  remoteName: string | null;
  remoteAvatarUrl: string | null;
  initiateCall: (
    conversationId: string,
    remoteUserId: string,
    remoteName: string,
    remoteAvatarUrl: string | null
  ) => Promise<void>;
  acceptIncomingCall: () => Promise<void>;
  rejectIncomingCall: () => void;
  hangUp: () => void;
  toggleMuteAudio: () => void;
  toggleCameraOff: () => void;
  flipCamera: () => Promise<void>;
}


const OUTGOING_RING_TIMEOUT_MS = 30_000;

export function useVideoCall(localUserId: string | undefined): UseVideoCallReturn {
  const [callStatus, setCallStatus] = useState<CallStatus>('idle');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCallInfo | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [remoteName, setRemoteName] = useState<string | null>(null);
  const [remoteAvatarUrl, setRemoteAvatarUrl] = useState<string | null>(null);


  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unansweredTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callStatusRef = useRef<CallStatus>('idle');
  const activeCallIdRef = useRef<string | null>(null);


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
      setRemoteName(activeState.remoteName);
      setRemoteAvatarUrl(activeState.remoteAvatarUrl);
      setCallStatus(activeState.callStatus);
      activeCallIdRef.current = activeState.callId;

      if (activeState.incomingCallInfo) {
        setIncomingCall({
          callId: activeState.incomingCallInfo.callId,
          from: activeState.incomingCallInfo.from,
          conversationId: activeState.incomingCallInfo.conversationId,
          offerSdp: activeState.incomingCallInfo.offerSdp,
        });
      } else {
        setIncomingCall(null);
      }
    };

    // Initialize state
    handleStateChange();

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
      callSoundManager.startIncomingRingtone();
      triggerVibration();
      vibeInterval = setInterval(triggerVibration, 3000);
    } else if (callStatus === 'calling' || callStatus === 'connecting') {
      callSoundManager.startOutgoingRingback();
    } else {
      callSoundManager.stopAll();
      if (canVibrateWeb()) {
        try {
          navigator.vibrate(0);
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

  useEffect(() => {
    return () => {
      clearUnansweredTimeout();
    };
  }, [clearUnansweredTimeout]);

  const initiateCall = useCallback(async (
    conversationId: string,
    remoteUserId: string,
    remoteNameVal: string,
    remoteAvatarVal: string | null
  ) => {
    if (!localUserId) return;

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

      void sendCallPush(conversationId, callId, true).catch((err) => {
        console.warn('[Call] Failed to dispatch call push:', err);
      });
    } catch (err) {
      console.error('[Call] Failed to start call:', err);
      setCallStatus('idle');
      cleanupCall();
    }
  }, [localUserId]);

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
  }, []);

  const hangUp = useCallback(() => {
    void endCall('hangup');
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
    remoteName,
    remoteAvatarUrl,
    initiateCall,
    acceptIncomingCall,
    rejectIncomingCall,
    hangUp,
    toggleMuteAudio,
    toggleCameraOff,
    flipCamera,
  };
}

export type { CallStatus };



