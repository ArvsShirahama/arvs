import { useEffect, useRef, useState } from 'react';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonModal,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonTextarea,
  IonTitle,
  IonToolbar,
  useIonToast,
} from '@ionic/react';
import { add, close, imagesOutline } from 'ionicons/icons';
import { createPost } from '../services';
import type {
  CreatePostMediaInput,
  Post,
  PostAspectRatio,
  PostMediaType,
} from '../../../types/database';
import './CreatePostModal.css';

interface CreatePostModalProps {
  isOpen: boolean;
  userId: string;
  onDismiss: () => void;
  onCreated: (post: Post) => void;
}

interface SelectedPostMedia extends CreatePostMediaInput {
  id: string;
  previewUrl: string;
}

const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const MAX_MEDIA_ITEMS = 10;

function getMediaType(file: File): PostMediaType | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  return null;
}

function getImageDimensions(url: string): Promise<{ width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({ width: null, height: null });
    image.src = url;
  });
}

function getVideoDimensions(url: string): Promise<{ width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => resolve({ width: video.videoWidth || null, height: video.videoHeight || null });
    video.onerror = () => resolve({ width: null, height: null });
    video.src = url;
  });
}

async function createSelectedMedia(file: File): Promise<SelectedPostMedia | null> {
  const mediaType = getMediaType(file);
  if (!mediaType) return null;

  const previewUrl = URL.createObjectURL(file);
  const dimensions = mediaType === 'video'
    ? await getVideoDimensions(previewUrl)
    : await getImageDimensions(previewUrl);

  return {
    id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
    file,
    mediaType,
    previewUrl,
    width: dimensions.width,
    height: dimensions.height,
  };
}

export default function CreatePostModal({
  isOpen,
  userId,
  onDismiss,
  onCreated,
}: CreatePostModalProps) {
  const [caption, setCaption] = useState('');
  const [selectedMedia, setSelectedMedia] = useState<SelectedPostMedia[]>([]);
  const [aspectRatio, setAspectRatio] = useState<PostAspectRatio>('square');
  const [posting, setPosting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedMediaRef = useRef<SelectedPostMedia[]>([]);
  const [presentToast] = useIonToast();

  const canPost = selectedMedia.length > 0 && !posting;

  useEffect(() => {
    selectedMediaRef.current = selectedMedia;
  }, [selectedMedia]);

  useEffect(() => {
    return () => {
      selectedMediaRef.current.forEach((media) => URL.revokeObjectURL(media.previewUrl));
    };
  }, []);

  const reset = () => {
    selectedMedia.forEach((media) => URL.revokeObjectURL(media.previewUrl));
    setSelectedMedia([]);
    setCaption('');
    setAspectRatio('square');
    setPosting(false);
  };

  const handleDismiss = () => {
    reset();
    onDismiss();
  };

  const pickFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;

    if (selectedMedia.length + files.length > MAX_MEDIA_ITEMS) {
      await presentToast({
        message: `Choose up to ${MAX_MEDIA_ITEMS} photos or videos.`,
        duration: 2200,
        color: 'warning',
        position: 'top',
      });
      return;
    }

    const nextMedia: SelectedPostMedia[] = [];
    for (const file of files) {
      const mediaType = getMediaType(file);
      if (!mediaType) {
        await presentToast({
          message: `${file.name} is not a supported image or video.`,
          duration: 2200,
          color: 'warning',
          position: 'top',
        });
        continue;
      }

      const maxBytes = mediaType === 'image' ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES;
      if (file.size > maxBytes) {
        await presentToast({
          message: `${file.name} is too large. Max ${mediaType === 'image' ? '10 MB' : '50 MB'}.`,
          duration: 2400,
          color: 'warning',
          position: 'top',
        });
        continue;
      }

      const media = await createSelectedMedia(file);
      if (media) {
        nextMedia.push(media);
      }
    }

    if (nextMedia.length > 0) {
      setSelectedMedia((current) => [...current, ...nextMedia]);
    }
  };

  const removeMedia = (id: string) => {
    setSelectedMedia((current) => {
      const item = current.find((media) => media.id === id);
      if (item) {
        URL.revokeObjectURL(item.previewUrl);
      }
      return current.filter((media) => media.id !== id);
    });
  };

  const handlePost = async () => {
    if (!canPost) return;

    setPosting(true);
    try {
      const post = await createPost({
        userId,
        files: selectedMedia.map((media) => ({
          file: media.file,
          mediaType: media.mediaType,
          width: media.width,
          height: media.height,
        })),
        aspectRatio,
        caption,
      });
      onCreated(post);
      reset();
      onDismiss();
      await presentToast({
        message: 'Post shared.',
        duration: 1500,
        color: 'success',
        position: 'top',
      });
    } catch (error) {
      await presentToast({
        message: error instanceof Error ? error.message : 'Failed to create post.',
        duration: 2400,
        color: 'danger',
        position: 'top',
      });
    } finally {
      setPosting(false);
    }
  };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={handleDismiss}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={handleDismiss} disabled={posting}>Cancel</IonButton>
          </IonButtons>
          <IonTitle>New Post</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={() => void handlePost()} disabled={!canPost}>
              {posting ? <IonSpinner name="crescent" /> : 'Post'}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="create-post-modal">
        <div className={`create-post-preview create-post-preview-${aspectRatio}`}>
          {selectedMedia.length === 0 ? (
            <button
              type="button"
              className="create-post-empty"
              onClick={() => fileInputRef.current?.click()}
              disabled={posting}
            >
              <IonIcon icon={imagesOutline} />
              <strong>Choose photos or videos</strong>
              <span>Up to 10 items</span>
            </button>
          ) : (
            <div className="create-post-preview-track">
              {selectedMedia.map((media, index) => (
                <div className="create-post-preview-item" key={media.id}>
                  {media.mediaType === 'video' ? (
                    <video
                      src={media.previewUrl}
                      className="create-post-preview-media"
                      controls
                      playsInline
                      preload="metadata"
                    />
                  ) : (
                    <img
                      src={media.previewUrl}
                      alt={`Selected media ${index + 1}`}
                      className="create-post-preview-media"
                    />
                  )}
                  <span className="create-post-preview-count">{index + 1}/{selectedMedia.length}</span>
                  <button
                    type="button"
                    className="create-post-remove"
                    onClick={() => removeMedia(media.id)}
                    disabled={posting}
                    aria-label="Remove selected media"
                  >
                    <IonIcon icon={close} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <IonSegment
          value={aspectRatio}
          onIonChange={(event) => setAspectRatio((event.detail.value as PostAspectRatio | undefined) ?? 'square')}
          className="create-post-ratio-segment"
        >
          <IonSegmentButton value="portrait">4:5</IonSegmentButton>
          <IonSegmentButton value="square">1:1</IonSegmentButton>
          <IonSegmentButton value="landscape">1.91:1</IonSegmentButton>
        </IonSegment>

        <div className="create-post-picker-row">
          <IonButton
            fill="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={posting || selectedMedia.length >= MAX_MEDIA_ITEMS}
          >
            <IonIcon slot="start" icon={add} />
            Add Media
          </IonButton>
          <span>{selectedMedia.length}/{MAX_MEDIA_ITEMS}</span>
        </div>

        <IonTextarea
          value={caption}
          onIonInput={(event) => setCaption(event.detail.value ?? '')}
          maxlength={2200}
          autoGrow
          fill="outline"
          label="Caption"
          labelPlacement="floating"
          className="create-post-caption"
        />

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={(event) => void pickFiles(event)}
        />
      </IonContent>
    </IonModal>
  );
}
