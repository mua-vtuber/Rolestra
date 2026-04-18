/**
 * Migration registry.
 *
 * All migrations must be listed here in sequential order.
 * New migrations should be appended to the end of the array.
 *
 * IMPORTANT: Never reorder or remove entries from this list.
 * Migrations are forward-only and immutable once applied.
 */

import type { Migration } from '../migrator';
import migration001 from './001-initial-schema';
import migration002 from './002-recovery-tables';
import migration003 from './003-remote-tables';
import migration004 from './004-memory-enhancement';
import migration005 from './005-consensus-records';
import migration006 from './006-consensus-summary';
import migration007 from './007-session-mode-columns';

/**
 * Ordered list of all migrations.
 * The migrator will apply them sequentially, skipping any already applied.
 */
export const migrations: readonly Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
];
