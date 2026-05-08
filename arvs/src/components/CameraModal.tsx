import { useState, useRef, useCallback, useEffect } from 'react';
import { Camera as CapCamera } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { IonIcon } from '@ionic/react';
import { close, cameraReverse } from 'ionicons/icons';
import './CameraModal.css';

interface CameraModalProps {
  onCapture: (file: Blob, type: 'image' | 'video') => void;
  onClose: () => void;
}

export default function CameraModal({ onCapture, onClose }: CameraModalProps) {
  const [mode, setMode] = useState<'photo' | 'video'>('photo');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [recording, setRecording] = useState(false);
  const [recordTime, setRecordTime] = useState(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCamera = useCallback(async (facing: 'user' | 'environment') => {
    // Stop any existing stream
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }

    try {
      // Request permissions on native platforms
      if (Capacitor.isNativePlatform()) {
        await CapCamera.requestPermissions({ permissions: ['camera'] });
      }

      const videoConstraints = { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } };
      let s: MediaStream;
      if (mode === 'video') {
        // Try with audio; fallback to video-only if mic permission denied
        try {
          s = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: true });
        } catch {
          s = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
        }
      } else {
        s = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
      }
      setStream(s);
      setCameraError(false);
      if (videoRef.current) {
        videoRef.current.srcObject = s;
      }
    } catch {
      setCameraError(true);
    }
  }, [stream, mode]);

  useEffect(() => {
    startCamera(facingMode);
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      stream?.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // Only run on mount and facingMode/mode change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode, mode]);

  const handleFlip = () => {
    setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'));
  };

  const takePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) {
        onCapture(blob, 'image');
        // Stop camera after capture
        stream?.getTracks().forEach((t) => t.stop());
      }
    }, 'image/jpeg', 0.85);
  };

  const startRecording = () => {
    if (!stream) return;
    chunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : 'video/mp4';
    const mr = new MediaRecorder(stream, { mimeType });
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      onCapture(blob, 'video');
      stream?.getTracks().forEach((t) => t.stop());
    };
    mr.start();
    mediaRecorderRef.current = mr;
    setRecording(true);
    setRecordTime(0);
    timerRef.current = setInterval(() => {
      setRecordTime((t) => t + 1);
    }, 1000);
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleCapture = () => {
    if (mode === 'photo') {
      takePhoto();
    } else {
      if (recording) {
        stopRecording();
      } else {
        startRecording();
      }
    }
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="camera-modal-overlay">
      <div className="camera-modal-viewfinder">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={facingMode === 'user' ? 'facing-user' : ''}
        />
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        {recording && <div className="camera-timer">{formatTime(recordTime)}</div>}
        {cameraError && (
          <div className="camera-modal-placeholder">
            <p>Unable to access camera</p>
            <button className="camera-modal-retry-btn" onClick={() => startCamera(facingMode)}>Retry</button>
          </div>
        )}
      </div>

      <div className="camera-modal-mode-toggle">
        <button
          className={`camera-modal-mode-btn ${mode === 'photo' ? 'active' : ''}`}
          onClick={() => { if (!recording) setMode('photo'); }}
        >
          Photo
        </button>
        <button
          className={`camera-modal-mode-btn ${mode === 'video' ? 'active' : ''}`}
          onClick={() => { if (!recording) setMode('video'); }}
        >
          Video
        </button>
      </div>

      <div className="camera-modal-controls">
        <button className="camera-modal-close-btn" onClick={onClose} aria-label="Close camera" disabled={recording}>
          <IonIcon icon={close} />
        </button>

        <button
          className={`camera-modal-capture-btn ${recording ? 'recording' : ''}`}
          onClick={handleCapture}
          aria-label={mode === 'photo' ? 'Take photo' : recording ? 'Stop recording' : 'Start recording'}
        >
          <span className="camera-modal-capture-inner" />
        </button>

        <button className="camera-modal-flip-btn" onClick={handleFlip} aria-label="Switch camera" disabled={recording}>
          <IonIcon icon={cameraReverse} />
        </button>
      </div>
    </div>
  );
}
