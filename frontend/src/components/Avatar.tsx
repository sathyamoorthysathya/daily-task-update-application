import { useState } from 'react';
import { type AvatarSource, avatarUrl } from './avatar-url';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts;
  return letters.map((part) => part?.[0]?.toUpperCase() ?? '').join('') || '?';
}

interface AvatarProps {
  user: AvatarSource;
  size?: 'sm' | 'lg';
}

/** Round profile picture with an initials fallback (also used when the image fails to load). */
export function Avatar({ user, size = 'sm' }: AvatarProps) {
  const src = avatarUrl(user);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  return (
    <span className={`avatar avatar--${size}`} aria-hidden="true">
      {src && src !== failedSrc ? (
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(src)}
          data-testid="avatar-image"
        />
      ) : (
        <span className="avatar-initials">{initials(user.name)}</span>
      )}
    </span>
  );
}
