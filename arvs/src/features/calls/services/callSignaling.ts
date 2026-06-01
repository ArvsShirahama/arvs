/**
 * Call Signaling Service
 *
 * WebRTC + Supabase Realtime broadcast for 1:1 video calls.
 * Must-fix guarantees:
 * - Waits for channel SUBSCRIBED before sending any offer/answer/ICE.
 * - Scopes every signal with callId to prevent stale signal crossover.
 * - Emits transport state so UI can reflect real connection truth.
 * - Uses env-based TURN configuration (no hardcoded credentials).
 */

import { supabase } from '../../../supabaseClient';
import { registerPlugin, Capacitor } from '@capacitor/core';
import { getStoredPipEnabled, onPipModeChange } from '../../../services/pipService';

interface AndroidPiPPlugin {
  setCallActive(options: { active: boolean }): Promise<void>;
  enterPiP(): Promise<void>;
}

const AndroidPiP = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
  ? registerPlugin<AndroidPiPPlugin>('AndroidPiP')
  : null;

export function triggerNativePiP(): void {
  if (AndroidPiP) {
    AndroidPiP.enterPiP().catch((err) => {
      console.warn('[AndroidPiP] Failed to enter native PiP:', err);
    });
  }
}

export type SignalType =
  | 'offer'
  | 'answer'
  | 'ice-candidate'
  | 'hangup'
  | 'reject'
  | 'busy'
  | 'remote-stream'
  | 'connection-state'
  | 'join';

export interface SignalPayload {
  type: SignalType;
  from: string;
  to: string;
  conversationId: string;
  callId: string;
  sdp?: string;
  candidate?: RTCIceCandidateInit | null;
  stream?: MediaStream;
  peerConnectionState?: RTCPeerConnectionState;
  iceConnectionState?: RTCIceConnectionState;
}

export interface IncomingCallDetails {
  callId: string;
  from: string;
  conversationId: string;
  offerSdp: string;
  callerName: string;
  callerAvatarUrl: string | null;
}

export type SignalCallback = (payload: SignalPayload) => void;

const ICE_DISCONNECTED_TIMEOUT_MS = 30_000;

function buildIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  const turnUrlsRaw = import.meta.env.VITE_TURN_URL as string | undefined;
  const turnUsername = import.meta.env.VITE_TURN_USERNAME as string | undefined;
  const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL as string | undefined;

  if (turnUrlsRaw && turnUsername && turnCredential) {
    const urls = turnUrlsRaw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    if (urls.length > 0) {
      servers.push({
        urls,
        username: turnUsername,
        credential: turnCredential,
      });
    }
  }

  return servers;
}

function getRtcConfig(): RTCConfiguration {
  return {
    iceServers: buildIceServers(),
    iceTransportPolicy: 'all',
  };
}

export type CallStatus = 'idle' | 'calling' | 'ringing' | 'connecting' | 'active' | 'ended';

let peerConnection: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;
let remoteStream: MediaStream | null = null;
let signalingChannel: ReturnType<typeof supabase.channel> | null = null;
let channelReadyPromise: Promise<void> | null = null;

let isRemoteDescriptionSet = false;
const pendingIceCandidatesByCallId = new Map<string, RTCIceCandidateInit[]>();
let signalListeners: SignalCallback[] = [];
let currentConversationId: string | null = null;
let currentLocalUserId: string | null = null;
let currentRemoteUserId: string | null = null;
let currentCallId: string | null = null;
let disconnectedTimer: ReturnType<typeof setTimeout> | null = null;
let channelGeneration = 0;
let currentFacingMode: 'user' | 'environment' = 'user';

let currentCallStatus: CallStatus = 'idle';
let remoteName: string | null = null;
let remoteAvatarUrl: string | null = null;
let localIceCandidates: RTCIceCandidateInit[] = [];
let incomingCallInfo: IncomingCallDetails | null = null;

