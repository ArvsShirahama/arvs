import { IonButton, IonSpinner } from '@ionic/react';
import Avatar from '../../../components/Avatar';
import type { Profile } from '../../../types/database';
import type { FollowState } from '../../feed/services';
import './SocialProfileHeader.css';

interface SocialProfileHeaderProps {
  profile: Profile;
  followState: FollowState;
  postCount: number;
  isOwnProfile: boolean;
  busyFollow?: boolean;
  onEdit?: () => void;
  onFollowToggle?: () => void;
  onOpenFollowers: () => void;
  onOpenFollowing: () => void;
}

function getDisplayName(profile: Profile): string {
  return profile.display_name?.trim() || profile.username || 'User';
}

export default function SocialProfileHeader({
  profile,
  followState,
  postCount,
  isOwnProfile,
  busyFollow = false,
  onEdit,
  onFollowToggle,
  onOpenFollowers,
  onOpenFollowing,
}: SocialProfileHeaderProps) {
  const displayName = getDisplayName(profile);
  const bio = profile.bio?.trim();
  const status = profile.status_message?.trim();

  return (
    <section className="social-profile-header">
      <div className="social-profile-top">
        <Avatar
          src={profile.avatar_url}
          name={displayName}
          size="large"
        />

        <div className="social-profile-stats">
          <span>
            <strong>{postCount}</strong>
            Posts
          </span>
          <button type="button" onClick={onOpenFollowers}>
            <strong>{followState.followerCount}</strong>
            Followers
          </button>
          <button type="button" onClick={onOpenFollowing}>
            <strong>{followState.followingCount}</strong>
            Following
          </button>
        </div>
      </div>

      <div className="social-profile-copy">
        <h1>{displayName}</h1>
        <p className="social-profile-username">@{profile.username}</p>
        {bio && <p className="social-profile-bio">{bio}</p>}
        {status && <p className="social-profile-status">{status}</p>}
      </div>

      <div className="social-profile-actions">
        {isOwnProfile ? (
          <IonButton expand="block" fill="outline" onClick={onEdit}>
            Edit Profile
          </IonButton>
        ) : (
          <IonButton
            expand="block"
            fill={followState.isFollowing ? 'outline' : 'solid'}
            onClick={onFollowToggle}
            disabled={busyFollow}
          >
            {busyFollow ? <IonSpinner name="crescent" /> : followState.isFollowing ? 'Following' : 'Follow'}
          </IonButton>
        )}
      </div>
    </section>
  );
}
