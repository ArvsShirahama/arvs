import { useCallback, useEffect, useState } from 'react';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { supabase } from '../supabaseClient';
import { useAuth } from './useAuth';
import { sendChatPush } from '../services/pushService';
import type { MessageType } from '../types/database';

export interface MediaDraft {
  src: string;
  blob: Blob;
  type: 'image' | 'video' | 'file';
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE = 50 * 1024 * 1024;
const MAX_FILE_SIZE = 25 * 1024 * 1024;

function sanitizeFileName(fileName: string): string {
  return fileName.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
}

function fallbackFileName(type: MediaDraft['type'], mimeType: string): string {
  if (type === 'image') {
    return mimeType.includes('png') ? 'photo.png' : 'photo.jpg';
  }
  if (type === 'video') {
    return mimeType.includes('webm') ? 'video.webm' : 'video.mp4';
  }
  return 'attachment';
}

export function useMediaCapture(
  conversationId: string,
  showToast: (message: string, color?: 'danger' | 'warning' | 'success') => void,
  imageFileInputRef: React.RefObject<HTMLInputElement | null>,
  galleryVideoInputRef: React.RefObject<HTMLInputElement | null>,
  captureVideoInputRef: React.RefObject<HTMLInputElement | null>,
  fileInputRef: React.RefObject<HTMLInputElement | null>
) {
  const { user } = useAuth();
  const [mediaPreview, setMediaPreview] = useState<MediaDraft | null>(null);
  const [sending, setSending] = useState(false);

  const revokePreviewUrl = useCallback((src: string) => {
    if (src.startsWith('blob:')) {
      URL.revokeObjectURL(src);
    }
  }, []);

  const notifyPush = useCallback(async (messageId: string) => {
    try {
      await sendChatPush(messageId);
    } catch (error) {
      console.warn('Push dispatch failed', error);
    }
  }, []);

  const applyMediaPreview = useCallback((draft: MediaDraft) => {
    const maxSize = draft.type === 'image'
      ? MAX_IMAGE_SIZE
      : draft.type === 'video'
        ? MAX_VIDEO_SIZE
        : MAX_FILE_SIZE;

    if (draft.sizeBytes > maxSize) {
      const maxSizeLabel = draft.type === 'image' ? '10 MB' : draft.type === 'video' ? '50 MB' : '25 MB';
      showToast(`File is too large. Max size: ${maxSizeLabel}`, 'warning');
      if (draft.src.startsWith('blob:')) {
        URL.revokeObjectURL(draft.src);
      }
      return;
    }

    setMediaPreview((previous) => {
      if (previous) {
        revokePreviewUrl(previous.src);
      }
      return draft;
    });
  }, [revokePreviewUrl, showToast]);

  const fetchBlobFromWebPath = useCallback(async (webPath: string): Promise<Blob | null> => {
    try {
      const response = await fetch(webPath);
      return await response.blob();
    } catch {
      return null;
    }
  }, []);

  const uploadMedia = useCallback(async (draft: MediaDraft): Promise<{ url: string; path: string } | null> => {
    if (!user || !conversationId) {
      return null;
    }

    const fileName = sanitizeFileName(draft.fileName || fallbackFileName(draft.type, draft.mimeType));
    const filePath = `${user.id}/${conversationId}/${Date.now()}-${fileName}`;

    try {
      const { error } = await supabase.storage
        .from('chat-media')
        .upload(filePath, draft.blob, {
          contentType: draft.mimeType || undefined,
        });

      if (error) {
        return null;
      }

      const { data } = supabase.storage.from('chat-media').getPublicUrl(filePath);
      return { url: data.publicUrl, path: filePath };
    } catch (error) {
      console.error('Storage upload exception', error);
      return null;
    }
  }, [conversationId, user]);

  const handleSend = useCallback(async (text: string) => {
    if (!user || !conversationId || sending) {
      return;
    }

    setSending(true);
    try {
      const { data, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: user.id,
          content: text,
        })
        .select('id')
        .single();
      setSending(false);

      if (error) {
        showToast('Message failed to send.');
        return;
      }

      if (data?.id) {
        void notifyPush(data.id);
      }
    } catch (error) {
      console.error('Failed to send text message', error);
      setSending(false);
      showToast('Message failed to send.');
    }
  }, [conversationId, notifyPush, sending, showToast, user]);

