/**
 * MemberProfileRepository — thin data-access layer over `member_profiles`
 * (migration 001-core).
 *
 * Responsibilities:
 *   - Map the SQL snake_case columns to the shared camelCase
 *     `MemberProfile` interface (`src/shared/member-profile-types.ts`).
 *   - Expose primitive CRUD verbs — `get`, `upsert`, `setStatusOverride` —
 *     that the {@link MemberProfileService} composes. No business rules or
 *     event emission live here.
 *
 * Status override is a FIRST-CLASS column surface rather than a generic
 * update sink because it has different semantics from the editable profile
 * fields: it is the user's manual "leave work" toggle, must not be
 * overwritten by routine profile edits, and has a narrow value domain
 * (`'offline-manual' | null`). Routing it through a named mutator keeps
 * the whitelisted `upsert` path unambiguously safe.
 */

import type Database from 'better-sqlite3';
import type {
  AvatarKind,
  MemberProfile,
  StatusOverride,
} from '../../shared/member-profile-types';

/** Snake-case row shape returned by better-sqlite3. */
interface MemberProfileRow {
  provider_id: string;
  role: string | null;
  personality: string | null;
  expertise: string | null;
  avatar_kind: AvatarKind;
  avatar_data: string | null;
  status_override: StatusOverride;
  updated_at: number;
}

function rowToProfile(row: MemberProfileRow): MemberProfile {
  return {
    providerId: row.provider_id,
    role: row.role ?? '',
    personality: row.personality ?? '',
    expertise: row.expertise ?? '',
    avatarKind: row.avatar_kind,
    avatarData: row.avatar_data,
    statusOverride: row.status_override,
    updatedAt: row.updated_at,
  };
}

export class MemberProfileRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * Fetch the profile row for `providerId`, or `null` when none exists.
   *
   * NB: the absence of a row is a valid state — profiles are only
   * materialised on first `upsert`. Callers who want a default-populated
   * object go through {@link MemberProfileService.getProfile}.
   */
  get(providerId: string): MemberProfile | null {
    const row = this.db
      .prepare(
        `SELECT provider_id, role, personality, expertise,
                avatar_kind, avatar_data, status_override, updated_at
         FROM member_profiles WHERE provider_id = ?`,
      )
      .get(providerId) as MemberProfileRow | undefined;
    return row ? rowToProfile(row) : null;
  }

  /**
   * INSERT-or-UPDATE the full profile row. `providerId` is the conflict
   * target; every other column is replaced with the passed values. Callers
   * must merge with existing data (via `get` first) before calling here if
   * they only want to change a subset — this method does NOT attempt to
   * diff. The service layer handles the merge and keeps this primitive
   * deterministic.
   *
   * The FOREIGN KEY on `provider_id` is enforced when
   * `PRAGMA foreign_keys=ON`; an unknown provider surfaces as a SqliteError
   * with code `SQLITE_CONSTRAINT_FOREIGNKEY`.
   */
  upsert(profile: MemberProfile): void {
    this.db
      .prepare(
        `INSERT INTO member_profiles
           (provider_id, role, personality, expertise,
            avatar_kind, avatar_data, status_override, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider_id) DO UPDATE SET
           role = excluded.role,
           personality = excluded.personality,
           expertise = excluded.expertise,
           avatar_kind = excluded.avatar_kind,
           avatar_data = excluded.avatar_data,
           status_override = excluded.status_override,
           updated_at = excluded.updated_at`,
      )
      .run(
        profile.providerId,
        profile.role,
        profile.personality,
        profile.expertise,
        profile.avatarKind,
        profile.avatarData,
        profile.statusOverride,
        profile.updatedAt,
      );
  }

  /**
   * Persist only the `status_override` column + `updated_at`. If no row
   * exists for `providerId` we INSERT a minimal row using the schema
   * defaults for everything else — this matches the semantics callers
   * expect ("user toggled 'leave work' before editing their profile").
   *
   * `null` clears the override, restoring runtime-controlled status.
   */
  setStatusOverride(
    providerId: string,
    override: StatusOverride,
    updatedAt: number,
  ): void {
    this.db
      .prepare(
        `INSERT INTO member_profiles
           (provider_id, status_override, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(provider_id) DO UPDATE SET
           status_override = excluded.status_override,
           updated_at = excluded.updated_at`,
      )
      .run(providerId, override, updatedAt);
  }
}
