/**
 * PermissionService (v3) — path-guard with realpath re-validation.
 *
 * Ported from R1 `tools/cli-smoke/src/path-guard.ts` and extended with the
 * v3 project lifecycle (folder_missing status + external junction TOCTOU
 * guard, spec §7.6 / CA-3).
 *
 * API:
 *   - validateAccess(targetPath, activeProjectId): enforces that `targetPath`
 *     resolves inside `consensusPath` or the active project's `cwdPath`.
 *     Used by Main-routed I/O. CLI-internal filesystem access is outside the
 *     scope of this service (spec §7.6.1).
 *   - resolveForCli(projectId): returns the concrete cwd/consensus paths
 *     that a CLI spawn is allowed to see, after a realpath re-check.
 *     - Throws if the project row is missing.
 *     - Throws if the project status is `folder_missing`.
 *     - For `kind='external'`, throws if the junction/symlink's realpath no
 *       longer matches `project.externalLink` (CA-3 TOCTOU defence).
 *
 * All errors are `PermissionBoundaryError` — callers can distinguish them
 * from generic I/O failures.
 *
 * The containment primitive itself lives in `./path-within` (R12-X T5) so the
 * minutes and snapshot services share the exact same check instead of each
 * hand-rolling a lexical prefix comparison.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Project } from '../../shared/project-types';
import type { AbsolutePath } from '../../shared/absolute-path';
import { resolveProjectPaths } from '../arena/resolve-project-paths';
import type { ArenaRootService } from '../arena/arena-root-service';
import { isPathWithin } from './path-within';

/**
 * Minimal contract that PermissionService needs from the v3
 * ProjectRepository (Task 8). Declaring it here (rather than importing the
 * repository directly) keeps Task 6 independent of Task 8. When Task 8 lands
 * its repository class can implement this interface without any change here.
 */
export interface ProjectLookup {
  get(projectId: string): Project | null;
}

/**
 * Thrown whenever path-guard rejects a request. The message is an internal
 * audit / log string — callers should not surface it to end-users verbatim.
 */
export class PermissionBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionBoundaryError';
  }
}

/**
 * Normalise a path for *exact-equality* comparison between a stored DB value
 * and a fresh `realpathSync` result (CA-3 TOCTOU guard).
 *
 * Pure string transform — does not touch the filesystem. Caller passes the
 * platform explicitly so the same routine is unit-testable from a non-Windows
 * host without resorting to global stubs.
 *
 * Windows-specific normalisation (the only place where `path.resolve` alone
 * is insufficient because drive letter case + long-path prefixes survive
 * normalisation):
 *   - strip `\\?\` long-path prefix on local drives (e.g. `\\?\C:\foo` →
 *     `C:\foo`). The `\\?\UNC\` form is left alone because stripping it
 *     would change the *meaning* of the path, not just its spelling.
 *   - upper-case the drive letter (`c:\` → `C:\`). `realpathSync` returns an
 *     upper-case drive letter on Windows; `path.resolve` preserves whatever
 *     case the caller wrote, so a stored `c:\foo` would otherwise look like
 *     a TOCTOU mismatch on every spawn — a permanent denial-of-service for
 *     a benign external-project registration.
 *   - convert any forward slashes to backslashes — defensive only;
 *     `path.resolve` on win32 already does this, but we apply it once more
 *     so future refactors that bypass `path.resolve` cannot regress the
 *     comparison silently.
 *
 * POSIX is left untouched: `realpathSync` and `path.resolve` already produce
 * a single canonical form on case-sensitive filesystems, and case-folding
 * here would weaken the guard on Linux/macOS where the spawn cwd really is
 * case-sensitive.
 */
