import { useCallback, useEffect, useState } from 'react';
import {
  IonAlert,
  IonSpinner,
  IonText,
  useIonToast,
} from '@ionic/react';
import type { PostWithAuthor } from '../../../types/database';
import { deletePost, getUserPosts, togglePostLike } from '../services';
import PostCard from './PostCard';
import './UserPostsSection.css';

interface UserPostsSectionProps {
  userId: string;
  currentUserId: string;
  title?: string;
  emptyText?: string;
}

export default function UserPostsSection({
  userId,
  currentUserId,
  title = 'Posts',
  emptyText = 'No posts yet.',
}: UserPostsSectionProps) {
  const [posts, setPosts] = useState<PostWithAuthor[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyPostId, setBusyPostId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PostWithAuthor | null>(null);
  const [presentToast] = useIonToast();

  const loadPosts = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getUserPosts(userId, currentUserId, 24);
      setPosts(rows);
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
  }, [currentUserId, presentToast, userId]);

  useEffect(() => {
    void loadPosts();
  }, [loadPosts]);

  const handleLike = async (post: PostWithAuthor) => {
    if (busyPostId) return;
    setBusyPostId(post.id);
    try {
      const liked = await togglePostLike(post, currentUserId);
      setPosts((current) => current.map((item) => item.id === post.id
        ? {
          ...item,
          liked_by_me: liked,
          like_count: Math.max(0, item.like_count + (liked ? 1 : -1)),
        }
        : item));
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
      setPosts((current) => current.filter((post) => post.id !== deleteTarget.id));
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
    <section className="user-posts-section">
      <h2>{title}</h2>

      {loading ? (
        <div className="user-posts-loading">
          <IonSpinner name="crescent" />
        </div>
      ) : posts.length === 0 ? (
        <IonText color="medium" className="user-posts-empty">
          <p>{emptyText}</p>
        </IonText>
      ) : (
        <div className="user-posts-list">
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              currentUserId={currentUserId}
              busy={busyPostId === post.id}
              compact
              onLike={(nextPost) => void handleLike(nextPost)}
              onDelete={post.user_id === currentUserId ? setDeleteTarget : undefined}
            />
          ))}
        </div>
      )}

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
