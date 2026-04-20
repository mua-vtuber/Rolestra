import { clsx } from 'clsx';

import type { AvatarShape } from '../../theme/theme-tokens';

export interface MemberLike {
  id: string;
  name: string;
  initials?: string;
  avatarUrl?: string;
}

export interface ProfileAvatarProps {
  member: MemberLike;
  /** Pixel size. Defaults to 30. */
  size?: number;
  /**
   * Shape override. When omitted, the enclosing theme's `avatarShape` token
   * is respected via CSS — circle fallback.
   */
  shape?: AvatarShape;
  className?: string;
}

const SHAPE_CLASS: Record<AvatarShape, string> = {
  circle: 'rounded-full',
  diamond: '[clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)] rounded-sm',
  status: 'rounded-sm',
};

export function ProfileAvatar({ member, size = 30, shape = 'circle', className }: ProfileAvatarProps) {
  const initials = member.initials ?? member.name.charAt(0) ?? '?';
  return (
    <div
      className={clsx(
        'flex items-center justify-center overflow-hidden shrink-0 bg-brand text-white font-semibold leading-none',
        SHAPE_CLASS[shape],
        className
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      data-testid="profile-avatar"
      data-shape={shape}
    >
      {member.avatarUrl ? (
        <img src={member.avatarUrl} alt={member.name} className="w-full h-full object-cover" />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}