let userCallsChannel: ReturnType<typeof supabase.channel> | null = null;


function getChannelName(conversationId: string): string {
  return `call-signal-${conversationId}`;
}

function clearDisconnectedTimer(): void {
  if (disconnectedTimer) {
    clearTimeout(disconnectedTimer);
    disconnectedTimer = null;
  }
}

function emitSignal(payload: SignalPayload): void {
  for (const listener of signalListeners) {
    listener(payload);
  }
  notifyCallStateChange();
}

function emitConnectionState(
  conversationId: string,
  localUserId: string,
  callId: string,
  pc: RTCPeerConnection
): void {
  const pcState = pc.connectionState;
  const iceState = pc.iceConnectionState;

  if (pcState === 'connected' || iceState === 'connected' || iceState === 'completed') {
    currentCallStatus = 'active';
  } else if (pcState === 'connecting' || iceState === 'checking' || iceState === 'new') {
    if (currentCallStatus !== 'active' && currentCallStatus !== 'ended') {
      currentCallStatus = 'connecting';
    }
  } else if (pcState === 'closed') {
    currentCallStatus = 'ended';
  }

  emitSignal({
    type: 'connection-state',
    from: 'system',
    to: localUserId,
    conversationId,
    callId,
    peerConnectionState: pcState,
    iceConnectionState: iceState,
  });
}

async function ensureSignalingChannel(conversationId: string, localUserId: string): Promise<void> {
  if (
    signalingChannel &&
    channelReadyPromise &&
    currentConversationId === conversationId &&
    currentLocalUserId === localUserId
  ) {
    return channelReadyPromise;
  }

  if (signalingChannel) {
    await supabase.removeChannel(signalingChannel);
    signalingChannel = null;
  }
  channelReadyPromise = null;
  channelGeneration += 1;
  const generation = channelGeneration;

  currentConversationId = conversationId;
  currentLocalUserId = localUserId;

  signalingChannel = supabase.channel(getChannelName(conversationId));
  signalingChannel.on('broadcast', { event: 'signal' }, ({ payload }) => {
    const signal = payload as SignalPayload;

    if (signal.conversationId !== conversationId) return;
    if (signal.from === localUserId) return;
    if (signal.to && signal.to !== localUserId) return;

    // Ignore stale signals from previous call generations except incoming offer.
    if (signal.callId && currentCallId && signal.callId !== currentCallId && signal.type !== 'offer') {
      return;
    }

    emitSignal(signal);
    void handleIncomingSignal(signal);
  });

  channelReadyPromise = new Promise<void>((resolve, reject) => {
    let settled = false;
    signalingChannel!.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        if (settled) return;
        settled = true;
        resolve();
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        // Ignore CLOSED from stale/replaced channel generations.
        if (generation !== channelGeneration) {
          return;
        }
        if (settled) return;
        settled = true;
        reject(new Error(`Call signaling channel failed: ${status}`));
      }
    });
  });

  return channelReadyPromise;
}

async function sendSignal(payload: SignalPayload): Promise<void> {
  if (!signalingChannel || !channelReadyPromise) {
    throw new Error('Call signaling channel is not ready.');
  }

  await channelReadyPromise;
  const result = await signalingChannel.send({
    type: 'broadcast',
    event: 'signal',
    payload,
  });

  if (result !== 'ok') {
    throw new Error(`Failed to send call signal: ${result}`);
  }
}

export async function acquireLocalMedia(videoEnabled = true): Promise<MediaStream> {
  if (videoEnabled) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: currentFacingMode, width: { ideal: 640 }, height: { ideal: 480 } },
      });
      localStream = stream;
      return stream;

    } catch (err) {
      console.warn('[Call] Camera unavailable, falling back to audio-only:', err);
      const audioOnlyStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      localStream = audioOnlyStream;
      return audioOnlyStream;
    }
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: false,
  });
  localStream = stream;
  return stream;
}

