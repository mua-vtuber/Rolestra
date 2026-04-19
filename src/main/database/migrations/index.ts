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
import { migration as m001 } from './001-core';
import { migration as m002 } from './002-projects';
import { migration as m003 } from './003-channels';
import { migration as m004 } from './004-meetings';
import { migration as m005 } from './005-messages';
import { migration as m006 } from './006-approval-inbox';
import { migration as m007 } from './007-queue';

/**
 * Ordered list of all v3 migrations.
 * The migrator will apply them sequentially, skipping any already applied.
 */
export const migrations: Migration[] = [m001, m002, m003, m004, m005, m006, m007];
