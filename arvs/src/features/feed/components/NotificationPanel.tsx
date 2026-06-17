import { useCallback, useEffect, useState } from 'react';
import { IonIcon, IonSpinner, useIonRouter } from '@ionic/react';
import { chevronBackOutline, closeOutline, notificationsOffOutline } from 'ionicons/icons';
import Avatar from '../../../components/Avatar';
import type { NotificationWithActor } from '../../../types/database';
import {
  getNotifications,
  markAllAsRead,
  markAsRead,
} from '../services';
import './NotificationPanel.css';

interface NotificationPanelProps {
  isOpen: boolean;
  userId: string;
  onDismiss: () => void;
  onUnreadCountChange?: (count: number) => void;
}

function getActorName(n: NotificationWithActor): string {
  return n.actor.display_name?.trim() || n.actor.username || 'Someone';
}

function buildMessage(n: NotificationWithActor): { actor: string; action: string } {
  const actor = getActorName(n);
  switch (n.type) {
    case 'like':
      return { actor, action: 'liked your post' };
    case 'comment':
      return { actor, action: 'commented on your post' };
    case 'follow':
      return { actor, action: 'started following you' };
    default:
      return { actor, action: 'interacted with you' };
  }
}

function formatRelativeTime(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffSeconds = Math.floor((now - then) / 1000);

  if (diffSeconds < 60) return 'Just now';
  const mins = Math.floor(diffSeconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(dateString));
}

export default function NotificationPanel({
  isOpen,
  userId,
  onDismiss,
  onUnreadCountChange,
}: NotificationPanelProps) {
  const router = useIonRouter();
  const [notifications, setNotifications] = useState<NotificationWithActor[]>([]);
  const [loading, setLoading] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getNotifications(userId);
      setNotifications(data);
    } catch {
      // fail silently — the panel will show empty state
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (isOpen) {
      void loadNotifications();
    }
  }, [isOpen, loadNotifications]);

  useEffect(() => {
    onUnreadCountChange?.(unreadCount);
  }, [unreadCount, onUnreadCountChange]);

  const handleItemClick = async (n: NotificationWithActor) => {
    if (!n.is_read) {
      try {
        await markAsRead(n.id);
        setNotifications((prev) =>
          prev.map((item) => (item.id === n.id ? { ...item, is_read: true } : item))
        );
      } catch {
        // swallow
      }
    }

    onDismiss();

    // Navigate based on notification type
    if (n.type === 'follow') {
      router.push(`/users/${n.actor_id}`, 'forward');
    } else if (n.post_id) {
      // For like/comment, navigate to the actor's profile (we don't have a single-post page)
      router.push(`/users/${n.actor_id}`, 'forward');
    }
  };

  const handleMarkAllRead = async () => {
    setMarkingAll(true);
    try {
      await markAllAsRead(userId);
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch {
      // swallow
    } finally {
      setMarkingAll(false);
    }
  };

  // Prevent body scroll when panel is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  return (
    <div className={`notification-overlay ${isOpen ? 'notification-overlay-open' : ''}`}>
      <div className="notification-backdrop" onClick={onDismiss} />
      <div className="notification-panel">
        <div className="notification-panel-header">
          <div className="notification-header-left">
            <button
              type="button"
              className="notification-back-btn"
              onClick={onDismiss}
              aria-label="Go back"
            >
              <IonIcon icon={chevronBackOutline} />
            </button>
            <h2>Notifications</h2>
          </div>
          <div className="notification-header-actions">
            {unreadCount > 0 && (
              <button
                type="button"
                className="notification-mark-all-btn"
                onClick={() => void handleMarkAllRead()}
                disabled={markingAll}
              >
                {markingAll ? 'Marking…' : 'Mark all read'}
              </button>
            )}
            <button
              type="button"
              className="notification-close-btn"
              onClick={onDismiss}
              aria-label="Close notifications"
            >
              <IonIcon icon={closeOutline} />
            </button>
          </div>
        </div>

        <div className="notification-list">
          {loading ? (
            <div className="notification-loading">
              <IonSpinner name="crescent" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="notification-empty">
              <IonIcon icon={notificationsOffOutline} />
              <p>No notifications yet</p>
            </div>
          ) : (
            notifications.map((n) => {
              const msg = buildMessage(n);
              return (
                <button
                  key={n.id}
                  type="button"
                  className={`notification-item ${!n.is_read ? 'notification-item-unread' : ''}`}
                  onClick={() => void handleItemClick(n)}
                >
                  {!n.is_read && <span className="notification-unread-dot" />}
                  <Avatar
                    src={n.actor.avatar_url}
                    name={getActorName(n)}
                    size="small"
                  />
                  <div className="notification-content">
                    <p className="notification-message">
                      <strong>{msg.actor}</strong> {msg.action}
                    </p>
                    <span className="notification-time">
                      {formatRelativeTime(n.created_at)}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
