import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AuditLog } from '../audit-log';
import { PatchApplier } from '../patch-applier';
import { CommandRunner } from '../command-runner';
import { ExecutionService } from '../execution-service';
import type {
  PatchSet,
  AuditEntry,
  CommandPolicy,
} from '../../../shared/execution-types';
import { DEFAULT_COMMAND_POLICY } from '../../../shared/execution-types';
import type { ApprovalItem } from '../../../shared/approval-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a unique temp directory for each test. */
function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'exec-test-'));
}

/** Recursively remove a directory. */
function removeTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Build a minimal AuditEntry for testing. */
function makeAuditEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    operationId: 'op-1',
    aiId: 'ai-1',
    action: 'read',
    targetPath: '/tmp/test',
    timestamp: Date.now(),
    result: 'success',
    rollbackable: false,
    ...overrides,
  };
}

// ===========================================================================
// AuditLog
// ===========================================================================

describe('AuditLog', () => {
  let log: AuditLog;

  beforeEach(() => {
    log = new AuditLog();
  });

  it('starts empty', () => {
    expect(log.size).toBe(0);
    expect(log.getEntries()).toEqual([]);
  });

  it('records entries', () => {
    const entry = makeAuditEntry();
    log.record(entry);
    expect(log.size).toBe(1);
    expect(log.getEntries()).toHaveLength(1);
    expect(log.getEntries()[0]).toEqual(entry);
  });

  it('stores a defensive copy (mutation-safe)', () => {
    const entry = makeAuditEntry();
    log.record(entry);
    entry.aiId = 'mutated';
    expect(log.getEntries()[0].aiId).toBe('ai-1');
  });

  it('returns a copy from getEntries', () => {
    log.record(makeAuditEntry());
    const entries = log.getEntries();
    entries.pop();
    expect(log.size).toBe(1);
  });

  it('clears all entries', () => {
    log.record(makeAuditEntry());
    log.record(makeAuditEntry({ operationId: 'op-2' }));
    expect(log.size).toBe(2);
    log.clear();
    expect(log.size).toBe(0);
  });

  describe('filtering', () => {
    beforeEach(() => {
      log.record(makeAuditEntry({ aiId: 'ai-1', action: 'read', result: 'success', timestamp: 100 }));
      log.record(makeAuditEntry({ aiId: 'ai-2', action: 'write', result: 'denied', timestamp: 200 }));
      log.record(makeAuditEntry({ aiId: 'ai-1', action: 'execute', result: 'failed', timestamp: 300 }));
      log.record(makeAuditEntry({ aiId: 'ai-2', action: 'apply-patch', result: 'success', timestamp: 400 }));
    });

    it('filters by aiId', () => {
      const result = log.getEntries({ aiId: 'ai-1' });
      expect(result).toHaveLength(2);
      expect(result.every((e) => e.aiId === 'ai-1')).toBe(true);
    });

    it('filters by action', () => {
      const result = log.getEntries({ action: 'write' });
      expect(result).toHaveLength(1);
      expect(result[0].action).toBe('write');
    });

    it('filters by result', () => {
      const result = log.getEntries({ result: 'success' });
      expect(result).toHaveLength(2);
    });

    it('filters by time range (since)', () => {
      const result = log.getEntries({ since: 200 });
      expect(result).toHaveLength(3);
    });

    it('filters by time range (until)', () => {
      const result = log.getEntries({ until: 200 });
      expect(result).toHaveLength(2);
    });

    it('combines multiple filters', () => {
      const result = log.getEntries({ aiId: 'ai-1', result: 'success' });
      expect(result).toHaveLength(1);
      expect(result[0].action).toBe('read');
    });
  });
});

// ===========================================================================
// PatchApplier
// ===========================================================================

