/**
 * Call Signaling Service
 *
 * Handles WebRTC peer connection setup and Supabase Realtime broadcast
 * signaling for 1-on-1 video calls. Zero external dependencies.
 *
 * Key design choices:
 * - ICE candidates are BUFFERED until the remote description is set.
 *   This prevents the #1 cause of "call connects but no media" bugs.
 * - Supabase broadcast channels are used for signaling (no DB table needed).
 * - A deterministic tiebreaker handles simultaneous call initiation.
 * - TURN relay servers are included for symmetric NAT traversal (mobile carriers).
 * - ICE `disconnected` state has a grace period before hangup (mobile networks).
 */

import { supabase } from '../supabaseClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SignalType = 'offer' | 'answer' | 'ice-candidate' | 'hangup' | 'reject' | 'busy' | 'remote-stream';

export interface SignalPayload {
  type: SignalType;
  from: string;
  to: string;
  conversationId: string;
  sdp?: string;
  candidate?: RTCIceCandidateInit | null;
  stream?: MediaStream;
}

export type SignalCallback = (payload: SignalPayload) => void;

// ---------------------------------------------------------------------------
// STUN + TURN configuration
// TURN servers are essential for mobile-to-mobile calls where both peers
// are behind symmetric NAT (common on mobile carriers).
// ---------------------------------------------------------------------------

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // Free TURN relay servers for NAT traversal on mobile networks
    {
      urls: 'turn:a.relay.metered.ca:80',
      username: 'e8dd65b92f6deb11e6080e8c',
      credential: '3RFEjIhfac6FJKXR',
    },
    {
      urls: 'turn:a.relay.metered.ca:80?transport=tcp',
      username: 'e8dd65b92f6deb11e6080e8c',
      credential: '3RFEjIhfac6FJKXR',
    },
    {
      urls: 'turn:a.relay.metered.ca:443',
      username: 'e8dd65b92f6deb11e6080e8c',
      credential: '3RFEjIhfac6FJKXR',
    },
    {
      urls: 'turns:a.relay.metered.ca:443',
      username: 'e8dd65b92f6deb11e6080e8c',
      credential: '3RFEjIhfac6FJKXR',
    },
  ],
  // Prefer relay candidates to ensure connectivity on restrictive networks
  iceTransportPolicy: 'all',
};

// Grace period before treating ICE `disconnected` as fatal (ms).
// Mobile networks frequently bounce between connected/disconnected.
const ICE_DISCONNECTED_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Module state (singleton — only one call at a time)
// ---------------------------------------------------------------------------

let peerConnection: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;
let remoteStream: MediaStream | null = null;
let signalingChannel: ReturnType<typeof supabase.channel> | null = null;
let isRemoteDescriptionSet = false;
let pendingIceCandidates: RTCIceCandidateInit[] = [];
let signalListeners: SignalCallback[] = [];
let currentConversationId: string | null = null;
let currentLocalUserId: string | null = null;
let disconnectedTimer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getChannelName(conversationId: string): string {
  return `call-signal-${conversationId}`;
}

/** Deterministic tiebreaker: lower user ID wins and becomes the offerer. */
export function isOfferer(localUserId: string, remoteUserId: string): boolean {
  return localUserId < remoteUserId;
}

