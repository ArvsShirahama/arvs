import { useCallback, useEffect, useState } from 'react';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonModal,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  useIonRouter,
  useIonToast,
} from '@ionic/react';
import Avatar from '../../../components/Avatar';
import type { Profile } from '../../../types/database';
import { followUser, unfollowUser } from '../../feed/services';
import {
  getFollowers,
  getFollowing,
  type ProfileSocialUser,
} from '../services';
import './ProfileStatsModal.css';

interface ProfileStatsModalProps {
  isOpen: boolean;
  mode: 'followers' | 'following';
  userId: string;
  currentUserId: string;
  onDismiss: () => void;
  onFollowChanged?: () => void;
}

function getDisplayName(profile: Profile): string {
  return profile.display_name?.trim() || profile.username || 'User';
}

export default function ProfileStatsModal({
  isOpen,
  mode,
  userId,
  currentUserId,
  onDismiss,
  onFollowChanged,
}: ProfileStatsModalProps) {
  const router = useIonRouter();
  const [presentToast] = useIonToast();
  const [users, setUsers] = useState<ProfileSocialUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const title = mode === 'followers' ? 'Followers' : 'Following';

  const loadUsers = useCallback(async () => {
    if (!isOpen) return;
    setLoading(true);
    try {
      const rows = mode === 'followers'
        ? await getFollowers(userId, currentUserId)
        : await getFollowing(userId, currentUserId);
      setUsers(rows);
    } catch {
      await presentToast({
        message: `Unable to load ${title.toLowerCase()}.`,
        duration: 1800,
        color: 'danger',
        position: 'top',
      });
    } finally {
      setLoading(false);
    }
  }, [currentUserId, isOpen, mode, presentToast, title, userId]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const openProfile = (profileId: string) => {
    onDismiss();
    window.setTimeout(() => {
      router.push(profileId === currentUserId ? '/tabs/profile' : `/users/${profileId}`, 'forward');
    }, 80);
  };

  const toggleFollow = async (event: React.MouseEvent, targetUserId: string, isFollowing: boolean) => {
    event.preventDefault();
    event.stopPropagation();
    if (busyUserId || targetUserId === currentUserId) return;

    setBusyUserId(targetUserId);
    try {
      if (isFollowing) {
        await unfollowUser(currentUserId, targetUserId);
      } else {
        await followUser(currentUserId, targetUserId);
      }

      setUsers((current) => current.map((item) => item.profile.id === targetUserId
        ? { ...item, isFollowing: !isFollowing }
        : item));
      onFollowChanged?.();
    } catch {
      await presentToast({
        message: 'Unable to update follow.',
        duration: 1600,
        color: 'danger',
        position: 'top',
      });
    } finally {
      setBusyUserId(null);
    }
  };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onDismiss}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={onDismiss}>Close</IonButton>
          </IonButtons>
          <IonTitle>{title}</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="profile-stats-modal">
        {loading ? (
          <div className="profile-stats-loading">
            <IonSpinner name="crescent" />
          </div>
        ) : users.length === 0 ? (
          <div className="profile-stats-empty">
            <IonText color="medium">
              <p>No {title.toLowerCase()} yet.</p>
            </IonText>
          </div>
        ) : (
          <IonList lines="none" className="profile-stats-list">
            {users.map((item) => {
              const displayName = getDisplayName(item.profile);
              const isSelf = item.profile.id === currentUserId;
              const isBusy = busyUserId === item.profile.id;

              return (
                <IonItem
                  key={item.profile.id}
                  button
                  className="profile-stats-item"
                  onClick={() => openProfile(item.profile.id)}
                >
                  <Avatar src={item.profile.avatar_url} name={displayName} size="medium" />
                  <IonLabel className="profile-stats-label">
                    <h2>{displayName}</h2>
                    <p>@{item.profile.username}</p>
                  </IonLabel>
                  {!isSelf && (
                    <IonButton
                      slot="end"
                      size="small"
                      fill={item.isFollowing ? 'outline' : 'solid'}
                      className="profile-stats-follow-btn"
                      disabled={isBusy}
                      onClick={(event) => void toggleFollow(event, item.profile.id, item.isFollowing)}
                    >
                      {isBusy ? <IonSpinner name="crescent" /> : item.isFollowing ? 'Following' : 'Follow'}
                    </IonButton>
                  )}
                </IonItem>
              );
            })}
          </IonList>
        )}
      </IonContent>
    </IonModal>
  );
}
