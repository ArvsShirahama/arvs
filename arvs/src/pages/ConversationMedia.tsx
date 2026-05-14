import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInfiniteScroll,
  IonInfiniteScrollContent,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonPage,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  useIonToast,
} from '@ionic/react';
import { Browser } from '@capacitor/browser';
import { documentOutline, playCircleOutline } from 'ionicons/icons';
import { IonIcon } from '@ionic/react';
import { useParams } from 'react-router-dom';
import MediaViewerModal from '../components/MediaViewerModal';
import { getConversationMediaPage } from '../services/conversationService';
import { formatFileSize } from '../services/conversationThemes';
import type { Message } from '../types/database';
import './ConversationMedia.css';

interface RouteParams {
  conversationId: string;
}

const PAGE_SIZE = 24;

type MediaFilter = 'all' | 'image' | 'video' | 'file';

function formatMediaTime(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ConversationMedia() {
  const { conversationId } = useParams<RouteParams>();
  const [presentToast] = useIonToast();

  const [filter, setFilter] = useState<MediaFilter>('all');
  const [items, setItems] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ src: string; type: 'image' | 'video' } | null>(null);

  const loadMedia = useCallback(async (reset: boolean) => {
    if (!conversationId) {
      return;
    }

    if (reset) {
      setLoading(true);
    } else {
      if (loadingMore || !hasMore || !nextCursor) {
        return;
      }
      setLoadingMore(true);
    }

    try {
      const page = await getConversationMediaPage(conversationId, {
        beforeCreatedAt: reset ? null : nextCursor,
        limit: PAGE_SIZE,
        type: filter,
      });

      setItems((current) => (reset ? page.messages : [...current, ...page.messages]));
      setHasMore(page.hasMore);
      setNextCursor(page.oldestCursor);
    } catch {
      await presentToast({
        message: 'Unable to load media.',
        duration: 2200,
        color: 'danger',
        position: 'top',
      });
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [conversationId, filter, hasMore, loadingMore, nextCursor, presentToast]);

  useEffect(() => {
    void loadMedia(true);
  }, [loadMedia]);

  const fileItems = useMemo(() => items.filter((item) => item.message_type === 'file'), [items]);
  const visualItems = useMemo(() => items.filter((item) => item.message_type === 'image' || item.message_type === 'video'), [items]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref={`/chat/${conversationId}/settings`} text="" />
          </IonButtons>
          <IonTitle>Shared Media</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="conversation-media-page" fullscreen>
        <div className="conversation-media-shell">
          <IonSegment value={filter} onIonChange={(event) => setFilter((event.detail.value as MediaFilter) || 'all')}>
            <IonSegmentButton value="all">
              <IonLabel>All</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="image">
              <IonLabel>Photos</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="video">
              <IonLabel>Videos</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="file">
              <IonLabel>Files</IonLabel>
            </IonSegmentButton>
          </IonSegment>

          {loading ? (
            <div className="conversation-media-loading">
              <IonSpinner name="crescent" />
            </div>
          ) : items.length === 0 ? (
            <div className="conversation-media-empty">
              <IonText color="medium">
                <p>No media in this conversation yet.</p>
              </IonText>
            </div>
          ) : (
            <>
              {visualItems.length > 0 && (
                <div className="conversation-media-grid">
                  {visualItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`conversation-media-card ${item.message_type === 'video' ? 'is-video' : ''}`}
                      onClick={() => item.media_url && setViewer({ src: item.media_url, type: item.message_type as 'image' | 'video' })}
                    >
                      {item.message_type === 'image' ? (
                        <img src={item.media_url ?? ''} alt={item.content || 'Shared image'} loading="lazy" />
                      ) : (
                        <>
                          <video src={item.media_url ?? ''} preload="metadata" muted playsInline />
                          <span className="conversation-media-video-badge">
                            <IonIcon icon={playCircleOutline} />
                            Video
                          </span>
                        </>
                      )}
                      <span className="conversation-media-timestamp">{formatMediaTime(item.created_at)}</span>
                    </button>
                  ))}
                </div>
              )}

              {fileItems.length > 0 && (
                <IonList lines="none" className="conversation-file-list">
                  {fileItems.map((item) => (
                    <IonItem
                      key={item.id}
                      button
                      detail={false}
                      className="conversation-file-item"
                      onClick={() => {
                        if (!item.media_url) {
                          return;
                        }
                        void Browser.open({ url: item.media_url });
                      }}
                    >
                      <IonIcon icon={documentOutline} slot="start" />
                      <IonLabel>
                        <h3>{item.media_name || item.content || 'File attachment'}</h3>
                        <p>{formatMediaTime(item.created_at)}</p>
                      </IonLabel>
                      <IonNote slot="end">{formatFileSize(item.media_size_bytes)}</IonNote>
                    </IonItem>
                  ))}
                </IonList>
              )}
            </>
          )}
        </div>

        <IonInfiniteScroll
          disabled={loading || !hasMore}
          threshold="120px"
          onIonInfinite={async (event) => {
            await loadMedia(false);
            (event.target as HTMLIonInfiniteScrollElement).complete();
          }}
        >
          <IonInfiniteScrollContent loadingSpinner="crescent" loadingText={loadingMore ? 'Loading more media...' : 'Loading more'} />
        </IonInfiniteScroll>

        <MediaViewerModal
          isOpen={!!viewer}
          src={viewer?.src ?? ''}
          type={viewer?.type ?? 'image'}
          onClose={() => setViewer(null)}
        />
      </IonContent>
    </IonPage>
  );
}
