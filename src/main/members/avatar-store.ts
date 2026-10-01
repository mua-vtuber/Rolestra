/**
 * AvatarStore — copies user-supplied avatar files into ArenaRoot
 * (R8-Task5, spec §7.1).
 *
 * Responsibilities:
 *   - Validate the source file's extension against {@link ALLOWED_AVATAR_EXTENSIONS}
 *     (D7: png/jpg/jpeg/webp/gif). Rejects everything else with
 *     {@link AvatarValidationError}.
 *   - Validate the source file's size against {@link AVATAR_MAX_BYTES}
 *     (D7: 5 MB).
 *   - Copy the source into `<ArenaRoot>/avatars/<providerId>.<ext>`. The
 *     filename is provider-id-keyed so a member has at most one custom
 *     avatar at a time.
 *   - Clean up siblings of the previous extension when a member uploads a
 *     new image with a different ext (e.g. png → jpg). Prevents orphaned
 *     files from accumulating across edits.
 *
 * Non-responsibilities:
 *   - DB updates (the IPC handler chain calls `member:update-profile` after
 *     the copy succeeds — keeping AvatarStore filesystem-only matches the
 *     R3 ProjectService TOCTOU pattern).
 *   - Image processing (no resize, no EXIF strip — D7 explicitly avoids
 *     pulling in `sharp` etc.).
 *   - Path-guard checking on the SOURCE path (the user owns whatever they
 *     picked — the OS dialog is the gate). Path-guard applies only to the
 *     destination, which is always inside ArenaRoot by construction.
 *
 * Error semantics:
 *   - {@link AvatarValidationError} — recoverable, has a stable `code` for
 *     i18n mapping in the renderer (`ext_not_allowed`, `size_exceeded`,
 *     `source_missing`).
 *   - Anything else (EPERM, EACCES, EBUSY) bubbles unchanged so the caller
 *     sees the raw cause — these usually indicate a misconfigured ArenaRoot
 *     and should not be silently swallowed.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  ALLOWED_AVATAR_EXTENSIONS,
  AVATAR_MAX_BYTES,
  type AllowedAvatarExtension,
  type AvatarUploadResponse,
} from '../../shared/member-profile-types';
import type { ArenaRootService } from '../arena/arena-root-service';

export type AvatarValidationCode =
  | 'ext_not_allowed'
  | 'size_exceeded'
  | 'source_missing';

/**
 * Recoverable validation failure during {@link AvatarStore.copy}. The
 * `code` is the contract surface — UI maps it to an i18n key, not the
 * `message`. The message is for log lines only.
 */
export class AvatarValidationError extends Error {
  constructor(
    readonly code: AvatarValidationCode,
    message: string,
  ) {
    super(message);
    this.name = 'AvatarValidationError';
  }
}

/**
 * Allow-list lookup. Lower-cases the source ext (so `.JPEG` is treated as
 * `jpeg`) and maps it against {@link ALLOWED_AVATAR_EXTENSIONS}. Returns
 * `null` when the ext is not in the allow-list.
 */
function normaliseExt(sourcePath: string): AllowedAvatarExtension | null {
  const ext = path.extname(sourcePath).slice(1).toLowerCase();
  if (ext === '') return null;
  return (ALLOWED_AVATAR_EXTENSIONS as readonly string[]).includes(ext)
    ? (ext as AllowedAvatarExtension)
    : null;
}

export class AvatarStore {
  constructor(private readonly arena: ArenaRootService) {}

  /**
   * Copy the source file into `<ArenaRoot>/avatars/<providerId>.<ext>`.
   *
   * Sequence (each step throws on failure with no partial state):
   *   1. Validate source ext ∈ allow-list.
   *   2. Stat source — must exist + be a file.
   *   3. Validate size ≤ {@link AVATAR_MAX_BYTES}.
   *   4. `mkdir -p` the avatars dir (defensive — `ensure()` already did this
   *      at boot, but a user can delete it between boots).
   *   5. Remove any stale sibling files for the same providerId (different
   *      extension) so the member has exactly one custom avatar on disk.
   *   6. `fs.copyFileSync` — atomic on most filesystems, overwriting a
   *      previous same-ext upload.
   *
   * Returns the persisted relative path (POSIX-style — `avatars/<id>.<ext>`)
   * which the caller stores in `member_profiles.avatar_data` plus the
   * resolved absolute path for the renderer to preview before the next
   * `member:get-profile`.
   */
  copy(providerId: string, sourcePath: string): AvatarUploadResponse {
    const ext = normaliseExt(sourcePath);
    if (ext === null) {
      throw new AvatarValidationError(
        'ext_not_allowed',
        `extension not allowed: ${path.extname(sourcePath) || '(none)'}`,
      );
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(sourcePath);
    } catch {
      throw new AvatarValidationError(
        'source_missing',
        `source not readable: ${sourcePath}`,
      );
    }
    if (!stat.isFile()) {
      throw new AvatarValidationError(
        'source_missing',
        `source is not a regular file: ${sourcePath}`,
      );
    }
    if (stat.size > AVATAR_MAX_BYTES) {
      throw new AvatarValidationError(
        'size_exceeded',
        `source size ${stat.size} exceeds limit ${AVATAR_MAX_BYTES}`,
      );
    }

    const avatarsDir = this.arena.avatarsPath();
    fs.mkdirSync(avatarsDir, { recursive: true });

    // Remove stale siblings (different ext) for this providerId. Without
    // this step a png → jpg switch would leave the .png orphaned forever.
    for (const otherExt of ALLOWED_AVATAR_EXTENSIONS) {
      if (otherExt === ext) continue;
      const stale = path.join(avatarsDir, `${providerId}.${otherExt}`);
      if (fs.existsSync(stale)) {
        try {
          fs.unlinkSync(stale);
        } catch {
          // Non-fatal — the new file will still be the canonical avatar.
          // Logging is the caller's job (handler captures via main logger).
        }
      }
    }

    const destAbs = path.join(avatarsDir, `${providerId}.${ext}`);
    fs.copyFileSync(sourcePath, destAbs);

    return {
      // POSIX separator — the value is stored in DB and consumed by the
      // renderer; backslash on Windows would break the file:// URL builder.
      relativePath: path.posix.join('avatars', `${providerId}.${ext}`),
      absolutePath: destAbs,
    };
  }

  /**
   * Remove all custom-avatar files for `providerId`. Used when a member
   * picks a default avatar after having uploaded a custom one (renderer
   * EditModal calls `member:update-profile` with `avatarKind='default'`,
   * and the handler invokes `forget` to clean up the orphaned blob).
   *
   * Idempotent — never throws on missing files.
   */
  forget(providerId: string): void {
    const avatarsDir = this.arena.avatarsPath();
    if (!fs.existsSync(avatarsDir)) return;
    for (const ext of ALLOWED_AVATAR_EXTENSIONS) {
      const p = path.join(avatarsDir, `${providerId}.${ext}`);
      if (fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch {
          // Best effort — same rationale as `copy`.
        }
      }
    }
  }
}