describe('PatchApplier', () => {
  let applier: PatchApplier;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
    applier = new PatchApplier(tmpDir);
  });

  afterEach(() => {
    removeTmpDir(tmpDir);
  });

  /** Helper to build a PatchSet pointing at the temp dir. */
  function makePatchSet(overrides: Partial<PatchSet> = {}): PatchSet {
    return {
      operationId: 'patch-1',
      aiId: 'ai-1',
      conversationId: 'conv-1',
      entries: [],
      dryRun: false,
      ...overrides,
    };
  }

  describe('generateDiff', () => {
    it('generates diff for create operation', () => {
      const targetPath = path.join(tmpDir, 'new-file.txt');
      const patchSet = makePatchSet({
        entries: [
          { targetPath, operation: 'create', newContent: 'hello world' },
        ],
      });

      const diff = applier.generateDiff(patchSet);
      expect(diff).toHaveLength(1);
      expect(diff[0].operation).toBe('create');
      expect(diff[0].before).toBeNull();
      expect(diff[0].after).toBe('hello world');
    });

    it('generates diff for modify operation', () => {
      const targetPath = path.join(tmpDir, 'existing.txt');
      fs.writeFileSync(targetPath, 'original content', 'utf-8');

      const patchSet = makePatchSet({
        entries: [
          { targetPath, operation: 'modify', newContent: 'updated content' },
        ],
      });

      const diff = applier.generateDiff(patchSet);
      expect(diff).toHaveLength(1);
      expect(diff[0].before).toBe('original content');
      expect(diff[0].after).toBe('updated content');
    });

    it('generates diff for delete operation', () => {
      const targetPath = path.join(tmpDir, 'to-delete.txt');
      fs.writeFileSync(targetPath, 'content to delete', 'utf-8');

      const patchSet = makePatchSet({
        entries: [{ targetPath, operation: 'delete' }],
      });

      const diff = applier.generateDiff(patchSet);
      expect(diff).toHaveLength(1);
      expect(diff[0].before).toBe('content to delete');
      expect(diff[0].after).toBeNull();
    });
  });

  describe('dry-run apply', () => {
    it('returns success without modifying files', () => {
      const targetPath = path.join(tmpDir, 'should-not-exist.txt');
      const patchSet = makePatchSet({
        dryRun: true,
        entries: [
          { targetPath, operation: 'create', newContent: 'test' },
        ],
      });

      const result = applier.apply(patchSet);
      expect(result.success).toBe(true);
      expect(result.appliedEntries).toHaveLength(0);
      expect(result.rolledBack).toBe(false);
      expect(fs.existsSync(targetPath)).toBe(false);
    });
  });

  describe('atomic apply', () => {
    it('creates a new file', () => {
      const targetPath = path.join(tmpDir, 'created.txt');
      const patchSet = makePatchSet({
        entries: [
          { targetPath, operation: 'create', newContent: 'new content' },
        ],
      });

      const result = applier.apply(patchSet);
      expect(result.success).toBe(true);
      expect(result.appliedEntries).toHaveLength(1);
      expect(fs.readFileSync(targetPath, 'utf-8')).toBe('new content');
    });

    it('creates parent directories for new files', () => {
      const targetPath = path.join(tmpDir, 'sub', 'dir', 'file.txt');
      const patchSet = makePatchSet({
        entries: [
          { targetPath, operation: 'create', newContent: 'nested' },
        ],
      });

      const result = applier.apply(patchSet);
      expect(result.success).toBe(true);
      expect(fs.readFileSync(targetPath, 'utf-8')).toBe('nested');
    });

    it('modifies an existing file', () => {
      const targetPath = path.join(tmpDir, 'modify-me.txt');
      fs.writeFileSync(targetPath, 'before', 'utf-8');

      const patchSet = makePatchSet({
        entries: [
          { targetPath, operation: 'modify', newContent: 'after' },
        ],
      });

      const result = applier.apply(patchSet);
      expect(result.success).toBe(true);
      expect(fs.readFileSync(targetPath, 'utf-8')).toBe('after');
    });

    it('deletes an existing file', () => {
      const targetPath = path.join(tmpDir, 'delete-me.txt');
      fs.writeFileSync(targetPath, 'goodbye', 'utf-8');

      const patchSet = makePatchSet({
        entries: [
          { targetPath, operation: 'delete' },
        ],
      });

      const result = applier.apply(patchSet);
      expect(result.success).toBe(true);
      expect(fs.existsSync(targetPath)).toBe(false);
    });

    it('applies multiple entries atomically', () => {
      const file1 = path.join(tmpDir, 'file1.txt');
      const file2 = path.join(tmpDir, 'file2.txt');
      fs.writeFileSync(file2, 'original', 'utf-8');

      const patchSet = makePatchSet({
        entries: [
          { targetPath: file1, operation: 'create', newContent: 'created' },
          { targetPath: file2, operation: 'modify', newContent: 'modified' },
        ],
      });

      const result = applier.apply(patchSet);
      expect(result.success).toBe(true);
      expect(result.appliedEntries).toHaveLength(2);
      expect(fs.readFileSync(file1, 'utf-8')).toBe('created');
      expect(fs.readFileSync(file2, 'utf-8')).toBe('modified');
    });
  });

  describe('rollback on failure', () => {
    it('rolls back created files when a later entry fails', () => {
      const file1 = path.join(tmpDir, 'created-then-rolled-back.txt');
      const nonexistent = path.join(tmpDir, 'nonexistent.txt');

      const patchSet = makePatchSet({
        entries: [
          { targetPath: file1, operation: 'create', newContent: 'temporary' },
          { targetPath: nonexistent, operation: 'modify', newContent: 'fail' },
        ],
      });

      const result = applier.apply(patchSet);
      expect(result.success).toBe(false);
      expect(result.rolledBack).toBe(true);
      expect(result.error).toBeDefined();
      // file1 should have been rolled back (removed)
      expect(fs.existsSync(file1)).toBe(false);
    });

    it('rolls back modified files when a later entry fails', () => {
      const file1 = path.join(tmpDir, 'modified-then-rolled-back.txt');
      const nonexistent = path.join(tmpDir, 'nonexistent.txt');
      fs.writeFileSync(file1, 'original content', 'utf-8');

      const patchSet = makePatchSet({
        entries: [
          { targetPath: file1, operation: 'modify', newContent: 'changed' },
          { targetPath: nonexistent, operation: 'modify', newContent: 'fail' },
        ],
      });

      const result = applier.apply(patchSet);
      expect(result.success).toBe(false);
      expect(result.rolledBack).toBe(true);
      // file1 should be restored to original
      expect(fs.readFileSync(file1, 'utf-8')).toBe('original content');
    });

    it('rolls back deleted files when a later entry fails', () => {
      const file1 = path.join(tmpDir, 'deleted-then-rolled-back.txt');
      const nonexistent = path.join(tmpDir, 'nonexistent-for-delete.txt');
      fs.writeFileSync(file1, 'should be restored', 'utf-8');

      const patchSet = makePatchSet({
        entries: [
          { targetPath: file1, operation: 'delete' },
          { targetPath: nonexistent, operation: 'delete' },
        ],
      });

      const result = applier.apply(patchSet);
      expect(result.success).toBe(false);
      expect(result.rolledBack).toBe(true);
      // file1 should be restored
      expect(fs.existsSync(file1)).toBe(true);
      expect(fs.readFileSync(file1, 'utf-8')).toBe('should be restored');
    });

    it('fails when creating a file that already exists', () => {
      const existing = path.join(tmpDir, 'already-exists.txt');
      fs.writeFileSync(existing, 'taken', 'utf-8');

      const patchSet = makePatchSet({
        entries: [
          { targetPath: existing, operation: 'create', newContent: 'conflict' },
        ],
      });

      const result = applier.apply(patchSet);
      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });
  });
});

