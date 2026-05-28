import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonPage,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  IonProgressBar,
  useIonRouter,
  useIonToast,
} from '@ionic/react';
import { Camera } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { imageOutline, imagesOutline, trashOutline } from 'ionicons/icons';
import { IonIcon } from '@ionic/react';
import { useParams } from 'react-router-dom';
import Avatar from '../../../components/Avatar';
import { useAuth } from '../../auth/hooks';
import { supabase } from '../../../supabaseClient';
import {
  deleteConversationBackgroundAsset,
  getConversationContext,
  saveConversationParticipantNickname,
  saveSharedConversationAppearance,
  uploadConversationBackgroundWithProgress,
} from '../services';
import {
  DEFAULT_CONVERSATION_THEME_ID,
  getDisplayNameForParticipant,
  getConversationTheme,
} from '../services';
import type { ConversationParticipantProfile, ConversationPreference, Profile } from '../../../types/database';
import type { ConversationNickname } from '../../../types/database';
import { validateImageFile, compressAndResizeImage } from '../../../utils/imageProcessor';
import ImageCropperModal from '../../../components/ImageCropperModal';
import './ConversationSettings.css';

interface RouteParams {
  conversationId: string;
}

interface BackgroundSelection {
  blob: Blob;
  fileName: string;
  contentType: string;
  previewUrl: string;
}

