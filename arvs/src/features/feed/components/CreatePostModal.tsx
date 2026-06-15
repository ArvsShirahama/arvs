import { useEffect, useRef, useState } from 'react';
import Cropper, { type Area, type Point } from 'react-easy-crop';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonModal,
  IonRange,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonTextarea,
  IonTitle,
  IonToolbar,
  useIonToast,
} from '@ionic/react';
import { add, close, cropOutline, imagesOutline } from 'ionicons/icons';
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

type CropStatus = 'pending' | 'complete' | 'not_required';

interface MediaCropState {
  x: number;
  y: number;
  zoom: number;
  croppedAreaPixels: Area | null;
}

interface SelectedPostMedia extends CreatePostMediaInput {
  id: string;
  originalFile: File;
  originalPreviewUrl: string;
  previewUrl: string;
  originalWidth: number | null;
  originalHeight: number | null;
  cropStatus: CropStatus;
  crop?: MediaCropState;
}

const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const MAX_MEDIA_ITEMS = 10;
const CROPPED_IMAGE_QUALITY = 0.9;

const ASPECT_RATIO_VALUES: Record<Exclude<PostAspectRatio, 'original'>, number> = {
  portrait: 4 / 5,
  square: 1,
  landscape: 1.91,
};

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

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to load image for cropping.'));
    image.src = url;
  });
}

function createCroppedFileName(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  return `${baseName}-cropped.jpg`;
}

