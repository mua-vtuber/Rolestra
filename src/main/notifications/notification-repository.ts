/**
 * NotificationRepository — thin data-access layer over `notification_prefs`
 * and `notification_log` (migration 011-notifications).
 *
 * Responsibilities:
 *   - Map snake_case rows to the shared camelCase shapes declared in
 *     `src/shared/notification-types.ts` (NotificationPrefs,
 *     NotificationLogEntry).
 *   - Own the "default prefs row" insertion — `getPrefs()` is a read-repair
 *     surface: any missing `NotificationKind` key is upserted with the
 *     spec-mandated defaults (`enabled=true`, `soundEnabled=true`). This
 *     mirrors the CHECK constraint in migration 011 (the six allowed
 *     kinds) and guarantees every caller gets a complete map — no
 *     partial/undefined entries ever leak out of the repo.
 *   - Round-trip SQL INTEGER (0/1) ↔ JS boolean for the prefs table and
 *     `notification_log.clicked`.
 *
 * No business rules live here — gating on focus/enabled, UUID generation,
 * or event emission belong to {@link NotificationService}.
 *
 * Schema reference (migration 011-notifications.ts):
 *   notification_prefs(key TEXT PK CHECK(key IN 6 kinds),
 *                      enabled INTEGER, sound_enabled INTEGER)
 *   notification_log(id TEXT PK, kind, title, body,
 *                    channel_id (FK channels SET NULL), clicked, created_at)
 */

import type Database from 'better-sqlite3';
import type {
  NotificationKind,
  NotificationLogEntry,
  NotificationPrefs,
} from '../../shared/notification-types';

/**
 * Six NotificationKind values mirroring the CHECK constraint in migration
 * 011-notifications. Iterated by {@link NotificationRepository.getPrefs}
 * when read-repairing missing rows. Keep in sync with the spec.
 */
export const NOTIFICATION_KINDS: readonly NotificationKind[] = [
  'new_message',
  'approval_pending',
  'work_done',
  'error',
  'queue_progress',
  'meeting_state',
] as const;

/** Default pref values applied to any kind that is missing from the table. */
const DEFAULT_PREF = { enabled: true, soundEnabled: true } as const;

interface PrefRow {
  key: NotificationKind;
  enabled: number;
  sound_enabled: number;
}

interface LogRow {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  channel_id: string | null;
  clicked: number;
  created_at: number;
}

function rowToEntry(row: LogRow): NotificationLogEntry {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    channelId: row.channel_id,
    clicked: row.clicked === 1,
    createdAt: row.created_at,
  };
}

export interface ListLogOptions {
  /** Maximum rows to return. Clamped to `[1, LOG_LIST_MAX_LIMIT]`. */
  limit?: number;
  /** Restrict to a single kind (otherwise returns every kind). */
  kind?: NotificationKind;
}

/** Upper bound for `listLog` — matches the UX cap in the plan. */
export const LOG_LIST_MAX_LIMIT = 200;
export const LOG_LIST_DEFAULT_LIMIT = 50;

