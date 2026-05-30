import { useEffect, useRef } from 'react';
import { useIonRouter, useIonToast } from '@ionic/react';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import {
  PushNotifications,
  type PushNotificationSchema,
} from '@capacitor/push-notifications';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../features/auth/hooks';
import {
  clearStoredPushToken,
  upsertPushTokenRegistration,
} from '../services/pushService';

const CHAT_NOTIFICATION_CHANNEL = {
  id: 'chat-messages',
  name: 'Chat Messages',
  description: 'Incoming direct messages',
  importance: 5 as const,
  visibility: 1 as const,
  vibration: true,
  lights: true,
  lightColor: '#ff6b6b',
};

const CALL_NOTIFICATION_CHANNEL = {
  id: 'incoming-calls',
  name: 'Incoming Calls',
  description: 'Ringing for incoming voice and video calls',
  importance: 5 as const,
  visibility: 1 as const,
  vibration: true,
  lights: true,
  lightColor: '#22c55e',
};

function isIncomingCall(notification: PushNotificationSchema): boolean {
  return notification.data?.type === 'incoming_call';
}

function getConversationRoute(notification: PushNotificationSchema): string | null {
  const route = notification.data?.route;
  if (typeof route === 'string' && route.startsWith('/')) {
    return route;
  }

  const conversationId = notification.data?.conversationId;
  if (typeof conversationId === 'string' && conversationId.length > 0) {
    return `/chat/${conversationId}`;
  }

  return null;
}

export default function PushNotificationManager() {
  const { user } = useAuth();
  const router = useIonRouter();
  const location = useLocation();
  const [presentToast] = useIonToast();

  const currentPathRef = useRef(location.pathname);
  const currentUserIdRef = useRef<string | null>(user?.id ?? null);

  useEffect(() => {
    currentPathRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    currentUserIdRef.current = user?.id ?? null;
  }, [user?.id]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    let isMounted = true;
    const handles: PluginListenerHandle[] = [];

    const setup = async () => {
      console.log('[Push] Setting up listeners...');
      await PushNotifications.createChannel(CHAT_NOTIFICATION_CHANNEL);
      await PushNotifications.createChannel(CALL_NOTIFICATION_CHANNEL);

      handles.push(
        await PushNotifications.addListener('registration', async (token) => {
          console.log('[Push] Got token:', token.value.substring(0, 20) + '...');
          if (!isMounted) return;

          try {
            const currentUserId = currentUserIdRef.current;
            if (!currentUserId) {
              console.warn('[Push] No user ID yet, skipping token save');
              return;
            }

            console.log('[Push] Saving token for user:', currentUserId);
            await upsertPushTokenRegistration(currentUserId, token.value);
            console.log('[Push] Token saved successfully');
          } catch (error) {
            console.error('[Push] Token save failed', error);
          }
        })
      );

      handles.push(
        await PushNotifications.addListener('registrationError', (error) => {
          console.error('[Push] Registration error:', JSON.stringify(error));
        })
      );

      handles.push(
        await PushNotifications.addListener('pushNotificationReceived', async (notification) => {
          const route = getConversationRoute(notification);

          // Incoming call: navigate to the conversation so useVideoCall picks up
          // the WebRTC offer arriving over the realtime signaling channel and
          // shows the ringing overlay. The realtime broadcast carries the actual
          // call data; the push just wakes the app and routes us there.
          if (isIncomingCall(notification)) {
            if (route && currentPathRef.current !== route) {
              router.push(route, 'forward');
            }
            await presentToast({
              message: `${notification.title || 'Incoming call'}`,
              duration: 3000,
              position: 'top',
              color: 'success',
            });
            return;
          }

          if (!route || route === currentPathRef.current) {
            return;
          }

          await presentToast({
            message: `${notification.title || 'New message'}${notification.body ? `: ${notification.body}` : ''}`,
            duration: 2500,
            position: 'top',
          });
        })
      );

      handles.push(
        await PushNotifications.addListener('pushNotificationActionPerformed', async ({ notification }) => {
          const route = getConversationRoute(notification);
          if (!route) {
            return;
          }

          await PushNotifications.removeAllDeliveredNotifications();
          // Both chat and call taps route to the conversation. For calls, the
          // ringing overlay appears once the realtime offer is received.
          if (currentPathRef.current !== route) {
            router.push(route, 'forward');
          }
        })
      );

      // Now that listeners are set up, handle registration based on user state
      await syncRegistration();
    };

    const syncRegistration = async () => {
      console.log('[Push] syncRegistration called, user:', user?.id ?? 'none');
      if (!user?.id) {
        clearStoredPushToken();
        try {
          await PushNotifications.unregister();
        } catch {
          // ignore logout cleanup failures
        }
        return;
      }

      let permissions = await PushNotifications.checkPermissions();
      console.log('[Push] Permission status:', permissions.receive);
      if (permissions.receive === 'prompt' || permissions.receive === 'prompt-with-rationale') {
        permissions = await PushNotifications.requestPermissions();
        console.log('[Push] Permission after request:', permissions.receive);
      }

      if (permissions.receive !== 'granted') {
        console.warn('[Push] Permission not granted, skipping registration');
        return;
      }

      try {
        console.log('[Push] Calling register()...');
        await PushNotifications.register();
        console.log('[Push] register() completed');
      } catch (error) {
        console.error('[Push] register() failed:', error);
      }
    };

    void setup();

    return () => {
      isMounted = false;
      handles.forEach((handle) => {
        void handle.remove();
      });
    };
  }, [presentToast, router, user?.id]);

  return null;
}
