import { useEffect, useRef, useState } from 'react';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonModal,
  IonSpinner,
  IonTextarea,
  IonTitle,
  IonToolbar,
  useIonToast,
} from '@ionic/react';
import Avatar from '../../../components/Avatar';
import { supabase } from '../../../supabaseClient';
import type { Profile } from '../../../types/database';
import { updateProfileDetails } from '../services';
import './EditProfileModal.css';

interface EditProfileModalProps {
  isOpen: boolean;
  profile: Profile | null;
  userId: string;
  onDismiss: () => void;
  onSaved: (profile: Profile) => void;
}

const AVATAR_MAX_BYTES = 10 * 1024 * 1024;

export default function EditProfileModal({
  isOpen,
  profile,
  userId,
  onDismiss,
  onSaved,
}: EditProfileModalProps) {
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [presentToast] = useIonToast();

  useEffect(() => {
    if (!profile || !isOpen) return;
    setDisplayName(profile.display_name ?? '');
    setUsername(profile.username ?? '');
    setBio(profile.bio ?? '');
    setStatusMessage(profile.status_message ?? '');
    setAvatarFile(null);
    if (avatarPreviewUrl) {
      URL.revokeObjectURL(avatarPreviewUrl);
    }
    setAvatarPreviewUrl(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, profile?.id]);

  useEffect(() => {
    return () => {
      if (avatarPreviewUrl) {
        URL.revokeObjectURL(avatarPreviewUrl);
      }
    };
  }, [avatarPreviewUrl]);

  const handleAvatarSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (file.size > AVATAR_MAX_BYTES) {
      await presentToast({
        message: 'Avatar is too large. Max 10 MB.',
        duration: 2200,
        color: 'warning',
        position: 'top',
      });
      return;
    }

    if (avatarPreviewUrl) {
      URL.revokeObjectURL(avatarPreviewUrl);
    }
    setAvatarFile(file);
    setAvatarPreviewUrl(URL.createObjectURL(file));
  };

  const uploadAvatar = async (): Promise<string | null | undefined> => {
    if (!avatarFile) return undefined;

    const extension = avatarFile.name.split('.').pop()?.toLowerCase() || 'jpg';
    const filePath = `${userId}/avatar.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, avatarFile, {
        upsert: true,
        contentType: avatarFile.type || undefined,
      });

    if (uploadError) {
      throw uploadError;
    }

    const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
    return `${data.publicUrl}?t=${Date.now()}`;
  };

  const handleSave = async () => {
    if (!displayName.trim() || !username.trim()) {
      await presentToast({
        message: 'Name and username are required.',
        duration: 1800,
        color: 'danger',
        position: 'top',
      });
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username.trim())) {
      await presentToast({
        message: 'Username can only use letters, numbers, and underscores.',
        duration: 2200,
        color: 'warning',
        position: 'top',
      });
      return;
    }

    setSaving(true);
    try {
      const avatarUrl = await uploadAvatar();
      const savedProfile = await updateProfileDetails(userId, {
        displayName,
        username,
        bio,
        statusMessage,
        avatarUrl,
      });
      onSaved(savedProfile);
      await presentToast({
        message: 'Profile updated.',
        duration: 1400,
        color: 'success',
        position: 'top',
      });
      onDismiss();
    } catch (error) {
      await presentToast({
        message: error instanceof Error ? error.message : 'Unable to update profile.',
        duration: 2400,
        color: 'danger',
        position: 'top',
      });
    } finally {
      setSaving(false);
    }
  };

  const avatarName = displayName.trim() || username || 'User';

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onDismiss}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={onDismiss} disabled={saving}>Cancel</IonButton>
          </IonButtons>
          <IonTitle>Edit Profile</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={() => void handleSave()} disabled={saving}>
              {saving ? <IonSpinner name="crescent" /> : 'Save'}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="edit-profile-modal">
        <div className="edit-profile-avatar">
          <Avatar
            src={avatarPreviewUrl ?? profile?.avatar_url}
            name={avatarName}
            size="large"
            onClick={() => fileInputRef.current?.click()}
          />
          <IonButton fill="clear" onClick={() => fileInputRef.current?.click()} disabled={saving}>
            Change Photo
          </IonButton>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => void handleAvatarSelected(event)}
          />
        </div>

        <div className="edit-profile-form">
          <IonInput
            label="Display Name"
            labelPlacement="floating"
            fill="outline"
            value={displayName}
            onIonInput={(event) => setDisplayName(event.detail.value ?? '')}
            maxlength={80}
          />
          <IonInput
            label="Username"
            labelPlacement="floating"
            fill="outline"
            value={username}
            onIonInput={(event) => setUsername(event.detail.value ?? '')}
            maxlength={40}
          />
          <IonTextarea
            label="Bio"
            labelPlacement="floating"
            fill="outline"
            value={bio}
            onIonInput={(event) => setBio(event.detail.value ?? '')}
            maxlength={160}
            autoGrow
          />
          <IonInput
            label="Status"
            labelPlacement="floating"
            fill="outline"
            value={statusMessage}
            onIonInput={(event) => setStatusMessage(event.detail.value ?? '')}
            maxlength={80}
          />
        </div>
      </IonContent>
    </IonModal>
  );
}
