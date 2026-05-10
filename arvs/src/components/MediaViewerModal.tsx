import { IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonModal, IonTitle, IonToolbar } from '@ionic/react';
import { close } from 'ionicons/icons';
import './MediaViewerModal.css';

interface MediaViewerModalProps {
  isOpen: boolean;
  src: string;
  type: 'image' | 'video';
  onClose: () => void;
}

export default function MediaViewerModal({ isOpen, src, type, onClose }: MediaViewerModalProps) {
  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose} className="media-viewer-modal">
      <IonHeader translucent>
        <IonToolbar className="media-viewer-toolbar">
          <IonTitle>Media</IonTitle>
          <IonButtons slot="end">
            <IonButton fill="clear" onClick={onClose} aria-label="Close media viewer">
              <IonIcon icon={close} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="media-viewer-content" fullscreen>
        <div className="media-viewer-frame">
          {type === 'image' ? (
            <img src={src} alt="Media" />
          ) : (
            <video src={src} controls autoPlay preload="metadata" />
          )}
        </div>
      </IonContent>
    </IonModal>
  );
}
