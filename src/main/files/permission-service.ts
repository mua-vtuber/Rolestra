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
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Project } from '../../shared/project-types';
import { resolveProjectPaths } from '../arena/resolve-project-paths';
import type { ArenaRootService } from '../arena/arena-root-service';

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
 * Returns true iff `candidate` is (a descendant of, or equal to) `root`
 * after both paths are resolved to absolute + realpath form.
 *
 * Behaviour (ported from R1 `tools/cli-smoke/src/path-guard.ts`):
 *   1. Reject raw `..` traversal based on lexical relation.
 *   2. realpath(root) and realpath(candidate); non-existent candidates fall
 *      back to the realpath of their nearest-existing ancestor joined with
 *      the remaining non-existing suffix. This allows validating writes to
 *      paths that do not exist yet while still catching symlink escapes on
 *      existing ancestors.
 *   3. Re-check the realpath relation: reject if relative path escapes or
 *      becomes absolute.
 *
 * Intentionally synchronous — call sites are on the spawn critical path.
 */
export function isPathWithin(root: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedCandidate = path.resolve(candidate);

  const rawRel = path.relative(normalizedRoot, normalizedCandidate);
  if (rawRel.startsWith('..') || path.isAbsolute(rawRel)) return false;

  let realRoot: string;
  try {
    realRoot = fs.realpathSync(normalizedRoot);
  } catch {
    // Root itself must exist. If it doesn't, nothing can be "within" it.
    return false;
  }

  let realCandidate: string;
  try {
    realCandidate = fs.realpathSync(normalizedCandidate);
  } catch {
    realCandidate = resolveNearestExistingAncestor(normalizedCandidate);
  }

  const rel = path.relative(realRoot, realCandidate);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * For a non-existent path, walk upward until an existing ancestor is found,
 * realpath it, then re-join the remaining suffix. Falls through to the raw
 * input if no ancestor exists (e.g. invalid drive).
 */
function resolveNearestExistingAncestor(p: string): string {
  let current = p;
  while (current && current !== path.dirname(current)) {
    try {
      const real = fs.realpathSync(current);
      const remaining = path.relative(current, p);
      return path.join(real, remaining);
    } catch {
      current = path.dirname(current);
    }
  }
  return p;
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
   * @throws PermissionBoundaryError if:
   *   - project row is missing,
   *   - project.status === 'folder_missing',
   *   - external link is missing on disk,
   *   - external link's realpath no longer matches project.externalLink.
   */
  resolveForCli(projectId: string): {
    cwd: string;
    consensusPath: string;
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
      if (realLink !== project.externalLink) {
        throw new PermissionBoundaryError(
          `External link TOCTOU mismatch: expected ${project.externalLink}, got ${realLink}`,
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
  private getAllowedRoots(activeProjectId: string | null): string[] {
    const roots = [this.arenaRoot.consensusPath()];
    if (activeProjectId) {
      const { cwd } = this.resolveForCli(activeProjectId);
      roots.push(cwd);
    }
    return roots;
  }
}
