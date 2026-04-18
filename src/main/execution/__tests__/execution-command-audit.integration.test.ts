/**
 * Integration tests for command execution with audit logging.
 *
 * Tests the CommandRunner policy enforcement combined with the
 * ExecutionService's audit log recording. Verifies that allowed commands
 * produce success entries, blocked commands produce denied entries,
 * and that audit filtering works correctly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createTmpDir, removeTmpDir } from '../../../test-utils';
import { ExecutionService } from '../execution-service';
import { AuditLog } from '../audit-log';
import { makeAuditEntry } from '../../../test-utils';

describe('Execution Command Audit', () => {
  let tmpDir: string;
  let service: ExecutionService;

  beforeEach(() => {
    tmpDir = createTmpDir('exec-cmd-audit-');
    service = new ExecutionService({ workspaceRoot: tmpDir });
  });

  afterEach(() => {
    removeTmpDir(tmpDir);
  });

  // ── Allowed Command → Success Audit Entry ─────────────────────────

  it('allowed command produces success audit entry', async () => {
    const testFile = path.join(tmpDir, 'audit-ok.txt');
    fs.writeFileSync(testFile, 'content\n', 'utf-8');

    const result = await service.runCommand(
      { command: 'cat', args: [testFile], cwd: tmpDir },
      'ai-audit-test',
    );

    expect(result.exitCode).toBe(0);

    const entries = service.getAuditLog().getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('execute');
    expect(entries[0].result).toBe('success');
    expect(entries[0].aiId).toBe('ai-audit-test');
  });

  // ── Blocked Command → Denied Audit Entry ──────────────────────────

  it('blocked command produces denied audit entry', async () => {
    await expect(
      service.runCommand(
        { command: 'curl', args: ['http://evil.com'], cwd: tmpDir },
        'ai-malicious',
      ),
    ).rejects.toThrow('Command not allowed');

    const entries = service.getAuditLog().getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('execute');
    expect(entries[0].result).toBe('denied');
    expect(entries[0].aiId).toBe('ai-malicious');
  });

  // ── Command Execution Result Logged ───────────────────────────────

  it('command execution result includes details in audit entry', async () => {
    const testFile = path.join(tmpDir, 'detail-ok.txt');
    fs.writeFileSync(testFile, 'detail\n', 'utf-8');

    await service.runCommand(
      { command: 'cat', args: [testFile], cwd: tmpDir },
      'ai-detail',
    );

    const entries = service.getAuditLog().getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].details).toContain('cat');
    expect(typeof entries[0].operationId).toBe('string');
    expect(entries[0].operationId.length).toBeGreaterThan(0);
  });

  // ── Audit Filtering by aiId ───────────────────────────────────────

  it('audit filtering by aiId returns only matching entries', async () => {
    const testFile = path.join(tmpDir, 'filter-aiId.txt');
    fs.writeFileSync(testFile, 'x\n', 'utf-8');

    await service.runCommand({ command: 'cat', args: [testFile], cwd: tmpDir }, 'ai-1');
    await service.runCommand({ command: 'cat', args: [testFile], cwd: tmpDir }, 'ai-2');
    await service.runCommand({ command: 'cat', args: [testFile], cwd: tmpDir }, 'ai-1');

    const filtered = service.getAuditLog().getEntries({ aiId: 'ai-1' });
    expect(filtered).toHaveLength(2);
    expect(filtered.every((e) => e.aiId === 'ai-1')).toBe(true);
  });

  // ── Audit Filtering by Action Type ────────────────────────────────

  it('audit filtering by action type returns only matching entries', async () => {
    // Execute a command (action = 'execute')
    const testFile = path.join(tmpDir, 'action-filter.txt');
    fs.writeFileSync(testFile, 'x\n', 'utf-8');
    await service.runCommand({ command: 'cat', args: [testFile], cwd: tmpDir }, 'ai-1');

    // Read a file (action = 'read')
    await service.readFile(testFile, 'ai-1');

    const executeEntries = service.getAuditLog().getEntries({ action: 'execute' });
    expect(executeEntries).toHaveLength(1);
    expect(executeEntries[0].action).toBe('execute');

    const readEntries = service.getAuditLog().getEntries({ action: 'read' });
    expect(readEntries).toHaveLength(1);
    expect(readEntries[0].action).toBe('read');
  });

  // ── Audit Filtering by Result ─────────────────────────────────────

  it('audit filtering by result returns only matching entries', async () => {
    const testFile = path.join(tmpDir, 'result-filter.txt');
    fs.writeFileSync(testFile, 'x\n', 'utf-8');

    // One success
    await service.runCommand({ command: 'cat', args: [testFile], cwd: tmpDir }, 'ai-1');

    // One denied
    try {
      await service.runCommand({ command: 'curl', args: [], cwd: tmpDir }, 'ai-1');
    } catch {
      // expected
    }

    const successEntries = service.getAuditLog().getEntries({ result: 'success' });
    expect(successEntries).toHaveLength(1);

    const deniedEntries = service.getAuditLog().getEntries({ result: 'denied' });
    expect(deniedEntries).toHaveLength(1);
  });

  // ── Audit Filtering by Time Range ─────────────────────────────────

  it('audit filtering by time range (since/until) works correctly', () => {
    const log = new AuditLog();
    log.record(makeAuditEntry({ timestamp: 100, aiId: 'ai-1' }));
    log.record(makeAuditEntry({ timestamp: 200, aiId: 'ai-1' }));
    log.record(makeAuditEntry({ timestamp: 300, aiId: 'ai-1' }));
    log.record(makeAuditEntry({ timestamp: 400, aiId: 'ai-1' }));

    const sinceResult = log.getEntries({ since: 200 });
    expect(sinceResult).toHaveLength(3);

    const untilResult = log.getEntries({ until: 300 });
    expect(untilResult).toHaveLength(3);

    const rangeResult = log.getEntries({ since: 200, until: 300 });
    expect(rangeResult).toHaveLength(2);
  });

  // ── Combined Filters ──────────────────────────────────────────────

  it('combined filters (aiId + result) narrow results correctly', async () => {
    const testFile = path.join(tmpDir, 'combined-filter.txt');
    fs.writeFileSync(testFile, 'x\n', 'utf-8');

    // ai-1: success
    await service.runCommand({ command: 'cat', args: [testFile], cwd: tmpDir }, 'ai-1');
    // ai-2: success
    await service.runCommand({ command: 'cat', args: [testFile], cwd: tmpDir }, 'ai-2');
    // ai-1: denied
    try {
      await service.runCommand({ command: 'curl', args: [], cwd: tmpDir }, 'ai-1');
    } catch {
      // expected
    }

    const combined = service.getAuditLog().getEntries({ aiId: 'ai-1', result: 'success' });
    expect(combined).toHaveLength(1);
    expect(combined[0].aiId).toBe('ai-1');
    expect(combined[0].result).toBe('success');
  });

  // ── Audit Clear ───────────────────────────────────────────────────

  it('audit clear empties the log', async () => {
    const testFile = path.join(tmpDir, 'clear-me.txt');
    fs.writeFileSync(testFile, 'x\n', 'utf-8');

    await service.runCommand({ command: 'cat', args: [testFile], cwd: tmpDir }, 'ai-1');
    await service.runCommand({ command: 'cat', args: [testFile], cwd: tmpDir }, 'ai-2');

    expect(service.getAuditLog().size).toBe(2);

    service.getAuditLog().clear();
    expect(service.getAuditLog().size).toBe(0);
    expect(service.getAuditLog().getEntries()).toEqual([]);
  });

  // ── Multiple Operations → Correct Count and Ordering ──────────────

  it('multiple operations produce correct count and chronological ordering', async () => {
    const file1 = path.join(tmpDir, 'order-1.txt');
    const file2 = path.join(tmpDir, 'order-2.txt');
    fs.writeFileSync(file1, 'a\n', 'utf-8');
    fs.writeFileSync(file2, 'b\n', 'utf-8');

    await service.runCommand({ command: 'cat', args: [file1], cwd: tmpDir }, 'ai-1');
    await service.runCommand({ command: 'cat', args: [file2], cwd: tmpDir }, 'ai-2');
    await service.readFile(file1, 'ai-3');

    const entries = service.getAuditLog().getEntries();
    expect(entries).toHaveLength(3);

    // Entries should be in chronological order
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].timestamp).toBeGreaterThanOrEqual(entries[i - 1].timestamp);
    }
  });
});