export function stopLocalMedia(): void {
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }
}

function createPeerConnection(
  conversationId: string,
  localUserId: string,
  remoteUserId: string,
  callId: string
): RTCPeerConnection {
  if (peerConnection) {
    peerConnection.close();
  }

  clearDisconnectedTimer();
  isRemoteDescriptionSet = false;
  remoteStream = new MediaStream();

  const pc = new RTCPeerConnection(getRtcConfig());

  if (localStream) {
    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream as MediaStream);
    });
  }

  pc.ontrack = (event) => {
    if (remoteStream && event.track && !remoteStream.getTracks().some((t) => t.id === event.track.id)) {
      remoteStream.addTrack(event.track);
    }

    emitSignal({
      type: 'remote-stream',
      from: 'system',
      to: localUserId,
      conversationId,
      callId,
      stream: remoteStream ?? undefined,
    });
  };

  pc.onicecandidate = (event) => {
    if (!event.candidate) return;
    const candidateJson = event.candidate.toJSON();
    localIceCandidates.push(candidateJson);
    void sendSignal({
      type: 'ice-candidate',
      from: localUserId,
      to: remoteUserId,
      conversationId,
      callId,
      candidate: candidateJson,
    });
  };

  pc.onconnectionstatechange = () => {
    emitConnectionState(conversationId, localUserId, callId, pc);
  };

  pc.oniceconnectionstatechange = () => {
    emitConnectionState(conversationId, localUserId, callId, pc);
    const state = pc.iceConnectionState;

    switch (state) {
      case 'connected':
      case 'completed':
        clearDisconnectedTimer();
        break;
      case 'disconnected':
        // The OS may temporarily freeze the WebView network when the app is
        // backgrounded. Give a generous timeout before considering the call dead.
        clearDisconnectedTimer();
        disconnectedTimer = setTimeout(() => {
          if (peerConnection && peerConnection.iceConnectionState === 'disconnected') {
            // Try an ICE restart first — if the peer is still there it will recover.
            try {
              peerConnection.restartIce();
            } catch {
              void endCall('hangup');
            }
          }
        }, ICE_DISCONNECTED_TIMEOUT_MS);
        break;
      case 'failed':
        // Instead of immediately ending the call, attempt an ICE restart.
        // Mobile browsers frequently report 'failed' after brief backgrounding
        // but the underlying transport recovers once foregrounded.
        clearDisconnectedTimer();
        if (peerConnection) {
          try {
            peerConnection.restartIce();
          } catch {
            void endCall('hangup');
          }
        } else {
          void endCall('hangup');
        }
        break;
      case 'closed':
        clearDisconnectedTimer();
        break;
      default:
        break;
    }
  };

  peerConnection = pc;
  return pc;
}

async function flushPendingCandidates(): Promise<void> {
  if (!peerConnection || !isRemoteDescriptionSet || !currentCallId) return;

  const candidates = pendingIceCandidatesByCallId.get(currentCallId) || [];
  for (const candidate of candidates) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn('[Call] Failed to add buffered ICE candidate:', err);
    }
  }
  pendingIceCandidatesByCallId.delete(currentCallId);
}

