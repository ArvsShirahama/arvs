import { Capacitor } from '@capacitor/core';
import { supabase } from '../supabaseClient';

const PUSH_TOKEN_STORAGE_KEY = 'arvs_push_registration_token';
const APP_ID = 'com.arvin.arvs';

export function getStoredPushToken(): string | null {
  return localStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
}

export function setStoredPushToken(token: string): void {
  localStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
}

export function clearStoredPushToken(): void {
  localStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
}

export async function upsertPushTokenRegistration(userId: string, token: string): Promise<void> {
  const { error } = await supabase.from('push_tokens').upsert(
    {
      token,
      user_id: userId,
      platform: Capacitor.getPlatform(),
      app_id: APP_ID,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'token' }
  );

  if (error) {
    throw error;
  }

  setStoredPushToken(token);
}

export async function removePushTokenRegistration(token: string | null): Promise<void> {
  if (!token) return;

  await supabase.from('push_tokens').delete().eq('token', token);
  clearStoredPushToken();
}

export async function sendChatPush(messageId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('send-chat-push', {
    body: { messageId },
  });

  if (error) {
    throw error;
  }
}
