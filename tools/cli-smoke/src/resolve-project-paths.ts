import path from 'node:path';
import type { Project, ProjectPaths } from './types';

export function resolveProjectPaths(project: Project, arenaRoot: string): ProjectPaths {
  const projectDir = path.join(arenaRoot, 'projects', project.slug);
  const metaDir = path.join(projectDir, '.arena');

  if (project.kind === 'external') {
    if (!project.externalLink) {
      throw new Error(`Project ${project.slug}: externalLink required when kind=external`);
    }
    return {
      projectDir,
      metaDir,
      spawnCwd: path.join(projectDir, 'link'),
      externalRealPath: project.externalLink,
    };
  }

  return { projectDir, metaDir, spawnCwd: projectDir };
}