async function handleIncomingSignal(signal: SignalPayload): Promise<void> {
  switch (signal.type) {
    case 'offer': {
      if (!signal.sdp || !signal.callId) return;

      if (currentCallStatus === 'idle') {
        currentCallId = signal.callId;
        currentConversationId = signal.conversationId;
        currentRemoteUserId = signal.from;
        currentCallStatus = 'ringing';

        // Fetch caller profile information
        try {
          const { data: profile } = await supabase
            .from('profiles')
            .select('display_name, username, avatar_url')
            .eq('id', signal.from)
            .maybeSingle();

          if (profile) {
            remoteName = profile.display_name || profile.username || 'Someone';
            remoteAvatarUrl = profile.avatar_url;
          }
        } catch (err) {
          console.warn('[Call] Failed to fetch caller profile:', err);
        }

        incomingCallInfo = {
          callId: signal.callId,
          from: signal.from,
          conversationId: signal.conversationId,
          offerSdp: signal.sdp,
          callerName: remoteName || 'Someone',
          callerAvatarUrl: remoteAvatarUrl,
        };

        _isCallModalOpen = true;
        notifyCallStateChange();
      } else {
        // Send busy signal back to the caller
        const tempChannel = supabase.channel(`call-signal-${signal.conversationId}`);
        tempChannel.subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            try {
              await tempChannel.send({
                type: 'broadcast',
                event: 'signal',
                payload: {
                  type: 'busy',
                  from: currentLocalUserId!,
                  to: signal.from,
                  conversationId: signal.conversationId,
                  callId: signal.callId,
                },
              });
            } catch (err) {
              console.warn('[Call] Failed to send busy response:', err);
            } finally {
              setTimeout(() => {
                void supabase.removeChannel(tempChannel);
              }, 4000);
            }
          }
        });
      }
      break;
    }
    case 'join': {
      if (signal.callId && currentCallId === signal.callId && currentCallStatus === 'calling' && peerConnection) {
        console.log('[Call] Recipient joined signaling channel, sending offer and accumulated ICE candidates');
        
        // Re-send the offer
        const localDesc = peerConnection.localDescription;
        if (localDesc && localDesc.type === 'offer') {
          await sendSignal({
            type: 'offer',
            from: currentLocalUserId!,
            to: currentRemoteUserId!,
            conversationId: currentConversationId!,
            callId: currentCallId,
            sdp: localDesc.sdp,
          });
        }

        // Re-send all accumulated ICE candidates
        for (const candidate of localIceCandidates) {
          await sendSignal({
            type: 'ice-candidate',
            from: currentLocalUserId!,
            to: currentRemoteUserId!,
            conversationId: currentConversationId!,
            callId: currentCallId,
            candidate,
          });
        }
      }
      break;
    }
    case 'answer': {
      if (!currentCallId || signal.callId !== currentCallId) return;
      if (!peerConnection || !signal.sdp) return;
      try {
        await peerConnection.setRemoteDescription(
          new RTCSessionDescription({ type: 'answer', sdp: signal.sdp })
        );
        isRemoteDescriptionSet = true;
        await flushPendingCandidates();

        currentCallStatus = 'connecting';
        notifyCallStateChange();
      } catch (err) {
        console.error('[Call] Failed to set remote answer:', err);
      }
      break;
    }
    case 'ice-candidate': {
      if (!signal.candidate || !signal.callId) return;
      if (peerConnection && isRemoteDescriptionSet && signal.callId === currentCallId) {
        try {
          await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } catch (err) {
          console.warn('[Call] Failed to add ICE candidate:', err);
        }
      } else {
        let list = pendingIceCandidatesByCallId.get(signal.callId);
        if (!list) {
          list = [];
          pendingIceCandidatesByCallId.set(signal.callId, list);
        }
        list.push(signal.candidate);
      }
      break;
    }
    case 'hangup':
    case 'reject':
    case 'busy': {
      if (signal.callId && currentCallId && signal.callId !== currentCallId) return;
      if (currentCallStatus !== 'idle' && currentCallStatus !== 'ended') {
        currentCallStatus = 'ended';
        notifyCallStateChange();
        setTimeout(() => {
          cleanupCall();
        }, 1200);
      }
      break;
    }
    default:
      break;
  }
}

