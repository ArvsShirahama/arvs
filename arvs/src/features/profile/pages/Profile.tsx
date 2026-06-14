import { useCallback, useEffect, useState } from 'react';
import {
  IonButton,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonPage,
  IonSpinner,
  IonTitle,
  IonToggle,
  IonToolbar,
  useIonRouter,
} from '@ionic/react';
import { useAuth } from '../../auth/hooks';
import {
  onThemeModeChange,
  resolveThemeMode,
  setThemeMode,
} from '../../../services/themeService';
import {
  getStoredPipEnabled,
  setPipEnabled,
  onPipModeChange,
} from '../../../services/pipService';
import { getFollowState, type FollowState } from '../../feed/services';
import {
  EditProfileModal,
  ProfilePostsGrid,
  ProfileStatsModal,
  SocialProfileHeader,
} from '../components';
import './Profile.css';

const emptyFollowState: FollowState = {
  followerCount: 0,
  followingCount: 0,
  isFollowing: false,
};

const Profile: React.FC = () => {
  const { profile, user, signOut, refreshProfile } = useAuth();
  const router = useIonRouter();
  const [darkModeEnabled, setDarkModeEnabled] = useState(resolveThemeMode() === 'dark');
  const [pipEnabled, setPipEnabledState] = useState(getStoredPipEnabled());
  const [followState, setFollowState] = useState<FollowState>(emptyFollowState);
  const [postCount, setPostCount] = useState(0);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [statsMode, setStatsMode] = useState<'followers' | 'following' | null>(null);

  const loadFollowCounts = useCallback(async () => {
    if (!user?.id) return;

    try {
      const state = await getFollowState(user.id, user.id);
      setFollowState(state);
    } catch {
      setFollowState(emptyFollowState);
    }
  }, [user?.id]);

  useEffect(() => {
    void loadFollowCounts();
  }, [loadFollowCounts]);

  useEffect(() => {
    return onThemeModeChange((mode) => {
      setDarkModeEnabled(mode === 'dark');
    });
  }, []);

  useEffect(() => {
    return onPipModeChange((enabled) => {
      setPipEnabledState(enabled);
    });
  }, []);

  const handleProfileSaved = () => {
    void refreshProfile();
  };

  const handleSignOut = async () => {
    await signOut();
    router.push('/login', 'root', 'replace');
  };

  const handleThemeToggle = (checked: boolean) => {
    setDarkModeEnabled(checked);
    setThemeMode(checked ? 'dark' : 'light');
  };

  const handlePipToggle = (checked: boolean) => {
    setPipEnabledState(checked);
    setPipEnabled(checked);
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Profile</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="profile-page">
        {!profile || !user ? (
          <div className="profile-loading">
            <IonSpinner name="crescent" />
          </div>
        ) : (
          <div className="profile-shell">
            <SocialProfileHeader
              profile={profile}
              followState={followState}
              postCount={postCount}
              isOwnProfile
              onEdit={() => setShowEditProfile(true)}
              onOpenFollowers={() => setStatsMode('followers')}
              onOpenFollowing={() => setStatsMode('following')}
            />

            <section className="profile-settings-card" aria-label="Profile settings">
              <h2>Settings</h2>

              <IonItem lines="none" className="profile-settings-item">
                <IonLabel>
                  <h3>Dark Mode</h3>
                  <p>Switch the app appearance.</p>
                </IonLabel>
                <IonToggle
                  checked={darkModeEnabled}
                  onIonChange={(event) => handleThemeToggle(event.detail.checked)}
                  aria-label="Toggle dark mode"
                />
              </IonItem>

              <IonItem lines="none" className="profile-settings-item">
                <IonLabel>
                  <h3>Picture-in-Picture</h3>
                  <p>Keep video calls floating when supported.</p>
                </IonLabel>
                <IonToggle
                  checked={pipEnabled}
                  onIonChange={(event) => handlePipToggle(event.detail.checked)}
                  aria-label="Toggle picture in picture mode"
                />
              </IonItem>

              <IonButton
                expand="block"
                fill="outline"
                color="medium"
                onClick={() => void handleSignOut()}
                className="profile-signout-btn"
              >
                Sign Out
              </IonButton>
            </section>

            <ProfilePostsGrid
              userId={user.id}
              currentUserId={user.id}
              emptyText="You have not posted yet."
              onCountChange={setPostCount}
            />

            <EditProfileModal
              isOpen={showEditProfile}
              profile={profile}
              userId={user.id}
              onDismiss={() => setShowEditProfile(false)}
              onSaved={handleProfileSaved}
            />

            <ProfileStatsModal
              isOpen={Boolean(statsMode)}
              mode={statsMode ?? 'followers'}
              userId={user.id}
              currentUserId={user.id}
              onDismiss={() => setStatsMode(null)}
              onFollowChanged={() => void loadFollowCounts()}
            />
          </div>
        )}
      </IonContent>
    </IonPage>
  );
};

export default Profile;
