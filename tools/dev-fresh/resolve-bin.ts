/**
 * F4-3 — resolve an npm package's `bin` JS entry point the same way npm
 * itself does: by reading that package's OWN `package.json` `bin` field
 * directly, not via `require.resolve()`.
 *
 * `electron-vite` and `@electron/rebuild` both define an `exports` field
 * that does NOT list their `bin/`/`lib/cli.js` script as an importable
 * subpath, so `require.resolve('electron-vite/bin/electron-vite.js')`
 * throws `ERR_PACKAGE_PATH_NOT_EXPORTED` even though the file exists on
 * disk (verified against this repo's actual installed packages) — the
 * `exports` map governs `import`/`require` resolution, not where a
 * package's declared CLI entry point lives. `node_modules/.bin/<name>`
 * is itself generated FROM each package's `bin` field, which is exactly
 * what this helper reads. Resolving the real path lets `run.ts` spawn
 * the JS entry directly with the CURRENT node executable
 * (`process.execPath`) instead of invoking the platform-specific
 * `.cmd`/shell shim through a shell (CLAUDE.md "셸 문자열 실행 금지" —
 * no shell strings, only structured argv).
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** `package.json`'s `bin` field, in either of its two valid shapes. */
type BinField = string | Record<string, string>;

/**
 * @param packageDir  absolute path to the installed package directory
 *   (e.g. `<repo>/node_modules/electron-vite`).
 * @param binName     the key to read when `bin` is an object (a scoped
 *   package's bin name is the UNSCOPED part, e.g. `'electron-rebuild'`
 *   for `@electron/rebuild` — this must match the package's own
 *   `package.json`, not be derived from the npm package name).
 * @throws if package.json is missing/unreadable, `bin` doesn't resolve
 *   to a string, or the resolved file does not exist — a silent
 *   fallback here would spawn nothing and look like the tool just hung.
 */
export function resolvePackageBinEntry(packageDir: string, binName: string): string {
  const pkgJsonPath = join(packageDir, 'package.json');
  if (!existsSync(pkgJsonPath)) {
    throw new Error(`dev-fresh: package.json not found at ${pkgJsonPath}`);
  }
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as { bin?: BinField };
  const relative = typeof pkgJson.bin === 'string' ? pkgJson.bin : pkgJson.bin?.[binName];
  if (typeof relative !== 'string' || relative.length === 0) {
    throw new Error(
      `dev-fresh: could not resolve a "bin.${binName}" entry in ${pkgJsonPath}`,
    );
  }
  const resolved = join(packageDir, relative);
  if (!existsSync(resolved)) {
    throw new Error(`dev-fresh: resolved bin entry does not exist: ${resolved}`);
  }
  return resolved;
}

/**
 * Resolve `<repoRoot>/node_modules/<packageName>`'s bin JS entry.
 * `packageName` may be scoped (e.g. `'@electron/rebuild'`); `binName` is
 * the unscoped key inside that package's own `bin` object.
 */
export function resolveNodeModulesBin(
  repoRoot: string,
  packageName: string,
  binName: string,
): string {
  return resolvePackageBinEntry(join(repoRoot, 'node_modules', packageName), binName);
}

/** Repo root inferred from this file's own location (`tools/dev-fresh/resolve-bin.ts` → two levels up). */
export function inferRepoRoot(thisFileDir: string): string {
  return dirname(dirname(thisFileDir));
}
