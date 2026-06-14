import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IonAlert,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInfiniteScroll,
  IonInfiniteScrollContent,
  IonPage,
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  type InfiniteScrollCustomEvent,
  type RefresherCustomEvent,
  useIonToast,
} from '@ionic/react';
import { add, imagesOutline, searchOutline } from 'ionicons/icons';
import { useAuth } from '../../auth/hooks';
import { supabase } from '../../../supabaseClient';
import type { Post, PostWithAuthor } from '../../../types/database';
import { CreatePostModal, PostCard, UserSearchModal } from '../components';
import {
  deletePost,
  followUser,
  getFeedPage,
  getPostById,
  togglePostLike,
  unfollowUser,
} from '../services';
import './Feed.css';

const FEED_PAGE_SIZE = 12;

export default function Feed() {
  const { user } = useAuth();
  const [posts, setPosts] = useState<PostWithAuthor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [showCreatePost, setShowCreatePost] = useState(false);
  const [showUserSearch, setShowUserSearch] = useState(false);
  const [busyPostId, setBusyPostId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PostWithAuthor | null>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [presentToast] = useIonToast();

  const loadFirstPage = useCallback(async (showLoader = true) => {
    if (!user) return;
    if (showLoader) setLoading(true);
    try {
      const page = await getFeedPage(user.id, { beforeCreatedAt: null, limit: FEED_PAGE_SIZE });
      setPosts(page.posts);
      setCursor(page.oldestCursor);
      setHasMore(page.hasMore);
    } catch {
      await presentToast({
        message: 'Unable to load feed.',
        duration: 2200,
        color: 'danger',
        position: 'top',
      });
    } finally {
      if (showLoader) setLoading(false);
    }
  }, [presentToast, user]);

  useEffect(() => {
    void loadFirstPage(true);
  }, [loadFirstPage]);

  useEffect(() => {
    if (!user) return;

    const scheduleRefresh = () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
      refreshTimeoutRef.current = setTimeout(() => {
        void loadFirstPage(false);
      }, 500);
    };

    const channel = supabase
      .channel('public-feed-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'post_likes' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'follows' }, scheduleRefresh)
      .subscribe();

    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
      void supabase.removeChannel(channel);
    };
  }, [loadFirstPage, user]);

  const loadMore = async (event: InfiniteScrollCustomEvent) => {
    if (!user || loadingMore || !hasMore || !cursor) {
      await event.target.complete();
      return;
    }

    setLoadingMore(true);
    try {
      const page = await getFeedPage(user.id, { beforeCreatedAt: cursor, limit: FEED_PAGE_SIZE });
      setPosts((current) => {
        const ids = new Set(current.map((post) => post.id));
        return [...current, ...page.posts.filter((post) => !ids.has(post.id))];
      });
      setCursor(page.oldestCursor);
      setHasMore(page.hasMore);
    } finally {
      setLoadingMore(false);
      await event.target.complete();
    }
  };

  const handleRefresh = (event: RefresherCustomEvent) => {
    void loadFirstPage(false).finally(() => event.detail.complete());
  };

  const handleCreated = async (post: Post) => {
    if (!user) return;
    const enriched = await getPostById(post.id, user.id);
    if (enriched) {
      setPosts((current) => [enriched, ...current.filter((item) => item.id !== enriched.id)]);
    } else {
      void loadFirstPage(false);
    }
  };

  const handleLike = async (post: PostWithAuthor) => {
    if (!user || busyPostId) return;
    setBusyPostId(post.id);
    try {
      const liked = await togglePostLike(post, user.id);
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

  const handleFollowToggle = async (post: PostWithAuthor) => {
    if (!user || busyPostId || post.user_id === user.id) return;
    setBusyPostId(post.id);
    try {
      if (post.is_following_author) {
        await unfollowUser(user.id, post.user_id);
      } else {
        await followUser(user.id, post.user_id);
      }
      const nextFollowing = !post.is_following_author;
      setPosts((current) => current.map((item) => item.user_id === post.user_id
        ? { ...item, is_following_author: nextFollowing }
        : item));
    } catch {
      await presentToast({
        message: 'Failed to update follow.',
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
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Feed</IonTitle>
          <IonButtons slot="end">
            <IonButton
              fill="clear"
              onClick={() => setShowUserSearch(true)}
              aria-label="Search users"
            >
              <IonIcon icon={searchOutline} />
            </IonButton>
            <IonButton
              fill="clear"
              onClick={() => setShowCreatePost(true)}
              aria-label="Create post"
            >
              <IonIcon icon={add} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="feed-page">
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        {loading ? (
          <div className="feed-loading">
            <IonSpinner name="crescent" />
          </div>
        ) : posts.length === 0 ? (
          <div className="feed-empty">
            <IonIcon icon={imagesOutline} />
            <IonText color="medium">
              <p>No posts yet.</p>
            </IonText>
            <IonButton onClick={() => setShowCreatePost(true)}>Create Post</IonButton>
          </div>
        ) : (
          <div className="feed-list">
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                currentUserId={user?.id ?? ''}
                busy={busyPostId === post.id}
                onLike={(nextPost) => void handleLike(nextPost)}
                onFollowToggle={(nextPost) => void handleFollowToggle(nextPost)}
                onDelete={post.user_id === user?.id ? setDeleteTarget : undefined}
              />
            ))}
          </div>
        )}

        <IonInfiniteScroll
          disabled={!hasMore}
          onIonInfinite={(event) => void loadMore(event)}
        >
          <IonInfiniteScrollContent loadingSpinner="crescent" />
        </IonInfiniteScroll>

        {user && (
          <CreatePostModal
            isOpen={showCreatePost}
            userId={user.id}
            onDismiss={() => setShowCreatePost(false)}
            onCreated={(post) => void handleCreated(post)}
          />
        )}

        {user && (
          <UserSearchModal
            isOpen={showUserSearch}
            currentUserId={user.id}
            onDismiss={() => setShowUserSearch(false)}
          />
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
      </IonContent>
    </IonPage>
  );
}
