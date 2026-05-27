import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IonActionSheet,
  IonAlert,
  IonContent,
  IonFab,
  IonFabButton,
  IonHeader,
  IonIcon,
  IonInfiniteScroll,
  IonInfiniteScrollContent,
  IonList,
  IonPage,
  IonSearchbar,
  IonSkeletonText,
  IonText,
  IonTitle,
  IonToolbar,
  useIonRouter,
  useIonToast,
} from '@ionic/react';
import { add, eyeOutline, imageOutline, trashOutline, videocamOutline } from 'ionicons/icons';
import ChatListItem from '../components/ChatListItem';
import NewChatModal from '../components/NewChatModal';
import Avatar from '../components/Avatar';
import StoryViewerModal, { type StoryViewerItem } from '../components/StoryViewerModal';
import { useAuth } from '../hooks/useAuth';
import {
  getConversationSummary,
  getSummaries,
  upsertSummaryFromRealtime,
} from '../services/chatService';
import { supabase } from '../supabaseClient';
import type { ConversationWithDetails, Message, Story, StoryMediaType } from '../types/database';
import './ChatList.css';

const SUMMARY_PAGE_SIZE = 30;

type ActiveStory = Omit<Story, 'caption' | 'media_type'> & {
  caption: string | null;
  media_type: StoryMediaType;
};

interface StoryViewerContext {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  isOwn: boolean;
}

