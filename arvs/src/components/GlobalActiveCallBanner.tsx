import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useIonRouter, IonIcon } from '@ionic/react';
import { callOutline, expandOutline } from 'ionicons/icons';
import { getActiveCallState, endCall } from '../features/calls/services';
import { getStoredPipEnabled } from '../services/pipService';
import './GlobalActiveCallBanner.css';

export default function GlobalActiveCallBanner() {
  const location = useLocation();
  const router = useIonRouter();
  const [activeCall, setActiveCall] = useState(getActiveCallState());

  useEffect(() => {
    const handleStateChange = () => {
      setActiveCall(getActiveCallState());
    };

    window.addEventListener('arvs-call-state-change', handleStateChange);
    return () => {
      window.removeEventListener('arvs-call-state-change', handleStateChange);
    };
  }, []);

  // Determine if a call is currently active or connecting
  const isCallActive =
    activeCall.callId &&
    (activeCall.peerConnectionState === 'connected' ||
      activeCall.peerConnectionState === 'connecting' ||
      activeCall.iceConnectionState === 'connected' ||
      activeCall.iceConnectionState === 'checking');

  if (!isCallActive) return null;

  // Check if user is currently inside the chat room of this call
  const isInsideCallChat =
    location.pathname === `/chat/${activeCall.conversationId}`;

  // Hide the banner if the user is already on the relevant chat screen
  if (isInsideCallChat) return null;

  // If in-app PiP is active and shown, hide the banner to prevent duplication.
  // In-app PiP is shown when: call is active, it's NOT hidden, the PiP setting is enabled,
  // and native PiP is NOT currently active.
  const isInAppPiPActive =
    !activeCall.isInAppPiPHidden &&
    getStoredPipEnabled() &&
    !activeCall.isNativePiPActive;

  if (isInAppPiPActive) return null;

  const handleReturn = () => {
    if (activeCall.conversationId) {
      router.push(`/chat/${activeCall.conversationId}`, 'forward', 'push');
    }
  };

  const handleHangUp = (e: React.MouseEvent) => {
    e.stopPropagation();
    void endCall('hangup');
  };

  return (
    <div className="global-call-banner-container" onClick={handleReturn}>
      <div className="global-call-banner-info">
        <span className="global-call-banner-status-dot" />
        <div className="global-call-banner-text">
          <span className="global-call-banner-title">Active Video Call</span>
          <span className="global-call-banner-subtitle">Tap to return to call</span>
        </div>
      </div>
      <div className="global-call-banner-actions">
        <button
          className="global-call-banner-btn global-call-banner-btn-return"
          onClick={(e) => {
            e.stopPropagation();
            handleReturn();
          }}
          aria-label="Return to call"
        >
          <IonIcon icon={expandOutline} />
          Return
        </button>
        <button
          className="global-call-banner-btn global-call-banner-btn-hangup"
          onClick={handleHangUp}
          aria-label="End call"
        >
          <IonIcon icon={callOutline} style={{ transform: 'rotate(135deg)' }} />
          End
        </button>
      </div>
    </div>
  );
}
