import React, { useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { App as CapApp } from '@capacitor/app';
import { PushNotifications } from '@capacitor/push-notifications';
import { getStoredPushToken, removePushTokenRegistration } from '../services/pushService';
import { supabase } from '../supabaseClient';
import type { Profile } from '../types/database';
import { AuthContext } from './authContextValue';

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps): React.JSX.Element {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());

  const fetchProfile = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    setProfile(data as Profile | null);
  }, []);

  // Subscribe to realtime profile updates to keep profile in sync
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('profile-updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${user.id}`,
        },
        (payload) => {
          setProfile(payload.new as Profile);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const refreshProfile = useCallback(async () => {
    if (user) {
      await fetchProfile(user.id);
    }
  }, [user, fetchProfile]);

  useEffect(() => {
    let presenceChannel: ReturnType<typeof supabase.channel> | undefined;

    const teardownPresence = () => {
      try {
        supabase.getChannels().forEach((ch) => {
          if (ch.topic === 'realtime:online-users') {
            ch.untrack().catch(() => {});
            supabase.removeChannel(ch).catch(() => {});
          }
        });
      } catch {
        // ignore cleanup errors
      }
      if (presenceChannel) {
        presenceChannel = undefined;
      }
      setOnlineUsers(new Set());
    };

    const setupPresence = (userId: string) => {
      teardownPresence();

      const existing = supabase.getChannels().find((ch) => ch.topic === 'realtime:online-users');
      if (existing) return;

      presenceChannel = supabase.channel('online-users', {
        config: { presence: { key: userId } },
      });

      presenceChannel
        .on('presence', { event: 'sync' }, () => {
          const state = presenceChannel!.presenceState();
          setOnlineUsers(new Set(Object.keys(state)));
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await presenceChannel!.track({ user_id: userId, online_at: new Date().toISOString() });
          }
        });
    };

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        fetchProfile(s.user.id);
        setupPresence(s.user.id);
      } else {
        teardownPresence();
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        fetchProfile(s.user.id);
        setupPresence(s.user.id);
      } else {
        setProfile(null);
        teardownPresence();
      }
      setLoading(false);
    });

    // Listen for deep link callback from OAuth on native platforms
    let appUrlListener: { remove: () => void } | undefined;
    if (Capacitor.isNativePlatform()) {
      CapApp.addListener('appUrlOpen', async ({ url }) => {
        // Extract tokens from the redirect URL fragment
        const hashPart = url.split('#')[1];
        if (hashPart) {
          const params = new URLSearchParams(hashPart);
          const accessToken = params.get('access_token');
          const refreshToken = params.get('refresh_token');
          if (accessToken && refreshToken) {
            await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          }
        }
        try { await Browser.close(); } catch { /* ignore */ }
      }).then((listener) => { appUrlListener = listener; });
    }

    return () => {
      subscription.unsubscribe();
      appUrlListener?.remove();
      teardownPresence();
    };
  }, [fetchProfile]);

  const signUp = useCallback(async (
    email: string,
    password: string,
    username: string,
    displayName: string
  ): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username,
          display_name: displayName,
        },
      },
    });
    if (error) return { error: error.message };
    return { error: null };
  }, []);

  const signIn = useCallback(async (
    email: string,
    password: string
  ): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return { error: null };
  }, []);

  const signInWithGoogle = useCallback(async (): Promise<{ error: string | null }> => {
    if (Capacitor.isNativePlatform()) {
      // Native: get the URL and open in in-app browser
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: 'com.arvin.arvs://tabs/chats',
          skipBrowserRedirect: true,
        },
      });
      if (error) return { error: error.message };
      if (data?.url) {
        await Browser.open({ url: data.url });
      }
      return { error: null };
    }

    // Web: default OAuth redirect
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/tabs/chats',
      },
    });
    if (error) return { error: error.message };
    return { error: null };
  }, []);

  const signOut = useCallback(async () => {
    if (user) {
      await supabase.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', user.id);
    }
    const existingPushToken = getStoredPushToken();
    if (existingPushToken) {
      try {
        await removePushTokenRegistration(existingPushToken);
      } catch {
        // best-effort cleanup before auth session is cleared
      }
    }
    if (Capacitor.isNativePlatform()) {
      try {
        await PushNotifications.unregister();
      } catch {
        // ignore native cleanup failures
      }
    }
    await supabase.auth.signOut();
    setProfile(null);
  }, [user]);

  return (
    <AuthContext.Provider value={{ session, user, profile, loading, onlineUsers, signUp, signIn, signInWithGoogle, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}
