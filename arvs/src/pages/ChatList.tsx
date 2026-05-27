import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IonActionSheet,
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
import { add, imageOutline, videocamOutline } from 'ionicons/icons';
import ChatListItem from '../components/ChatListItem';
import NewChatModal from '../components/NewChatModal';
import Avatar from '../components/Avatar';
import { useAuth } from '../hooks/useAuth';
import {
  getConversationSummary,
  getSummaries,
  upsertSummaryFromRealtime,
} from '../services/chatService';
import { supabase } from '../supabaseClient';
import type { ConversationWithDetails, Message } from '../types/database';
import './ChatList.css';

const SUMMARY_PAGE_SIZE = 30;

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
  const [uploadingStory, setUploadingStory] = useState(false);

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
      });

      if (insertError) {
        presentToast({ message: 'Failed to save story.', color: 'danger', duration: 2200, position: 'top' });
      } else {
        presentToast({ message: 'Story uploaded!', color: 'success', duration: 1500, position: 'top' });
      }
    } catch {
      presentToast({ message: 'Something went wrong.', color: 'danger', duration: 2200, position: 'top' });
    } finally {
      setUploadingStory(false);
    }
  }, [user, presentToast]);

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
                onClick={() => setShowStorySheet(true)}
              >
                <div className="active-user-avatar-container">
                  <Avatar
                    src={profile?.avatar_url}
                    name={profile?.display_name || 'Me'}
                  />
                  <span className={`my-story-add-btn ${uploadingStory ? 'my-story-uploading' : ''}`}>
                    {uploadingStory ? (
                      <span className="my-story-add-loading" aria-hidden="true">…</span>
                    ) : (
                      <IonIcon icon={add} className="my-story-add-icon" aria-hidden="true" />
                    )}
                  </span>
                </div>
                <span className="active-user-name">Create Story</span>
              </div>

              {/* Divider between My Story and active users */}
              {activeUsers.length > 0 && <div className="my-story-divider" />}

              {/* Active online users */}
              {activeUsers.map((conv) => {
                const displayName = conv.other_user?.display_name || 'User';
                const firstName = displayName.split(' ')[0];
                return (
                  <div
                    key={conv.id}
                    className="active-user-item"
                    onClick={() => router.push(`/chat/${conv.id}`, 'forward')}
                  >
                    <div className="active-user-avatar-container">
                      <Avatar
                        src={conv.other_user?.avatar_url}
                        name={displayName}
                        showStatus={true}
                        isOnline={true}
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
            {filteredConversations.map((conv) => (
              <ChatListItem
                key={conv.id}
                conversation={conv}
                currentUserId={user!.id}
                isOnline={onlineUsers.has(conv.other_user.id)}
              />
            ))}
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
      </IonContent>
    </IonPage>
  );
};

export default ChatList;
