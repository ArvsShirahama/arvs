/**
 * IncomingCallOverlay
 *
 * Slide-down overlay shown when receiving an incoming video call.
 * Displays the caller's name/avatar with accept and reject buttons.
 */

import { IonIcon } from '@ionic/react';
import { call as callIcon, close } from 'ionicons/icons';
import Avatar from '../../../components/Avatar';
import './IncomingCallOverlay.css';

interface IncomingCallOverlayProps {
  isOpen: boolean;
  callerName: string;
  callerAvatarUrl: string | null;
  onAccept: () => void;
  onReject: () => void;
}

export default function IncomingCallOverlay({
  isOpen,
  callerName,
  callerAvatarUrl,
  onAccept,
  onReject,
}: IncomingCallOverlayProps) {
  if (!isOpen) return null;

  return (
    <div className="incoming-call-overlay">
      <div className="incoming-call-card">
        <div className="incoming-call-info">
          <div className="incoming-call-avatar-ring">
            <Avatar
              src={callerAvatarUrl}
              name={callerName}
              size="small"
            />
          </div>
          <div className="incoming-call-text">
            <span className="incoming-call-name">{callerName}</span>
            <span className="incoming-call-label">Incoming video call...</span>
          </div>
        </div>

        <div className="incoming-call-actions">
          <button
            className="incoming-call-btn incoming-call-reject"
            onClick={onReject}
            aria-label="Reject call"
          >
            <IonIcon icon={close} />
          </button>
          <button
            className="incoming-call-btn incoming-call-accept"
            onClick={onAccept}
            aria-label="Accept call"
          >
            <IonIcon icon={callIcon} />
          </button>
        </div>
      </div>
    </div>
  );
}
