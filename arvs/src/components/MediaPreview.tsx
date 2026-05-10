import { useEffect, useState } from 'react';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonModal,
  IonTextarea,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import { close, send } from 'ionicons/icons';
import './MediaPreview.css';

interface MediaPreviewProps {
  isOpen: boolean;
  src: string;
  type: 'image' | 'video';
  sending?: boolean;
  onSend: (caption: string) => void;
  onCancel: () => void;
}

export default function MediaPreview({ isOpen, src, type, sending = false, onSend, onCancel }: MediaPreviewProps) {
  const [caption, setCaption] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setCaption('');
    }
  }, [isOpen]);

  const handleSend = () => {
    if (sending) return;
    onSend(caption.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onCancel} className="media-preview-modal">
      <IonHeader translucent>
        <IonToolbar className="media-preview-toolbar">
          <IonTitle>Send Media</IonTitle>
          <IonButtons slot="end">
            <IonButton fill="clear" onClick={onCancel} aria-label="Cancel">
              <IonIcon icon={close} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="media-preview-content" fullscreen>
        <div className="media-preview-frame">
          {type === 'image' ? (
            <img src={src} alt="Preview" />
          ) : (
            <video src={src} controls autoPlay muted />
          )}
        </div>
      </IonContent>

      <IonFooter>
        <IonToolbar className="media-preview-footer-toolbar">
          <div className="media-preview-caption-row">
            <IonTextarea
              className="media-preview-caption"
              placeholder="Add a caption..."
              value={caption}
              onIonInput={(e) => setCaption(e.detail.value ?? '')}
              onKeyDown={handleKeyDown}
              autoGrow
              rows={1}
              disabled={sending}
            />
            <IonButton
              className="media-preview-send-btn"
              onClick={handleSend}
              disabled={sending}
              aria-label="Send"
            >
              <IonIcon icon={send} />
            </IonButton>
          </div>
        </IonToolbar>
      </IonFooter>
    </IonModal>
  );
}