// ===========================================================================
// CommandRunner
// ===========================================================================

describe('CommandRunner', () => {
  let runner: CommandRunner;

  beforeEach(() => {
    runner = new CommandRunner(DEFAULT_COMMAND_POLICY);
  });

  describe('validation', () => {
    it('allows whitelisted commands', () => {
      expect(() =>
        runner.validate({ command: 'ls', args: ['-la'], cwd: '/tmp' }),
      ).not.toThrow();
    });

    it('rejects non-whitelisted commands', () => {
      expect(() =>
        runner.validate({ command: 'curl', args: ['http://evil.com'], cwd: '/tmp' }),
      ).toThrow('Command not allowed: curl');
    });

    it('blocks dangerous patterns', () => {
      const policy: CommandPolicy = {
        allowedCommands: ['rm'],
        blockedPatterns: ['rm\\s+-rf\\s+/'],
        maxExecutionTimeMs: 5000,
        maxOutputBytes: 1024,
      };
      const dangerousRunner = new CommandRunner(policy);

      expect(() =>
        dangerousRunner.validate({ command: 'rm', args: ['-rf', '/'], cwd: '/tmp' }),
      ).toThrow('Blocked dangerous pattern');
    });

    it('allows safe commands that do not match blocked patterns', () => {
      const policy: CommandPolicy = {
        allowedCommands: ['git'],
        blockedPatterns: ['rm\\s+-rf\\s+/'],
        maxExecutionTimeMs: 5000,
        maxOutputBytes: 1024,
      };
      const safeRunner = new CommandRunner(policy);

      expect(() =>
        safeRunner.validate({ command: 'git', args: ['status'], cwd: '/tmp' }),
      ).not.toThrow();
    });

    it('blocks chmod 777', () => {
      const policy: CommandPolicy = {
        allowedCommands: ['chmod'],
        blockedPatterns: ['chmod\\s+777'],
        maxExecutionTimeMs: 5000,
        maxOutputBytes: 1024,
      };
      const chmodRunner = new CommandRunner(policy);

      expect(() =>
        chmodRunner.validate({ command: 'chmod', args: ['777', '/tmp/file'], cwd: '/tmp' }),
      ).toThrow('Blocked dangerous pattern');
    });
  });

  describe('execution', () => {
    it('runs a simple command successfully', async () => {
      const testFile = path.join('/tmp', `runner-out-${Date.now()}.txt`);
      fs.writeFileSync(testFile, 'hello\n', 'utf-8');
      const result = await runner.run({
        command: 'cat',
        args: [testFile],
        cwd: '/tmp',
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('hello');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      fs.rmSync(testFile, { force: true });
    });

    it('captures stderr', async () => {
      const result = await runner.run({
        command: 'cat',
        args: ['/tmp/nonexistent-capture-stderr.txt'],
        cwd: '/tmp',
      });

      expect(result.exitCode).toBeGreaterThan(0);
      expect(result.stderr).toContain('No such file');
    });

    it('captures non-zero exit code', async () => {
      const result = await runner.run({
        command: 'ls',
        args: ['/tmp/nonexistent-capture-exit-code'],
        cwd: '/tmp',
      });

      expect(result.exitCode).toBeGreaterThan(0);
    });

    it('rejects non-whitelisted commands at execution', async () => {
      await expect(
        runner.run({ command: 'curl', args: [], cwd: '/tmp' }),
      ).rejects.toThrow('Command not allowed');
    });
  });
});

// ===========================================================================
// ExecutionService (integration)
// ===========================================================================

describe('ExecutionService', () => {
  let service: ExecutionService;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
    service = new ExecutionService({ workspaceRoot: tmpDir });
  });

  afterEach(() => {
    removeTmpDir(tmpDir);
  });

  describe('readFile', () => {
    it('reads file and logs success', async () => {
      const filePath = path.join(tmpDir, 'read-me.txt');
      fs.writeFileSync(filePath, 'file content', 'utf-8');

      const content = await service.readFile(filePath, 'ai-test');
      expect(content).toBe('file content');

      const entries = service.getAuditLog().getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe('read');
      expect(entries[0].result).toBe('success');
    });

    it('logs failure on missing file', async () => {
      const filePath = path.join(tmpDir, 'nonexistent.txt');

      await expect(service.readFile(filePath, 'ai-test')).rejects.toThrow();

      const entries = service.getAuditLog().getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].result).toBe('failed');
    });
  });

  describe('writeFile', () => {
    it('writes file and logs success', async () => {
      const filePath = path.join(tmpDir, 'write-me.txt');

      await service.writeFile(filePath, 'written', 'ai-test');
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('written');

      const entries = service.getAuditLog().getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe('write');
      expect(entries[0].result).toBe('success');
      expect(entries[0].rollbackable).toBe(true);
    });

    it('creates parent directories automatically', async () => {
      const filePath = path.join(tmpDir, 'deep', 'nested', 'file.txt');

      await service.writeFile(filePath, 'nested content', 'ai-test');
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('nested content');
    });
  });

  describe('listDir', () => {
    it('lists directory contents and logs success', async () => {
      fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'a', 'utf-8');
      fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'b', 'utf-8');

      const entries = await service.listDir(tmpDir, 'ai-test');
      expect(entries).toContain('a.txt');
      expect(entries).toContain('b.txt');

      const auditEntries = service.getAuditLog().getEntries();
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0].action).toBe('read');
    });
  });

  describe('applyPatch', () => {
    it('applies a patch set and logs success', async () => {
      const filePath = path.join(tmpDir, 'patched.txt');
      const patchSet: PatchSet = {
        operationId: 'patch-int-1',
        aiId: 'ai-test',
        conversationId: 'conv-1',
        entries: [
          { targetPath: filePath, operation: 'create', newContent: 'patched' },
        ],
        dryRun: false,
      };

      const result = await service.applyPatch(patchSet);
      expect(result.success).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('patched');

      const auditEntries = service.getAuditLog().getEntries();
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0].action).toBe('apply-patch');
      expect(auditEntries[0].result).toBe('success');
    });

    it('logs dry-run as success', async () => {
      const filePath = path.join(tmpDir, 'dry-run.txt');
      const patchSet: PatchSet = {
        operationId: 'patch-dry-1',
        aiId: 'ai-test',
        conversationId: 'conv-1',
        entries: [
          { targetPath: filePath, operation: 'create', newContent: 'should not exist' },
        ],
        dryRun: true,
      };

      const result = await service.applyPatch(patchSet);
      expect(result.success).toBe(true);
      expect(fs.existsSync(filePath)).toBe(false);

      const auditEntries = service.getAuditLog().getEntries();
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0].details).toBe('dry-run');
    });

    it('logs failure and rollback', async () => {
      const file1 = path.join(tmpDir, 'ok-file.txt');
      const nonexistent = path.join(tmpDir, 'no-such.txt');

      const patchSet: PatchSet = {
        operationId: 'patch-fail-1',
        aiId: 'ai-test',
        conversationId: 'conv-1',
        entries: [
          { targetPath: file1, operation: 'create', newContent: 'temp' },
          { targetPath: nonexistent, operation: 'modify', newContent: 'boom' },
        ],
        dryRun: false,
      };

      const result = await service.applyPatch(patchSet);
      expect(result.success).toBe(false);
      expect(result.rolledBack).toBe(true);

      const auditEntries = service.getAuditLog().getEntries();
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0].result).toBe('failed');
    });
  });

  describe('runCommand', () => {
    it('runs allowed command and logs success', async () => {
      const testFile = path.join(tmpDir, 'run-command-ok.txt');
      fs.writeFileSync(testFile, 'ok\n', 'utf-8');
      const result = await service.runCommand(
        { command: 'cat', args: [testFile], cwd: tmpDir },
        'ai-test',
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('ok');

      const auditEntries = service.getAuditLog().getEntries();
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0].action).toBe('execute');
      expect(auditEntries[0].result).toBe('success');
    });

    it('denies non-whitelisted command and logs denial', async () => {
      await expect(
        service.runCommand(
          { command: 'curl', args: ['http://evil.com'], cwd: tmpDir },
          'ai-test',
        ),
      ).rejects.toThrow('Command not allowed');

      const auditEntries = service.getAuditLog().getEntries();
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0].result).toBe('denied');
    });
  });

  describe('generateDiff', () => {
    it('returns diff entries for preview', () => {
      const filePath = path.join(tmpDir, 'diff-target.txt');
      fs.writeFileSync(filePath, 'before', 'utf-8');

      const patchSet: PatchSet = {
        operationId: 'diff-1',
        aiId: 'ai-test',
        conversationId: 'conv-1',
        entries: [
          { targetPath: filePath, operation: 'modify', newContent: 'after' },
        ],
        dryRun: true,
      };

      const diff = service.generateDiff(patchSet);
      expect(diff).toHaveLength(1);
      expect(diff[0].before).toBe('before');
      expect(diff[0].after).toBe('after');
    });
  });

  // ── Edge cases ────────────────────────────────────────────────

  describe('edge cases', () => {
    it('empty entries[] patch — applies as no-op success', async () => {
      const patchSet: PatchSet = {
        operationId: 'patch-empty',
        aiId: 'ai-test',
        conversationId: 'conv-1',
        entries: [],
        dryRun: false,
      };

      const result = await service.applyPatch(patchSet);
      expect(result.success).toBe(true);
      expect(result.appliedEntries).toHaveLength(0);
    });

    it('cwd outside workspace — path traversal blocked', async () => {
      const outsidePath = path.resolve(tmpDir, '..', 'escape.txt');

      const patchSet: PatchSet = {
        operationId: 'patch-escape',
        aiId: 'ai-test',
        conversationId: 'conv-1',
        entries: [
          { targetPath: outsidePath, operation: 'create', newContent: 'escaped' },
        ],
        dryRun: false,
      };

      await expect(service.applyPatch(patchSet)).rejects.toThrow('Path traversal blocked');
    });

    it('path traversal via .. in targetPath — blocked', async () => {
      const traversalPath = path.join(tmpDir, 'sub', '..', '..', 'escape.txt');

      const patchSet: PatchSet = {
        operationId: 'patch-traversal',
        aiId: 'ai-test',
        conversationId: 'conv-1',
        entries: [
          { targetPath: traversalPath, operation: 'create', newContent: 'hacked' },
        ],
        dryRun: false,
      };

      await expect(service.applyPatch(patchSet)).rejects.toThrow('Path traversal blocked');
    });
  });

  // ── R11-Task7: dryRunPreview ────────────────────────────────────

  describe('dryRunPreview (R11-Task7)', () => {
    function makeApproval(
      kind: ApprovalItem['kind'],
      payload: unknown,
      overrides: Partial<ApprovalItem> = {},
    ): ApprovalItem {
      return {
        id: 'app-1',
        kind,
        projectId: null,
        channelId: null,
        meetingId: null,
        requesterId: null,
        payload,
        status: 'pending',
        decisionComment: null,
        createdAt: 0,
        decidedAt: null,
        ...overrides,
      };
    }

    it('cli_permission Edit on existing file → modified + description preview', async () => {
      const target = path.join(tmpDir, 'real.txt');
      fs.writeFileSync(target, 'hello', 'utf-8');
      const approval = makeApproval('cli_permission', {
        kind: 'cli_permission',
        cliRequestId: 'cli-1',
        toolName: 'Edit',
        target,
        description: '루트 정책 갱신',
        participantId: 'p-claude',
        participantName: 'Claude',
      });

      const result = await service.dryRunPreview(approval);
      expect(result.impactedFiles).toEqual([
        { path: target, addedLines: 0, removedLines: 0, changeKind: 'modified' },
      ]);
      expect(result.diffPreviews).toEqual([
        { path: target, preview: '루트 정책 갱신', truncated: false },
      ]);
    });

    it('cli_permission Write on missing file → added (no description = no preview)', async () => {
      const target = path.join(tmpDir, 'new.txt');
      const approval = makeApproval('cli_permission', {
        kind: 'cli_permission',
        cliRequestId: 'cli-2',
        toolName: 'Write',
        target,
        description: null,
        participantId: 'p-codex',
        participantName: 'Codex',
      });

      const result = await service.dryRunPreview(approval);
      expect(result.impactedFiles[0]?.changeKind).toBe('added');
      expect(result.diffPreviews).toHaveLength(0);
    });

    it('cli_permission Delete tool → deleted changeKind regardless of fs state', async () => {
      const target = path.join(tmpDir, 'doomed.txt');
      fs.writeFileSync(target, 'bye', 'utf-8');
      const approval = makeApproval('cli_permission', {
        kind: 'cli_permission',
        cliRequestId: 'cli-3',
        toolName: 'Delete',
        target,
        description: '',
        participantId: 'p-x',
        participantName: 'X',
      });

      const result = await service.dryRunPreview(approval);
      expect(result.impactedFiles).toHaveLength(1);
      expect(result.impactedFiles[0]?.changeKind).toBe('deleted');
    });

    it('cli_permission unknown tool name (Bash) → empty arrays', async () => {
      const approval = makeApproval('cli_permission', {
        kind: 'cli_permission',
        cliRequestId: 'cli-4',
        toolName: 'Bash',
        target: 'rm -rf /tmp/foo',
        description: '쉘 실행',
        participantId: 'p',
        participantName: 'P',
      });

      const result = await service.dryRunPreview(approval);
      expect(result.impactedFiles).toEqual([]);
      expect(result.diffPreviews).toEqual([]);
    });

    it('mode_transition / review_outcome → empty arrays (no fs impact)', async () => {
      const modeTransition = makeApproval('mode_transition', {
        kind: 'mode_transition',
        currentMode: 'hybrid',
        targetMode: 'auto',
      });
      const review = makeApproval('review_outcome', { outcome: 'accepted' });

      const a = await service.dryRunPreview(modeTransition);
      const b = await service.dryRunPreview(review);
      expect(a).toEqual({ impactedFiles: [], diffPreviews: [] });
      expect(b).toEqual({ impactedFiles: [], diffPreviews: [] });
    });

    it('cli_permission with empty target → empty arrays (defensive)', async () => {
      const approval = makeApproval('cli_permission', {
        kind: 'cli_permission',
        cliRequestId: 'cli-empty',
        toolName: 'Edit',
        target: '',
        description: 'no path',
        participantId: 'p',
        participantName: 'P',
      });
      const result = await service.dryRunPreview(approval);
      expect(result.impactedFiles).toEqual([]);
      expect(result.diffPreviews).toEqual([]);
    });

    it('null payload → empty arrays (no projection)', async () => {
      const approval = makeApproval('cli_permission', null);
      const result = await service.dryRunPreview(approval);
      expect(result.impactedFiles).toEqual([]);
      expect(result.diffPreviews).toEqual([]);
    });

    it('does not write to filesystem (read-only invariant)', async () => {
      const target = path.join(tmpDir, 'sentinel.txt');
      fs.writeFileSync(target, 'before', 'utf-8');
      const approval = makeApproval('cli_permission', {
        kind: 'cli_permission',
        cliRequestId: 'cli-ro',
        toolName: 'Edit',
        target,
        description: 'should not write',
        participantId: 'p',
        participantName: 'P',
      });
      await service.dryRunPreview(approval);
      // File content must be unchanged — preview never executes apply.
      expect(fs.readFileSync(target, 'utf-8')).toBe('before');
      // Audit log must not have grown — dryRunPreview is observation only.
      const beforeCount = service.getAuditLog().size;
      await service.dryRunPreview(approval);
      expect(service.getAuditLog().size).toBe(beforeCount);
    });

    it('alternate write tool aliases (write_file / edit_file) → recognised', async () => {
      const target = path.join(tmpDir, 'snake.txt');
      fs.writeFileSync(target, '!', 'utf-8');
      const r1 = await service.dryRunPreview(
        makeApproval('cli_permission', {
          kind: 'cli_permission',
          cliRequestId: 'a',
          toolName: 'edit_file',
          target,
          description: '',
          participantId: 'p',
          participantName: 'P',
        }),
      );
      const r2 = await service.dryRunPreview(
        makeApproval('cli_permission', {
          kind: 'cli_permission',
          cliRequestId: 'b',
          toolName: 'write_file',
          target,
          description: '',
          participantId: 'p',
          participantName: 'P',
        }),
      );
      expect(r1.impactedFiles[0]?.changeKind).toBe('modified');
      expect(r2.impactedFiles[0]?.changeKind).toBe('modified');
    });
  });
});
