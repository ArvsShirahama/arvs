import { useCallback, useEffect, useState } from 'react';
import {
  IonAlert,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonModal,
  IonPage,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  useIonToast,
} from '@ionic/react';
import { albumsOutline, playCircleOutline } from 'ionicons/icons';
import type { PostWithAuthor } from '../../../types/database';
import {
  deletePost,
  getUserPosts,
  togglePostLike,
} from '../../feed/services';
import PostCard from '../../feed/components/PostCard';
import './ProfilePostsGrid.css';

interface ProfilePostsGridProps {
  userId: string;
  currentUserId: string;
  emptyText?: string;
  onCountChange?: (count: number) => void;
}

export default function ProfilePostsGrid({
  userId,
  currentUserId,
  emptyText = 'No posts yet.',
  onCountChange,
}: ProfilePostsGridProps) {
  const [posts, setPosts] = useState<PostWithAuthor[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPost, setSelectedPost] = useState<PostWithAuthor | null>(null);
  const [busyPostId, setBusyPostId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PostWithAuthor | null>(null);
  const [presentToast] = useIonToast();

  const loadPosts = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getUserPosts(userId, currentUserId, 60);
      setPosts(rows);
      onCountChange?.(rows.length);
    } catch {
      await presentToast({
        message: 'Unable to load posts.',
        duration: 1800,
        color: 'danger',
        position: 'top',
      });
    } finally {
      setLoading(false);
    }
  }, [currentUserId, onCountChange, presentToast, userId]);

  useEffect(() => {
    void loadPosts();
  }, [loadPosts]);

  const handleLike = async (post: PostWithAuthor) => {
    if (busyPostId) return;
    setBusyPostId(post.id);
    try {
      const liked = await togglePostLike(post, currentUserId);
      const updatePost = (item: PostWithAuthor): PostWithAuthor => item.id === post.id
        ? {
          ...item,
          liked_by_me: liked,
          like_count: Math.max(0, item.like_count + (liked ? 1 : -1)),
        }
        : item;
      setPosts((current) => current.map(updatePost));
      setSelectedPost((current) => current ? updatePost(current) : current);
    } catch {
      await presentToast({
        message: 'Failed to update like.',
        duration: 1600,
        color: 'danger',
        position: 'top',
      });
    } finally {
      setBusyPostId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusyPostId(deleteTarget.id);
    try {
      await deletePost(deleteTarget);
      setPosts((current) => {
        const next = current.filter((post) => post.id !== deleteTarget.id);
        onCountChange?.(next.length);
        return next;
      });
      setSelectedPost(null);
      await presentToast({
        message: 'Post deleted.',
        duration: 1500,
        color: 'success',
        position: 'top',
      });
    } catch {
      await presentToast({
        message: 'Failed to delete post.',
        duration: 1800,
        color: 'danger',
        position: 'top',
      });
    } finally {
      setBusyPostId(null);
      setDeleteTarget(null);
    }
  };

  return (
    <section className="profile-posts-grid-section">
      <div className="profile-posts-grid-title">
        <h2>Posts</h2>
      </div>

      {loading ? (
        <div className="profile-posts-grid-loading">
          <IonSpinner name="crescent" />
        </div>
      ) : posts.length === 0 ? (
        <div className="profile-posts-grid-empty">
          <IonText color="medium">
            <p>{emptyText}</p>
          </IonText>
        </div>
      ) : (
        <div className="profile-posts-grid">
          {posts.map((post) => {
            const firstMedia = post.media[0];
            const isVideo = firstMedia?.media_type === 'video';
            const hasMultiple = post.media.length > 1;

            return (
              <button
                type="button"
                key={post.id}
                className="profile-posts-grid-item"
                onClick={() => setSelectedPost(post)}
                aria-label="Open post"
              >
                {isVideo ? (
                  <video
                    src={firstMedia.media_url}
                    muted
                    playsInline
                    preload="metadata"
                    className="profile-posts-grid-media"
                  />
                ) : (
                  <img
                    src={firstMedia?.media_url ?? post.media_url}
                    alt={post.caption || 'Post'}
                    loading="lazy"
                    className="profile-posts-grid-media"
                  />
                )}
                {isVideo && <IonIcon icon={playCircleOutline} className="profile-posts-grid-indicator" />}
                {hasMultiple && <IonIcon icon={albumsOutline} className="profile-posts-grid-indicator profile-posts-grid-indicator-left" />}
              </button>
            );
          })}
        </div>
      )}

      <IonModal isOpen={Boolean(selectedPost)} onDidDismiss={() => setSelectedPost(null)}>
        <IonPage>
          <IonHeader>
            <IonToolbar>
              <IonButtons slot="start">
                <IonButton onClick={() => setSelectedPost(null)}>Close</IonButton>
              </IonButtons>
              <IonTitle>Post</IonTitle>
            </IonToolbar>
          </IonHeader>
          <IonContent className="profile-post-viewer">
            {selectedPost && (
              <PostCard
                post={selectedPost}
                currentUserId={currentUserId}
                busy={busyPostId === selectedPost.id}
                onLike={(post) => void handleLike(post)}
                onDelete={selectedPost.user_id === currentUserId ? setDeleteTarget : undefined}
              />
            )}
          </IonContent>
        </IonPage>
      </IonModal>

      <IonAlert
        isOpen={Boolean(deleteTarget)}
        header="Delete post?"
        message="This removes the post from your profile and feed."
        buttons={[
          { text: 'Cancel', role: 'cancel', handler: () => setDeleteTarget(null) },
          { text: 'Delete', role: 'destructive', handler: () => void handleDelete() },
        ]}
        onDidDismiss={() => setDeleteTarget(null)}
      />
    </section>
  );
}
