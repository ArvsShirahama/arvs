import { useRef, useState } from 'react';
import {
  IonButton,
  IonButtons,
  IonFooter,
  IonIcon,
  IonTextarea,
  IonToolbar,
} from '@ionic/react';
import { camera, image, send } from 'ionicons/icons';
import './MessageInput.css';

interface MessageInputProps {
  onSend: (text: string) => void;
  onPickGallery: () => void;
  onOpenCamera: () => void;
  disabled?: boolean;
}

export default function MessageInput({ onSend, onPickGallery, onOpenCamera, disabled }: MessageInputProps) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLIonTextareaElement>(null);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
    inputRef.current?.setFocus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <IonFooter className="message-input-footer">
      <IonToolbar className="message-input-toolbar">
        <div className="message-input-row">
          <IonButtons slot="start" className="message-media-actions">
            <IonButton
              fill="clear"
              className="message-media-btn"
              onClick={onOpenCamera}
              disabled={disabled}
              aria-label="Open camera"
            >
              <IonIcon icon={camera} />
            </IonButton>
            <IonButton
              fill="clear"
              className="message-media-btn"
              onClick={onPickGallery}
              disabled={disabled}
              aria-label="Pick from gallery"
            >
              <IonIcon icon={image} />
            </IonButton>
          </IonButtons>

          <IonTextarea
            ref={inputRef}
            className="message-input-field"
            placeholder="Message"
            value={text}
            onIonInput={(e) => setText(e.detail.value ?? '')}
            onKeyDown={handleKeyDown}
            rows={1}
            autoGrow
            enterkeyhint="send"
            disabled={disabled}
          />

          <IonButtons slot="end" className="message-send-actions">
            <IonButton
              className="message-send-btn"
              onClick={handleSend}
              disabled={!text.trim() || disabled}
              aria-label="Send message"
            >
              <IonIcon icon={send} />
            </IonButton>
          </IonButtons>
        </div>
      </IonToolbar>
    </IonFooter>
  );
}
