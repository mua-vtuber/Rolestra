/**
 * ChannelRepository — thin data-access layer over the `channels` +
 * `channel_members` tables introduced in migration 003-channels +
 * 018-channels-role-purpose-handoff (R12-C 채널 역할).
 *
 * Responsibilities:
 *   - Map the SQL snake_case columns to the shared camelCase `Channel` /
 *     `ChannelMember` interfaces (`src/shared/channel-types.ts`).
 *   - Expose CRUD primitives the {@link ChannelService} composes into
 *     atomic transactions. No filesystem work, no policy logic.
 *   - Preserve the `read_only` INTEGER ↔ boolean mapping at the boundary
 *     so the rest of the codebase sees a proper boolean.
 *   - R12-C: `role` / `purpose` / `handoff_mode` (channels) + `drag_order`
 *     (channel_members) round-trip + parseRole / parseHandoffMode throw
 *     on unknown values (silent fallback 금지).
 *
 * Update safety:
 *   `update(id, patch)` whitelists the columns a caller may change. `id` /
 *   `project_id` / `kind` / `created_at` are structural invariants and stay
 *   read-only after insertion — the whitelist is the only thing standing
 *   between a future bug and silent mutation of those fields.
 */

import type Database from 'better-sqlite3';
import type {
  Channel,
  ChannelKind,
  ChannelMember,
} from '../../shared/channel-types';
import type {
  ChannelPurpose,
  ChannelRole,
  HandoffMode,
} from '../../shared/channel-role-types';
import { isHandoffMode } from '../../shared/channel-role-types';
import { isRoleId } from '../../shared/role-types';

/** Snake-case row shape as returned by better-sqlite3. */
interface ChannelRow {
  id: string;
  project_id: string | null;
  name: string;
  kind: ChannelKind;
  read_only: number; // 0|1
  created_at: number;
  role: string | null;
  purpose: string | null;
  handoff_mode: string;
  /** R12-C2 (migration 019) — 회의 자유 토론 라운드 cap. NULL = 무제한. */
  max_rounds: number | null;
}

interface ChannelMemberRow {
  channel_id: string;
  project_id: string | null;
  provider_id: string;
  drag_order: number | null;
}

/**
 * Columns `update()` is allowed to mutate. Everything else — `id`,
 * `project_id`, `kind`, `created_at` — stays read-only after insertion.
 */
const _UPDATABLE_COLUMNS = [
  'name',
  'read_only',
  'role',
  'purpose',
  'handoff_mode',
  'max_rounds',
] as const;

type UpdatableColumn = (typeof _UPDATABLE_COLUMNS)[number];

/** Camel-case patch accepted by `update()`. */
export interface ChannelUpdatePatch {
  name?: string;
  readOnly?: boolean;
  role?: ChannelRole;
  purpose?: ChannelPurpose;
  handoffMode?: HandoffMode;
  /**
   * R12-C2 — 회의 라운드 cap. `null` = 무제한, 정수 = N 라운드 cap.
   * `undefined` 는 patch 에서 누락 (변경 안 함) 의미.
   */
  maxRounds?: number | null;
}

/**
 * camelCase patch key → snake_case column. Kept in sync with
 * `_UPDATABLE_COLUMNS`. Any camelCase key not in this map is silently
 * dropped by `update()` — defence in depth if the TS type is bypassed.
 */
const PATCH_KEY_TO_COLUMN: Record<keyof ChannelUpdatePatch, UpdatableColumn> = {
  name: 'name',
  readOnly: 'read_only',
  role: 'role',
  purpose: 'purpose',
  handoffMode: 'handoff_mode',
  maxRounds: 'max_rounds',
};

/** SELECT projection — keep in sync between get/listByProject/listDms/getDmByProvider/getGlobalGeneralChannel. */
const CHANNEL_COLUMNS =
  'id, project_id, name, kind, read_only, created_at, role, purpose, handoff_mode, max_rounds';

const MEMBER_COLUMNS = 'channel_id, project_id, provider_id, drag_order';

function parseRole(raw: string | null, channelId: string): ChannelRole {
  if (raw === null) return null;
  if (isRoleId(raw)) return raw;
  throw new Error(
    `ChannelRepository: unknown role '${raw}' for channel '${channelId}'. ` +
      `Add to RoleId union or migrate row.`,
  );
}

