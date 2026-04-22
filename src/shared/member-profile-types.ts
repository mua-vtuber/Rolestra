/**
 * Member Profile 도메인 타입 — migrations/001-core.ts member_profiles 컬럼과 1:1 camelCase 매핑,
 * 런타임 상태 판정 결과를 포함하는 MemberView 파생 타입 제공.
 */

export type WorkStatus = 'online' | 'connecting' | 'offline-connection' | 'offline-manual';
export type StatusOverride = 'offline-manual' | null;
export type AvatarKind = 'default' | 'custom';

export interface MemberProfile {
  providerId: string;
  role: string;
  personality: string;
  expertise: string;
  avatarKind: AvatarKind;
  avatarData: string | null;     // default: palette key, custom: relative path or base64
  statusOverride: StatusOverride;
  updatedAt: number;
}

export interface MemberView extends MemberProfile {
  displayName: string;       // providers.display_name
  persona: string;           // providers.persona (legacy fallback)
  workStatus: WorkStatus;    // runtime 판정
}

/**
 * Allowed image extensions for `member:upload-avatar` (spec §7.1, R8 D7).
 *
 * Lowercase ASCII only — the AvatarStore normalises the source extension
 * before checking. The list deliberately excludes formats we cannot render
 * inline in the renderer (avif, heic, raw camera formats) — a member avatar
 * is a profile picture, not a photo gallery.
 *
 * Order is irrelevant; the array is iterated for membership checks. Treating
 * `jpg` and `jpeg` as separate entries keeps the AvatarStore copy path
 * deterministic — a `.JPEG` source becomes `<providerId>.jpeg`, never
 * `.jpg` (no surprising rename for the user).
 */
export const ALLOWED_AVATAR_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
] as const;

/** Literal union of {@link ALLOWED_AVATAR_EXTENSIONS}. */
export type AllowedAvatarExtension = (typeof ALLOWED_AVATAR_EXTENSIONS)[number];

/**
 * Hard cap on uploaded avatar file size (spec §7.1, R8 D7).
 *
 * 5 MB is generous for a profile picture (a 4 K JPEG is ~2 MB) while
 * keeping the renderer message round-trip cheap and discouraging users
 * from accidentally uploading unrelated assets (raw camera files,
 * screenshots of full PDFs, etc.). EXIF stripping is intentionally NOT
 * performed — base64 conversion or image processing would pull in `sharp`
 * or equivalent, which the project deliberately avoids (D7).
 */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/**
 * `member:upload-avatar` request payload (R8-Task1).
 *
 * `sourcePath` is the absolute path of a file the user picked via
 * `dialog.showOpenDialog` (renderer side). The Main process copies it to
 * `<ArenaRoot>/avatars/<providerId>.<ext>` and returns the resulting
 * relative + absolute paths so the renderer can immediately preview the
 * new avatar before the next `member:get-profile` round-trip.
 */
export interface AvatarUploadRequest {
  providerId: string;
  sourcePath: string;
}

/**
 * `member:upload-avatar` response (R8-Task1).
 *
 * `relativePath` is what the caller stores in `member_profiles.avatar_data`
 * (POSIX-style relative to ArenaRoot — `avatars/<providerId>.<ext>`).
 * `absolutePath` is for renderer preview only — never persist it (the user
 * may move ArenaRoot, see D2).
 */
export interface AvatarUploadResponse {
  relativePath: string;
  absolutePath: string;
}
