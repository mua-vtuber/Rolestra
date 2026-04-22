/**
 * R6-Task6 smoke: meetings/engine DI purity.
 *
 * Pins the invariant that `src/main/meetings/engine/*.ts` NEVER imports
 * the v2 workspace-handler singletons (`permissionService`,
 * `workspaceService`, `consensusFolderService`). The v3 orchestrator +
 * turn-executor reach permission / arena-root state exclusively via
 * constructor DI; a regression that re-introduces the singleton import
 * should be caught at CI, not at runtime in a mocked test.
 *
 * This is a static assertion: we grep the committed source, not the
 * compiled bundle.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ENGINE_DIR = join(__dirname, '..');

const FORBIDDEN_IMPORTS = [
  'workspace-handler',
  // Legacy v2 engine singletons that rely on workspace-handler
  // transitively — re-introducing either pulls the singleton back.
  "from '../../engine/conversation'",
  "from '../../engine/orchestrator'",
  "from '../../engine/turn-executor'",
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('R6-Task6 — meetings/engine v3 DI purity', () => {
  const files = walk(ENGINE_DIR);

  it('finds at least the four engine files committed in R6', () => {
    const names = files.map((p) => p.split('/').pop()!);
    expect(names).toEqual(
      expect.arrayContaining([
        'meeting-session.ts',
        'meeting-turn-executor.ts',
        'meeting-orchestrator.ts',
        'meeting-minutes-composer.ts',
      ]),
    );
  });

  it.each(FORBIDDEN_IMPORTS)(
    'no engine/*.ts file imports %s',
    (needle) => {
      for (const file of files) {
        const src = readFileSync(file, 'utf8');
        // Scan only lines that start with `import` / `from` so a
        // comment mentioning the forbidden path (like the header of
        // meeting-orchestrator.ts explaining the DI purity) does not
        // trip the assertion.
        const lines = src.split('\n').filter((l) => {
          const trimmed = l.trimStart();
          return (
            trimmed.startsWith('import ') ||
            trimmed.startsWith('} from ') ||
            trimmed.startsWith("from '")
          );
        });
        for (const line of lines) {
          expect(line).not.toContain(needle);
        }
      }
    },
  );

  it('engine/*.ts imports `arena-root-service` via `../../arena/arena-root-service` (DI anchor)', () => {
    const turnExecutor = files.find((p) =>
      p.endsWith('meeting-turn-executor.ts'),
    );
    expect(turnExecutor).toBeDefined();
    const src = readFileSync(turnExecutor!, 'utf8');
    expect(src).toMatch(/from ['"]\.\.\/\.\.\/arena\/arena-root-service['"]/);
  });
});