function parseHandoffMode(raw: string, channelId: string): HandoffMode {
  if (isHandoffMode(raw)) return raw;
  throw new Error(
    `ChannelRepository: unknown handoff_mode '${raw}' for channel '${channelId}'. ` +
      `Allowed: 'check' | 'auto'.`,
  );
}

function rowToChannel(row: ChannelRow): Channel {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    kind: row.kind,
    readOnly: row.read_only === 1,
    createdAt: row.created_at,
    role: parseRole(row.role, row.id),
    purpose: row.purpose,
    handoffMode: parseHandoffMode(row.handoff_mode, row.id),
    maxRounds: row.max_rounds,
  };
}

function rowToMember(row: ChannelMemberRow): ChannelMember {
  return {
    channelId: row.channel_id,
    projectId: row.project_id,
    providerId: row.provider_id,
    dragOrder: row.drag_order,
  };
}

export class ChannelRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * Runs `fn` inside a better-sqlite3 transaction. Synchronous by design
   * — better-sqlite3 transactions cannot span awaits. Exposed so the
   * service can compose `insert` + multiple `addMember` calls into a
   * single atomic write.
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /** Returns the channel row, or `null` when the id is unknown. */
  get(id: string): Channel | null {
    const row = this.db
      .prepare(`SELECT ${CHANNEL_COLUMNS} FROM channels WHERE id = ?`)
      .get(id) as ChannelRow | undefined;
    return row ? rowToChannel(row) : null;
  }

  /**
   * Lists channels belonging to the given project. System channels first
   * (ordered by their kind — `system_general` < `system_approval` <
   * `system_minutes`), then user channels by `created_at` ascending.
   *
   * The `kind_order` expression is a CASE-based secondary ordering; SQLite
   * has no ENUM type so we manually assign sort positions here.
   */
  listByProject(projectId: string): Channel[] {
    const rows = this.db
      .prepare(
        `SELECT ${CHANNEL_COLUMNS},
                CASE kind
                  WHEN 'system_general'  THEN 0
                  WHEN 'system_approval' THEN 1
                  WHEN 'system_minutes'  THEN 2
                  WHEN 'user'            THEN 3
                  ELSE 4
                END AS kind_order
         FROM channels
         WHERE project_id = ?
         ORDER BY kind_order ASC, created_at ASC`,
      )
      .all(projectId) as ChannelRow[];
    return rows.map(rowToChannel);
  }

  /** Lists every DM channel (project_id IS NULL, kind = 'dm'). */
  listDms(): Channel[] {
    const rows = this.db
      .prepare(
        `SELECT ${CHANNEL_COLUMNS}
         FROM channels
         WHERE project_id IS NULL AND kind = 'dm'
         ORDER BY created_at ASC`,
      )
      .all() as ChannelRow[];
    return rows.map(rowToChannel);
  }

  /**
   * Returns the DM channel for the given provider, or `null` when no DM
   * exists. Relies on the partial unique index `idx_dm_unique_per_provider`
   * which guarantees at most one row.
   */
  getDmByProvider(providerId: string): Channel | null {
    const row = this.db
      .prepare(
        `SELECT ${CHANNEL_COLUMNS
          .split(', ')
          .map((c) => `c.${c}`)
          .join(', ')}
         FROM channels c
         JOIN channel_members cm ON cm.channel_id = c.id
         WHERE c.project_id IS NULL
           AND c.kind = 'dm'
           AND cm.provider_id = ?`,
      )
      .get(providerId) as ChannelRow | undefined;
    return row ? rowToChannel(row) : null;
  }

  /**
   * R12-C — Returns the global general channel (project_id IS NULL,
   * kind = 'system_general'). After migration 018 there is at most one
   * such row. Returns null when none exists yet (app boot before
   * `ensureGlobalGeneralChannel`).
   */
  getGlobalGeneralChannel(): Channel | null {
    const row = this.db
      .prepare(
        `SELECT ${CHANNEL_COLUMNS}
         FROM channels
         WHERE project_id IS NULL AND kind = 'system_general'
         LIMIT 1`,
      )
      .get() as ChannelRow | undefined;
    return row ? rowToChannel(row) : null;
  }

  /**
   * Inserts a fully-populated channel row. Caller is responsible for
   * generating `id` (UUID) and `created_at`. No side-effects on
   * channel_members — wire that up with {@link addMember} inside the
   * same transaction.
   */
  insert(channel: Channel): void {
    this.db
      .prepare(
        `INSERT INTO channels
           (id, project_id, name, kind, read_only, created_at, role, purpose, handoff_mode, max_rounds)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        channel.id,
        channel.projectId,
        channel.name,
        channel.kind,
        channel.readOnly ? 1 : 0,
        channel.createdAt,
        channel.role,
        channel.purpose,
        channel.handoffMode,
        channel.maxRounds,
      );
  }

  /**
   * Applies a whitelisted column patch. Keys absent from
   * `PATCH_KEY_TO_COLUMN` are dropped silently. Returns `true` when at
   * least one column was updated (ie. row with `id` existed AND patch had
   * at least one writable key).
   */
  update(id: string, patch: ChannelUpdatePatch): boolean {
    const assignments: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(patch) as [
      keyof ChannelUpdatePatch,
      ChannelUpdatePatch[keyof ChannelUpdatePatch],
    ][]) {
      if (value === undefined) continue;
      const column = PATCH_KEY_TO_COLUMN[key];
      if (!column) continue; // defensive — impossible with the TS type
      assignments.push(`${column} = ?`);
      values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
    }

    if (assignments.length === 0) return false;

    values.push(id);
    const result = this.db
      .prepare(`UPDATE channels SET ${assignments.join(', ')} WHERE id = ?`)
      .run(...values);
    return result.changes > 0;
  }

  /**
   * Hard-deletes a row. ON DELETE CASCADE tears down channel_members.
   * The caller (service layer) is responsible for enforcing the
   * "system channels cannot be deleted" policy before invoking this.
   */
  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM channels WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ── channel_members ────────────────────────────────────────────────

  /**
   * Inserts a member row. The composite FK `(project_id, provider_id) →
   * project_members` is enforced by SQLite when `project_id` is non-null.
   * For DM channels both `channelProjectId` and the DM row itself are
   * NULL, so the composite FK is skipped (SQL-92 behaviour: any NULL in
   * the referenced set suppresses the check).
   *
   * Uses plain `INSERT` (not `INSERT OR IGNORE`) because the DM
   * partial-unique index (`idx_dm_unique_per_provider`) must surface as
   * a constraint violation for the service layer to translate into
   * {@link DuplicateDmError}. Idempotency is the service layer's job
   * when it needs it — see `ChannelService.addMember`.
   */
  addMember(
    channelId: string,
    channelProjectId: string | null,
    providerId: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO channel_members (channel_id, project_id, provider_id)
         VALUES (?, ?, ?)`,
      )
      .run(channelId, channelProjectId, providerId);
  }

  /**
   * Removes a member. Returns `true` when a row was actually deleted
   * (the pair existed), `false` when it did not.
   */
  removeMember(channelId: string, providerId: string): boolean {
    const result = this.db
      .prepare(
        'DELETE FROM channel_members WHERE channel_id = ? AND provider_id = ?',
      )
      .run(channelId, providerId);
    return result.changes > 0;
  }

  /**
   * Lists members of `channelId`. R12-C: ordered by `drag_order` ASC
   * with NULLS LAST (unset members go to the bottom), then `provider_id`
   * for stability. SQLite has no NULLS LAST keyword so we use the
   * `(drag_order IS NULL) ASC` trick.
   */
  listMembers(channelId: string): ChannelMember[] {
    const rows = this.db
      .prepare(
        `SELECT ${MEMBER_COLUMNS}
         FROM channel_members
         WHERE channel_id = ?
         ORDER BY (drag_order IS NULL) ASC, drag_order ASC, provider_id ASC`,
      )
      .all(channelId) as ChannelMemberRow[];
    return rows.map(rowToMember);
  }

  /**
   * R12-C — Reorders members atomically. `providerOrderedIds[i]` gets
   * `drag_order = i`. Members not in the list have their `drag_order`
   * left untouched (caller passes the full ordered list).
   *
   * Throws when any provider in the list is not a current member of
   * the channel (prevents silent drift between UI state and DB).
   */
  reorderMembers(channelId: string, providerOrderedIds: string[]): void {
    const stmt = this.db.prepare(
      `UPDATE channel_members
          SET drag_order = ?
        WHERE channel_id = ? AND provider_id = ?`,
    );
    this.transaction(() => {
      providerOrderedIds.forEach((providerId, idx) => {
        const result = stmt.run(idx, channelId, providerId);
        if (result.changes === 0) {
          throw new Error(
            `ChannelRepository.reorderMembers: provider '${providerId}' is not a member of channel '${channelId}'`,
          );
        }
      });
    });
  }
}
