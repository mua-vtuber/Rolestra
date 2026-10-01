/**
 * F4-1/F4-3 (spec `docs/specs/2026-09-29-ai-setup-and-character.md`) —
 * pure path/env helpers for `npm run dev:fresh`.
 *
 * Split out from `run.ts` (the actual process-spawning script) so this
 * module has zero side effects and can be unit-tested without touching
 * the filesystem or spawning anything.
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Env var Electron's main process reads to redirect `userData` in a dev run — see `src/main/config/dev-userdata-override.ts`. */
export const DEV_USER_DATA_OVERRIDE_ENV = 'ROLESTRA_DEV_USER_DATA';

/** Env var `ArenaRootService` reads to redirect the chat data root — see `src/main/arena/arena-root-service.ts` (`ARENA_ROOT_ENV_OVERRIDE`). */
export const ARENA_ROOT_ENV = 'ROLESTRA_ARENA_ROOT';

/** Prefix for the per-run temp folder name, so a stray leftover is identifiable in the OS temp directory. */
const DEV_FRESH_FOLDER_PREFIX = 'rolestra-dev-fresh-';

/**
 * `userData` lives directly under the run folder; the chat ArenaRoot gets its
 * own named subfolder so the two never collide. The chat CLI working folder
 * is always `<ArenaRoot>/consensus`, so redirecting the ArenaRoot also keeps
 * every CLI run out of the user's real `Documents\Rolestra`.
 */
const ARENA_SUBDIR_NAME = 'arena';

export interface DevFreshLayout {
  /** The freshly-created run-scoped temp folder (parent of all paths below). */
  runRoot: string;
  /** Value to set `ROLESTRA_DEV_USER_DATA` to. */
  userDataPath: string;
  /** Value to set `ROLESTRA_ARENA_ROOT` to (chat data + the `consensus/` CLI folder). */
  arenaRootPath: string;
}

/**
 * Compute the folder layout for one `dev:fresh` run, given a base temp
 * directory and a uniqueness token. Pure — does not touch the filesystem.
 *
 * `uniqueToken` is injected (rather than this function calling
 * `randomUUID()` itself) so a test can assert a deterministic layout; the
 * real caller in `run.ts` passes `randomUUID()`.
 */
export function computeDevFreshLayout(baseTmpDir: string, uniqueToken: string): DevFreshLayout {
  const runRoot = join(baseTmpDir, `${DEV_FRESH_FOLDER_PREFIX}${uniqueToken}`);
  return {
    runRoot,
    userDataPath: join(runRoot, 'userData'),
    arenaRootPath: join(runRoot, ARENA_SUBDIR_NAME),
  };
}

/** Same as {@link computeDevFreshLayout} but rooted at the OS temp directory — what the real script actually calls. */
export function computeDevFreshLayoutInOsTmp(uniqueToken: string): DevFreshLayout {
  return computeDevFreshLayout(tmpdir(), uniqueToken);
}

/**
 * Build the child-process environment for the Electron dev run: the
 * caller's own `process.env` plus the two overrides layered on top. A
 * plain object merge (not a mutation of `process.env`) so this stays a
 * pure function the caller can unit-test.
 */
export function buildDevFreshEnv(
  baseEnv: NodeJS.ProcessEnv,
  layout: DevFreshLayout,
): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    [DEV_USER_DATA_OVERRIDE_ENV]: layout.userDataPath,
    [ARENA_ROOT_ENV]: layout.arenaRootPath,
  };
}