  const handleSendMedia = useCallback(async (caption: string) => {
    if (!user || !conversationId || !mediaPreview || sending) {
      return;
    }

    setSending(true);
    const uploaded = await uploadMedia(mediaPreview);
    if (!uploaded) {
      setSending(false);
      showToast('Unable to upload attachment.');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: user.id,
          content: caption,
          message_type: mediaPreview.type as MessageType,
          media_url: uploaded.url,
          media_path: uploaded.path,
          media_name: mediaPreview.fileName,
          media_mime_type: mediaPreview.mimeType,
          media_size_bytes: mediaPreview.sizeBytes,
        })
        .select('id')
        .single();

      revokePreviewUrl(mediaPreview.src);
      setMediaPreview(null);
      setSending(false);

      if (error) {
        showToast('Unable to send attachment.');
        return;
      }

      if (data?.id) {
        void notifyPush(data.id);
      }
    } catch (error) {
      console.error('Failed to send media message', error);
      setSending(false);
      showToast('Unable to send attachment.');
    }
  }, [conversationId, mediaPreview, notifyPush, revokePreviewUrl, sending, showToast, uploadMedia, user]);

  const takePhoto = useCallback(async () => {
    try {
      const photo = await Camera.getPhoto({
        quality: 85,
        source: CameraSource.Camera,
        resultType: CameraResultType.Uri,
        saveToGallery: false,
      });

      if (!photo.webPath) {
        return;
      }

      const blob = await fetchBlobFromWebPath(photo.webPath);
      if (!blob) {
        showToast('Could not process captured photo.');
        return;
      }

      applyMediaPreview({
        src: photo.webPath,
        blob,
        type: 'image',
        fileName: `photo.${photo.format || 'jpg'}`,
        mimeType: blob.type || 'image/jpeg',
        sizeBytes: blob.size,
      });
    } catch (error) {
      // user cancellation is expected and should stay silent
      console.debug('Photo capture cancelled/failed', error);
    }
  }, [applyMediaPreview, fetchBlobFromWebPath, showToast]);

  const pickImageFromGallery = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) {
      imageFileInputRef.current?.click();
      return;
    }

    try {
      const result = await Camera.pickImages({ quality: 85, limit: 1 });
      const selected = result.photos?.[0];
      if (!selected?.webPath) {
        return;
      }

      const blob = await fetchBlobFromWebPath(selected.webPath);
      if (!blob) {
        showToast('Could not process selected image.');
        return;
      }

      applyMediaPreview({
        src: selected.webPath,
        blob,
        type: 'image',
        fileName: `photo.${selected.format || 'jpg'}`,
        mimeType: blob.type || 'image/jpeg',
        sizeBytes: blob.size,
      });
    } catch (error) {
      // user cancellation is expected and should stay silent
      console.debug('Gallery image pick cancelled/failed', error);
    }
  }, [imageFileInputRef, fetchBlobFromWebPath, applyMediaPreview, showToast]);

  const handleImageFileSelected = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    event.target.value = '';
    applyMediaPreview({
      src: URL.createObjectURL(file),
      blob: file,
      type: 'image',
      fileName: file.name,
      mimeType: file.type || 'image/jpeg',
      sizeBytes: file.size,
    });
  }, [applyMediaPreview]);

  const handleVideoFileSelected = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    event.target.value = '';
    applyMediaPreview({
      src: URL.createObjectURL(file),
      blob: file,
      type: 'video',
      fileName: file.name,
      mimeType: file.type || 'video/mp4',
      sizeBytes: file.size,
    });
  }, [applyMediaPreview]);

  const handleFileSelected = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    event.target.value = '';
    applyMediaPreview({
      src: URL.createObjectURL(file),
      blob: file,
      type: 'file',
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
    });
  }, [applyMediaPreview]);

  const cancelMedia = useCallback(() => {
    if (!mediaPreview) {
      return;
    }
    revokePreviewUrl(mediaPreview.src);
    setMediaPreview(null);
  }, [mediaPreview, revokePreviewUrl]);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      if (mediaPreview) {
        revokePreviewUrl(mediaPreview.src);
      }
    };
  }, [mediaPreview, revokePreviewUrl]);

  return {
    mediaPreview,
    sending,
    takePhoto,
    pickImageFromGallery,
    handleImageFileSelected,
    handleVideoFileSelected,
    handleFileSelected,
    handleSend,
    handleSendMedia,
    cancelMedia,
  };
}
