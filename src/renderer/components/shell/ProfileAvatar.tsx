import { clsx } from 'clsx';
import type { ReactElement } from 'react';

import { Avatar } from '../members/Avatar';
import type { MemberView } from '../../../shared/member-profile-types';
import type { AvatarShape } from '../../theme/theme-tokens';

export interface MemberLike {
  id: string;
  name: string;
  initials?: string;
  avatarUrl?: string;
}

export interface ProfileAvatarProps {
  member: MemberLike;
  /**
   * Optional MemberView (R8-Task2). When provided, ProfileAvatar delegates
   * to {@link Avatar} so the persisted `avatarKind`/`avatarData` is honoured
   * — i.e. a member with `avatarKind='default'` + `avatarData='blue-dev'`
   * gets the catalogue color+emoji instead of bare initials.
   *
   * R3 callers (ProjectRail, RecentWidget) pass `member` only — they keep
   * the legacy initials/avatarUrl behaviour unchanged. R5 callers
   * (MemberRow, PeopleWidget) start passing `profile` in R8-Task7 to opt
   * into the structured render.
   *
   * The dual-prop shape is deliberate: ripping out `member` would force a
   * bigger churn across legacy surfaces for no UX benefit at those sizes
   * (22 px / 28 px where the emoji barely reads). Keeping both lets each
   * surface migrate independently.
   */
  profile?: MemberView;
  /**
   * Optional pre-resolved URL for `profile.avatarKind === 'custom'` —
   * caller resolves the ArenaRoot-relative path to a `file://` URL because
   * Avatar has no IPC dependency. Ignored when `profile` is omitted.
   */
  customAvatarSrc?: string;
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

export function ProfileAvatar({
  member,
  profile,
  customAvatarSrc,
  size = 30,
  shape = 'circle',
  className,
}: ProfileAvatarProps): ReactElement {
  if (profile) {
    return (
      <Avatar
        providerId={profile.providerId}
        displayName={profile.displayName || member.name}
        avatarKind={profile.avatarKind}
        avatarData={profile.avatarData}
        resolvedSrc={customAvatarSrc}
        size={size}
        shape={shape}
        className={className}
      />
    );
  }

  const initials = member.initials ?? member.name.charAt(0) ?? '?';
  return (
    <div
      className={clsx(
        'flex items-center justify-center overflow-hidden shrink-0 bg-brand text-white font-semibold leading-none',
        SHAPE_CLASS[shape],
        className,
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
