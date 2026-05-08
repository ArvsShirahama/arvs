import { useState } from 'react';
import { IonIcon } from '@ionic/react';
import { close, send } from 'ionicons/icons';
import './MediaPreview.css';

interface MediaPreviewProps {
  src: string;
  type: 'image' | 'video';
  onSend: (caption: string) => void;
  onCancel: () => void;
}

export default function MediaPreview({ src, type, onSend, onCancel }: MediaPreviewProps) {
  const [caption, setCaption] = useState('');

  const handleSend = () => {
    onSend(caption.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="media-preview-overlay">
      <button className="media-preview-close" onClick={onCancel} aria-label="Cancel">
        <IonIcon icon={close} />
      </button>

      <div className="media-preview-content">
        {type === 'image' ? (
          <img src={src} alt="Preview" />
        ) : (
          <video src={src} controls autoPlay muted />
        )}
      </div>

      <div className="media-preview-caption">
        <textarea
          placeholder="Add a caption..."
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <button className="media-preview-send-btn" onClick={handleSend} aria-label="Send">
          <IonIcon icon={send} />
        </button>
      </div>
    </div>
  );
}
