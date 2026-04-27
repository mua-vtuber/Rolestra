/**
 * F4-Task7: workspace-service rejects OS system directories as workspace
 * roots. The Windows guard now reads `%SystemRoot%` / `%ProgramFiles%`
 * dynamically; the tests cover both the dynamic Windows form (via a
 * cross-platform-friendly assertion against the resolved `BLOCKED_SYSTEM_DIRS`
 * set we exercise through `initWorkspace`) and the POSIX static form.
 *
 * The suite focuses on the F4 behaviour change — preexisting workspace
 * features (subdirectory creation, isArenaPath) keep their integration
 * coverage in the wider IPC tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import { rmSync } from 'node:fs';

import { WorkspaceService } from '../workspace-service';

describe('WorkspaceService — F4 system dir guard', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'rolestra-ws-test-'));
  });

  afterEach(() => {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it('initWorkspace succeeds for a fresh tmp directory', async () => {
    const svc = new WorkspaceService();
    const info = await svc.initWorkspace(tmpRoot);
    expect(info.exists).toBe(true);
    expect(info.projectFolder).toBe(path.resolve(tmpRoot));
    expect(info.subdirectories.length).toBeGreaterThan(0);
  });

  it.runIf(process.platform !== 'win32')(
    'rejects POSIX system directories (/, /etc, /usr, …)',
    async () => {
      const svc = new WorkspaceService();
      for (const blocked of ['/', '/etc', '/usr', '/var']) {
        await expect(svc.initWorkspace(blocked)).rejects.toThrow(
          /Cannot use system directory/,
        );
      }
    },
  );

  it.runIf(process.platform === 'win32')(
    'rejects %SystemRoot% / %ProgramFiles% dynamically',
    async () => {
      const sysRoot = process.env.SystemRoot;
      if (!sysRoot) {
        // Skip when the host strips SystemRoot — F4 guard correctly
        // omits the entry, so there is nothing to assert.
        return;
      }
      const svc = new WorkspaceService();
      await expect(svc.initWorkspace(sysRoot)).rejects.toThrow(
        /Cannot use system directory/,
      );
    },
  );

  it('error message includes the offending path so users know what to change', async () => {
    if (process.platform === 'win32') {
      const sysRoot = process.env.SystemRoot;
      if (!sysRoot) return;
      const svc = new WorkspaceService();
      await expect(svc.initWorkspace(sysRoot)).rejects.toThrow(
        new RegExp(sysRoot.replace(/\\/g, '\\\\')),
      );
    } else {
      const svc = new WorkspaceService();
      await expect(svc.initWorkspace('/etc')).rejects.toThrow(/\/etc/);
    }
  });
});

describe('WorkspaceService — F4 dynamic blocked dir set', () => {
  // The dynamic blocked-dir computation is module-local, so we exercise
  // it indirectly via `initWorkspace`. To verify env-var sensitivity we
  // would need to re-import the module under a mocked `process.env`;
  // vitest's module-cache + `process.env` mutation is sufficient.
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it.runIf(process.platform === 'win32')(
    're-imports respect a runtime SystemRoot override',
    async () => {
      const original = process.env.SystemRoot;
      try {
        process.env.SystemRoot = 'D:\\AltWindows';
        const mod = await import('../workspace-service');
        const svc = new mod.WorkspaceService();
        await expect(svc.initWorkspace('D:\\AltWindows')).rejects.toThrow(
          /Cannot use system directory/,
        );
      } finally {
        if (original === undefined) {
          delete process.env.SystemRoot;
        } else {
          process.env.SystemRoot = original;
        }
      }
    },
  );
});
