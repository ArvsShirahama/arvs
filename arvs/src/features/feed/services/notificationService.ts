import { supabase } from '../../../supabaseClient';
import type {
  Notification,
  NotificationWithActor,
  Profile,
} from '../../../types/database';

const DEFAULT_NOTIFICATION_LIMIT = 30;

export async function getNotifications(
  userId: string,
  limit = DEFAULT_NOTIFICATION_LIMIT
): Promise<NotificationWithActor[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('recipient_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  const notifications = (data as Notification[] | null) ?? [];
  if (notifications.length === 0) return [];

  const actorIds = Array.from(new Set(notifications.map((n) => n.actor_id)));
  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .in('id', actorIds);

  if (profileError) throw profileError;

  const profilesById = new Map(
    ((profiles as Profile[] | null) ?? []).map((p) => [p.id, p])
  );

  return notifications
    .map((n) => {
      const actor = profilesById.get(n.actor_id);
      if (!actor) return null;
      return { ...n, actor };
    })
    .filter((n): n is NotificationWithActor => n !== null);
}

export async function getUnreadCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('recipient_id', userId)
    .eq('is_read', false);

  if (error) throw error;
  return count ?? 0;
}

export async function markAsRead(notificationId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notificationId);

  if (error) throw error;
}

export async function markAllAsRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('recipient_id', userId)
    .eq('is_read', false);

  if (error) throw error;
}
