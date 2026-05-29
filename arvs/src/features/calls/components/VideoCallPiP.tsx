import { useEffect, useRef, useState } from 'react';
import { IonIcon } from '@ionic/react';
import { call as callIcon, expandOutline } from 'ionicons/icons';
import type { CallStatus } from '../hooks/useVideoCall';
import './VideoCallPiP.css';

interface VideoCallPiPProps {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  callStatus: CallStatus;
  isVideoOff: boolean;
  onMaximize: () => void;
  onHangUp: () => void;
}

function bindStreamToVideo(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  stream: MediaStream | null
): void {
  if (!stream) return;
  const el = videoRef.current;
  if (el) {
    if (el.srcObject !== stream) {
      el.srcObject = stream;
    }
    el.play().catch((err) => {
      console.warn('[CallPiP] Error playing video:', err);
    });
  }
}

export default function VideoCallPiP({
  localStream,
  remoteStream,
  callStatus,
  isVideoOff,
  onMaximize,
  onHangUp,
}: VideoCallPiPProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const dragStartRef = useRef<{ pointerX: number; pointerY: number; posX: number; posY: number } | null>(null);
  const totalDragDistanceRef = useRef(0);

  // Bind local stream
  useEffect(() => {
    if (localStream) {
      bindStreamToVideo(localVideoRef, localStream);
    }
  }, [localStream]);

  // Bind remote stream
  useEffect(() => {
    if (remoteStream) {
      bindStreamToVideo(remoteVideoRef, remoteStream);
    }
  }, [remoteStream]);

  // Drag start helper
  const startDrag = (clientX: number, clientY: number) => {
    dragStartRef.current = {
      pointerX: clientX,
      pointerY: clientY,
      posX: position.x,
      posY: position.y,
    };
    totalDragDistanceRef.current = 0;
    setIsDragging(true);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Left click only
    startDrag(e.clientX, e.clientY);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length > 0) {
      startDrag(e.touches[0].clientX, e.touches[0].clientY);
    }
  };

  // Drag listener binding
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;

      const dx = e.clientX - dragStartRef.current.pointerX;
      const dy = e.clientY - dragStartRef.current.pointerY;

      totalDragDistanceRef.current = Math.sqrt(dx * dx + dy * dy);

      let nextX = dragStartRef.current.posX + dx;
      let nextY = dragStartRef.current.posY + dy;

      // Bound within screen viewport dimensions
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Position offset bases: right: 16px, bottom: 90px.
        const baseLeft = viewportWidth - 110 - 16;
        const baseTop = viewportHeight - 160 - 90;

        const absoluteLeft = baseLeft + nextX;
        const absoluteTop = baseTop + nextY;

        const minLeft = 8;
        const maxLeft = viewportWidth - rect.width - 8;
        const minTop = 8;
        const maxTop = viewportHeight - rect.height - 8;

        const boundedLeft = Math.max(minLeft, Math.min(maxLeft, absoluteLeft));
        const boundedTop = Math.max(minTop, Math.min(maxTop, absoluteTop));

        nextX = boundedLeft - baseLeft;
        nextY = boundedTop - baseTop;
      }

      setPosition({ x: nextX, y: nextY });
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!dragStartRef.current || e.touches.length === 0) return;

      if (e.cancelable) {
        e.preventDefault();
      }

      const touch = e.touches[0];
      const dx = touch.clientX - dragStartRef.current.pointerX;
      const dy = touch.clientY - dragStartRef.current.pointerY;

      totalDragDistanceRef.current = Math.sqrt(dx * dx + dy * dy);

      let nextX = dragStartRef.current.posX + dx;
      let nextY = dragStartRef.current.posY + dy;

      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        const baseLeft = viewportWidth - 110 - 16;
        const baseTop = viewportHeight - 160 - 90;

        const absoluteLeft = baseLeft + nextX;
        const absoluteTop = baseTop + nextY;

        const minLeft = 8;
        const maxLeft = viewportWidth - rect.width - 8;
        const minTop = 8;
        const maxTop = viewportHeight - rect.height - 8;

        const boundedLeft = Math.max(minLeft, Math.min(maxLeft, absoluteLeft));
        const boundedTop = Math.max(minTop, Math.min(maxTop, absoluteTop));

        nextX = boundedLeft - baseLeft;
        nextY = boundedTop - baseTop;
      }

      setPosition({ x: nextX, y: nextY });
    };

    const handleDragEnd = () => {
      if (!dragStartRef.current) return;
      dragStartRef.current = null;
      setIsDragging(false);

      // If dragged less than 6px, treat as tap to maximize
      if (totalDragDistanceRef.current < 6) {
        onMaximize();
      }
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleDragEnd);
      window.addEventListener('touchmove', handleTouchMove, { passive: false });
      window.addEventListener('touchend', handleDragEnd);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleDragEnd);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleDragEnd);
    };
  }, [isDragging, onMaximize, position]);

  return (
    <div
      ref={containerRef}
      className={`video-call-pip-container ${isDragging ? 'dragging' : ''}`}
      style={{
        transform: `translate(${position.x}px, ${position.y}px)`,
        transition: isDragging ? 'none' : 'transform 0.25s cubic-bezier(0.1, 0.8, 0.2, 1)',
      }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
    >
      {/* Remote stream video as main background of PiP */}
      <video
        ref={remoteVideoRef}
        className="video-call-pip-remote"
        autoPlay
        playsInline
        muted
        {...{ 'webkit-playsinline': 'true' } as React.HTMLAttributes<HTMLVideoElement>}
      />

      {/* Local stream preview in tiny corner */}
      {localStream && !isVideoOff && (
        <video
          ref={localVideoRef}
          className="video-call-pip-local"
          autoPlay
          playsInline
          muted
          {...{ 'webkit-playsinline': 'true' } as React.HTMLAttributes<HTMLVideoElement>}
        />
      )}

      {/* Overlay status & controls */}
      <div className="video-call-pip-overlay">
        <div className="video-call-pip-status">
          <span className={`video-call-pip-dot ${callStatus === 'active' ? 'active' : ''}`} />
        </div>

        <div className="video-call-pip-controls" onClick={(e) => e.stopPropagation()}>
          <button
            className="video-call-pip-btn video-call-pip-btn-maximize"
            onClick={onMaximize}
            aria-label="Expand call screen"
          >
            <IonIcon icon={expandOutline} />
          </button>
          <button
            className="video-call-pip-btn video-call-pip-btn-hangup"
            onClick={onHangUp}
            aria-label="End call"
          >
            <IonIcon icon={callIcon} />
          </button>
        </div>
      </div>
    </div>
  );
}
