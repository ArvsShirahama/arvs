import { IonAvatar } from '@ionic/react';
import './Avatar.css';

interface AvatarProps {
  src: string | null | undefined;
  name: string;
  size?: 'small' | 'medium' | 'large';
  onClick?: () => void;
  showStatus?: boolean;
  isOnline?: boolean;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';
}

function hashColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 55%)`;
}

export default function Avatar({ src, name, size = 'medium', onClick, showStatus = false, isOnline = false }: AvatarProps) {
  const sizeClass = `avatar-${size}`;
  const statusDot = showStatus ? (
    <span className={`avatar-status-dot ${isOnline ? 'avatar-online' : 'avatar-offline'}`} />
  ) : null;

  if (src) {
    return (
      <div className="avatar-wrapper">
        <IonAvatar className={`avatar ${sizeClass}`} onClick={onClick}>
          <img src={src} alt={name} />
        </IonAvatar>
        {statusDot}
      </div>
    );
  }

  return (
    <div className="avatar-wrapper">
      <div
        className={`avatar avatar-initials ${sizeClass}`}
        style={{ backgroundColor: hashColor(name) }}
        onClick={onClick}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
      >
        <span>{getInitials(name)}</span>
      </div>
      {statusDot}
    </div>
  );
}
