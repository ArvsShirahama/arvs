import { IonItem, IonLabel, IonNote } from '@ionic/react';
import type { ConversationWithDetails } from '../types/database';
import Avatar from './Avatar';
import './ChatListItem.css';

interface ChatListItemProps {
  conversation: ConversationWithDetails;
  currentUserId: string;
  isOnline?: boolean;
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  if (diffDays === 1) {
    return 'Yesterday';
  }

  if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  }

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function ChatListItem({ conversation, currentUserId, isOnline = false }: ChatListItemProps) {
  const { other_user, last_message, unread_count } = conversation;
  const isOwnMessage = last_message?.sender_id === currentUserId;

  const getPreview = () => {
    if (!last_message) return 'No messages yet';

    const prefix = isOwnMessage ? 'You: ' : '';
    if (last_message.message_type === 'image') {
      return `${prefix}[Photo]${last_message.content ? ` - ${last_message.content}` : ''}`;
    }

    if (last_message.message_type === 'video') {
      return `${prefix}[Video]${last_message.content ? ` - ${last_message.content}` : ''}`;
    }

    return `${prefix}${last_message.content}`;
  };

  const preview = getPreview();
  const hasUnread = unread_count > 0;

  return (
    <IonItem
      routerLink={`/chat/${conversation.id}`}
      detail={false}
      className="chatlist-item"
      button
    >
      <Avatar
        src={other_user.avatar_url}
        name={other_user.display_name || other_user.username}
        size="medium"
        showStatus
        isOnline={isOnline}
      />
      <IonLabel className="chatlist-item-content">
        <h2 className={`chatlist-item-name ${hasUnread ? 'chatlist-unread' : ''}`}>
          {other_user.display_name || other_user.username}
        </h2>
        <p className={`chatlist-item-preview ${hasUnread ? 'chatlist-unread' : ''}`}>{preview}</p>
      </IonLabel>
      <div className="chatlist-item-meta" slot="end">
        {last_message && (
          <IonNote className="chatlist-item-time">
            {formatTime(last_message.created_at)}
          </IonNote>
        )}
        {hasUnread && <span className="chatlist-unread-badge">{unread_count}</span>}
      </div>
    </IonItem>
  );
}