export default function ConversationSettings() {
  const { conversationId } = useParams<RouteParams>();
  const { user } = useAuth();
  const router = useIonRouter();
  const [presentToast] = useIonToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [otherUser, setOtherUser] = useState<Profile | null>(null);
  const [preference, setPreference] = useState<ConversationPreference | null>(null);
  const [participants, setParticipants] = useState<ConversationParticipantProfile[]>([]);
  const [participantNicknames, setParticipantNicknames] = useState<Record<string, string>>({});
  const [savedParticipantNicknames, setSavedParticipantNicknames] = useState<Record<string, string>>({});
  const [backgroundSelection, setBackgroundSelection] = useState<BackgroundSelection | null>(null);
  const [removeBackground, setRemoveBackground] = useState(false);
  const [showCropper, setShowCropper] = useState(false);
  const [pendingImageSrc, setPendingImageSrc] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadSettings = useCallback(async () => {
    if (!user?.id || !conversationId) {
      return;
    }

    setLoading(true);
    try {
      const context = await getConversationContext(conversationId, user.id);
      setOtherUser(context.otherUser);
      setPreference(context.preference);
      setParticipants(context.participants);
      const nextNicknames = context.participants.reduce<Record<string, string>>((acc, participant) => {
        acc[participant.profile.id] = participant.nickname ?? '';
        return acc;
      }, {});
      setParticipantNicknames(nextNicknames);
      setSavedParticipantNicknames(nextNicknames);
      setRemoveBackground(false);
    } catch {
      await presentToast({
        message: 'Unable to load conversation settings.',
        duration: 2200,
        color: 'danger',
        position: 'top',
      });
    } finally {
      setLoading(false);
    }
  }, [conversationId, presentToast, user?.id]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (!conversationId) return;

    const channel = supabase
      .channel(`conversation-settings-${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversation_nicknames',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = (payload.new || payload.old) as ConversationNickname | undefined;
          if (!row) return;

          const nextValue = payload.eventType === 'DELETE' ? '' : ((payload.new as ConversationNickname).nickname ?? '');
          setParticipantNicknames((current) => ({ ...current, [row.user_id]: nextValue }));
          setSavedParticipantNicknames((current) => ({ ...current, [row.user_id]: nextValue }));
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId]);

  useEffect(() => {
    return () => {
      if (backgroundSelection?.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(backgroundSelection.previewUrl);
      }
    };
  }, [backgroundSelection]);

  const otherUserNickname = otherUser ? participantNicknames[otherUser.id] ?? null : null;
  const previewName = useMemo(
    () => getDisplayNameForParticipant(otherUser, otherUserNickname ?? preference?.peer_nickname),
    [otherUser, otherUserNickname, preference?.peer_nickname]
  );

  const systemTheme = useMemo(() => getConversationTheme(preference?.theme_id), [preference?.theme_id]);
  const activeBackgroundUrl = backgroundSelection?.previewUrl ?? (removeBackground ? null : preference?.background_image_url ?? null);
  const heroBackground = activeBackgroundUrl
    ? `${systemTheme.overlay}, url(${activeBackgroundUrl})`
    : 'var(--conversation-preview-fallback)';

  const applyBackgroundSelection = (blob: Blob, fileName: string, contentType: string, previewUrl: string) => {
    setBackgroundSelection((current) => {
      if (current?.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(current.previewUrl);
      }
      return { blob, fileName, contentType, previewUrl };
    });
    setRemoveBackground(false);
  };

  const handleImageSelected = async (blob: Blob, fileName: string, previewUrl: string) => {
    setValidationError(null);
    
    // Validate
    const validation = validateImageFile(blob);
    if (!validation.valid) {
      setValidationError(validation.error || 'Invalid image');
      await presentToast({ message: validation.error || 'Invalid image', duration: 3000, color: 'danger' });
      return;
    }
    
    // Show cropper
    setPendingImageSrc(previewUrl);
    setShowCropper(true);
  };

  const pickBackground = async () => {
    if (!Capacitor.isNativePlatform()) {
      fileInputRef.current?.click();
      return;
    }

    try {
      const result = await Camera.pickImages({ quality: 100, limit: 1 });
      const image = result.photos?.[0];
      if (!image?.webPath) {
        return;
      }

      const response = await fetch(image.webPath);
      const blob = await response.blob();
      const extension = image.format || 'jpg';
      await handleImageSelected(blob, `background.${extension}`, image.webPath);
    } catch {
      // silent on cancellation
    }
  };

  const handleFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    event.target.value = '';
    void handleImageSelected(file, file.name, URL.createObjectURL(file));
  };

  const clearSelectedBackground = () => {
    setRemoveBackground(true);
    if (backgroundSelection?.previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(backgroundSelection.previewUrl);
    }
    setBackgroundSelection(null);
  };

  const updateParticipantNickname = (participantId: string, value: string) => {
    setParticipantNicknames((current) => ({
      ...current,
      [participantId]: value,
    }));
  };

  const handleCropConfirm = async (croppedBlob: Blob) => {
    setShowCropper(false);
    if (pendingImageSrc?.startsWith('blob:')) {
      URL.revokeObjectURL(pendingImageSrc);
    }
    setPendingImageSrc(null);
    
    // Compress cropped image
    const compressedBlob = await compressAndResizeImage(croppedBlob);
    applyBackgroundSelection(compressedBlob, 'background.jpg', 'image/jpeg', URL.createObjectURL(compressedBlob));
  };

  const handleCropCancel = () => {
    setShowCropper(false);
    if (pendingImageSrc?.startsWith('blob:')) {
      URL.revokeObjectURL(pendingImageSrc);
    }
    setPendingImageSrc(null);
  };

  const handleSave = async () => {
    if (!user?.id || !conversationId) {
      return;
    }

    setSaving(true);

    try {
      let backgroundImageUrl = removeBackground ? null : preference?.background_image_url ?? null;
      let backgroundImagePath = removeBackground ? null : preference?.background_image_path ?? null;

      if (removeBackground && preference?.background_image_path) {
        await deleteConversationBackgroundAsset(preference.background_image_path);
      }

      if (backgroundSelection) {
        setIsUploading(true);
        setUploadProgress(0);
        
        const uploaded = await uploadConversationBackgroundWithProgress({
          conversationId,
          userId: user.id,
          blob: backgroundSelection.blob,
          fileName: backgroundSelection.fileName,
          contentType: backgroundSelection.contentType,
          previousPath: removeBackground ? null : preference?.background_image_path,
          onProgress: (percent: number) => setUploadProgress(percent),
        });

        backgroundImageUrl = uploaded.backgroundImageUrl;
        backgroundImagePath = uploaded.backgroundImagePath;
        setIsUploading(false);
      }

      const changedNicknameEntries = Object.entries(participantNicknames)
        .filter(([participantId, value]) => (value.trim() || '') !== (savedParticipantNicknames[participantId]?.trim() || ''));

      const savedNicknameRows = await Promise.all(
        changedNicknameEntries.map(([participantId, value]) =>
          saveConversationParticipantNickname(conversationId, participantId, value.trim() || null)
        )
      );

      const nextPreference = backgroundSelection || removeBackground
        ? await saveSharedConversationAppearance(conversationId, user.id, {
          theme_id: DEFAULT_CONVERSATION_THEME_ID,
          background_type: backgroundImageUrl ? 'image' : 'gradient',
          background_image_url: backgroundImageUrl,
          background_image_path: backgroundImagePath,
        })
        : {
          ...(preference ?? {
            conversation_id: conversationId,
            user_id: user.id,
            created_at: new Date().toISOString(),
          }),
          theme_id: DEFAULT_CONVERSATION_THEME_ID,
          background_type: backgroundImageUrl ? 'image' as const : 'gradient' as const,
          background_image_url: backgroundImageUrl,
          background_image_path: backgroundImagePath,
          updated_at: new Date().toISOString(),
          peer_nickname: otherUser ? participantNicknames[otherUser.id]?.trim() || null : null,
        };

      const nextSavedNicknames = { ...savedParticipantNicknames };
      for (const row of savedNicknameRows) {
        nextSavedNicknames[row.user_id] = row.nickname ?? '';
      }
      setSavedParticipantNicknames(nextSavedNicknames);
      setParticipantNicknames((current) => ({
        ...current,
        ...nextSavedNicknames,
      }));

      setPreference({
        ...nextPreference,
        peer_nickname: otherUser ? nextSavedNicknames[otherUser.id]?.trim() || null : null,
        background_type: backgroundImageUrl ? 'image' : 'gradient',
        background_image_url: backgroundImageUrl,
        background_image_path: backgroundImagePath,
      });
      setRemoveBackground(false);
      if (backgroundSelection?.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(backgroundSelection.previewUrl);
      }
      setBackgroundSelection(null);

      await presentToast({
        message: 'Conversation settings updated.',
        duration: 1800,
        color: 'success',
        position: 'top',
      });
    } catch {
      await presentToast({
        message: 'Failed to save conversation settings.',
        duration: 2200,
        color: 'danger',
        position: 'top',
      });
    } finally {
      setIsUploading(false);
      setSaving(false);
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref={`/chat/${conversationId}`} text="" />
          </IonButtons>
          <IonTitle>Conversation Settings</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="conversation-settings-page" fullscreen>
        {loading ? (
          <div className="conversation-settings-loading">
            <IonSpinner name="crescent" />
          </div>
        ) : (
          <div className="conversation-settings-shell">
            <section className="conversation-settings-hero" style={{ backgroundImage: heroBackground }}>
              <div className="conversation-settings-hero-overlay">
                <Avatar
                  src={otherUser?.avatar_url}
                  name={previewName}
                  size="large"
                />
                <h1>{previewName}</h1>
                <p>@{otherUser?.username ?? 'unknown'}</p>
              </div>
            </section>

            <section className="conversation-settings-section conversation-people-section">
              <h2>People</h2>
              <div className="conversation-people-list">
                {participants.map((participant) => {
                  const participantProfile = participant.profile;
                  const currentNickname = participantNicknames[participantProfile.id] ?? '';
                  const displayName = getDisplayNameForParticipant(participantProfile, currentNickname);
                  const isCurrentUser = participantProfile.id === user?.id;

                  return (
                    <div className="conversation-person-row" key={participantProfile.id}>
                      <Avatar
                        src={participantProfile.avatar_url}
                        name={displayName}
                        size="small"
                      />
                      <div className="conversation-person-copy">
                        <strong>{displayName}</strong>
                        <span>@{participantProfile.username}{isCurrentUser ? ' · You' : ''}</span>
                      </div>
                      <IonInput
                        className="conversation-person-nickname"
                        value={currentNickname}
                        maxlength={30}
                        placeholder="Nickname"
                        aria-label={`Nickname for ${participantProfile.username}`}
                        onIonInput={(event) => updateParticipantNickname(participantProfile.id, event.detail.value ?? '')}
                      />
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="conversation-settings-section">
              <div className="conversation-settings-section-header">
                <div>
                  <h2>Background</h2>
                  <IonText color="medium">
                    <p>Shared by both users.</p>
                  </IonText>
                </div>
              </div>

              <div className="conversation-background-card" style={{ backgroundImage: activeBackgroundUrl ? `${systemTheme.overlay}, url(${activeBackgroundUrl})` : 'var(--conversation-preview-fallback)' }}>
                {!activeBackgroundUrl && <span className="conversation-background-empty">Using system appearance</span>}
              </div>

              {validationError && (
                <IonText color="danger" className="conversation-settings-error">
                  {validationError}
                </IonText>
              )}

              {isUploading && (
                <div className="conversation-settings-progress">
                  <IonProgressBar value={uploadProgress / 100} />
                  <IonText className="progress-text">{uploadProgress}%</IonText>
                </div>
              )}

              <div className="conversation-background-actions">
                <IonButton fill="outline" onClick={pickBackground}>
                  <IonIcon slot="start" icon={imagesOutline} />
                  Choose Image
                </IonButton>
                <IonButton
                  fill="clear"
                  color="medium"
                  onClick={clearSelectedBackground}
                  disabled={!activeBackgroundUrl}
                >
                  <IonIcon slot="start" icon={trashOutline} />
                  Remove
                </IonButton>
              </div>
            </section>

            <section className="conversation-settings-section">
              <IonButton
                expand="block"
                fill="outline"
                onClick={() => router.push(`/chat/${conversationId}/media`, 'forward')}
              >
                <IonIcon slot="start" icon={imageOutline} />
                View All Media
              </IonButton>
            </section>

            <section className="conversation-settings-actions">
              <IonButton expand="block" onClick={handleSave} disabled={saving}>
                {saving ? <IonSpinner name="crescent" /> : 'Save'}
              </IonButton>
            </section>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileSelected}
        />

        {showCropper && pendingImageSrc && (
          <ImageCropperModal
            isOpen={showCropper}
            imageSrc={pendingImageSrc}
            onConfirm={handleCropConfirm}
            onCancel={handleCropCancel}
          />
        )}
      </IonContent>
    </IonPage>
  );
}