const ChatList: React.FC = () => {
  const { user, profile, onlineUsers } = useAuth();
  const router = useIonRouter();
  const [presentToast] = useIonToast();
  const [conversations, setConversations] = useState<ConversationWithDetails[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [showNewChat, setShowNewChat] = useState(false);
  const [showStorySheet, setShowStorySheet] = useState(false);
  const [showMyStorySheet, setShowMyStorySheet] = useState(false);
  const [confirmDeleteAllStories, setConfirmDeleteAllStories] = useState(false);
  const [uploadingStory, setUploadingStory] = useState(false);
  const [storiesByUserId, setStoriesByUserId] = useState<Record<string, ActiveStory[]>>({});
  const [storyViewerContext, setStoryViewerContext] = useState<StoryViewerContext | null>(null);

  // File input refs for story upload
  const storyImageInputRef = useRef<HTMLInputElement>(null);
  const storyVideoInputRef = useRef<HTMLInputElement>(null);

  // Debounce ref for real-time updates
  const updateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingUpdatesRef = useRef<Set<string>>(new Set());

  // Filter conversations locally based on search query
  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const query = searchQuery.toLowerCase().trim();
    return conversations.filter((conv) => {
      const displayName = conv.other_user?.display_name?.toLowerCase() || '';
      const username = conv.other_user?.username?.toLowerCase() || '';
      return displayName.includes(query) || username.includes(query);
    });
  }, [conversations, searchQuery]);

  // Find online users that we have a conversation with
  const activeUsers = useMemo(() => {
    if (!user) return [];
    return conversations.filter((conv) => conv.other_user && onlineUsers.has(conv.other_user.id));
  }, [conversations, onlineUsers, user]);

  const ownActiveStories = useMemo(() => {
    if (!user) return [];
    return storiesByUserId[user.id] || [];
  }, [storiesByUserId, user]);

  const viewerStories = useMemo<StoryViewerItem[]>(() => {
    if (!storyViewerContext) return [];
    return (storiesByUserId[storyViewerContext.userId] || []).map((story) => ({
      id: story.id,
      media_url: story.media_url,
      media_type: story.media_type,
      created_at: story.created_at,
      caption: story.caption,
    }));
  }, [storiesByUserId, storyViewerContext]);

  const fetchActiveStories = useCallback(async (targetUserIds: string[]) => {
    const uniqueUserIds = Array.from(new Set(targetUserIds.filter(Boolean)));
    if (uniqueUserIds.length === 0) {
      setStoriesByUserId({});
      return;
    }

    const { data, error } = await supabase
      .from('stories')
      .select('id,user_id,media_url,media_path,media_type,caption,created_at,expires_at')
      .in('user_id', uniqueUserIds)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[ChatList] Failed to fetch stories for avatars:', error);
      return;
    }

    const nextStories: Record<string, ActiveStory[]> = {};
    for (const story of (data || []) as ActiveStory[]) {
      if (!nextStories[story.user_id]) nextStories[story.user_id] = [];
      nextStories[story.user_id].push(story);
    }

    setStoriesByUserId(nextStories);
  }, []);

  const openStoryViewer = useCallback((
    targetUserId: string,
    displayName: string,
    avatarUrl: string | null,
    isOwn = false
  ) => {
    const userStories = storiesByUserId[targetUserId] || [];
    if (userStories.length === 0) return;

    setStoryViewerContext({
      userId: targetUserId,
      displayName,
      avatarUrl,
      isOwn,
    });
  }, [storiesByUserId]);

  const refreshStoriesForListUsers = useCallback(async () => {
    if (!user) return;
    const targetUserIds = Array.from(
      new Set([
        ...conversations.map((conv) => conv.other_user.id),
        user.id,
      ])
    );
    await fetchActiveStories(targetUserIds);
  }, [conversations, fetchActiveStories, user]);

  const cleanupExpiredOwnStories = useCallback(async () => {
    if (!user) return;

    const nowIso = new Date().toISOString();
    const { data: expiredStories, error: fetchError } = await supabase
      .from('stories')
      .select('id,media_path')
      .eq('user_id', user.id)
      .lte('expires_at', nowIso);

    if (fetchError || !expiredStories || expiredStories.length === 0) {
      return;
    }

    const expiredIds = expiredStories.map((story) => story.id);
    const expiredPaths = expiredStories
      .map((story) => story.media_path)
      .filter((path): path is string => Boolean(path));

    await supabase
      .from('stories')
      .delete()
      .in('id', expiredIds)
      .eq('user_id', user.id);

    if (expiredPaths.length > 0) {
      await supabase.storage.from('stories').remove(expiredPaths);
    }
  }, [user]);

  const handleDeleteStory = useCallback(async (storyId: string) => {
    if (!user) return;
    const ownStories = storiesByUserId[user.id] || [];
    const story = ownStories.find((item) => item.id === storyId);
    if (!story) return;

    const { error: deleteError } = await supabase
      .from('stories')
      .delete()
      .eq('id', story.id)
      .eq('user_id', user.id);

    if (deleteError) {
      presentToast({ message: 'Failed to delete story.', color: 'danger', duration: 2200, position: 'top' });
      return;
    }

    if (story.media_path) {
      await supabase.storage.from('stories').remove([story.media_path]);
    }

    setStoriesByUserId((prev) => {
      const current = prev[user.id] || [];
      const remaining = current.filter((item) => item.id !== story.id);
      return {
        ...prev,
        [user.id]: remaining,
      };
    });

    presentToast({ message: 'Story deleted.', color: 'success', duration: 1500, position: 'top' });
  }, [presentToast, storiesByUserId, user]);

  const handleDeleteAllStories = useCallback(async () => {
    if (!user || ownActiveStories.length === 0) return;

    const idsToDelete = ownActiveStories.map((story) => story.id);
    const pathsToDelete = ownActiveStories
      .map((story) => story.media_path)
      .filter((path): path is string => Boolean(path));

    const { error } = await supabase
      .from('stories')
      .delete()
      .in('id', idsToDelete)
      .eq('user_id', user.id);

    if (error) {
      presentToast({ message: 'Failed to delete stories.', color: 'danger', duration: 2200, position: 'top' });
      return;
    }

    if (pathsToDelete.length > 0) {
      await supabase.storage.from('stories').remove(pathsToDelete);
    }

    setStoriesByUserId((prev) => ({
      ...prev,
      [user.id]: [],
    }));
    setStoryViewerContext((prev) => (prev?.isOwn ? null : prev));
    presentToast({ message: 'All active stories deleted.', color: 'success', duration: 1600, position: 'top' });
  }, [ownActiveStories, presentToast, user]);

  // Story upload handler
  const handleStoryFileSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>, mediaType: 'image' | 'video') => {
    const file = event.target.files?.[0];
    if (!file || !user) return;
    event.target.value = '';

    const maxSize = mediaType === 'image' ? 10 * 1024 * 1024 : 50 * 1024 * 1024;
    if (file.size > maxSize) {
      presentToast({ message: `File too large. Max: ${mediaType === 'image' ? '10 MB' : '50 MB'}`, color: 'warning', duration: 2200, position: 'top' });
      return;
    }

    setUploadingStory(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || (mediaType === 'image' ? 'jpg' : 'mp4');
      const filePath = `${user.id}/${Date.now()}-story.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('stories')
        .upload(filePath, file, { contentType: file.type || undefined });

      if (uploadError) {
        presentToast({ message: 'Failed to upload story.', color: 'danger', duration: 2200, position: 'top' });
        setUploadingStory(false);
        return;
      }

      const { data: urlData } = supabase.storage.from('stories').getPublicUrl(filePath);

      const { error: insertError } = await supabase.from('stories').insert({
        user_id: user.id,
        media_url: urlData.publicUrl,
        media_path: filePath,
        media_type: mediaType,
        expires_at: new Date(Date.now() + (24 * 60 * 60 * 1000)).toISOString(),
      });

      if (insertError) {
        presentToast({ message: 'Failed to save story.', color: 'danger', duration: 2200, position: 'top' });
      } else {
        presentToast({ message: 'Story uploaded!', color: 'success', duration: 1500, position: 'top' });
        await refreshStoriesForListUsers();
      }
    } catch {
      presentToast({ message: 'Something went wrong.', color: 'danger', duration: 2200, position: 'top' });
    } finally {
      setUploadingStory(false);
    }
  }, [presentToast, refreshStoriesForListUsers, user]);

  const fetchConversations = useCallback(async (reset = false) => {
    if (!user) return;

    if (reset) {
      setLoading(true);
      const firstPage = await getSummaries(user.id, SUMMARY_PAGE_SIZE, null);
      setConversations(firstPage);
      setHasMore(firstPage.length === SUMMARY_PAGE_SIZE);
      setNextCursor(firstPage.length > 0 ? firstPage[firstPage.length - 1].updated_at : null);
      setLoading(false);
      return;
    }

    if (loadingMore || !hasMore || !nextCursor) return;

    setLoadingMore(true);
    try {
      const nextPage = await getSummaries(user.id, SUMMARY_PAGE_SIZE, nextCursor);
      setConversations((prev) => {
        const ids = new Set(prev.map((item) => item.id));
        const deduped = nextPage.filter((item) => !ids.has(item.id));
        return [...prev, ...deduped];
      });
      setHasMore(nextPage.length === SUMMARY_PAGE_SIZE);
      setNextCursor(nextPage.length > 0 ? nextPage[nextPage.length - 1].updated_at : nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }, [user, hasMore, loadingMore, nextCursor]);

  useEffect(() => {
    fetchConversations(true);
  }, [fetchConversations]);

  useEffect(() => {
    if (!user) return;
    void cleanupExpiredOwnStories();
  }, [cleanupExpiredOwnStories, user]);

  useEffect(() => {
    if (!user) return;

    const conversationUserIds = [
      ...conversations
        .map((conv) => conv.other_user?.id)
        .filter((id): id is string => Boolean(id)),
      user.id,
    ];

    void fetchActiveStories(conversationUserIds);
  }, [conversations, fetchActiveStories, user]);

  useEffect(() => {
    if (!user) return;

    // Debounced function to batch real-time updates
    const debouncedUpdate = (conversationId: string) => {
      // Add to pending updates
      pendingUpdatesRef.current.add(conversationId);

      // Clear existing timeout
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }

      // Set new timeout - batch updates within 1 second
      updateTimeoutRef.current = setTimeout(async () => {
        const idsToRefresh = Array.from(pendingUpdatesRef.current);
        pendingUpdatesRef.current.clear();

        // Refresh all pending conversations
        for (const convId of idsToRefresh) {
          const summary = await getConversationSummary(convId, user.id);
          if (summary) {
            setConversations((prev) => upsertSummaryFromRealtime(prev, summary));
          }
        }
      }, 1000);
    };

    const channel = supabase
      .channel('chat-list-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        async (payload) => {
          const message = payload.new as Message;
          debouncedUpdate(message.conversation_id);
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        async (payload) => {
          const message = payload.new as Message;
          debouncedUpdate(message.conversation_id);
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversation_preferences',
          filter: `user_id=eq.${user.id}`,
        },
        async (payload) => {
          const conversationId = (payload.new as { conversation_id?: string } | null)?.conversation_id
            ?? (payload.old as { conversation_id?: string } | null)?.conversation_id;
          if (!conversationId) return;

          debouncedUpdate(conversationId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      // Cleanup timeout on unmount
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const relevantUserIds = new Set<string>([
      user.id,
      ...conversations.map((conv) => conv.other_user.id),
    ]);

    const channel = supabase
      .channel(`stories-realtime-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'stories' },
        async (payload) => {
          const changedUserId =
            (payload.new as { user_id?: string } | null)?.user_id
            ?? (payload.old as { user_id?: string } | null)?.user_id;
          if (!changedUserId || !relevantUserIds.has(changedUserId)) return;
          await refreshStoriesForListUsers();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversations, refreshStoriesForListUsers, user]);

  useEffect(() => {
    if (!storyViewerContext) return;
    if (viewerStories.length === 0) {
      setStoryViewerContext(null);
    }
  }, [storyViewerContext, viewerStories.length]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Chats</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="chatlist-page">
        {/* Searchbar */}
        <IonSearchbar
          value={searchQuery}
          onIonInput={(e) => setSearchQuery(e.detail.value ?? '')}
          placeholder="Search display name or username..."
          className="chatlist-searchbar"
        />

        {/* Stories & Active Users Row */}
        {!loading && (
          <div className="active-users-section">
            <div className="active-users-header">
              <span className="active-users-title">Stories</span>
              {activeUsers.length > 0 && (
                <span className="active-users-count">{activeUsers.length} active</span>
              )}
            </div>
            <div className="active-users-scroll">
              {/* My Story — current user's avatar with "+" button */}
              <div
                className="active-user-item my-story-item"
                onClick={() => {
                  if (ownActiveStories.length > 0) {
                    setShowMyStorySheet(true);
                    return;
                  }
                  setShowStorySheet(true);
                }}
              >
                <div className="active-user-avatar-container">
                  <Avatar
                    src={profile?.avatar_url}
                    name={profile?.display_name || 'Me'}
                    hasStoryRing={ownActiveStories.length > 0}
                  />
                  <span className={`my-story-add-btn ${uploadingStory ? 'my-story-uploading' : ''}`}>
                    {uploadingStory ? (
                      <span className="my-story-add-loading" aria-hidden="true">…</span>
                    ) : (
                      <IonIcon icon={add} className="my-story-add-icon" aria-hidden="true" />
                    )}
                  </span>
                </div>
                <span className="active-user-name">{ownActiveStories.length > 0 ? 'My Story' : 'Create Story'}</span>
              </div>

              {/* Divider between My Story and active users */}
              {activeUsers.length > 0 && <div className="my-story-divider" />}

              {/* Active online users */}
              {activeUsers.map((conv) => {
                const displayName = conv.other_user?.display_name || 'User';
                const firstName = displayName.split(' ')[0];
                const userStories = storiesByUserId[conv.other_user.id] || [];
                return (
                  <div
                    key={conv.id}
                    className="active-user-item"
                    onClick={() => router.push(`/chat/${conv.id}`, 'forward')}
                  >
                    <div
                      className="active-user-avatar-container"
                      onClick={userStories.length > 0 ? (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        openStoryViewer(conv.other_user.id, displayName, conv.other_user?.avatar_url || null);
                      } : undefined}
                    >
                      <Avatar
                        src={conv.other_user?.avatar_url}
                        name={displayName}
                        showStatus={true}
                        isOnline={true}
                        hasStoryRing={userStories.length > 0}
                      />
                    </div>
                    <span className="active-user-name">{firstName}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {loading ? (
          <IonList lines="none" className="chatlist-list">
            {[...Array(6)].map((_, idx) => (
              <div key={idx} className="chatlist-skeleton-row">
                <IonSkeletonText animated className="chatlist-skeleton-avatar" />
                <div className="chatlist-skeleton-body">
                  <IonSkeletonText animated className="chatlist-skeleton-line-lg" />
                  <IonSkeletonText animated className="chatlist-skeleton-line-sm" />
                </div>
              </div>
            ))}
          </IonList>
        ) : conversations.length === 0 ? (
          <div className="chatlist-empty">
            <IonText color="medium">
              <p>No conversations yet</p>
              <p className="chatlist-empty-hint">Tap + to start chatting</p>
            </IonText>
          </div>
        ) : filteredConversations.length === 0 ? (
          <div className="chatlist-empty">
            <IonText color="medium">
              <p>No results found for "{searchQuery}"</p>
            </IonText>
          </div>
        ) : (
          <IonList lines="none" className="chatlist-list">
            {filteredConversations.map((conv) => {
              const userStories = storiesByUserId[conv.other_user.id] || [];
              const displayName = conv.preference?.peer_nickname?.trim()
                || conv.other_user.display_name
                || conv.other_user.username;
              return (
              <ChatListItem
                key={conv.id}
                conversation={conv}
                currentUserId={user!.id}
                isOnline={onlineUsers.has(conv.other_user.id)}
                hasStory={userStories.length > 0}
                onAvatarClick={userStories.length > 0
                  ? () => openStoryViewer(conv.other_user.id, displayName, conv.other_user.avatar_url)
                  : undefined}
              />
              );
            })}
          </IonList>
        )}

        <IonInfiniteScroll
          disabled={loading || !hasMore}
          threshold="100px"
          onIonInfinite={async (event) => {
            await fetchConversations(false);
            (event.target as HTMLIonInfiniteScrollElement).complete();
          }}
        >
          <IonInfiniteScrollContent
            loadingSpinner="crescent"
            loadingText={loadingMore ? 'Loading more chats...' : 'Loading more'}
          />
        </IonInfiniteScroll>

        <IonFab vertical="bottom" horizontal="end" slot="fixed">
          <IonFabButton onClick={() => setShowNewChat(true)}>
            <IonIcon icon={add} />
          </IonFabButton>
        </IonFab>

        <NewChatModal
          isOpen={showNewChat}
          onDismiss={() => setShowNewChat(false)}
          onConversationCreated={(conversationId) => {
            setShowNewChat(false);
            router.push(`/chat/${conversationId}`, 'forward');
          }}
        />

        {/* Story upload action sheet */}
        <IonActionSheet
          isOpen={showStorySheet}
          onDidDismiss={() => setShowStorySheet(false)}
          header="Add to My Story"
          buttons={[
            {
              text: 'Choose Image',
              icon: imageOutline,
              handler: () => storyImageInputRef.current?.click(),
            },
            {
              text: 'Choose Video',
              icon: videocamOutline,
              handler: () => storyVideoInputRef.current?.click(),
            },
            { text: 'Cancel', role: 'cancel' },
          ]}
        />

        <IonActionSheet
          isOpen={showMyStorySheet}
          onDidDismiss={() => setShowMyStorySheet(false)}
          header="My Story"
          buttons={[
            ...(ownActiveStories.length > 0
              ? [{
                text: `View Stories (${ownActiveStories.length})`,
                icon: eyeOutline,
                handler: () => openStoryViewer(
                  user!.id,
                  profile?.display_name || profile?.username || 'Me',
                  profile?.avatar_url || null,
                  true
                ),
              }]
              : []),
            {
              text: 'Add Image',
              icon: imageOutline,
              handler: () => storyImageInputRef.current?.click(),
            },
            {
              text: 'Add Video',
              icon: videocamOutline,
              handler: () => storyVideoInputRef.current?.click(),
            },
            ...(ownActiveStories.length > 0
              ? [{
                text: 'Delete All Active Stories',
                role: 'destructive' as const,
                icon: trashOutline,
                handler: () => setConfirmDeleteAllStories(true),
              }]
              : []),
            { text: 'Cancel', role: 'cancel' as const },
          ]}
        />

        {/* Hidden file inputs for story upload */}
        <input
          type="file"
          ref={storyImageInputRef}
          accept="image/*"
          hidden
          onChange={(e) => handleStoryFileSelected(e, 'image')}
        />
        <input
          type="file"
          ref={storyVideoInputRef}
          accept="video/*"
          hidden
          onChange={(e) => handleStoryFileSelected(e, 'video')}
        />

        {storyViewerContext && viewerStories.length > 0 && (
          <StoryViewerModal
            isOpen={Boolean(storyViewerContext)}
            stories={viewerStories}
            ownerName={storyViewerContext.displayName}
            ownerAvatarUrl={storyViewerContext.avatarUrl}
            canDelete={storyViewerContext.isOwn}
            onDeleteStory={handleDeleteStory}
            onClose={() => setStoryViewerContext(null)}
          />
        )}

        <IonAlert
          isOpen={confirmDeleteAllStories}
          header="Delete Stories?"
          message={`Delete all ${ownActiveStories.length} active stories?`}
          onDidDismiss={() => setConfirmDeleteAllStories(false)}
          buttons={[
            { text: 'Cancel', role: 'cancel' },
            {
              text: 'Delete',
              role: 'destructive',
              handler: () => void handleDeleteAllStories(),
            },
          ]}
        />
      </IonContent>
    </IonPage>
  );
};

export default ChatList;
