import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonModal,
  IonPage,
  IonSearchbar,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  useIonRouter,
  useIonToast,
} from '@ionic/react';
import Avatar from '../../../components/Avatar';
import type { Profile } from '../../../types/database';
import {
  followUser,
  searchUsers,
  unfollowUser,
} from '../services';
import { supabase } from '../../../supabaseClient';
import './UserSearchModal.css';

interface UserSearchModalProps {
  isOpen: boolean;
  currentUserId: string;
  onDismiss: () => void;
}

function getDisplayName(profile: Profile): string {
  return profile.display_name?.trim() || profile.username || 'User';
}

export default function UserSearchModal({
  isOpen,
  currentUserId,
  onDismiss,
}: UserSearchModalProps) {
  const router = useIonRouter();
  const [presentToast] = useIonToast();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [followingIds, setFollowingIds] = useState<Set<string>>(() => new Set());
  const [searching, setSearching] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const searchRunRef = useRef(0);
  const pendingRouteRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setResults([]);
      setFollowingIds(new Set());
      setSearching(false);
      setBusyUserId(null);
    }
  }, [isOpen]);

  const loadFollowStateForResults = useCallback(async (profiles: Profile[]) => {
    const ids = profiles.map((profile) => profile.id);
    if (ids.length === 0) {
      setFollowingIds(new Set());
      return;
    }

    const { data, error } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', currentUserId)
      .in('following_id', ids);

    if (error) {
      setFollowingIds(new Set());
      return;
    }

    setFollowingIds(new Set(((data ?? []) as { following_id: string }[]).map((row) => row.following_id)));
  }, [currentUserId]);

  useEffect(() => {
    if (!isOpen) return;

    const trimmedQuery = query.trim();
    const runId = searchRunRef.current + 1;
    searchRunRef.current = runId;

    if (trimmedQuery.length < 2) {
      setResults([]);
      setFollowingIds(new Set());
      setSearching(false);
      return;
    }

    setSearching(true);
    const timeout = setTimeout(async () => {
      try {
        const profiles = await searchUsers(trimmedQuery, currentUserId);
        if (searchRunRef.current !== runId) return;

        setResults(profiles);
        await loadFollowStateForResults(profiles);
      } catch {
        if (searchRunRef.current !== runId) return;
        await presentToast({
          message: 'Unable to search users.',
          duration: 1800,
          color: 'danger',
          position: 'top',
        });
      } finally {
        if (searchRunRef.current === runId) {
          setSearching(false);
        }
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [currentUserId, isOpen, loadFollowStateForResults, presentToast, query]);

  const openProfile = (profileId: string) => {
    pendingRouteRef.current = `/users/${profileId}`;
    onDismiss();
  };

  const handleDidDismiss = () => {
    onDismiss();
    const pendingRoute = pendingRouteRef.current;
    pendingRouteRef.current = null;

    if (pendingRoute) {
      window.setTimeout(() => {
        router.push(pendingRoute, 'forward');
      }, 80);
    }
  };

  const toggleFollow = async (event: React.MouseEvent, profileId: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (busyUserId) return;

    setBusyUserId(profileId);
    const currentlyFollowing = followingIds.has(profileId);
    try {
      if (currentlyFollowing) {
        await unfollowUser(currentUserId, profileId);
      } else {
        await followUser(currentUserId, profileId);
      }

      setFollowingIds((current) => {
        const next = new Set(current);
        if (currentlyFollowing) {
          next.delete(profileId);
        } else {
          next.add(profileId);
        }
        return next;
      });
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

  const showEmptyState = !searching && query.trim().length >= 2 && results.length === 0;

  return (
    <IonModal isOpen={isOpen} onDidDismiss={handleDidDismiss}>
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonButtons slot="start">
              <IonButton onClick={onDismiss}>Cancel</IonButton>
            </IonButtons>
            <IonTitle>Search Users</IonTitle>
          </IonToolbar>
        </IonHeader>

        <IonContent className="user-search-modal">
          <IonSearchbar
            value={query}
            onIonInput={(event) => setQuery(event.detail.value ?? '')}
            placeholder="Search username or name"
            className="user-search-input"
            autoFocus
          />

          {query.trim().length < 2 && (
            <div className="user-search-empty">
              <IonText color="medium">
                <p>Search people by username or name.</p>
              </IonText>
            </div>
          )}

          {searching && (
            <div className="user-search-loading">
              <IonSpinner name="crescent" />
            </div>
          )}

          {showEmptyState && (
            <div className="user-search-empty">
              <IonText color="medium">
                <p>No users found.</p>
              </IonText>
            </div>
          )}

          <IonList lines="none" className="user-search-list">
            {results.map((profile) => {
              const displayName = getDisplayName(profile);
              const isFollowing = followingIds.has(profile.id);
              const isBusy = busyUserId === profile.id;

              return (
                <IonItem
                  key={profile.id}
                  button
                  className="user-search-item"
                  onClick={() => openProfile(profile.id)}
                >
                  <Avatar
                    src={profile.avatar_url}
                    name={displayName}
                    size="medium"
                  />
                  <IonLabel className="user-search-label">
                    <h2>{displayName}</h2>
                    <p>@{profile.username}</p>
                  </IonLabel>
                  <IonButton
                    slot="end"
                    size="small"
                    fill={isFollowing ? 'outline' : 'solid'}
                    className="user-search-follow-btn"
                    disabled={isBusy}
                    onClick={(event) => void toggleFollow(event, profile.id)}
                  >
                    {isBusy ? <IonSpinner name="crescent" /> : isFollowing ? 'Following' : 'Follow'}
                  </IonButton>
                </IonItem>
              );
            })}
          </IonList>
        </IonContent>
      </IonPage>
    </IonModal>
  );
}
