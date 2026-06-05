import { useCallback, useEffect, useState } from 'react';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonPage,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  useIonToast,
} from '@ionic/react';
import { useParams } from 'react-router-dom';
import Avatar from '../../../components/Avatar';
import { useAuth } from '../../auth/hooks';
import { supabase } from '../../../supabaseClient';
import type { Profile } from '../../../types/database';
import {
  followUser,
  getFollowState,
  type FollowState,
  unfollowUser,
} from '../services';
import { UserPostsSection } from '../components';
import './UserProfile.css';

interface RouteParams {
  userId: string;
}

function getDisplayName(profile: Profile | null): string {
  return profile?.display_name?.trim() || profile?.username || 'User';
}

export default function UserProfile() {
  const { userId } = useParams<RouteParams>();
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [followState, setFollowState] = useState<FollowState>({
    followerCount: 0,
    followingCount: 0,
    isFollowing: false,
  });
  const [loading, setLoading] = useState(true);
  const [busyFollow, setBusyFollow] = useState(false);
  const [presentToast] = useIonToast();

  const isOwnProfile = user?.id === userId;

  const loadProfile = useCallback(async () => {
    if (!user?.id || !userId) return;
    setLoading(true);
    try {
      const [{ data, error }, state] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
        getFollowState(user.id, userId),
      ]);
      if (error) throw error;
      setProfile((data as Profile | null) ?? null);
      setFollowState(state);
    } catch {
      await presentToast({
        message: 'Unable to load profile.',
        duration: 1800,
        color: 'danger',
        position: 'top',
      });
    } finally {
      setLoading(false);
    }
  }, [presentToast, user?.id, userId]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const handleFollowToggle = async () => {
    if (!user || isOwnProfile || busyFollow) return;
    setBusyFollow(true);
    try {
      if (followState.isFollowing) {
        await unfollowUser(user.id, userId);
      } else {
        await followUser(user.id, userId);
      }
      setFollowState((current) => ({
        ...current,
        isFollowing: !current.isFollowing,
        followerCount: Math.max(0, current.followerCount + (current.isFollowing ? -1 : 1)),
      }));
    } catch {
      await presentToast({
        message: 'Failed to update follow.',
        duration: 1600,
        color: 'danger',
        position: 'top',
      });
    } finally {
      setBusyFollow(false);
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/tabs/feed" text="" />
          </IonButtons>
          <IonTitle>{profile ? getDisplayName(profile) : 'Profile'}</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="user-profile-page">
        {loading ? (
          <div className="user-profile-loading">
            <IonSpinner name="crescent" />
          </div>
        ) : !profile ? (
          <div className="user-profile-empty">
            <IonText color="medium">
              <p>User not found.</p>
            </IonText>
          </div>
        ) : (
          <div className="user-profile-shell">
            <section className="user-profile-card">
              <Avatar
                src={profile.avatar_url}
                name={getDisplayName(profile)}
                size="large"
              />
              <h1>{getDisplayName(profile)}</h1>
              <p>@{profile.username}</p>
              <div className="user-profile-stats">
                <span><strong>{followState.followerCount}</strong> Followers</span>
                <span><strong>{followState.followingCount}</strong> Following</span>
              </div>
              {!isOwnProfile && (
                <IonButton
                  expand="block"
                  fill={followState.isFollowing ? 'outline' : 'solid'}
                  onClick={() => void handleFollowToggle()}
                  disabled={busyFollow}
                >
                  {busyFollow ? <IonSpinner name="crescent" /> : followState.isFollowing ? 'Following' : 'Follow'}
                </IonButton>
              )}
            </section>

            {user && (
              <UserPostsSection
                userId={profile.id}
                currentUserId={user.id}
                title="Posts"
                emptyText="No posts yet."
              />
            )}
          </div>
        )}
      </IonContent>
    </IonPage>
  );
}