async function createCroppedImageFile(
  imageUrl: string,
  cropPixels: Area,
  fileName: string
): Promise<File> {
  const image = await loadImage(imageUrl);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(cropPixels.width));
  canvas.height = Math.max(1, Math.round(cropPixels.height));

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Image crop is not supported on this device.');
  }

  context.drawImage(
    image,
    cropPixels.x,
    cropPixels.y,
    cropPixels.width,
    cropPixels.height,
    0,
    0,
    canvas.width,
    canvas.height
  );

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) {
        resolve(result);
      } else {
        reject(new Error('Unable to create cropped image.'));
      }
    }, 'image/jpeg', CROPPED_IMAGE_QUALITY);
  });

  return new File([blob], createCroppedFileName(fileName), {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
}

function revokeSelectedMediaUrls(mediaItems: SelectedPostMedia[]): void {
  mediaItems.forEach((media) => {
    URL.revokeObjectURL(media.originalPreviewUrl);
    if (media.previewUrl !== media.originalPreviewUrl) {
      URL.revokeObjectURL(media.previewUrl);
    }
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
    originalFile: file,
    file,
    mediaType,
    originalPreviewUrl: previewUrl,
    previewUrl,
    originalWidth: dimensions.width,
    originalHeight: dimensions.height,
    width: dimensions.width,
    height: dimensions.height,
    cropStatus: mediaType === 'image' ? 'pending' : 'not_required',
    crop: mediaType === 'image'
      ? { x: 0, y: 0, zoom: 1, croppedAreaPixels: null }
      : undefined,
  };
}

function findNextPendingImage(items: SelectedPostMedia[], afterId?: string): string | null {
  if (items.length === 0) return null;
  const startIndex = afterId ? Math.max(0, items.findIndex((item) => item.id === afterId) + 1) : 0;
  const orderedItems = [...items.slice(startIndex), ...items.slice(0, startIndex)];
  return orderedItems.find((item) => item.mediaType === 'image' && item.cropStatus === 'pending')?.id ?? null;
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
  const [activeCropId, setActiveCropId] = useState<string | null>(null);
  const [cropping, setCropping] = useState(false);
  const [posting, setPosting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedMediaRef = useRef<SelectedPostMedia[]>([]);
  const [presentToast] = useIonToast();

  const pendingImageCount = selectedMedia.filter((media) => media.mediaType === 'image' && media.cropStatus === 'pending').length;
  const activeCropMedia = selectedMedia.find((media) => media.id === activeCropId) ?? null;
  const allImagesCropped = pendingImageCount === 0;
  const canPost = selectedMedia.length > 0 && allImagesCropped && !posting && !cropping;

  useEffect(() => {
    selectedMediaRef.current = selectedMedia;
  }, [selectedMedia]);

  useEffect(() => {
    return () => {
      revokeSelectedMediaUrls(selectedMediaRef.current);
    };
  }, []);

  const reset = () => {
    revokeSelectedMediaUrls(selectedMedia);
    setSelectedMedia([]);
    setCaption('');
    setAspectRatio('square');
    setActiveCropId(null);
    setCropping(false);
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
        if (aspectRatio === 'original' && media.mediaType === 'image') {
          media.cropStatus = 'not_required';
        }
        nextMedia.push(media);
      }
    }

    if (nextMedia.length > 0) {
      setSelectedMedia((current) => {
        const updated = [...current, ...nextMedia];
        setActiveCropId(findNextPendingImage(updated) ?? null);
        return updated;
      });
    }
  };

  const removeMedia = (id: string) => {
    setSelectedMedia((current) => {
      const item = current.find((media) => media.id === id);
      if (item) {
        revokeSelectedMediaUrls([item]);
      }
      const updated = current.filter((media) => media.id !== id);
      if (activeCropId === id) {
        setActiveCropId(findNextPendingImage(updated) ?? null);
      }
      return updated;
    });
  };

  const handleAspectRatioChange = (nextAspectRatio: PostAspectRatio) => {
    setAspectRatio(nextAspectRatio);
    setSelectedMedia((current) => {
      const updated = current.map((media) => {
        if (media.mediaType !== 'image') return media;

        if (media.previewUrl !== media.originalPreviewUrl) {
          URL.revokeObjectURL(media.previewUrl);
        }

        return {
          ...media,
          file: media.originalFile,
          previewUrl: media.originalPreviewUrl,
          width: media.originalWidth,
          height: media.originalHeight,
          cropStatus: nextAspectRatio === 'original' ? 'not_required' : ('pending' as CropStatus),
          crop: { x: 0, y: 0, zoom: 1, croppedAreaPixels: null },
        };
      });
      setActiveCropId(findNextPendingImage(updated) ?? null);
      return updated;
    });
  };

  const updateActiveCrop = (patch: Partial<MediaCropState>) => {
    if (!activeCropId) return;
    setSelectedMedia((current) => current.map((media) => {
      if (media.id !== activeCropId || media.mediaType !== 'image') return media;
      return {
        ...media,
        crop: {
          x: media.crop?.x ?? 0,
          y: media.crop?.y ?? 0,
          zoom: media.crop?.zoom ?? 1,
          croppedAreaPixels: media.crop?.croppedAreaPixels ?? null,
          ...patch,
        },
      };
    }));
  };

  const confirmCrop = async () => {
    if (!activeCropMedia || activeCropMedia.mediaType !== 'image' || !activeCropMedia.crop?.croppedAreaPixels) {
      return;
    }

    setCropping(true);
    try {
      const croppedFile = await createCroppedImageFile(
        activeCropMedia.originalPreviewUrl,
        activeCropMedia.crop.croppedAreaPixels,
        activeCropMedia.originalFile.name
      );
      const croppedPreviewUrl = URL.createObjectURL(croppedFile);

      let updatedItems: SelectedPostMedia[] = [];
      setSelectedMedia((current) => {
        updatedItems = current.map((media) => {
          if (media.id !== activeCropMedia.id) return media;
          if (media.previewUrl !== media.originalPreviewUrl) {
            URL.revokeObjectURL(media.previewUrl);
          }

          return {
            ...media,
            file: croppedFile,
            previewUrl: croppedPreviewUrl,
            width: activeCropMedia.crop?.croppedAreaPixels?.width ?? media.width,
            height: activeCropMedia.crop?.croppedAreaPixels?.height ?? media.height,
            cropStatus: 'complete',
          };
        });
        return updatedItems;
      });

      setActiveCropId(findNextPendingImage(updatedItems, activeCropMedia.id));
    } catch (error) {
      await presentToast({
        message: error instanceof Error ? error.message : 'Unable to crop image.',
        duration: 2200,
        color: 'danger',
        position: 'top',
      });
    } finally {
      setCropping(false);
    }
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

  const activeCrop = activeCropMedia?.crop ?? { x: 0, y: 0, zoom: 1, croppedAreaPixels: null };
  const cropEditor = activeCropMedia?.mediaType === 'image' ? (
    <section className="create-post-crop-editor" aria-label="Adjust image crop">
      <div
        className={`create-post-crop-stage create-post-crop-stage-${aspectRatio}`}
        style={
          aspectRatio === 'original' && activeCropMedia.originalWidth && activeCropMedia.originalHeight
            ? { aspectRatio: `${activeCropMedia.originalWidth} / ${activeCropMedia.originalHeight}` }
            : undefined
        }
      >
        <Cropper
          image={activeCropMedia.originalPreviewUrl}
          crop={{ x: activeCrop.x, y: activeCrop.y }}
          zoom={activeCrop.zoom}
          aspect={
            aspectRatio === 'original'
              ? (activeCropMedia.originalWidth && activeCropMedia.originalHeight
                  ? activeCropMedia.originalWidth / activeCropMedia.originalHeight
                  : 1)
              : ASPECT_RATIO_VALUES[aspectRatio as Exclude<PostAspectRatio, 'original'>]
          }
          minZoom={1}
          maxZoom={4}
          cropShape="rect"
          showGrid={false}
          onCropChange={(nextCrop: Point) => updateActiveCrop({ x: nextCrop.x, y: nextCrop.y })}
          onZoomChange={(nextZoom: number) => updateActiveCrop({ zoom: nextZoom })}
          onCropComplete={(_, croppedAreaPixels) => updateActiveCrop({ croppedAreaPixels })}
        />
      </div>

      <div className="create-post-crop-controls">
        <div className="create-post-crop-copy">
          <strong>Adjust crop</strong>
          <span>{pendingImageCount} image{pendingImageCount === 1 ? '' : 's'} left</span>
        </div>
        <IonRange
          min={1}
          max={4}
          step={0.05}
          value={activeCrop.zoom}
          onIonInput={(event) => updateActiveCrop({ zoom: Number(event.detail.value) })}
          aria-label="Crop zoom"
        />
        <IonButton
          expand="block"
          onClick={() => void confirmCrop()}
          disabled={cropping || !activeCrop.croppedAreaPixels}
        >
          {cropping ? <IonSpinner name="crescent" /> : 'Use Crop'}
        </IonButton>
      </div>
    </section>
  ) : null;

  return (
    <IonModal isOpen={isOpen} onDidDismiss={handleDismiss}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={handleDismiss} disabled={posting || cropping}>Cancel</IonButton>
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
        {cropEditor}

        <div
          className={`create-post-preview create-post-preview-${aspectRatio} ${cropEditor ? 'create-post-preview-disabled' : ''}`}
          style={
            aspectRatio === 'original' && selectedMedia[0]?.width && selectedMedia[0]?.height
              ? { aspectRatio: `${selectedMedia[0].width} / ${selectedMedia[0].height}` }
              : undefined
          }
        >
          {selectedMedia.length === 0 ? (
            <button
              type="button"
              className="create-post-empty"
              onClick={() => fileInputRef.current?.click()}
              disabled={posting || cropping}
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
                  {media.cropStatus === 'pending' && (
                    <span className="create-post-crop-pending">Crop needed</span>
                  )}
                  {media.mediaType === 'image' && (
                    <button
                      type="button"
                      className="create-post-adjust"
                      onClick={() => setActiveCropId(media.id)}
                      disabled={posting || cropping}
                      aria-label="Adjust crop"
                    >
                      <IonIcon icon={cropOutline} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="create-post-remove"
                    onClick={() => removeMedia(media.id)}
                    disabled={posting || cropping}
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
          onIonChange={(event) => handleAspectRatioChange((event.detail.value as PostAspectRatio | undefined) ?? 'square')}
          className="create-post-ratio-segment"
          disabled={posting || cropping}
        >
          <IonSegmentButton value="portrait">4:5</IonSegmentButton>
          <IonSegmentButton value="square">1:1</IonSegmentButton>
          <IonSegmentButton value="landscape">1.91:1</IonSegmentButton>
          <IonSegmentButton value="original">Original</IonSegmentButton>
        </IonSegment>

        <div className="create-post-picker-row">
          <IonButton
            fill="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={posting || cropping || selectedMedia.length >= MAX_MEDIA_ITEMS}
          >
            <IonIcon slot="start" icon={add} />
            Add Media
          </IonButton>
          <span>{pendingImageCount > 0 ? `${pendingImageCount} crop needed` : `${selectedMedia.length}/${MAX_MEDIA_ITEMS}`}</span>
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
          disabled={posting || cropping}
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
