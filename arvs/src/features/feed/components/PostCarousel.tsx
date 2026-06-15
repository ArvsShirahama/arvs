import { useRef, useState } from 'react';
import { IonIcon } from '@ionic/react';
import { chevronBack, chevronForward } from 'ionicons/icons';
import type { PostAspectRatio, PostMedia } from '../../../types/database';
import './PostCarousel.css';

interface PostCarouselProps {
  media: PostMedia[];
  aspectRatio: PostAspectRatio;
  altText: string;
}

export default function PostCarousel({
  media,
  aspectRatio,
  altText,
}: PostCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loadedIds, setLoadedIds] = useState<Set<string>>(() => new Set());

  const markLoaded = (id: string) => {
    setLoadedIds((current) => new Set(current).add(id));
  };

  const scrollToIndex = (index: number) => {
    const nextIndex = Math.max(0, Math.min(media.length - 1, index));
    const container = scrollRef.current;
    if (!container) return;

    container.scrollTo({
      left: nextIndex * container.clientWidth,
      behavior: 'smooth',
    });
    setActiveIndex(nextIndex);
  };

  const handleScroll = () => {
    const container = scrollRef.current;
    if (!container) return;

    const nextIndex = Math.round(container.scrollLeft / Math.max(1, container.clientWidth));
    if (nextIndex !== activeIndex) {
      setActiveIndex(Math.max(0, Math.min(media.length - 1, nextIndex)));
    }
  };

  if (media.length === 0) {
    return null;
  }

  const firstMedia = media[0];
  const dynamicStyle = aspectRatio === 'original' && firstMedia?.width && firstMedia?.height
    ? { aspectRatio: `${firstMedia.width} / ${firstMedia.height}` }
    : undefined;

  return (
    <div
      className={`post-carousel post-carousel-${aspectRatio}`}
      style={dynamicStyle}
    >
      <div
        ref={scrollRef}
        className="post-carousel-track"
        onScroll={handleScroll}
      >
        {media.map((item, index) => {
          const isLoaded = loadedIds.has(item.id);

          return (
            <div className="post-carousel-slide" key={item.id}>
              {item.media_type === 'video' ? (
                <video
                  src={item.media_url}
                  className={`post-carousel-media ${isLoaded ? 'post-carousel-media-loaded' : ''}`}
                  controls
                  playsInline
                  preload="metadata"
                  controlsList="nodownload noplaybackrate"
                  disablePictureInPicture
                  onLoadedData={() => markLoaded(item.id)}
                  aria-label={`${altText} video ${index + 1}`}
                />
              ) : (
                <img
                  src={item.media_url}
                  alt={media.length > 1 ? `${altText} ${index + 1}` : altText}
                  className={`post-carousel-media ${isLoaded ? 'post-carousel-media-loaded' : ''}`}
                  loading={index === 0 ? 'eager' : 'lazy'}
                  onLoad={() => markLoaded(item.id)}
                />
              )}
            </div>
          );
        })}
      </div>

      {media.length > 1 && (
        <>
          <span className="post-carousel-count">{activeIndex + 1}/{media.length}</span>
          <button
            type="button"
            className="post-carousel-nav post-carousel-nav-prev"
            onClick={() => scrollToIndex(activeIndex - 1)}
            disabled={activeIndex === 0}
            aria-label="Previous media"
          >
            <IonIcon icon={chevronBack} />
          </button>
          <button
            type="button"
            className="post-carousel-nav post-carousel-nav-next"
            onClick={() => scrollToIndex(activeIndex + 1)}
            disabled={activeIndex === media.length - 1}
            aria-label="Next media"
          >
            <IonIcon icon={chevronForward} />
          </button>
          <div className="post-carousel-dots" aria-label="Carousel pagination">
            {media.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={`post-carousel-dot ${index === activeIndex ? 'post-carousel-dot-active' : ''}`}
                onClick={() => scrollToIndex(index)}
                aria-label={`Go to media ${index + 1}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