export class NotificationRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * Boot-time seed: inserts a default pref row for every kind that is
   * missing from `notification_prefs`, and returns the number of rows
   * inserted. Used by {@link NotificationService.seedDefaultPrefsIfEmpty}
   * so the R9 production wire logs a "seeded N kinds" count; callers that
   * just need a complete map should use {@link getPrefs} (which also
   * read-repairs but fetches afterwards).
   *
   * Uses `INSERT OR IGNORE` so repeat calls are idempotent and rows with
   * user-modified `enabled`/`sound_enabled` values are preserved.
   */
  seedDefaultPrefsIfEmpty(): number {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO notification_prefs (key, enabled, sound_enabled)
       VALUES (?, 1, 1)`,
    );
    let inserted = 0;
    const apply = this.db.transaction(() => {
      for (const kind of NOTIFICATION_KINDS) {
        const result = insert.run(kind);
        inserted += Number(result.changes);
      }
    });
    apply();
    return inserted;
  }

  /**
   * Returns a complete {@link NotificationPrefs} map. Any kind that is
   * missing from `notification_prefs` (first-boot / partial state) is
   * inserted with the default pref `{ enabled: true, soundEnabled: true }`
   * so callers never have to handle "undefined kind".
   *
   * The insert uses `INSERT OR IGNORE` so repeat calls are idempotent —
   * a concurrent writer would not double-insert, and a row already at
   * non-default values is preserved untouched.
   */
  getPrefs(): NotificationPrefs {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO notification_prefs (key, enabled, sound_enabled)
       VALUES (?, 1, 1)`,
    );
    const select = this.db.prepare(
      `SELECT key, enabled, sound_enabled FROM notification_prefs`,
    );

    // Read-repair in a single transaction so a caller never observes a
    // partial table (e.g. half the kinds inserted). If any insert fails
    // the transaction rolls back and the error surfaces to the caller.
    const repair = this.db.transaction(() => {
      for (const kind of NOTIFICATION_KINDS) {
        insert.run(kind);
      }
    });
    repair();

    const rows = select.all() as PrefRow[];
    // Seed with defaults so missing rows (which should not exist after the
    // repair above, but be robust to a racing DELETE) still round-trip.
    const prefs = {} as NotificationPrefs;
    for (const kind of NOTIFICATION_KINDS) {
      prefs[kind] = { ...DEFAULT_PREF };
    }
    for (const row of rows) {
      prefs[row.key] = {
        enabled: row.enabled === 1,
        soundEnabled: row.sound_enabled === 1,
      };
    }
    return prefs;
  }

  /**
   * Applies a partial update to {@link NotificationPrefs}. Only the kinds
   * present in `patch` are touched; others are left alone. Each touched
   * kind is written with `INSERT ... ON CONFLICT DO UPDATE` so the call is
   * safe whether or not a row already exists.
   *
   * Returns the complete prefs map AFTER the update (via `getPrefs()`) so
   * callers never have to stitch patch + old state themselves.
   */
  updatePrefs(patch: Partial<NotificationPrefs>): NotificationPrefs {
    const upsert = this.db.prepare(
      `INSERT INTO notification_prefs (key, enabled, sound_enabled)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         enabled = excluded.enabled,
         sound_enabled = excluded.sound_enabled`,
    );

    // Fetch current state once so each kind's upsert preserves whichever
    // flag the caller did NOT include. `getPrefs` also read-repairs any
    // missing defaults so `current[kind]` is always populated.
    const current = this.getPrefs();

    const apply = this.db.transaction(() => {
      for (const kind of NOTIFICATION_KINDS) {
        const entry = patch[kind];
        if (entry === undefined) continue;
        const next = { ...current[kind], ...entry };
        upsert.run(kind, next.enabled ? 1 : 0, next.soundEnabled ? 1 : 0);
      }
    });
    apply();

    return this.getPrefs();
  }

  /**
   * Appends a notification log row. The caller owns `id` (UUID) and
   * `createdAt` (epoch ms). `channelId=null` is stored as SQL NULL so a
   * later `channels` deletion can set it to NULL via the FK clause.
   */
  insertLog(entry: NotificationLogEntry): void {
    this.db
      .prepare(
        `INSERT INTO notification_log
           (id, kind, title, body, channel_id, clicked, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.kind,
        entry.title,
        entry.body,
        entry.channelId,
        entry.clicked ? 1 : 0,
        entry.createdAt,
      );
  }

  /**
   * Marks a previously-emitted notification as clicked. Silently no-ops
   * when the id is unknown — clicks fire asynchronously from the OS and
   * the corresponding row may have been pruned by a cleanup pass (future
   * work).
   */
  markClicked(id: string): void {
    this.db
      .prepare(`UPDATE notification_log SET clicked = 1 WHERE id = ?`)
      .run(id);
  }

  /**
   * Lists log rows newest-first, optionally filtered by `kind`. `limit` is
   * clamped to `[1, LOG_LIST_MAX_LIMIT]`.
   */
  listLog(opts: ListLogOptions = {}): NotificationLogEntry[] {
    const limit = clampLimit(
      opts.limit,
      LOG_LIST_DEFAULT_LIMIT,
      LOG_LIST_MAX_LIMIT,
    );

    if (opts.kind !== undefined) {
      const rows = this.db
        .prepare(
          `SELECT id, kind, title, body, channel_id, clicked, created_at
           FROM notification_log
           WHERE kind = ?
           ORDER BY created_at DESC, rowid DESC
           LIMIT ?`,
        )
        .all(opts.kind, limit) as LogRow[];
      return rows.map(rowToEntry);
    }

    const rows = this.db
      .prepare(
        `SELECT id, kind, title, body, channel_id, clicked, created_at
         FROM notification_log
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?`,
      )
      .all(limit) as LogRow[];
    return rows.map(rowToEntry);
  }
}

/** Clamps a user-supplied limit into `[1, max]` with a default fallback. */
function clampLimit(
  raw: number | undefined,
  defaultValue: number,
  max: number,
): number {
  if (raw === undefined) return defaultValue;
  if (!Number.isFinite(raw)) return defaultValue;
  const n = Math.floor(raw);
  if (n < 1) return 1;
  if (n > max) return max;
  return n;
}
