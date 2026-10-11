import type Database from 'better-sqlite3';

/**
 * Marker row recording that the global general channel was created once
 * (spec 2026-10-08 F1, migration 039). Its presence stops boot from creating
 * the channel again after the user deleted it.
 */
export const GENERAL_CHANNEL_PROVISIONED_MARKER = 'general_channel_provisioned';

/**
 * SQL for the general channel's lifecycle: the `app_install_markers` table
 * and the single DELETE that removes the global general channel row. Reading
 * and inserting the channel row itself stays in `ChannelRepository`.
 */
export class GeneralChannelRepository {
  constructor(private readonly db: Database.Database) {}

  /** Runs `fn` in one SQLite transaction (all or nothing). */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  hasMarker(marker: string): boolean {
    const row = this.db
      .prepare('SELECT 1 AS present FROM app_install_markers WHERE marker = ?')
      .get(marker) as { present: number } | undefined;
    return row !== undefined;
  }

  /** Records a marker once; a second call keeps the first `recorded_at`. */
  recordMarker(marker: string, recordedAt: number): void {
    this.db
      .prepare('INSERT OR IGNORE INTO app_install_markers (marker, recorded_at) VALUES (?, ?)')
      .run(marker, recordedAt);
  }

  /**
   * Deletes the global general channel row. Foreign keys cascade its
   * messages, opinion cards, votes, whisper rounds, CLI sessions and read
   * marker; notification rows keep their history with `channel_id = NULL`.
   *
   * @throws when the delete did not remove exactly one row.
   */
  deleteGeneral(channelId: string): void {
    const result = this.db
      .prepare(
        `DELETE FROM channels
         WHERE id = ? AND kind = 'system_general' AND project_id IS NULL`,
      )
      .run(channelId);
    if (result.changes !== 1) {
      throw new Error(`Global general channel delete removed ${result.changes} rows: ${channelId}`);
    }
  }
}
