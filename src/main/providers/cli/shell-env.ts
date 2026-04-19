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
 * dumps the resulting env back to us. We cache the result for the resolver
 * instance's lifetime (shells are not cheap) and only invoke it on darwin —
 * Windows and Linux inherit PATH correctly because GUI launchers on those
 * platforms source the normal user env.
 *
 * Errors (missing shell, timeout, non-zero exit) are swallowed with a
 * `console.warn` and we fall back to `{}`. A missing shell-env dump is not
 * fatal: the caller layers it on top of `process.env` anyway, so the spawn
 * just uses whatever env the Electron process inherited.
 *
 * Shape: {@link createShellEnvResolver} builds a fresh cache per instance.
 * Production uses the module-scoped {@link defaultShellEnvResolver} so
 * repeat calls across the Main process share one dump; tests construct
 * their own resolver to keep the platform-branch cache isolated.
 */

type ShellEnv = NodeJS.ProcessEnv;

export interface ShellEnvResolver {
  /**
   * Return the shell-resolved environment on macOS, or `{}` elsewhere.
   *
   * Safe to call repeatedly — the first call actually spawns the shell and
   * every subsequent call returns the cached result. Concurrent callers
   * share a single in-flight promise.
   */
  get(): Promise<ShellEnv>;
}

/**
 * Build a fresh shell-env resolver with its own private cache.
 *
 * Each resolver is independent: two resolvers will each invoke `shell-env`
 * at most once on their first `get()` call. Tests that need to observe the
 * platform branch on a fresh cache should call this in `beforeEach`.
 */
export function createShellEnvResolver(): ShellEnvResolver {
  let cached: ShellEnv | null = null;
  let pending: Promise<ShellEnv> | null = null;

  return {
    async get(): Promise<ShellEnv> {
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
          // TODO R2-log: swap for structured logger (src/main/log/)
          console.warn('[rolestra.cli.shell_env] fallback:', {
            name: err instanceof Error ? err.name : undefined,
            code: (err as NodeJS.ErrnoException)?.code,
            message,
          });
          return {};
        }
      })();

      try {
        cached = await pending;
        return cached;
      } finally {
        pending = null;
      }
    },
  };
}

/**
 * Module-scoped singleton used by production callers (`buildSpawnEnv`).
 * Tests should construct their own resolver via {@link createShellEnvResolver}.
 */
export const defaultShellEnvResolver: ShellEnvResolver = createShellEnvResolver();

/**
 * Convenience for production call sites: `await getShellEnv()` is equivalent
 * to `await defaultShellEnvResolver.get()`. Kept as the canonical entry point
 * because `buildSpawnEnv` consumes it.
 */
export async function getShellEnv(): Promise<ShellEnv> {
  return defaultShellEnvResolver.get();
}
