import type { Migration } from '../migrator';

/**
 * One-time install facts (spec 2026-10-08 F1). The global general channel is
 * created once on first run and never again after the user deletes it; the
 * `general_channel_provisioned` marker row records that it was created.
 *
 * A fresh DB gets no marker here, so the first boot creates the general
 * channel together with its marker (`GeneralChannelService.provisionOnFirstRun`).
 * An existing install that already has the general channel gets the marker
 * now, dated from that channel's creation, so nothing changes for it until
 * the user deletes the channel.
 *
 * The marker name is spelled out here rather than imported so this migration
 * keeps meaning the same thing if the app constant changes later. `WHERE
 * EXISTS` instead of `HAVING` because old SQLite rejects HAVING without GROUP
 * BY. Idempotent: `IF NOT EXISTS` and `INSERT OR IGNORE`; no existing table or
 * row is changed.
 */
export const migration: Migration = {
  id: '039-install-markers',
  sql: `
CREATE TABLE IF NOT EXISTS app_install_markers (
  marker TEXT PRIMARY KEY,
  recorded_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO app_install_markers (marker, recorded_at)
SELECT 'general_channel_provisioned',
       (SELECT MIN(created_at) FROM channels
         WHERE kind = 'system_general' AND project_id IS NULL)
 WHERE EXISTS (SELECT 1 FROM channels
                WHERE kind = 'system_general' AND project_id IS NULL);
`,
};
