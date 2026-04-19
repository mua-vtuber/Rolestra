/**
 * v3 migration chain (Rolestra).
 *
 * Files 001~011 are populated in Phase R2 Tasks 1-3.
 * v2 migrations archived under `_legacy/migrations-v2/` (see README there).
 *
 * IMPORTANT: Never reorder or remove entries once added.
 * Migrations are forward-only and immutable once applied.
 */

import type { Migration } from '../migrator';

/**
 * Ordered list of all v3 migrations.
 * The migrator will apply them sequentially, skipping any already applied.
 */
export const migrations: Migration[] = [];
