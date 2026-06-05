import {
  IonButton,
  IonIcon,
  IonSpinner,
} from '@ionic/react';
import {
  heart,
  heartOutline,
  personAddOutline,
  personRemoveOutline,
  trashOutline,
} from 'ionicons/icons';
import { useIonRouter } from '@ionic/react';
import Avatar from '../../../components/Avatar';
import type { PostWithAuthor } from '../../../types/database';
import PostCarousel from './PostCarousel';
import './PostCard.css';

interface PostCardProps {
  post: PostWithAuthor;
  currentUserId: string;
  busy?: boolean;
  compact?: boolean;
  onLike: (post: PostWithAuthor) => void;
  onFollowToggle?: (post: PostWithAuthor) => void;
  onDelete?: (post: PostWithAuthor) => void;
}

function getAuthorName(post: PostWithAuthor): string {
  return post.author.display_name?.trim() || post.author.username || 'User';
}

function formatPostTime(value: string): string {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export default function PostCard({
  post,
  currentUserId,
  busy = false,
  compact = false,
  onLike,
  onFollowToggle,
  onDelete,
}: PostCardProps) {
  const router = useIonRouter();
  const isOwn = post.user_id === currentUserId;
  const authorName = getAuthorName(post);

  return (
    <article className={`post-card ${compact ? 'post-card-compact' : ''}`}>
      <header className="post-card-header">
        <button
          type="button"
          className="post-author-button"
          onClick={() => router.push(isOwn ? '/tabs/profile' : `/users/${post.user_id}`, 'forward')}
        >
          <Avatar
            src={post.author.avatar_url}
            name={authorName}
            size="small"
          />
          <span className="post-author-copy">
            <strong>{authorName}</strong>
            <small>@{post.author.username} - {formatPostTime(post.created_at)}</small>
          </span>
        </button>

        <div className="post-card-actions">
          {!isOwn && onFollowToggle && (
            <IonButton
              size="small"
              fill={post.is_following_author ? 'clear' : 'outline'}
              className="post-follow-btn"
              onClick={() => onFollowToggle(post)}
              disabled={busy}
            >
              <IonIcon slot="start" icon={post.is_following_author ? personRemoveOutline : personAddOutline} />
              {post.is_following_author ? 'Following' : 'Follow'}
            </IonButton>
          )}
          {isOwn && onDelete && (
            <IonButton
              size="small"
              fill="clear"
              color="medium"
              onClick={() => onDelete(post)}
              disabled={busy}
              aria-label="Delete post"
            >
              <IonIcon icon={trashOutline} />
            </IonButton>
          )}
        </div>
      </header>

      <PostCarousel
        media={post.media}
        aspectRatio={post.aspect_ratio}
        altText={post.caption || `${authorName} post`}
      />

      <footer className="post-card-footer">
        <button
          type="button"
          className={`post-like-button ${post.liked_by_me ? 'post-liked' : ''}`}
          onClick={() => onLike(post)}
          disabled={busy}
          aria-label={post.liked_by_me ? 'Unlike post' : 'Like post'}
        >
          {busy ? <IonSpinner name="dots" /> : <IonIcon icon={post.liked_by_me ? heart : heartOutline} />}
          <span>{post.like_count}</span>
        </button>

        {post.caption.trim() && (
          <p className="post-caption">
            <strong>{authorName}</strong> {post.caption}
          </p>
        )}
      </footer>
    </article>
  );
}