export async function startCall(
  conversationId: string,
  localUserId: string,
  remoteUserId: string
): Promise<{ callId: string; localStream: MediaStream; remoteStream: MediaStream }> {
  currentCallStatus = 'calling';
  currentLocalUserId = localUserId;
  currentRemoteUserId = remoteUserId;
  currentConversationId = conversationId;
  localIceCandidates = [];
  incomingCallInfo = null;

  // Fetch profiles for displaying caller/callee names and avatars
  let localName = 'Someone';
  let localAvatar: string | null = null;
  try {
    const [{ data: localProfile }, { data: remoteProfile }] = await Promise.all([
      supabase.from('profiles').select('display_name, username, avatar_url').eq('id', localUserId).maybeSingle(),
      supabase.from('profiles').select('display_name, username, avatar_url').eq('id', remoteUserId).maybeSingle(),
    ]);
    if (localProfile) {
      localName = localProfile.display_name || localProfile.username || 'Someone';
      localAvatar = localProfile.avatar_url;
    }
    if (remoteProfile) {
      remoteName = remoteProfile.display_name || remoteProfile.username || 'Someone';
      remoteAvatarUrl = remoteProfile.avatar_url;
    }
  } catch (err) {
    console.warn('[Call] Failed to fetch caller/callee profiles:', err);
  }

  await ensureSignalingChannel(conversationId, localUserId);

  const callId = crypto.randomUUID();
  const stream = await acquireLocalMedia();

  const pc = createPeerConnection(conversationId, localUserId, remoteUserId, callId);
  currentCallId = callId;

  const offer = await pc.createOffer({
    offerToReceiveAudio: true,
    offerToReceiveVideo: true,
  });
  await pc.setLocalDescription(offer);

  await sendSignal({
    type: 'offer',
    from: localUserId,
    to: remoteUserId,
    conversationId,
    callId,
    sdp: offer.sdp,
  });

  // Broadcast lightweight invitation on the callee's user-specific channel
  const inviteChannel = supabase.channel(`user-calls-${remoteUserId}`);
  inviteChannel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      try {
        await inviteChannel.send({
          type: 'broadcast',
          event: 'invite',
          payload: {
            type: 'invite',
            from: localUserId,
            to: remoteUserId,
            conversationId,
            callId,
            callerName: localName,
            callerAvatarUrl: localAvatar,
          },
        });
      } catch (err) {
        console.warn('[Call] Failed to send user invitation broadcast:', err);
      } finally {
        setTimeout(() => {
          void supabase.removeChannel(inviteChannel);
        }, 4000);
      }
    }
  });

  notifyCallStateChange();
  return { callId, localStream: stream, remoteStream: remoteStream as MediaStream };
}

export async function acceptCall(
  conversationId: string,
  localUserId: string,
  remoteUserId: string,
  callId: string,
  offerSdp: string
): Promise<{ callId: string; localStream: MediaStream; remoteStream: MediaStream }> {
  currentCallStatus = 'connecting';
  incomingCallInfo = null;
  localIceCandidates = [];

  await ensureSignalingChannel(conversationId, localUserId);

  currentCallId = callId;
  currentRemoteUserId = remoteUserId;

  let stream: MediaStream;
  try {
    stream = await acquireLocalMedia();
  } catch (err) {
    console.error('[Call] Cannot acquire any media:', err);
    await sendSignal({
      type: 'hangup',
      from: localUserId,
      to: remoteUserId,
      conversationId,
      callId,
    });
    cleanupCall();
    throw err;
  }

  const pc = createPeerConnection(conversationId, localUserId, remoteUserId, callId);

  await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: offerSdp }));
  isRemoteDescriptionSet = true;
  await flushPendingCandidates();

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  await sendSignal({
    type: 'answer',
    from: localUserId,
    to: remoteUserId,
    conversationId,
    callId,
    sdp: answer.sdp,
  });

  notifyCallStateChange();
  return { callId, localStream: stream, remoteStream: remoteStream as MediaStream };
}

