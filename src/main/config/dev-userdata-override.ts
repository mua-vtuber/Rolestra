/**
 * F4-1/F4-2 (spec `docs/specs/2026-09-29-ai-setup-and-character.md`) —
 * dev-only `userData` folder override.
 *
 * Every config/secrets/DB path in this app is ultimately anchored at
 * `app.getPath('userData')` (see `src/main/config/instance.ts` ~26,
 * `src/main/database/connection.ts`'s legacy-DB detection, and
 * `initializeFoundation` in `src/main/bootstrap/foundation.ts`, which is
 * the FIRST thing `main/index.ts` runs after `app.whenReady()`). Until now
 * the only way to run against a throwaway profile was the Playwright E2E
 * harness, which launches a bootstrap script that calls
 * `app.setPath('userData', …)` itself — there was no equivalent for a
 * human running `npm run dev` who wants to see the first-run / onboarding
 * screen without touching their real `%APPDATA%\Rolestra` (or
 * `~/Library/Application Support/Rolestra`, `~/.config/Rolestra`) data.
 *
 * `applyDevUserDataOverride` closes that gap: when the named env var is a
 * non-empty string AND the app is NOT packaged, it calls
 * `app.setPath('userData', …)` before anything else can read the old
 * path. It is a deliberate no-op otherwise:
 *   - packaged build: always ignored, even if the env var somehow leaked
 *     into the installed app's environment — an end user's real data
 *     folder must never be silently redirected by a stray env var.
 *   - dev build, env var unset/empty: ordinary `npm run dev` keeps using
 *     the user's real `userData` folder exactly as before this feature
 *     shipped.
 *
 * `tools/dev-fresh.ts` is the only production caller that actually SETS
 * this env var (for the launched Electron child process) — see that
 * script for how the temp folder is created and the path is printed.
 */

import type { App } from 'electron';

/**
 * Env var name (F4-1) carrying the ABSOLUTE path Electron should use as
 * `userData` in a dev run. Exported as a named constant (not a literal
 * string) so `tools/dev-fresh.ts` sets exactly the same key this module
 * reads — a typo in either place would otherwise silently fail to connect
 * the two ends.
 */
export const DEV_USER_DATA_OVERRIDE_ENV = 'ROLESTRA_DEV_USER_DATA';

/**
 * Apply the dev-only `userData` override, if applicable.
 *
 * MUST be called before any code reads `app.getPath('userData')` —
 * `main/index.ts` calls this as its very first statement, ahead of even
 * `app.setName(...)` in source order is not required (setPath does not
 * depend on the app name), but it must run ahead of
 * `initializeFoundation` / `getConfigService()`.
 *
 * @returns the applied path, or `null` when the override did not apply
 *   (packaged build, or the env var was unset/empty) — callers that only
 *   care about "did this run" can check for non-null.
 */
export function applyDevUserDataOverride(app: Pick<App, 'isPackaged' | 'setPath'>): string | null {
  if (app.isPackaged) return null;
  const override = process.env[DEV_USER_DATA_OVERRIDE_ENV] ?? '';
  if (override.length === 0) return null;
  app.setPath('userData', override);
  return override;
}
