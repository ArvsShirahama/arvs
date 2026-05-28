import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../../supabaseClient';
import { useAuth } from '../../auth/hooks';

const TYPING_THROTTLE_MS = 2000;
const TYPING_EXPIRE_MS = 3500;

/**
 * Hook to manage typing indicator state via Supabase Presence.
 * - `sendTyping()`: Call on every keystroke (throttled internally to 1 broadcast per 2s)
 * - `peerIsTyping`: true when the other user is actively typing
 */
export function useTypingIndicator(conversationId: string) {
  const { user } = useAuth();
  const [peerIsTyping, setPeerIsTyping] = useState(false);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastSentRef = useRef(0);
  const peerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Set up the presence channel for typing events
  useEffect(() => {
    if (!conversationId || !user) return;

    const channel = supabase.channel(`typing-${conversationId}`, {
      config: { presence: { key: user.id } },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const otherUserTyping = Object.keys(state).some((key) => key !== user.id);
        setPeerIsTyping(otherUserTyping);

        // Auto-expire typing indicator if no updates received
        if (otherUserTyping) {
          if (peerTimerRef.current) clearTimeout(peerTimerRef.current);
          peerTimerRef.current = setTimeout(() => {
            setPeerIsTyping(false);
          }, TYPING_EXPIRE_MS);
        }
      })
      .on('presence', { event: 'leave' }, () => {
        setPeerIsTyping(false);
        if (peerTimerRef.current) {
          clearTimeout(peerTimerRef.current);
          peerTimerRef.current = null;
        }
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (peerTimerRef.current) {
        clearTimeout(peerTimerRef.current);
        peerTimerRef.current = null;
      }
      channel.untrack().catch(() => {});
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [conversationId, user]);

  const sendTyping = useCallback(() => {
    if (!channelRef.current || !user) return;

    const now = Date.now();
    if (now - lastSentRef.current < TYPING_THROTTLE_MS) return;
    lastSentRef.current = now;

    channelRef.current.track({ typing: true, user_id: user.id }).catch(() => {});

    // Automatically untrack after the expire window so typing doesn't persist forever
    setTimeout(() => {
      channelRef.current?.untrack().catch(() => {});
    }, TYPING_EXPIRE_MS);
  }, [user]);

  return { peerIsTyping, sendTyping };
}

