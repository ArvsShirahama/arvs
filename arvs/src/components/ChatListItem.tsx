import { IonItem, IonLabel, IonNote } from '@ionic/react';
import type { ConversationWithDetails } from '../types/database';
import Avatar from './Avatar';
import './ChatListItem.css';

interface ChatListItemProps {
  conversation: ConversationWithDetails;
  currentUserId: string;
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function ChatListItem({ conversation, currentUserId }: ChatListItemProps) {
  const { other_user, last_message } = conversation;
  const isOwnMessage = last_message?.sender_id === currentUserId;
  const preview = last_message
    ? `${isOwnMessage ? 'You: ' : ''}${last_message.content}`
    : 'No messages yet';

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
      />
      <IonLabel className="chatlist-item-content">
        <h2 className="chatlist-item-name">{other_user.display_name || other_user.username}</h2>
        <p className="chatlist-item-preview">{preview}</p>
      </IonLabel>
      {last_message && (
        <IonNote slot="end" className="chatlist-item-time">
          {formatTime(last_message.created_at)}
        </IonNote>
      )}
    </IonItem>
  );
}