export async function endCall(reason: 'hangup' | 'reject' | 'busy' = 'hangup'): Promise<void> {
  if (currentConversationId && currentLocalUserId && currentRemoteUserId && currentCallId) {
    try {
      await sendSignal({
        type: reason,
        from: currentLocalUserId,
        to: currentRemoteUserId,
        conversationId: currentConversationId,
        callId: currentCallId,
      });
    } catch (err) {
      console.warn('[Call] Failed to send end signal:', err);
    }
  }

  currentCallStatus = 'ended';
  notifyCallStateChange();

  setTimeout(() => {
    cleanupCall();
  }, 1200);
}

export async function subscribeToCallSignals(
  conversationId: string,
  localUserId: string
): Promise<void> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < 3) {
    try {
      await ensureSignalingChannel(conversationId, localUserId);
      return;
    } catch (error) {
      lastError = error;
      attempt += 1;

      const message = error instanceof Error ? error.message : String(error);
      if (
        !message.includes('CLOSED')
        && !message.includes('TIMED_OUT')
        && !message.includes('CHANNEL_ERROR')
      ) {
        throw error;
      }

      // Retry with short backoff for transient Realtime channel closures.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, attempt * 250);
      });
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Call signaling channel could not be established after retries.');
}

export function onSignal(callback: SignalCallback): () => void {
  signalListeners.push(callback);
  return () => {
    signalListeners = signalListeners.filter((cb) => cb !== callback);
  };
}

export function toggleMute(muted: boolean): void {
  if (localStream) {
    localStream.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }
}

export function toggleVideo(videoOff: boolean): void {
  if (localStream) {
    localStream.getVideoTracks().forEach((track) => {
      track.enabled = !videoOff;
    });
  }
}

export function getFacingMode(): 'user' | 'environment' {
  return currentFacingMode;
}

export async function switchCamera(): Promise<'user' | 'environment'> {
  if (!localStream) {
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    notifyCallStateChange();
    return currentFacingMode;
  }

  const newFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
  const oldTrack = localStream.getVideoTracks()[0];

  // 1. Stop and remove the old track BEFORE requesting the new one to release the camera hardware resource.
  // This is crucial on Android/iOS mobile devices to avoid "SourceUnavailableError" or "NotReadableError".
  if (oldTrack) {
    oldTrack.stop();
    localStream.removeTrack(oldTrack);
  }

  let tempStream: MediaStream;
  try {
    // 2. Try to request a new stream using facingMode constraint
    tempStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: newFacingMode, width: { ideal: 640 }, height: { ideal: 480 } },
    });
  } catch (err) {
    console.warn('[Call] Failed to switch camera using facingMode, trying enumerateDevices...', err);
    try {
      // 3. Fallback: Enumerate devices to find a different video input device explicitly
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter((d) => d.kind === 'videoinput');
      
      if (videoDevices.length > 1) {
        const currentTrackSettings = oldTrack ? oldTrack.getSettings() : null;
        const currentDeviceId = currentTrackSettings?.deviceId;
        
        let targetDevice = videoDevices.find((d) => d.deviceId !== currentDeviceId);
        if (!targetDevice) {
          targetDevice = videoDevices[1]; // Fallback to second device
        }

        tempStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { deviceId: { exact: targetDevice.deviceId }, width: { ideal: 640 }, height: { ideal: 480 } },
        });
      } else {
        throw err;
      }
    } catch (fallbackErr) {
      console.error('[Call] Camera switch fallback failed, recovering original facing mode...', fallbackErr);
      try {
        tempStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: currentFacingMode, width: { ideal: 640 }, height: { ideal: 480 } },
        });
      } catch (recoverErr) {
        console.error('[Call] Failed to recover original camera track:', recoverErr);
        notifyCallStateChange();
        return currentFacingMode;
      }
    }
  }

  const newTrack = tempStream.getVideoTracks()[0];
  if (!newTrack) {
    throw new Error('No video track found in the new stream');
  }

  // 4. Add the new track to the localStream
  localStream.addTrack(newTrack);

  // 5. If there is an active peer connection, replace the track in the sender
  if (peerConnection) {
    const senders = peerConnection.getSenders();
    const videoSender = senders.find((sender) => sender.track && sender.track.kind === 'video');
    if (videoSender) {
      try {
        await videoSender.replaceTrack(newTrack);
      } catch (replaceErr) {
        console.error('[Call] replaceTrack failed in peer connection:', replaceErr);
      }
    }
  }

  currentFacingMode = newFacingMode;
  notifyCallStateChange();
  return currentFacingMode;
}


