import { IonAvatar } from '@ionic/react';
import './Avatar.css';

interface AvatarProps {
  src: string | null | undefined;
  name: string;
  size?: 'small' | 'medium' | 'large';
  onClick?: () => void;
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

export default function Avatar({ src, name, size = 'medium', onClick }: AvatarProps) {
  const sizeClass = `avatar-${size}`;

  if (src) {
    return (
      <IonAvatar className={`avatar ${sizeClass}`} onClick={onClick}>
        <img src={src} alt={name} />
      </IonAvatar>
    );
  }

  return (
    <div
      className={`avatar avatar-initials ${sizeClass}`}
      style={{ backgroundColor: hashColor(name) }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <span>{getInitials(name)}</span>
    </div>
  );
}
