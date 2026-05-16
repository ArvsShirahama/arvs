import { useState, useCallback } from 'react';
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonContent,
  IonRange,
} from '@ionic/react';
import Cropper from 'react-easy-crop';
import { getCroppedImage } from '../utils/imageProcessor';
import type { Crop } from '../utils/imageProcessor';
import './ImageCropperModal.css';

interface ImageCropperModalProps {
  isOpen: boolean;
  imageSrc: string;
  onConfirm: (croppedBlob: Blob) => void;
  onCancel: () => void;
}

const ImageCropperModal: React.FC<ImageCropperModalProps> = ({
  isOpen,
  imageSrc,
  onConfirm,
  onCancel,
}) => {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Crop | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const onCropComplete = useCallback((_: Crop, croppedAreaPixels: Crop) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const handleApply = async () => {
    if (!croppedAreaPixels) return;

    setIsProcessing(true);
    try {
      const croppedBlob = await getCroppedImage(imageSrc, croppedAreaPixels);
      onConfirm(croppedBlob);
    } catch (error) {
      console.error('Failed to crop image:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <IonModal isOpen={isOpen} className="image-cropper-modal">
      <IonHeader>
        <IonToolbar>
          <IonTitle>Adjust Background</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onCancel} disabled={isProcessing}>
              Cancel
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="cropper-modal-content">
        <div className="cropper-container">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={9 / 16}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>

        <div className="cropper-controls">
          <div className="zoom-control">
            <IonRange
              value={zoom}
              min={1}
              max={3}
              step={0.1}
              onIonChange={(e) => setZoom(Number(e.detail.value))}
            />
          </div>
        </div>

        <div className="cropper-actions">
          <IonButton
            fill="outline"
            onClick={onCancel}
            disabled={isProcessing}
          >
            Cancel
          </IonButton>
          <IonButton
            onClick={handleApply}
            disabled={isProcessing || !croppedAreaPixels}
          >
            {isProcessing ? 'Processing...' : 'Apply'}
          </IonButton>
        </div>
      </IonContent>
    </IonModal>
  );
};

export default ImageCropperModal;