export function normalizePathForCompare(
  p: string,
  platform: NodeJS.Platform = process.platform,
): string {
  // Resolve via the platform-specific helper rather than the host-default
  // `path.resolve`. Without this, a Windows-style input like `C:/foo` would
  // be interpreted as a relative path on a POSIX host (WSL/CI) — the test
  // suite would pass on Windows but a Linux CI agent would silently emit
  // garbage normalised values, masking real comparison bugs.
  const resolver = platform === 'win32' ? path.win32 : path.posix;
  let normalized = resolver.resolve(p);
  if (platform === 'win32') {
    if (
      normalized.startsWith('\\\\?\\') &&
      !normalized.startsWith('\\\\?\\UNC\\')
    ) {
      normalized = normalized.slice(4);
    }
    if (/^[a-z]:/.test(normalized)) {
      normalized = normalized.charAt(0).toUpperCase() + normalized.slice(1);
    }
    normalized = normalized.replace(/\//g, '\\');
  }
  return normalized;
}

export class PermissionService {
  constructor(
    private readonly arenaRoot: ArenaRootService,
    private readonly projectRepo: ProjectLookup,
  ) {}

  /**
   * Validate that a Main-process I/O target falls inside the allowed roots
   * for the currently active project.
   *
   * Allowed roots:
   *   - consensusPath (always)
   *   - cwdPath of `activeProjectId` (if provided)
   *
   * **Performance note:** When `activeProjectId != null`, this method runs
   * the same TOCTOU re-validation as `resolveForCli` — a project DB lookup
   * plus one or two `fs.realpathSync` calls. Not a cheap/cached guard.
   * Callers that hot-loop on this should batch or precompute allowedRoots.
   *
   * @throws PermissionBoundaryError when the target escapes all allowed roots.
   */
  validateAccess(targetPath: string, activeProjectId: string | null): void {
    const allowed = this.getAllowedRoots(activeProjectId);
    for (const root of allowed) {
      if (isPathWithin(root, targetPath)) return;
    }
    throw new PermissionBoundaryError(
      `Access denied: ${targetPath} (allowed roots: ${allowed.join(', ')})`,
    );
  }

  /**
   * Prepare the spawn context for a CLI process targeting `projectId`.
   *
   * Performs the final realpath re-check one call before spawn (spec CA-3
   * TOCTOU defence). Callers must pass the returned `cwd`/`consensusPath`
   * directly to the child process — re-resolving later re-introduces the
   * race window this method exists to close.
   *
   * The returned `cwd` for an `external` project is the symlink path
   * (e.g. `<arena>/projects/<slug>/link`), not the resolved target. Child
   * processes follow the symlink at spawn time; keeping `cwd` as the
   * symlink preserves the ability to detect future TOCTOU swaps.
   *
   * @throws PermissionBoundaryError if:
   *   - project row is missing,
   *   - project.status === 'folder_missing',
   *   - external link is missing on disk,
   *   - external link's realpath no longer matches project.externalLink.
   */
  resolveForCli(projectId: string): {
    cwd: AbsolutePath;
    consensusPath: AbsolutePath;
    project: Project;
  } {
    const project = this.projectRepo.get(projectId);
    if (!project) {
      throw new PermissionBoundaryError(`Project not found: ${projectId}`);
    }
    if (project.status === 'folder_missing') {
      throw new PermissionBoundaryError(`Project folder missing: ${project.slug}`);
    }

    const paths = resolveProjectPaths(project, this.arenaRoot.getPath());

    if (project.kind === 'external') {
      if (!fs.existsSync(paths.cwdPath)) {
        throw new PermissionBoundaryError(
          `External link missing: ${paths.cwdPath}`,
        );
      }
      const realLink = fs.realpathSync(paths.cwdPath);
      // Defensive normalization: Task 8's ProjectRepository SHOULD store
      // externalLink in realpathSync-normalized form, but we normalize both
      // sides through `normalizePathForCompare` so that a trailing slash,
      // mixed separators, an unresolved `/var` → `/private/var` prefix, or
      // a Windows drive-letter / `\\?\` long-path mismatch cannot silently
      // DoS every external-project spawn. Security unchanged — the LHS is
      // still a fresh realpathSync of the symlink at spawn time.
      // `externalLink` is typed `string | null`; for kind='external' it is a
      // non-null invariant (enforced by resolveProjectPaths above), but we
      // guard defensively to satisfy the type system.
      const normalizedStored =
        project.externalLink !== null
          ? normalizePathForCompare(project.externalLink)
          : '';
      const normalizedReal = normalizePathForCompare(realLink);
      if (normalizedReal !== normalizedStored) {
        throw new PermissionBoundaryError(
          `External link TOCTOU mismatch: expected ${normalizedStored}, got ${normalizedReal}`,
        );
      }
    }

    return {
      cwd: paths.cwdPath,
      consensusPath: paths.consensusPath,
      project,
    };
  }

  /**
   * Compute the allowed-roots set for `validateAccess`. Always includes the
   * consensus path; includes the project cwd only when an active project is
   * provided and passes the same lifecycle checks as `resolveForCli`.
   */
  private getAllowedRoots(activeProjectId: string | null): AbsolutePath[] {
    const roots = [this.arenaRoot.consensusPath()];
    if (activeProjectId) {
      const { cwd } = this.resolveForCli(activeProjectId);
      roots.push(cwd);
    }
    return roots;
  }
}
