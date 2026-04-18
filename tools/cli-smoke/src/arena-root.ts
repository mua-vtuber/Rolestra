import fs from 'node:fs/promises';
import { statSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { ArenaRootConfig } from './types';

const SUBDIRS = ['consensus', 'projects', 'db', 'logs'] as const;

export async function initArenaRoot(root: string): Promise<ArenaRootConfig> {
  const absRoot = path.resolve(root);
  if (existsSync(absRoot) && !statSync(absRoot).isDirectory()) {
    throw new Error(`ArenaRoot path exists but is not a directory: ${absRoot}`);
  }
  await fs.mkdir(absRoot, { recursive: true });
  for (const sub of SUBDIRS) {
    await fs.mkdir(path.join(absRoot, sub), { recursive: true });
  }
  return getArenaRootConfig(absRoot);
}

export function getArenaRootConfig(root: string): ArenaRootConfig {
  const absRoot = path.resolve(root);
  return {
    root: absRoot,
    consensusDir: path.join(absRoot, 'consensus'),
    projectsDir: path.join(absRoot, 'projects'),
    dbDir: path.join(absRoot, 'db'),
    logsDir: path.join(absRoot, 'logs'),
  };
}
