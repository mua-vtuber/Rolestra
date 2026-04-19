/**
 * Shell environment dump for macOS GUI Electron apps (CA-4).
 *
 * When Electron is launched from Finder / Dock on macOS it inherits the
 * *login* environment, which typically omits `/opt/homebrew/bin`,
 * `~/.local/bin`, and any PATH additions made in `~/.zshrc` or `~/.bashrc`.
 * The result is that CLI tools installed via Homebrew/nvm/pyenv appear
 * missing when spawned from the app, even though they resolve fine in a
 * terminal.
 *
 * The `shell-env` package runs the user's interactive login shell once and
 * dumps the resulting env back to us. We cache the result for the process
 * lifetime (shells are not cheap) and only invoke it on darwin — Windows and
 * Linux inherit PATH correctly because GUI launchers on those platforms
 * source the normal user env.
 *
 * Errors (missing shell, timeout, non-zero exit) are swallowed with a
 * `console.warn` and we fall back to `{}`. A missing shell-env dump is not
 * fatal: the caller layers it on top of `process.env` anyway, so the spawn
 * just uses whatever env the Electron process inherited.
 */

type ShellEnv = NodeJS.ProcessEnv;

let cached: ShellEnv | null = null;
let pending: Promise<ShellEnv> | null = null;

/**
 * Return the shell-resolved environment on macOS, or `{}` elsewhere.
 *
 * Safe to call repeatedly — the first call actually spawns the shell and
 * every subsequent call returns the cached result.
 *
 * Concurrent callers share a single in-flight promise.
 */
export async function getShellEnv(): Promise<ShellEnv> {
  if (cached !== null) return cached;
  if (process.platform !== 'darwin') {
    cached = {};
    return cached;
  }
  if (pending) return pending;

  pending = (async () => {
    try {
      const mod = await import('shell-env');
      const env = await mod.shellEnv();
      return { ...env } as ShellEnv;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[shell-env] failed to dump shell env, falling back to {}: ${message}`);
      return {};
    }
  })();

  try {
    cached = await pending;
    return cached;
  } finally {
    pending = null;
  }
}

/**
 * Test-only helper — forget the cached dump so a test that swaps
 * `process.platform` can observe the platform branch on the next call.
 */
export function _resetShellEnvCacheForTests(): void {
  cached = null;
  pending = null;
}
