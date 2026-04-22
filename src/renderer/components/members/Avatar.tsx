/**
 * Avatar — renders a member's profile picture (R8-Task2, spec §7.1).
 *
 * Three render branches:
 *   1. `avatarKind === 'default'` and `avatarData` matches a key in
 *      {@link DEFAULT_AVATARS} → coloured bubble (`color` background) with
 *      the catalogue `emoji` centred. This is the spec-defined "기본 아바타
 *      풀(8개)".
 *   2. `avatarKind === 'custom'` and `avatarData` is non-empty → renders an
 *      `<img>` whose `src` resolves the ArenaRoot-relative path through the
 *      renderer's `resolveArenaPath` helper (provided by props for now —
 *      Task 5 will make a global hook available; until then callers pass
 *      an explicit URL via `resolvedSrc`).
 *   3. Fallback (default with unknown key, custom with empty data, or
 *      missing fields) → solid `bg-brand` bubble with the first character
 *      of `displayName` (initials). This is the legacy behaviour from R3
 *      `ProfileAvatar`, preserved so members without an explicit profile
 *      still render.
 *
 * Shape:
 *   - Inherits the theme's `avatarShape` token (circle/diamond/status) by
 *     default. Callers can pin a shape via the `shape` prop — useful for
 *     the AvatarPicker grid where every cell renders as a circle for
 *     consistent visual scanning regardless of theme.
 *
 * No work-status indicator is drawn here. Surfaces that need both an avatar
 * AND a status dot (MemberRow, MemberPanel) compose `<Avatar>` with
 * `<WorkStatusDot>` side-by-side. Conflating them inside Avatar would
 * complicate the AvatarPicker (which has no member, only a key).
 *
 * Hex literals for the catalogue colours are intentional — the 8 default
 * colours are part of the catalogue's identity, not the theme tokens (a
 * member who picks "blue-dev" should look the same in every theme).
 */

import { clsx } from 'clsx';
import type { ReactElement } from 'react';

import {
  DEFAULT_AVATARS,
  findDefaultAvatar,
} from '../../../shared/default-avatars';
import type { AvatarKind } from '../../../shared/member-profile-types';
import type { AvatarShape } from '../../theme/theme-tokens';

const SHAPE_CLASS: Record<AvatarShape, string> = {
  circle: 'rounded-full',
  diamond: '[clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)] rounded-sm',
  status: 'rounded-sm',
};

export interface AvatarProps {
  /** Stable provider id — used for keying + initials fallback when displayName missing. */
  providerId: string;
  /** Display name — first character is the initials fallback when no avatar resolves. */
  displayName?: string;
  /** Persisted `member_profiles.avatar_kind`. */
  avatarKind: AvatarKind;
  /** Persisted `member_profiles.avatar_data` (default key OR custom relative path). */
  avatarData: string | null;
  /**
   * Pre-resolved absolute URL for custom avatars. Provided by the caller
   * because path → URL resolution depends on Electron's `file://` semantics
   * which only the boot layer knows. The Avatar component itself stays
   * pure (no IPC, no globals).
   */
  resolvedSrc?: string;
  /** Pixel size. Defaults to 30 (matches R3 ProfileAvatar default). */
  size?: number;
  /** Shape override. When omitted, `'circle'` (caller picks via theme). */
  shape?: AvatarShape;
  className?: string;
}

/** Default-branch render — coloured bubble + emoji from {@link DEFAULT_AVATARS}. */
function renderDefault(
  entry: (typeof DEFAULT_AVATARS)[number],
  size: number,
): ReactElement {
  // Emoji size scales with bubble size — too small at 16 px, oversized at 64 px.
  // 0.55 keeps the glyph visually centred at every R8 surface size (28..48 px).
  const fontSize = Math.round(size * 0.55);
  return (
    <span
      data-testid="avatar-emoji"
      className="flex h-full w-full items-center justify-center"
      style={{ backgroundColor: entry.color, fontSize }}
      aria-hidden="true"
    >
      {entry.emoji}
    </span>
  );
}

/** Custom-branch render — `<img>` with the resolved URL. */
function renderCustom(src: string, alt: string): ReactElement {
  return (
    <img
      data-testid="avatar-custom-img"
      src={src}
      alt={alt}
      className="h-full w-full object-cover"
    />
  );
}

/** Fallback render — solid brand bubble with the first character of `displayName`. */
function renderInitials(displayName: string, size: number): ReactElement {
  const ch = (displayName.trim().charAt(0) || '?').toUpperCase();
  return (
    <span
      data-testid="avatar-initials"
      className="flex h-full w-full items-center justify-center bg-brand text-white font-semibold"
      style={{ fontSize: Math.round(size * 0.42) }}
    >
      {ch}
    </span>
  );
}

export function Avatar({
  providerId,
  displayName,
  avatarKind,
  avatarData,
  resolvedSrc,
  size = 30,
  shape = 'circle',
  className,
}: AvatarProps): ReactElement {
  const name = displayName ?? providerId;

  let body: ReactElement;
  let renderedKind: 'default' | 'custom' | 'initials';
  if (avatarKind === 'default' && avatarData) {
    const entry = findDefaultAvatar(avatarData);
    if (entry) {
      body = renderDefault(entry, size);
      renderedKind = 'default';
    } else {
      body = renderInitials(name, size);
      renderedKind = 'initials';
    }
  } else if (avatarKind === 'custom' && resolvedSrc) {
    body = renderCustom(resolvedSrc, name);
    renderedKind = 'custom';
  } else {
    body = renderInitials(name, size);
    renderedKind = 'initials';
  }

  return (
    <div
      data-testid="avatar"
      data-provider-id={providerId}
      data-avatar-kind={renderedKind}
      data-shape={shape}
      className={clsx(
        'flex items-center justify-center overflow-hidden shrink-0 leading-none',
        SHAPE_CLASS[shape],
        className,
      )}
      style={{ width: size, height: size }}
    >
      {body}
    </div>
  );
}