function clearDisconnectedTimer(): void {
  if (disconnectedTimer) {
    clearTimeout(disconnectedTimer);
    disconnectedTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Signaling channel (Supabase Realtime broadcast)
// ---------------------------------------------------------------------------

function ensureSignalingChannel(conversationId: string, localUserId: string): void {
  if (signalingChannel && currentConversationId === conversationId) {
    return;
  }

  // Clean up any previous channel
  if (signalingChannel) {
    supabase.removeChannel(signalingChannel);
    signalingChannel = null;
  }

  currentConversationId = conversationId;
  currentLocalUserId = localUserId;

  const channelName = getChannelName(conversationId);
  signalingChannel = supabase.channel(channelName);

  signalingChannel
    .on('broadcast', { event: 'signal' }, ({ payload }) => {
      const signal = payload as SignalPayload;

      // Ignore our own signals
      if (signal.from === localUserId) return;

      // Notify all listeners
      for (const listener of signalListeners) {
        listener(signal);
      }

      // Handle WebRTC-specific signals internally
      void handleIncomingSignal(signal);
    })
    .subscribe();
}

function sendSignal(payload: SignalPayload): void {
  if (!signalingChannel) {
    console.warn('[Call] Cannot send signal: no signaling channel');
    return;
  }

  signalingChannel.send({
    type: 'broadcast',
    event: 'signal',
    payload,
  });
}

// ---------------------------------------------------------------------------
// Media stream helpers
// ---------------------------------------------------------------------------

export async function acquireLocalMedia(videoEnabled = true): Promise<MediaStream> {
  if (videoEnabled) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      });
      localStream = stream;
      return stream;
    } catch (err) {
      // Camera may be locked by another tab/process (NotReadableError) or
      // not available (NotFoundError). Fall back to audio-only.
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

// ---------------------------------------------------------------------------
// Peer connection management
// ---------------------------------------------------------------------------

function createPeerConnection(conversationId: string, localUserId: string): RTCPeerConnection {
  if (peerConnection) {
    peerConnection.close();
  }

  clearDisconnectedTimer();
  isRemoteDescriptionSet = false;
  remoteStream = new MediaStream();

  const pc = new RTCPeerConnection(RTC_CONFIG);

  // Add local tracks to the connection
  if (localStream) {
    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream!);
    });
  }

  // When remote tracks arrive, update the stream and notify listeners
  pc.ontrack = (event) => {
    if (remoteStream && event.track) {
      if (!remoteStream.getTracks().some((t) => t.id === event.track.id)) {
        remoteStream.addTrack(event.track);
        console.log('[Call] Added remote track:', event.track.kind);
      }
    }

    for (const listener of signalListeners) {
      listener({
        type: 'remote-stream',
        from: 'system',
        to: localUserId,
        conversationId,
        stream: remoteStream || undefined,
      });
    }
  };

  // When ICE candidates are generated, send them to the remote peer
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignal({
        type: 'ice-candidate',
        from: localUserId,
        to: '', // broadcast — other peer picks it up
        conversationId,
        candidate: event.candidate.toJSON(),
      });
    }
  };

  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    console.log('[Call] ICE state:', state);

    switch (state) {
      case 'connected':
      case 'completed':
        // Connection recovered or established — clear any pending disconnect timer
        clearDisconnectedTimer();
        break;

      case 'disconnected':
        // Mobile networks frequently bounce to disconnected temporarily.
        // Give it a grace period before treating as fatal.
        clearDisconnectedTimer();
        disconnectedTimer = setTimeout(() => {
          // Check again — it may have recovered during the grace period
          if (peerConnection && peerConnection.iceConnectionState === 'disconnected') {
            console.warn('[Call] ICE still disconnected after grace period, ending call');
            endCall('hangup');
          }
        }, ICE_DISCONNECTED_TIMEOUT_MS);
        break;

      case 'failed':
        // ICE negotiation permanently failed — end the call and notify the remote peer
        clearDisconnectedTimer();
        console.error('[Call] ICE connection failed, ending call');
        endCall('hangup');
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

/** Flush any ICE candidates that arrived before the remote description was set. */
async function flushPendingCandidates(): Promise<void> {
  if (!peerConnection || !isRemoteDescriptionSet) return;

  for (const candidate of pendingIceCandidates) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn('[Call] Failed to add buffered ICE candidate:', err);
    }
  }
  pendingIceCandidates = [];
}

// ---------------------------------------------------------------------------
// Handle incoming signals from the remote peer
// ---------------------------------------------------------------------------

async function handleIncomingSignal(signal: SignalPayload): Promise<void> {
  switch (signal.type) {
    case 'answer': {
      if (!peerConnection) return;
      try {
        await peerConnection.setRemoteDescription(
          new RTCSessionDescription({ type: 'answer', sdp: signal.sdp })
        );
        isRemoteDescriptionSet = true;
        await flushPendingCandidates();
      } catch (err) {
        console.error('[Call] Failed to set remote answer:', err);
      }
      break;
    }

    case 'ice-candidate': {
      if (!signal.candidate) return;

      if (!peerConnection || !isRemoteDescriptionSet) {
        // Buffer the candidate — this is THE critical fix
        pendingIceCandidates.push(signal.candidate);
        return;
      }

      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
      } catch (err) {
        console.warn('[Call] Failed to add ICE candidate:', err);
      }
      break;
    }

    // offer, hangup, reject, busy are handled by the hook via signalListeners
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start an outgoing call. Creates the peer connection, acquires local media,
 * generates an SDP offer, and sends it via broadcast.
 */
export async function startCall(
  conversationId: string,
  localUserId: string,
  remoteUserId: string
): Promise<{ localStream: MediaStream; remoteStream: MediaStream }> {
  ensureSignalingChannel(conversationId, localUserId);

  pendingIceCandidates = []; // Clear stale candidates before starting a new call session
  const stream = await acquireLocalMedia();
  const pc = createPeerConnection(conversationId, localUserId);

  const offer = await pc.createOffer({
    offerToReceiveAudio: true,
    offerToReceiveVideo: true,
  });
  await pc.setLocalDescription(offer);

  sendSignal({
    type: 'offer',
    from: localUserId,
    to: remoteUserId,
    conversationId,
    sdp: offer.sdp,
  });

  return { localStream: stream, remoteStream: remoteStream! };
}

/**
 * Accept an incoming call. Creates the peer connection, acquires local media,
 * sets the remote offer, generates an SDP answer, and sends it back.
 */
export async function acceptCall(
  conversationId: string,
  localUserId: string,
  remoteUserId: string,
  offerSdp: string
): Promise<{ localStream: MediaStream; remoteStream: MediaStream }> {
  ensureSignalingChannel(conversationId, localUserId);

  let stream: MediaStream;
  try {
    stream = await acquireLocalMedia();
  } catch (err) {
    // Media acquisition failed completely (no audio either).
    // Notify the caller so they stop ringing.
    console.error('[Call] Cannot acquire any media:', err);
    sendSignal({
      type: 'hangup',
      from: localUserId,
      to: remoteUserId,
      conversationId,
    });
    cleanupCall();
    throw err;
  }

  const pc = createPeerConnection(conversationId, localUserId);

  await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: offerSdp }));
  isRemoteDescriptionSet = true;
  await flushPendingCandidates();

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  sendSignal({
    type: 'answer',
    from: localUserId,
    to: remoteUserId,
    conversationId,
    sdp: answer.sdp,
  });

  return { localStream: stream, remoteStream: remoteStream! };
}

