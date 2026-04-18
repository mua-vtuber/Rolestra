import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { WorkspaceService } from '../workspace-service';
import { PermissionService } from '../permission-service';
import { ConsensusFolderService } from '../consensus-folder-service';
import type { FilePermission } from '../../../shared/file-types';
import { WORKSPACE_SUBDIRS } from '../../../shared/file-types';

/** Create a unique temporary directory for each test. */
function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'arena-test-'));
}

/** Recursively remove a directory. */
function cleanupDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Check if symlinks can be created (requires admin on Windows). */
const canCreateSymlinks = (() => {
  const dir = makeTmpDir();
  try {
    const target = path.join(dir, 'target');
    fs.mkdirSync(target);
    const link = path.join(dir, 'link');
    fs.symlinkSync(target, link);
    return true;
  } catch {
    return false;
  } finally {
    cleanupDir(dir);
  }
})();

// ═══════════════════════════════════════════════════════════════════
// WorkspaceService
// ═══════════════════════════════════════════════════════════════════

describe('WorkspaceService', () => {
  let tmpDir: string;
  let service: WorkspaceService;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    service = new WorkspaceService();
  });

  afterEach(() => {
    service.dispose();
    cleanupDir(tmpDir);
  });

  // ── initWorkspace ──────────────────────────────────────────────

  it('creates .arena/workspace/ with all subdirectories', async () => {
    const info = await service.initWorkspace(tmpDir);

    expect(info.exists).toBe(true);
    expect(info.projectFolder).toBe(path.resolve(tmpDir));
    expect(info.arenaFolder).toBe(path.join(path.resolve(tmpDir), '.arena', 'workspace'));
    expect(info.subdirectories).toEqual(expect.arrayContaining([...WORKSPACE_SUBDIRS]));

    // Verify actual directories on disk
    for (const sub of WORKSPACE_SUBDIRS) {
      const subPath = path.join(info.arenaFolder, sub);
      expect(fs.existsSync(subPath)).toBe(true);
      expect(fs.statSync(subPath).isDirectory()).toBe(true);
    }
  });

  it('is idempotent -- second init does not throw or destroy content', async () => {
    await service.initWorkspace(tmpDir);

    // Write a file inside drafts
    const draftFile = path.join(tmpDir, '.arena', 'workspace', 'drafts', 'test.txt');
    fs.writeFileSync(draftFile, 'hello');

    // Re-init
    const info = await service.initWorkspace(tmpDir);
    expect(info.exists).toBe(true);

    // File should still exist
    expect(fs.readFileSync(draftFile, 'utf-8')).toBe('hello');
  });

  it('throws when project path is not a directory', async () => {
    const filePath = path.join(tmpDir, 'not-a-dir.txt');
    fs.writeFileSync(filePath, 'content');

    await expect(service.initWorkspace(filePath)).rejects.toThrow(/not a directory/);
  });

  it('throws when project path does not exist', async () => {
    const noSuchPath = path.join(tmpDir, 'nonexistent');

    await expect(service.initWorkspace(noSuchPath)).rejects.toThrow();
  });

  // ── getWorkspaceInfo ───────────────────────────────────────────

  it('returns null before initialization', () => {
    expect(service.getWorkspaceInfo()).toBeNull();
  });

  it('returns workspace info after initialization', async () => {
    await service.initWorkspace(tmpDir);
    const info = service.getWorkspaceInfo();

    expect(info).not.toBeNull();
    const safeInfo = info as NonNullable<typeof info>;
    expect(safeInfo.projectFolder).toBe(path.resolve(tmpDir));
    expect(safeInfo.exists).toBe(true);
    expect(safeInfo.subdirectories).toHaveLength(WORKSPACE_SUBDIRS.length);
  });

  // ── isArenaPath ────────────────────────────────────────────────

  it('returns true for paths inside .arena/workspace/', async () => {
    await service.initWorkspace(tmpDir);
    const arenaFolder = path.join(tmpDir, '.arena', 'workspace');

    expect(service.isArenaPath(arenaFolder)).toBe(true);
    expect(service.isArenaPath(path.join(arenaFolder, 'drafts'))).toBe(true);
    expect(service.isArenaPath(path.join(arenaFolder, 'drafts', 'file.txt'))).toBe(true);
    expect(service.isArenaPath(path.join(arenaFolder, 'proposals'))).toBe(true);
    expect(service.isArenaPath(path.join(arenaFolder, 'approved'))).toBe(true);
  });

  it('returns false for paths outside .arena/workspace/', async () => {
    await service.initWorkspace(tmpDir);

    expect(service.isArenaPath(tmpDir)).toBe(false);
    expect(service.isArenaPath(path.join(tmpDir, 'src'))).toBe(false);
    expect(service.isArenaPath('/some/other/path')).toBe(false);
  });

  it('returns false when workspace is not initialized', () => {
    expect(service.isArenaPath('/any/path')).toBe(false);
  });

  // ── System directory blocking ────────────────────────────────────
  describe('system directory blocking', () => {
    it('blocks root directory as workspace', async () => {
      const svc = new WorkspaceService();
      const rootPath = process.platform === 'win32' ? 'C:\\Windows' : '/';
      await expect(svc.initWorkspace(rootPath)).rejects.toThrow(/system directory/i);
    });

    it('blocks /etc as workspace on Unix', async () => {
      if (process.platform === 'win32') return;
      const svc = new WorkspaceService();
      await expect(svc.initWorkspace('/etc')).rejects.toThrow(/system directory/i);
    });

    it('blocks /usr as workspace on Unix', async () => {
      if (process.platform === 'win32') return;
      const svc = new WorkspaceService();
      await expect(svc.initWorkspace('/usr')).rejects.toThrow(/system directory/i);
    });

    it('allows normal project directory', async () => {
      const svc = new WorkspaceService();
      // tmpDir from outer scope is fine
      await expect(svc.initWorkspace(tmpDir)).resolves.toBeDefined();
      svc.dispose();
    });
  });

  // ── dispose ────────────────────────────────────────────────────

  it('resets state after dispose', async () => {
    await service.initWorkspace(tmpDir);
    expect(service.getWorkspaceInfo()).not.toBeNull();

    service.dispose();
    expect(service.getWorkspaceInfo()).toBeNull();
    expect(service.isArenaPath(path.join(tmpDir, '.arena', 'workspace'))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PermissionService
// ═══════════════════════════════════════════════════════════════════

describe('PermissionService', () => {
  let tmpDir: string;
  let workspace: WorkspaceService;
  let permission: PermissionService;

  const AI_ID = 'ai-claude';

  /** Helper: create a standard read/write permission. */
  const rwPermission = (participantId: string, folderPath: string): FilePermission => ({
    participantId,
    folderPath,
    read: true,
    write: true,
    execute: false,
  });

  /** Helper: create a read-only permission. */
  const readOnlyPermission = (participantId: string, folderPath: string): FilePermission => ({
    participantId,
    folderPath,
    read: true,
    write: false,
    execute: false,
  });

  /** Helper: create a full permission. */
  const fullPermission = (participantId: string, folderPath: string): FilePermission => ({
    participantId,
    folderPath,
    read: true,
    write: true,
    execute: true,
  });

  beforeEach(async () => {
    tmpDir = makeTmpDir();
    workspace = new WorkspaceService();
    await workspace.initWorkspace(tmpDir);
    permission = new PermissionService(workspace);
    permission.setProjectFolder(tmpDir);
  });

  afterEach(() => {
    workspace.dispose();
    cleanupDir(tmpDir);
  });

  // ── .arena/workspace/ auto-allow ───────────────────────────────

  describe('arena workspace auto-allow', () => {
    it('allows read in .arena/workspace/ without explicit permissions', () => {
      const target = path.join(tmpDir, '.arena', 'workspace', 'drafts', 'file.txt');
      const result = permission.validateAccess(AI_ID, target, 'read');
      expect(result.allowed).toBe(true);
    });

    it('allows write in .arena/workspace/ without explicit permissions', () => {
      const target = path.join(tmpDir, '.arena', 'workspace', 'proposals', 'doc.md');
      const result = permission.validateAccess(AI_ID, target, 'write');
      expect(result.allowed).toBe(true);
    });

    it('denies execute in .arena/workspace/ without explicit permission', () => {
      const target = path.join(tmpDir, '.arena', 'workspace', 'drafts', 'script.sh');
      const result = permission.validateAccess(AI_ID, target, 'execute');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/permission/i);
    });

    it('allows execute in .arena/workspace/ with explicit permission', () => {
      permission.setPermissions([fullPermission(AI_ID, tmpDir)]);
      const target = path.join(tmpDir, '.arena', 'workspace', 'drafts', 'script.sh');
      const result = permission.validateAccess(AI_ID, target, 'execute');
      expect(result.allowed).toBe(true);
    });
  });

  // ── Project folder boundary ────────────────────────────────────

  describe('project folder boundary', () => {
    it('denies access outside project folder', () => {
      permission.setPermissions([fullPermission(AI_ID, tmpDir)]);
      const outsidePath = path.resolve(tmpDir, '..', 'some-other-folder', 'file.txt');
      const result = permission.validateAccess(AI_ID, outsidePath, 'read');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/outside|traversal/i);
    });

    it('denies access to absolute paths outside project', () => {
      permission.setPermissions([fullPermission(AI_ID, tmpDir)]);
      const result = permission.validateAccess(AI_ID, '/etc/passwd', 'read');
      expect(result.allowed).toBe(false);
    });

    it('allows access to files inside project folder with permissions', () => {
      permission.setPermissions([rwPermission(AI_ID, tmpDir)]);
      const target = path.join(tmpDir, 'src', 'index.ts');
      // Create the file so realpathSync succeeds
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(target, '');
      const result = permission.validateAccess(AI_ID, target, 'read');
      expect(result.allowed).toBe(true);
    });
  });

  // ── Per-participant read/write/execute ─────────────────────────

  describe('per-participant permissions', () => {
    it('denies read when read=false', () => {
      permission.setPermissions([{
        participantId: AI_ID,
        folderPath: tmpDir,
        read: false,
        write: true,
        execute: false,
      }]);

      const target = path.join(tmpDir, 'file.txt');
      fs.writeFileSync(target, '');
      const result = permission.validateAccess(AI_ID, target, 'read');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/read/i);
    });

    it('denies write when write=false', () => {
      permission.setPermissions([readOnlyPermission(AI_ID, tmpDir)]);

      const target = path.join(tmpDir, 'file.txt');
      fs.writeFileSync(target, '');
      const result = permission.validateAccess(AI_ID, target, 'write');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/write/i);
    });

    it('denies execute when execute=false', () => {
      permission.setPermissions([rwPermission(AI_ID, tmpDir)]);

      const target = path.join(tmpDir, 'script.sh');
      fs.writeFileSync(target, '');
      const result = permission.validateAccess(AI_ID, target, 'execute');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/execute/i);
    });

    it('allows all actions when all flags are true', () => {
      permission.setPermissions([fullPermission(AI_ID, tmpDir)]);

      const target = path.join(tmpDir, 'file.txt');
      fs.writeFileSync(target, '');

      expect(permission.validateAccess(AI_ID, target, 'read').allowed).toBe(true);
      expect(permission.validateAccess(AI_ID, target, 'write').allowed).toBe(true);
      expect(permission.validateAccess(AI_ID, target, 'execute').allowed).toBe(true);
    });

    it('denies when participant has no permissions configured', () => {
      // No permissions set for AI_ID
      const target = path.join(tmpDir, 'file.txt');
      fs.writeFileSync(target, '');
      const result = permission.validateAccess(AI_ID, target, 'read');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/no permissions/i);
    });
  });

  // ── Symbolic link escape ───────────────────────────────────────

  describe('symbolic link prevention', () => {
    it.skipIf(!canCreateSymlinks)('blocks symlink that points outside project folder', () => {
      permission.setPermissions([fullPermission(AI_ID, tmpDir)]);

      // Create an outside directory and a symlink pointing to it
      const outsideDir = makeTmpDir();
      const secretFile = path.join(outsideDir, 'secret.txt');
      fs.writeFileSync(secretFile, 'secret data');

      const symlinkPath = path.join(tmpDir, 'link-to-outside');
      fs.symlinkSync(outsideDir, symlinkPath);

      const target = path.join(symlinkPath, 'secret.txt');
      const result = permission.validateAccess(AI_ID, target, 'read');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/symb|escape|outside|traversal/i);

      // Cleanup
      cleanupDir(outsideDir);
    });

    it.skipIf(!canCreateSymlinks)('allows symlink that stays inside project folder', () => {
      permission.setPermissions([rwPermission(AI_ID, tmpDir)]);

      // Create a subdirectory and symlink within the project
      const subDir = path.join(tmpDir, 'sub');
      fs.mkdirSync(subDir);
      fs.writeFileSync(path.join(subDir, 'file.txt'), 'data');

      const symlinkPath = path.join(tmpDir, 'link-to-sub');
      fs.symlinkSync(subDir, symlinkPath);

      const target = path.join(symlinkPath, 'file.txt');
      const result = permission.validateAccess(AI_ID, target, 'read');
      expect(result.allowed).toBe(true);
    });
  });

  // ── Path traversal ─────────────────────────────────────────────

  describe('path traversal prevention', () => {
    it('blocks ../ traversal attempt', () => {
      permission.setPermissions([fullPermission(AI_ID, tmpDir)]);

      const target = path.join(tmpDir, 'sub', '..', '..', 'etc', 'passwd');
      const result = permission.validateAccess(AI_ID, target, 'read');
      expect(result.allowed).toBe(false);
    });

    it('blocks path that resolves outside project even without literal ..', () => {
      permission.setPermissions([fullPermission(AI_ID, tmpDir)]);

      const outsidePath = path.resolve(tmpDir, '..');
      const result = permission.validateAccess(AI_ID, outsidePath, 'read');
      expect(result.allowed).toBe(false);
    });
  });

  // ── Permission management ──────────────────────────────────────

  describe('permission management', () => {
    it('setPermissions replaces all permissions', () => {
      const perm1 = rwPermission('ai-1', tmpDir);
      const perm2 = readOnlyPermission('ai-2', tmpDir);

      permission.setPermissions([perm1]);
      expect(permission.getPermissions()).toHaveLength(1);

      permission.setPermissions([perm1, perm2]);
      expect(permission.getPermissions()).toHaveLength(2);
    });

    it('getPermissions returns a copy', () => {
      const perm = rwPermission(AI_ID, tmpDir);
      permission.setPermissions([perm]);

      const retrieved = permission.getPermissions();
      retrieved.push(readOnlyPermission('other', tmpDir));

      // Original should be unchanged
      expect(permission.getPermissions()).toHaveLength(1);
    });

    it('getPermissionsForParticipant returns correct entry', () => {
      const perm1 = rwPermission('ai-1', tmpDir);
      const perm2 = readOnlyPermission('ai-2', tmpDir);
      permission.setPermissions([perm1, perm2]);

      const result = permission.getPermissionsForParticipant('ai-2');
      expect(result).not.toBeNull();
      const safeResult = result as NonNullable<typeof result>;
      expect(safeResult.participantId).toBe('ai-2');
      expect(safeResult.read).toBe(true);
      expect(safeResult.write).toBe(false);
    });

    it('getPermissionsForParticipant returns null for unknown participant', () => {
      permission.setPermissions([rwPermission('ai-1', tmpDir)]);
      expect(permission.getPermissionsForParticipant('ai-unknown')).toBeNull();
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────

  describe('edge cases', () => {
    it('denies when no project folder is configured', () => {
      const freshPermission = new PermissionService(workspace);
      const result = freshPermission.validateAccess(AI_ID, '/any/path', 'read');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/no project folder/i);
    });

    it('returns correct metadata in AccessCheckResult', () => {
      permission.setPermissions([rwPermission(AI_ID, tmpDir)]);
      const target = path.join(tmpDir, 'test.txt');
      fs.writeFileSync(target, '');

      const result = permission.validateAccess(AI_ID, target, 'write');
      expect(result.participantId).toBe(AI_ID);
      expect(result.targetPath).toBe(target);
      expect(result.action).toBe('write');
      expect(result.allowed).toBe(true);
    });
  });

  // ── Consensus folder auto-allow ───────────────────────────────

  describe('consensus folder auto-allow', () => {
    let consensusDir: string;
    let consensusFolderService: ConsensusFolderService;
    let permWithConsensus: PermissionService;

    beforeEach(async () => {
      consensusDir = path.join(makeTmpDir(), 'consensus');
      consensusFolderService = new ConsensusFolderService();
      await consensusFolderService.initFolder(consensusDir);
      permWithConsensus = new PermissionService(workspace, consensusFolderService);
      permWithConsensus.setProjectFolder(tmpDir);
    });

    afterEach(() => {
      consensusFolderService.dispose();
      if (fs.existsSync(consensusDir)) {
        cleanupDir(path.dirname(consensusDir));
      }
    });

    it('allows read in consensus folder without explicit permissions', () => {
      const target = path.join(consensusDir, 'result.md');
      const result = permWithConsensus.validateAccess(AI_ID, target, 'read');
      expect(result.allowed).toBe(true);
    });

    it('allows write in consensus folder without explicit permissions', () => {
      const target = path.join(consensusDir, 'summary.md');
      const result = permWithConsensus.validateAccess(AI_ID, target, 'write');
      expect(result.allowed).toBe(true);
    });

    it('denies execute in consensus folder', () => {
      const target = path.join(consensusDir, 'script.sh');
      const result = permWithConsensus.validateAccess(AI_ID, target, 'execute');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/execute.*denied.*consensus/i);
    });

    it('allows consensus folder access even without participant permissions', () => {
      // No permissions configured for AI_ID at all
      const target = path.join(consensusDir, 'doc.md');
      const result = permWithConsensus.validateAccess(AI_ID, target, 'write');
      expect(result.allowed).toBe(true);
    });

    it('still enforces project boundary for non-consensus external paths', () => {
      permWithConsensus.setPermissions([rwPermission(AI_ID, tmpDir)]);
      const outsidePath = path.resolve(tmpDir, '..', 'other-folder', 'file.txt');
      const result = permWithConsensus.validateAccess(AI_ID, outsidePath, 'read');
      expect(result.allowed).toBe(false);
    });
  });
});
