import { randomUUID } from 'node:crypto';
import type { Project } from '../../../shared/project-types';
import type { ArenaRootService } from '../../arena/arena-root-service';
import type { ProjectRepository } from '../../projects/project-repository';

/** Inserts archived-schema project rows for channel/message repository tests. */
export class LegacyProjectFixture {
  constructor(
    private readonly repository: ProjectRepository,
    _arena: ArenaRootService,
    private readonly deps?: { onProjectCreated?: (project: Project) => void },
  ) {}

  async create(input: {
    name: string;
    kind: 'new';
    permissionMode: Project['permissionMode'];
    initialMemberProviderIds?: string[];
  }): Promise<Project> {
    const id = randomUUID();
    const project: Project = {
      id,
      slug: id,
      name: input.name,
      description: '',
      kind: input.kind,
      externalLink: null,
      permissionMode: input.permissionMode,
      autonomyMode: 'manual',
      status: 'active',
      createdAt: Date.now(),
      archivedAt: null,
    };
    this.repository.insert(project);
    for (const providerId of input.initialMemberProviderIds ?? []) {
      this.repository.addMember(project.id, providerId, null, Date.now());
    }
    this.deps?.onProjectCreated?.(project);
    return project;
  }

  addMember(projectId: string, providerId: string): void {
    this.repository.addMember(projectId, providerId, null, Date.now());
  }
}
