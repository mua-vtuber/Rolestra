/**
 * v3 migration chain (Rolestra).
 *
 * Files 001~011 are populated in Phase R2 Tasks 1-3.
 * v2 migrations were archived prior to R11 and are no longer in tree.
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
import { migration as m008 } from './008-memory';
import { migration as m009 } from './009-audit';
import { migration as m010 } from './010-remote';
import { migration as m011 } from './011-notifications';
import { migration as m012 } from './012-circuit-breaker-state';
import { migration as m013 } from './013-onboarding-state';
import { migration as m014 } from './014-llm-cost-audit-log';
import { migration as m015 } from './015-approval-circuit-breaker-kind';
import { migration as m016 } from './016-meeting-paused-and-kind';
import { migration as m017 } from './017-providers-roles-skills';
import { migration as m018 } from './018-channels-role-purpose-handoff';
import { migration as m019 } from './019-opinion-tables';

/**
 * Ordered list of all v3 migrations.
 * The migrator will apply them sequentially, skipping any already applied.
 */
export const migrations: Migration[] = [
  m001,
  m002,
  m003,
  m004,
  m005,
  m006,
  m007,
  m008,
  m009,
  m010,
  m011,
  m012,
  m013,
  m014,
  m015,
  m016,
  m017,
  m018,
  m019,
];