/**
 * End the current call and clean up call resources (but keep channel alive).
 * Sends a signal to the remote peer so they know the call ended.
 */
export function endCall(reason: 'hangup' | 'reject' | 'busy' = 'hangup'): void {
  if (currentConversationId && currentLocalUserId) {
    sendSignal({
      type: reason,
      from: currentLocalUserId,
      to: '',
      conversationId: currentConversationId,
    });
  }

  cleanupCall();
}

/**
 * Subscribe to incoming signaling channel. Used to listen for incoming calls.
 */
export function subscribeToCallSignals(
  conversationId: string,
  localUserId: string
): void {
  ensureSignalingChannel(conversationId, localUserId);
}

/**
 * Register a callback for incoming signals.
 */
export function onSignal(callback: SignalCallback): () => void {
  signalListeners.push(callback);
  return () => {
    signalListeners = signalListeners.filter((cb) => cb !== callback);
  };
}

/**
 * Toggle the local audio track on/off.
 */
export function toggleMute(muted: boolean): void {
  if (localStream) {
    localStream.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }
}

/**
 * Toggle the local video track on/off.
 */
export function toggleVideo(videoOff: boolean): void {
  if (localStream) {
    localStream.getVideoTracks().forEach((track) => {
      track.enabled = !videoOff;
    });
  }
}

/**
 * Clean up only call resources (peer connection + media streams).
 * Keeps the signaling channel alive so subsequent calls work.
 * Use this when ending a call normally.
 */
export function cleanupCall(): void {
  clearDisconnectedTimer();

  // Stop all media tracks
  stopLocalMedia();

  if (remoteStream) {
    remoteStream.getTracks().forEach((track) => track.stop());
    remoteStream = null;
  }

  // Close peer connection
  if (peerConnection) {
    peerConnection.ontrack = null;
    peerConnection.onicecandidate = null;
    peerConnection.oniceconnectionstatechange = null;
    peerConnection.close();
    peerConnection = null;
  }

  // Reset call state (but NOT channel state)
  isRemoteDescriptionSet = false;
  pendingIceCandidates = [];
}

/**
 * Full cleanup: call resources + signaling channel.
 * Use this only when the component unmounts (leaving the chat page).
 */
export function cleanup(): void {
  cleanupCall();

  // Remove signaling channel
  if (signalingChannel) {
    supabase.removeChannel(signalingChannel);
    signalingChannel = null;
  }

  currentConversationId = null;
  currentLocalUserId = null;
}

/**
 * Get current call state for debugging.
 */
export function getCallDebugInfo(): Record<string, unknown> {
  return {
    hasPC: !!peerConnection,
    pcState: peerConnection?.iceConnectionState ?? 'none',
    signalingState: peerConnection?.signalingState ?? 'none',
    hasLocalStream: !!localStream,
    localTracks: localStream?.getTracks().map((t) => `${t.kind}:${t.enabled}`) ?? [],
    hasRemoteStream: !!remoteStream,
    remoteTracks: remoteStream?.getTracks().map((t) => `${t.kind}:${t.enabled}`) ?? [],
    remoteDescSet: isRemoteDescriptionSet,
    pendingCandidates: pendingIceCandidates.length,
    conversationId: currentConversationId,
  };
}
