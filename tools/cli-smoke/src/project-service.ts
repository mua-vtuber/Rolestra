import fs from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getArenaRootConfig } from './arena-root';
import { ProjectSchema, type Project, type PermissionMode } from './types';
import { createLink } from './junction';

export interface CreateNewInput {
  slug: string;
  name: string;
  description: string;
  permissionMode: PermissionMode;
}

export interface LinkExternalInput extends CreateNewInput {
  externalPath: string;
}

export interface ImportProjectInput extends CreateNewInput {
  sourcePath: string;
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

  async linkExternal(input: LinkExternalInput): Promise<Project> {
    if (input.permissionMode === 'auto') {
      throw new Error('auto mode is not allowed for external projects (spec §7.3)');
    }
    const cfg = getArenaRootConfig(this.arenaRoot);
    const projectDir = path.join(cfg.projectsDir, input.slug);
    if (existsSync(projectDir)) {
      throw new Error(`Project directory already exists: ${projectDir}`);
    }

    const realExternal = realpathSync(path.resolve(input.externalPath));
    const project: Project = ProjectSchema.parse({
      id: randomUUID(),
      slug: input.slug,
      name: input.name,
      description: input.description,
      kind: 'external',
      externalLink: realExternal,
      permissionMode: input.permissionMode,
      createdAt: Date.now(),
    });

    await fs.mkdir(path.join(projectDir, '.arena'), { recursive: true });
    await createLink(path.join(projectDir, 'link'), realExternal);
    await fs.writeFile(
      path.join(projectDir, '.arena', 'meta.json'),
      JSON.stringify(project, null, 2),
      'utf-8',
    );
    return project;
  }

  async importProject(input: ImportProjectInput): Promise<Project> {
    const cfg = getArenaRootConfig(this.arenaRoot);
    const projectDir = path.join(cfg.projectsDir, input.slug);
    if (existsSync(projectDir)) {
      throw new Error(`Project directory already exists: ${projectDir}`);
    }
    await fs.cp(input.sourcePath, projectDir, { recursive: true, errorOnExist: false });

    const project: Project = ProjectSchema.parse({
      id: randomUUID(),
      slug: input.slug,
      name: input.name,
      description: input.description,
      kind: 'imported',
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
