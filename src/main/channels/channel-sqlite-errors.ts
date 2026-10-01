interface SqliteErrorLike {
  code?: unknown;
  message?: unknown;
}

export function asSqliteErr(err: unknown): SqliteErrorLike | null {
  if (!err || typeof err !== 'object') return null;
  return err as SqliteErrorLike;
}

export function isChannelNameUniqueViolation(err: unknown): boolean {
  const e = asSqliteErr(err);
  if (!e) return false;
  if (e.code !== 'SQLITE_CONSTRAINT_UNIQUE') return false;
  if (typeof e.message !== 'string') return false;
  // SQLite reports either "channels.project_id, channels.name" or the
  // index name depending on whether an explicit index exists. The base
  // table-constraint form is what migration 003 produces.
  return (
    e.message.includes('channels.project_id') &&
    e.message.includes('channels.name')
  );
}

export function isDmUniqueViolation(err: unknown): boolean {
  const e = asSqliteErr(err);
  if (!e) return false;
  if (e.code !== 'SQLITE_CONSTRAINT_UNIQUE') return false;
  if (typeof e.message !== 'string') return false;
  // SQLite reports the partial unique index violation as either the
  // index name ("idx_dm_unique_per_provider") OR the column form
  // ("channel_members.provider_id") depending on version/flags. Both
  // phrasings mean the same thing here since the index is the ONLY
  // uniqueness constraint that mentions `channel_members.provider_id`
  // — the table's own PK is the composite `(channel_id, provider_id)`
  // which reports both columns.
  return (
    e.message.includes('idx_dm_unique_per_provider') ||
    e.message === 'UNIQUE constraint failed: channel_members.provider_id'
  );
}

export function isMemberFkViolation(err: unknown): boolean {
  const e = asSqliteErr(err);
  if (!e) return false;
  // better-sqlite3 reports plain `SQLITE_CONSTRAINT_FOREIGNKEY` — it
  // does not disambiguate which FK failed. For `addMember` there is
  // exactly one FK that can fail (the composite project_members FK;
  // the `channels(id)` FK would only fail if `channelId` were bogus,
  // which we've pre-checked), so attribution is unambiguous at the
  // call site.
  return e.code === 'SQLITE_CONSTRAINT_FOREIGNKEY';
}
