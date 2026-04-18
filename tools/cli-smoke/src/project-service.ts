import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getArenaRootConfig } from './arena-root';
import { ProjectSchema, type Project, type PermissionMode } from './types';

export interface CreateNewInput {
  slug: string;
  name: string;
  description: string;
  permissionMode: PermissionMode;
}

export class ProjectService {
  constructor(private readonly arenaRoot: string) {}

  async createNewProject(input: CreateNewInput): Promise<Project> {
    const cfg = getArenaRootConfig(this.arenaRoot);
    const projectDir = path.join(cfg.projectsDir, input.slug);
    if (existsSync(projectDir)) {
      throw new Error(`Project directory already exists: ${projectDir}`);
    }

    const project: Project = ProjectSchema.parse({
      id: randomUUID(),
      slug: input.slug,
      name: input.name,
      description: input.description,
      kind: 'new',
      externalLink: null,
      permissionMode: input.permissionMode,
      createdAt: Date.now(),
    });

    await fs.mkdir(path.join(projectDir, '.arena'), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, '.arena', 'meta.json'),
      JSON.stringify(project, null, 2),
      'utf-8',
    );
    return project;
  }
}
