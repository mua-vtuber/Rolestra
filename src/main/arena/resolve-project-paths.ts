/**
 * resolveProjectPaths — pure helper that maps a Project entity to the set of
 * filesystem paths Rolestra uses at runtime (rootPath, cwdPath, metaPath,
 * consensusPath).
 *
 * Ported from `tools/cli-smoke/src/resolve-project-paths.ts` (R1). The R1
 * interface (`projectDir` / `metaDir` / `spawnCwd` / `externalRealPath`) was
 * replaced by the shared `ProjectPaths` interface defined in
 * `src/shared/arena-root-types.ts`.
 *
 * Kind semantics:
 *   - new / imported: cwdPath = rootPath
 *   - external     : cwdPath = rootPath/link   (junction/symlink target;
 *                                               externalLink is required)
 */

import type { Project } from '../../shared/project-types';
import type { ProjectPaths } from '../../shared/arena-root-types';
import type { AbsolutePath } from '../../shared/absolute-path';
import { joinAbsolute } from '../files/absolute-path-node';

/** Subdir of ArenaRoot that holds per-project directories. */
const PROJECTS_SUBDIR = 'projects';
/** Subdir of ArenaRoot that holds consensus artifacts. */
const CONSENSUS_SUBDIR = 'consensus';
/** Relative path segments of the per-project metadata file. */
const META_RELATIVE_SEGMENTS = ['.arena', 'meta.json'] as const;
/** Subdirectory inside external-kind project dirs that links to the real source. */
const EXTERNAL_LINK_SUBDIR = 'link';

/**
 * Resolves the filesystem paths for a given project under a specific ArenaRoot.
 *
 * @throws {Error} When `project.kind === 'external'` but `externalLink` is null.
 */
export function resolveProjectPaths(
  project: Project,
  arenaRoot: AbsolutePath,
): ProjectPaths {
  const rootPath = joinAbsolute(arenaRoot, PROJECTS_SUBDIR, project.slug);
  const metaPath = joinAbsolute(rootPath, ...META_RELATIVE_SEGMENTS);
  const consensusPath = joinAbsolute(arenaRoot, CONSENSUS_SUBDIR);

  if (project.kind === 'external') {
    if (!project.externalLink) {
      throw new Error(
        `Project ${project.slug}: externalLink required when kind=external`,
      );
    }
    return {
      rootPath,
      cwdPath: joinAbsolute(rootPath, EXTERNAL_LINK_SUBDIR),
      metaPath,
      consensusPath,
    };
  }

  // kind: 'new' | 'imported' — cwd is the project root itself.
  return {
    rootPath,
    cwdPath: rootPath,
    metaPath,
    consensusPath,
  };
}
