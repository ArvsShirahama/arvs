import { useState, useRef } from 'react';
import { IonIcon } from '@ionic/react';
import { send, camera, image } from 'ionicons/icons';
import './MessageInput.css';

interface MessageInputProps {
  onSend: (text: string) => void;
  onPickGallery: () => void;
  onOpenCamera: () => void;
  disabled?: boolean;
}

export default function MessageInput({ onSend, onPickGallery, onOpenCamera, disabled }: MessageInputProps) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="message-input-bar">
      <button
        className="message-media-btn"
        onClick={onOpenCamera}
        disabled={disabled}
        aria-label="Open camera"
      >
        <IonIcon icon={camera} />
      </button>
      <button
        className="message-media-btn"
        onClick={onPickGallery}
        disabled={disabled}
        aria-label="Pick from gallery"
      >
        <IonIcon icon={image} />
      </button>
      <textarea
        ref={inputRef}
        className="message-input-field"
        placeholder="Message"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        disabled={disabled}
      />
      <button
        className="message-send-btn"
        onClick={handleSend}
        disabled={!text.trim() || disabled}
        aria-label="Send message"
      >
        <IonIcon icon={send} />
      </button>
    </div>
  );
}