export function cleanupCall(): void {
  clearDisconnectedTimer();
  stopLocalMedia();

  if (remoteStream) {
    remoteStream.getTracks().forEach((track) => track.stop());
    remoteStream = null;
  }

  if (peerConnection) {
    peerConnection.ontrack = null;
    peerConnection.onicecandidate = null;
    peerConnection.oniceconnectionstatechange = null;
    peerConnection.onconnectionstatechange = null;
    peerConnection.close();
    peerConnection = null;
  }

  isRemoteDescriptionSet = false;
  pendingIceCandidatesByCallId.clear();
  currentCallId = null;
  currentRemoteUserId = null;
  _isInAppPiPHidden = false;
  _isNativePiPActive = false;
  currentFacingMode = 'user';

  // Reset signaling layer states
  currentCallStatus = 'idle';
  remoteName = null;
  remoteAvatarUrl = null;
  localIceCandidates = [];
  incomingCallInfo = null;

  notifyCallStateChange();
}

export async function cleanup(): Promise<void> {
  cleanupCall();

  if (signalingChannel) {
    await supabase.removeChannel(signalingChannel);
    signalingChannel = null;
  }
  channelReadyPromise = null;
  currentConversationId = null;
  currentLocalUserId = null;
}

export function getCallDebugInfo(): Record<string, unknown> {
  return {
    hasPC: !!peerConnection,
    pcState: peerConnection?.connectionState ?? 'none',
    iceState: peerConnection?.iceConnectionState ?? 'none',
    signalingState: peerConnection?.signalingState ?? 'none',
    hasLocalStream: !!localStream,
    localTracks: localStream?.getTracks().map((t) => `${t.kind}:${t.enabled}`) ?? [],
    hasRemoteStream: !!remoteStream,
    remoteTracks: remoteStream?.getTracks().map((t) => `${t.kind}:${t.enabled}`) ?? [],
    remoteDescSet: isRemoteDescriptionSet,
    pendingCandidates: currentCallId ? (pendingIceCandidatesByCallId.get(currentCallId)?.length ?? 0) : 0,
    conversationId: currentConversationId,
    callId: currentCallId,
    remoteUserId: currentRemoteUserId,
  };
}

export function notifyCallStateChange(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('arvs-call-state-change'));
  }

  if (AndroidPiP) {
    const active = !!currentCallId && getStoredPipEnabled();
    AndroidPiP.setCallActive({ active }).catch((err) => {
      console.warn('[AndroidPiP] Failed to update call active state:', err);
    });
  }
}

if (typeof window !== 'undefined') {
  onPipModeChange(() => {
    notifyCallStateChange();
  });
}

let _isCallModalOpen = false;
let _isInAppPiPHidden = false;
let _isNativePiPActive = false;

export function setCallModalOpen(open: boolean): void {
  _isCallModalOpen = open;
  notifyCallStateChange();
}

export function getCallModalOpen(): boolean {
  return _isCallModalOpen;
}

export function setInAppPiPHidden(hidden: boolean): void {
  _isInAppPiPHidden = hidden;
  notifyCallStateChange();
}

export function getInAppPiPHidden(): boolean {
  return _isInAppPiPHidden;
}

export function setNativePiPActive(active: boolean): void {
  _isNativePiPActive = active;
  notifyCallStateChange();
}

export function getNativePiPActive(): boolean {
  return _isNativePiPActive;
}

