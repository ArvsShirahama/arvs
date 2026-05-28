import { useRef, useState } from 'react';
import {
  IonButton,
  IonButtons,
  IonFooter,
  IonIcon,
  IonTextarea,
  IonToolbar,
} from '@ionic/react';
import { camera, close, image, pencil, send } from 'ionicons/icons';
import './MessageInput.css';

interface MessageInputProps {
  onSend: (text: string) => void;
  onPickGallery: () => void;
  onOpenCamera: () => void;
  onTyping?: () => void;
  disabled?: boolean;
  /** When set, the input is in edit mode with pre-filled text */
  editingMessage?: { id: string; content: string } | null;
  onCancelEdit?: () => void;
}

export default function MessageInput({
  onSend,
  onPickGallery,
  onOpenCamera,
  onTyping,
  disabled,
  editingMessage,
  onCancelEdit,
}: MessageInputProps) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLIonTextareaElement>(null);

  // When entering edit mode, prefill the text
  const displayText = editingMessage ? (text || editingMessage.content) : text;

  const handleSend = () => {
    const trimmed = displayText.trim();
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

  const handleInput = (value: string) => {
    setText(value);
    onTyping?.();
  };

  const handleCancelEdit = () => {
    setText('');
    onCancelEdit?.();
  };

  return (
    <IonFooter className="message-input-footer">
      {/* Edit mode banner */}
      {editingMessage && (
        <div className="message-edit-banner">
          <IonIcon icon={pencil} className="message-edit-icon" />
          <span className="message-edit-label">Editing message</span>
          <IonButton fill="clear" size="small" onClick={handleCancelEdit} className="message-edit-cancel-btn">
            <IonIcon icon={close} />
          </IonButton>
        </div>
      )}

      <IonToolbar className="message-input-toolbar">
        <div className="message-input-row">
          {!editingMessage && (
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
          )}

          <IonTextarea
            ref={inputRef}
            className="message-input-field"
            placeholder={editingMessage ? 'Edit your message...' : 'Message'}
            value={displayText}
            onIonInput={(e) => handleInput(e.detail.value ?? '')}
            onKeyDown={handleKeyDown}
            rows={1}
            autoGrow
            enterkeyhint="send"
            disabled={disabled}
          />

          <IonButtons slot="end" className="message-send-actions">
            <IonButton
              className={`message-send-btn ${editingMessage ? 'message-send-btn-edit' : ''}`}
              onClick={handleSend}
              disabled={!displayText.trim() || disabled}
              aria-label={editingMessage ? 'Save edit' : 'Send message'}
            >
              <IonIcon icon={editingMessage ? pencil : send} />
            </IonButton>
          </IonButtons>
        </div>
      </IonToolbar>
    </IonFooter>
  );
}
