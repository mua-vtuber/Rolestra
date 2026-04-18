import { z } from 'zod';

export const PermissionModeSchema = z.enum(['auto', 'hybrid', 'approval']);
export type PermissionMode = z.infer<typeof PermissionModeSchema>;

export const ProjectKindSchema = z.enum(['new', 'external', 'imported']);
export type ProjectKind = z.infer<typeof ProjectKindSchema>;

export const CliKindSchema = z.enum(['claude', 'codex', 'gemini']);
export type CliKind = z.infer<typeof CliKindSchema>;

export const ProjectSchema = z.object({
  id: z.uuid(),
  slug: z.string().min(1).regex(/^[a-z0-9][a-z0-9_-]*$/, 'lowercase slug'),
  name: z.string().min(1),
  description: z.string().default(''),
  kind: ProjectKindSchema,
  externalLink: z.string().nullable().default(null),
  permissionMode: PermissionModeSchema,
  createdAt: z.number().int(),
});
export type Project = z.infer<typeof ProjectSchema>;

export interface ProjectPaths {
  projectDir: string;
  metaDir: string;
  spawnCwd: string;
  externalRealPath?: string;
}

export interface ArenaRootConfig {
  root: string;
  consensusDir: string;
  projectsDir: string;
  dbDir: string;
  logsDir: string;
}

export interface SmokeScenarioResult {
  scenario: string;
  cliKind: CliKind;
  permissionMode: PermissionMode;
  projectKind: ProjectKind;
  os: NodeJS.Platform;
  startedAt: string;
  finishedAt: string;
  success: boolean;
  observations: string[];
  stderr?: string;
  fileCreated?: string;
}
