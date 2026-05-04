import type { Message } from '../types/database';
import './ChatBubble.css';

interface ChatBubbleProps {
  message: Message;
  isMine: boolean;
}

function formatMessageTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ChatBubble({ message, isMine }: ChatBubbleProps) {
  return (
    <div className={`bubble-row ${isMine ? 'bubble-right' : 'bubble-left'}`}>
      <div className={`bubble ${isMine ? 'bubble-mine' : 'bubble-theirs'}`}>
        <p className="bubble-text">{message.content}</p>
        <span className="bubble-time">{formatMessageTime(message.created_at)}</span>
      </div>
    </div>
  );
}