export interface ActiveCallState {
  callId: string | null;
  conversationId: string | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  peerConnectionState: RTCPeerConnectionState | 'none';
  iceConnectionState: RTCIceConnectionState | 'none';
  isModalOpen: boolean;
  isInAppPiPHidden: boolean;
  isNativePiPActive: boolean;
  facingMode: 'user' | 'environment';
  callStatus: CallStatus;
  remoteName: string | null;
  remoteAvatarUrl: string | null;
  incomingCallInfo: IncomingCallDetails | null;
}

export function getActiveCallState(): ActiveCallState {
  return {
    callId: currentCallId,
    conversationId: currentConversationId,
    localStream,
    remoteStream,
    peerConnectionState: peerConnection?.connectionState ?? 'none',
    iceConnectionState: peerConnection?.iceConnectionState ?? 'none',
    isModalOpen: _isCallModalOpen,
    isInAppPiPHidden: _isInAppPiPHidden,
    isNativePiPActive: _isNativePiPActive,
    facingMode: currentFacingMode,
    callStatus: currentCallStatus,
    remoteName,
    remoteAvatarUrl,
    incomingCallInfo,
  };
}

export function subscribeToUserCallInvitations(localUserId: string): void {
  if (userCallsChannel) {
    void supabase.removeChannel(userCallsChannel);
  }

  currentLocalUserId = localUserId;

  userCallsChannel = supabase.channel(`user-calls-${localUserId}`);
  userCallsChannel.on('broadcast', { event: 'invite' }, async ({ payload }) => {
    const invite = payload as {
      type: 'invite';
      from: string;
      to: string;
      conversationId: string;
      callId: string;
      callerName: string;
      callerAvatarUrl: string | null;
      video: boolean;
    };

    if (invite.to !== localUserId) return;
    await handleCallInvitation(invite);
  });

  userCallsChannel.subscribe();
}

export function unsubscribeFromUserCallInvitations(): void {
  if (userCallsChannel) {
    void supabase.removeChannel(userCallsChannel);
    userCallsChannel = null;
  }
}

export async function handleCallInvitation(invite: {
  conversationId: string;
  callId: string;
  from: string;
  callerName: string;
  callerAvatarUrl: string | null;
}): Promise<void> {
  if (currentCallStatus !== 'idle') {
    // Busy! Send busy signal back to caller on their conversation channel
    const tempChannel = supabase.channel(`call-signal-${invite.conversationId}`);
    tempChannel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        try {
          await tempChannel.send({
            type: 'broadcast',
            event: 'signal',
            payload: {
              type: 'busy',
              from: currentLocalUserId!,
              to: invite.from,
              conversationId: invite.conversationId,
              callId: invite.callId,
            },
          });
        } catch (err) {
          console.warn('[Call] Failed to send busy notification:', err);
        } finally {
          setTimeout(() => {
            void supabase.removeChannel(tempChannel);
          }, 4000);
        }
      }
    });
    return;
  }

  console.log('[Call] Global call invitation received. Joining signaling...');
  currentCallId = invite.callId;
  currentConversationId = invite.conversationId;
  currentRemoteUserId = invite.from;
  remoteName = invite.callerName;
  remoteAvatarUrl = invite.callerAvatarUrl;

  await subscribeToCallSignals(invite.conversationId, currentLocalUserId!);

  await sendSignal({
    type: 'join',
    from: currentLocalUserId!,
    to: invite.from,
    conversationId: invite.conversationId,
    callId: invite.callId,
  });

  currentCallStatus = 'ringing';
  incomingCallInfo = {
    callId: invite.callId,
    from: invite.from,
    conversationId: invite.conversationId,
    offerSdp: '',
    callerName: invite.callerName,
    callerAvatarUrl: invite.callerAvatarUrl,
  };

  _isCallModalOpen = true;
  notifyCallStateChange();
}



