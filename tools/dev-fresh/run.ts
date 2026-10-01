/**
 * F4-3 (spec `docs/specs/2026-09-29-ai-setup-and-character.md`) —
 * `npm run dev:fresh`.
 *
 * Runs the app against a brand-new temp folder every invocation, so the
 * onboarding / empty-state screens are visible without touching (reading
 * OR writing) the user's real `%APPDATA%\Rolestra` (or platform
 * equivalent). Does three things in order:
 *
 *   1. Rebuild the native module for the current Electron ABI
 *      (`npm run rebuild:electron` normally runs via `predev`, which is
 *      an npm lifecycle hook tied to the exact script name `dev` — it
 *      does NOT fire for a differently-named script like `dev:fresh`,
 *      so this script does it explicitly, first, and waits for it to
 *      finish before launching Electron).
 *   2. Compute a fresh temp folder layout (see `paths.ts`), create it, and
 *      print it. The chat CLI working folder is `<ArenaRoot>/consensus`, so
 *      the ArenaRoot override below already keeps every CLI run inside this
 *      temp folder (never the user's REAL `Documents\Rolestra`).
 *   3. Launch `electron-vite dev` with `ROLESTRA_DEV_USER_DATA` +
 *      `ROLESTRA_ARENA_ROOT` set to that layout — `src/main/index.ts`
 *      reads the first (via `applyDevUserDataOverride`,
 *      `src/main/config/dev-userdata-override.ts`) and
 *      `ArenaRootService` reads the second (already-existing
 *      `ARENA_ROOT_ENV_OVERRIDE`, used today by the Playwright E2E
 *      harness the same way).
 *
 * Both child processes are spawned with a structured argv (never a shell
 * string — CLAUDE.md "셸 문자열 실행 금지") by resolving each package's
 * real JS bin entry (see `resolve-bin.ts`) and running it with the
 * CURRENT node executable (`process.execPath`), so this script needs no
 * new dependency — `electron-vite` and `@electron/rebuild` are already
 * installed devDependencies, and `tsx` (already a devDependency) is what
 * runs this file itself.
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDevFreshEnv, computeDevFreshLayoutInOsTmp } from './paths';
import { inferRepoRoot, resolveNodeModulesBin } from './resolve-bin';

const thisFileDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = inferRepoRoot(thisFileDir);

/** Run a child process to completion with the current node executable, structured argv, inherited stdio. */
function runToCompletion(
  nodeScript: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; label: string },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [nodeScript, ...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: 'inherit',
      shell: false,
      windowsHide: false,
    });
    child.on('error', (err) => {
      reject(new Error(`dev-fresh: failed to start ${options.label}: ${err.message}`));
    });
    child.on('exit', (code, signal) => {
      if (signal !== null) {
        reject(new Error(`dev-fresh: ${options.label} was terminated by signal ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`dev-fresh: ${options.label} exited with code ${code}`));
        return;
      }
      resolve();
    });
  });
}

async function main(): Promise<void> {
  // 1. Rebuild the native module first — electron-vite dev must not start
  //    against a stale/mismatched better-sqlite3 binary.
  const rebuildEntry = resolveNodeModulesBin(repoRoot, '@electron/rebuild', 'electron-rebuild');
  console.log('[dev:fresh] Rebuilding native modules for Electron...');
  await runToCompletion(
    rebuildEntry,
    ['-f', '-w', 'better-sqlite3'],
    { cwd: repoRoot, env: process.env, label: 'electron-rebuild' },
  );

  // 2. Compute + create the fresh folder layout.
  const layout = computeDevFreshLayoutInOsTmp(randomUUID());
  mkdirSync(layout.userDataPath, { recursive: true });
  mkdirSync(layout.arenaRootPath, { recursive: true });

  console.log(`[dev:fresh] Fresh run folder: ${layout.runRoot}`);
  console.log(`[dev:fresh]   userData: ${layout.userDataPath}`);
  console.log(`[dev:fresh]   arena root (chat data + consensus/ CLI folder): ${layout.arenaRootPath}`);
  console.log('[dev:fresh] The existing %APPDATA%\\Rolestra (or platform equivalent) profile is not read or written.');

  // 3. Launch electron-vite dev with the two overrides layered onto the
  //    current environment — this call does not resolve until the dev
  //    server process exits (Ctrl+C from the user, typically).
  const viteEntry = resolveNodeModulesBin(repoRoot, 'electron-vite', 'electron-vite');
  const childEnv = buildDevFreshEnv(process.env, layout);
  console.log('[dev:fresh] Starting electron-vite dev...');
  await runToCompletion(
    viteEntry,
    ['dev'],
    { cwd: repoRoot, env: childEnv, label: 'electron-vite dev' },
  );
}

main().catch((err: unknown) => {
  console.error('[dev:fresh] Failed:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
