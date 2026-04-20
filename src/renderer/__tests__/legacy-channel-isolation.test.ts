/**
 * legacy-channel-isolation.test.ts — R3 Task 11 guard.
 *
 * Ensures the new v3 renderer (src/renderer/**) never references any v2 IPC
 * channel from `LEGACY_V2_CHANNELS` (src/main/ipc/router.ts:248). The legacy
 * renderer lives under `_legacy/renderer-v1/` which is outside this scan.
 *
 * If this test fails, either:
 *   (a) the new renderer accidentally called a legacy channel → replace with
 *       the v3 equivalent per docs/superpowers/specs/appendix-legacy-channels.md;
 *   (b) the channel list changed in router.ts → mirror the change here AND
 *       in the appendix table.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const rendererRoot = join(repoRoot, 'src', 'renderer');

// Mirrors src/main/ipc/router.ts:248 LEGACY_V2_CHANNELS — keep in sync.
const LEGACY_CHANNELS: ReadonlyArray<string> = [
  'chat:send',
  'chat:pause',
  'chat:resume',
  'chat:stop',
  'chat:set-rounds',
  'chat:deep-debate',
  'chat:continue',
  'chat:fork',
  'chat:list-branches',
  'chat:switch-branch',
  'conversation:list',
  'conversation:load',
  'conversation:new',
  'conversation:delete',
  'workspace:pick-folder',
  'workspace:init',
  'workspace:status',
  'consensus-folder:status',
  'consensus-folder:pick',
  'consensus-folder:init',
  'consensus:respond',
  'consensus:status',
  'consensus:set-facilitator',
  'session:mode-transition-respond',
  'session:select-worker',
  'session:user-decision',
  'session:status',
];

const SELF_PATH = join('src', 'renderer', '__tests__', 'legacy-channel-isolation.test.ts');

function collectFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectFiles(full, acc);
    } else if (/\.(ts|tsx|js|jsx|html)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

describe('legacy channel isolation (R3-Task11)', () => {
  it('src/renderer/** contains no v2 channel literals', () => {
    const files = collectFiles(rendererRoot).filter((f) => relative(repoRoot, f) !== SELF_PATH);
    const offenders: Array<{ file: string; channel: string }> = [];
    for (const file of files) {
      const contents = readFileSync(file, 'utf8');
      for (const ch of LEGACY_CHANNELS) {
        const needle = `'${ch}'`;
        const needleDq = `"${ch}"`;
        if (contents.includes(needle) || contents.includes(needleDq)) {
          offenders.push({ file: relative(repoRoot, file), channel: ch });
        }
      }
    }
    expect(
      offenders,
      `legacy v2 channels found in v3 renderer:\n${offenders
        .map((o) => `  - ${o.file} → "${o.channel}"`)
        .join('\n')}\nReplace with the v3 channel per docs/superpowers/specs/appendix-legacy-channels.md.`
    ).toHaveLength(0);
  });

  it('legacy channel list is exactly 27 entries (matches appendix)', () => {
    expect(LEGACY_CHANNELS).toHaveLength(27);
  });
});
