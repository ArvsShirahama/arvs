import { useCallback, useEffect, useState } from 'react';
import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonPage,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  useIonRouter,
  useIonToast,
} from '@ionic/react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../../auth/hooks';
import { supabase } from '../../../supabaseClient';
import type { Profile } from '../../../types/database';
import {
  followUser,
  getFollowState,
  type FollowState,
  unfollowUser,
} from '../services';
import {
  ProfilePostsGrid,
  ProfileStatsModal,
  SocialProfileHeader,
} from '../../profile/components';
import './UserProfile.css';

interface RouteParams {
  userId: string;
}

const emptyFollowState: FollowState = {
  followerCount: 0,
  followingCount: 0,
  isFollowing: false,
};

function getDisplayName(profile: Profile | null): string {
  return profile?.display_name?.trim() || profile?.username || 'Profile';
}

export default function UserProfile() {
  const { userId } = useParams<RouteParams>();
  const { user } = useAuth();
  const router = useIonRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [followState, setFollowState] = useState<FollowState>(emptyFollowState);
  const [postCount, setPostCount] = useState(0);
  const [statsMode, setStatsMode] = useState<'followers' | 'following' | null>(null);
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
          <IonTitle>{getDisplayName(profile)}</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="user-profile-page">
        {loading ? (
          <div className="user-profile-loading">
            <IonSpinner name="crescent" />
          </div>
        ) : !profile || !user ? (
          <div className="user-profile-empty">
            <IonText color="medium">
              <p>User not found.</p>
            </IonText>
          </div>
        ) : (
          <div className="user-profile-shell">
            <SocialProfileHeader
              profile={profile}
              followState={followState}
              postCount={postCount}
              isOwnProfile={isOwnProfile}
              busyFollow={busyFollow}
              onEdit={() => router.push('/tabs/profile', 'root')}
              onFollowToggle={() => void handleFollowToggle()}
              onOpenFollowers={() => setStatsMode('followers')}
              onOpenFollowing={() => setStatsMode('following')}
            />

            <ProfilePostsGrid
              userId={profile.id}
              currentUserId={user.id}
              emptyText="No posts yet."
              onCountChange={setPostCount}
            />

            <ProfileStatsModal
              isOpen={Boolean(statsMode)}
              mode={statsMode ?? 'followers'}
              userId={profile.id}
              currentUserId={user.id}
              onDismiss={() => setStatsMode(null)}
              onFollowChanged={() => void loadProfile()}
            />
          </div>
        )}
      </IonContent>
    </IonPage>
  );
}
