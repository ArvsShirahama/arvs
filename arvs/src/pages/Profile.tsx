import { useState, useRef } from 'react';
import {
  IonPage,
  IonContent,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonInput,
  IonButton,
  IonText,
  IonSpinner,
  useIonRouter,
  useIonToast,
} from '@ionic/react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../supabaseClient';
import Avatar from '../components/Avatar';
import './Profile.css';

const Profile: React.FC = () => {
  const { profile, user, signOut, refreshProfile } = useAuth();
  const router = useIonRouter();
  const [presentToast] = useIonToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [username, setUsername] = useState(profile?.username ?? '');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const handleSave = async () => {
    if (!user) return;
    if (!username.trim() || !displayName.trim()) {
      presentToast({ message: 'Name and username are required.', duration: 2000, color: 'danger' });
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: displayName.trim(), username: username.trim() })
      .eq('id', user.id);
    setSaving(false);

    if (error) {
      presentToast({ message: error.message, duration: 3000, color: 'danger' });
    } else {
      await refreshProfile();
      presentToast({ message: 'Profile updated!', duration: 2000, color: 'success' });
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    const fileExt = file.name.split('.').pop();
    const filePath = `${user.id}/avatar.${fileExt}`;

    setUploading(true);
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, file, { upsert: true });

    if (uploadError) {
      setUploading(false);
      presentToast({ message: uploadError.message, duration: 3000, color: 'danger' });
      return;
    }

    const { data: publicUrlData } = supabase.storage
      .from('avatars')
      .getPublicUrl(filePath);

    const avatarUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`;

    await supabase
      .from('profiles')
      .update({ avatar_url: avatarUrl })
      .eq('id', user.id);

    await refreshProfile();
    setUploading(false);
    presentToast({ message: 'Avatar updated!', duration: 2000, color: 'success' });
  };

  const handleSignOut = async () => {
    await signOut();
    router.push('/login', 'root', 'replace');
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Profile</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding profile-page">
        <div className="profile-container">
          <div className="profile-avatar-section">
            <Avatar
              src={profile?.avatar_url}
              name={profile?.display_name || 'User'}
              size="large"
              onClick={() => fileInputRef.current?.click()}
            />
            <input
              type="file"
              accept="image/*"
              ref={fileInputRef}
              hidden
              onChange={handleAvatarUpload}
            />
            {uploading && <IonSpinner name="crescent" className="upload-spinner" />}
            <IonText color="medium" className="avatar-hint">
              <p>Tap to change photo</p>
            </IonText>
          </div>

          <div className="profile-form">
            <IonInput
              label="Display Name"
              labelPlacement="floating"
              fill="outline"
              value={displayName}
              onIonInput={(e) => setDisplayName(e.detail.value ?? '')}
              className="profile-input"
            />
            <IonInput
              label="Username"
              labelPlacement="floating"
              fill="outline"
              value={username}
              onIonInput={(e) => setUsername(e.detail.value ?? '')}
              className="profile-input"
            />
            <IonInput
              label="Email"
              labelPlacement="floating"
              fill="outline"
              value={user?.email ?? ''}
              readonly
              className="profile-input"
            />

            <IonButton
              expand="block"
              onClick={handleSave}
              disabled={saving}
              className="profile-save-btn"
            >
              {saving ? <IonSpinner name="crescent" /> : 'Save Changes'}
            </IonButton>

            <IonButton
              expand="block"
              fill="outline"
              color="medium"
              onClick={handleSignOut}
              className="profile-signout-btn"
            >
              Sign Out
            </IonButton>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Profile;
