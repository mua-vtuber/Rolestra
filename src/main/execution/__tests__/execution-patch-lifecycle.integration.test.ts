/**
 * Integration tests for the patch lifecycle through ExecutionService.
 *
 * Tests the full flow: generateDiff (preview) -> applyPatch (apply) -> verify,
 * plus dry-run mode, atomic apply/rollback, path traversal protection, and
 * audit trail recording.
 *
 * Uses real file system with temp directories for isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createTmpDir, removeTmpDir, makePatchSet, makePatchEntry } from '../../../test-utils';
import { ExecutionService } from '../execution-service';
import type { PatchSet } from '../../../shared/execution-types';

describe('Execution Patch Lifecycle', () => {
  let tmpDir: string;
  let service: ExecutionService;

  beforeEach(() => {
    tmpDir = createTmpDir('exec-patch-lifecycle-');
    service = new ExecutionService({ workspaceRoot: tmpDir });
  });

  afterEach(() => {
    removeTmpDir(tmpDir);
  });

  /** Build a PatchSet with entries pointing at the temp dir. */
  function localPatchSet(overrides: Partial<PatchSet> = {}): PatchSet {
    return makePatchSet(overrides);
  }

  // ── Full Lifecycle ──────────────────────────────────────────────────

  it('full lifecycle: generateDiff (preview) then applyPatch (apply) then verify', async () => {
    const targetPath = path.join(tmpDir, 'lifecycle.txt');
    const patchSet = localPatchSet({
      entries: [makePatchEntry({ targetPath, operation: 'create', newContent: 'lifecycle content' })],
    });

    // Preview
    const diff = service.generateDiff(patchSet);
    expect(diff).toHaveLength(1);
    expect(diff[0].operation).toBe('create');
    expect(diff[0].before).toBeNull();
    expect(diff[0].after).toBe('lifecycle content');

    // File should not exist yet (generateDiff is read-only)
    expect(fs.existsSync(targetPath)).toBe(false);

    // Apply
    const applySet = { ...patchSet, dryRun: false };
    const result = await service.applyPatch(applySet);
    expect(result.success).toBe(true);

    // Verify
    expect(fs.existsSync(targetPath)).toBe(true);
    expect(fs.readFileSync(targetPath, 'utf-8')).toBe('lifecycle content');
  });

  // ── Dry-Run ────────────────────────────────────────────────────────

  it('dry-run: dryRun=true does not create file, result.success=true', async () => {
    const targetPath = path.join(tmpDir, 'dry-run-file.txt');
    const patchSet = localPatchSet({
      dryRun: true,
      entries: [makePatchEntry({ targetPath, operation: 'create', newContent: 'should not exist' })],
    });

    const result = await service.applyPatch(patchSet);
    expect(result.success).toBe(true);
    expect(result.appliedEntries).toHaveLength(0);
    expect(fs.existsSync(targetPath)).toBe(false);
  });

  // ── Create then Verify Content ─────────────────────────────────────

  it('create file then verify content matches', async () => {
    const targetPath = path.join(tmpDir, 'verify-content.txt');
    const content = 'Hello, World!\nLine 2\nLine 3';
    const patchSet = localPatchSet({
      entries: [makePatchEntry({ targetPath, operation: 'create', newContent: content })],
    });

    const result = await service.applyPatch(patchSet);
    expect(result.success).toBe(true);
    expect(fs.readFileSync(targetPath, 'utf-8')).toBe(content);
  });

  // ── Modify Existing File ──────────────────────────────────────────

  it('modify existing file then verify new content', async () => {
    const targetPath = path.join(tmpDir, 'modify-me.txt');
    fs.writeFileSync(targetPath, 'original content', 'utf-8');

    const patchSet = localPatchSet({
      entries: [makePatchEntry({ targetPath, operation: 'modify', newContent: 'updated content' })],
    });

    const result = await service.applyPatch(patchSet);
    expect(result.success).toBe(true);
    expect(fs.readFileSync(targetPath, 'utf-8')).toBe('updated content');
  });

  // ── Delete Existing File ──────────────────────────────────────────

  it('delete existing file then verify removed', async () => {
    const targetPath = path.join(tmpDir, 'delete-me.txt');
    fs.writeFileSync(targetPath, 'doomed content', 'utf-8');

    const patchSet = localPatchSet({
      entries: [makePatchEntry({ targetPath, operation: 'delete' })],
    });

    const result = await service.applyPatch(patchSet);
    expect(result.success).toBe(true);
    expect(fs.existsSync(targetPath)).toBe(false);
  });

  // ── Multi-File Atomic Apply ───────────────────────────────────────

  it('multi-file atomic apply: 3 entries all succeed', async () => {
    const file1 = path.join(tmpDir, 'multi-1.txt');
    const file2 = path.join(tmpDir, 'multi-2.txt');
    const file3 = path.join(tmpDir, 'multi-3.txt');
    fs.writeFileSync(file2, 'original', 'utf-8');

    const patchSet = localPatchSet({
      entries: [
        makePatchEntry({ targetPath: file1, operation: 'create', newContent: 'created' }),
        makePatchEntry({ targetPath: file2, operation: 'modify', newContent: 'modified' }),
        makePatchEntry({ targetPath: file3, operation: 'create', newContent: 'also created' }),
      ],
    });

    const result = await service.applyPatch(patchSet);
    expect(result.success).toBe(true);
    expect(result.appliedEntries).toHaveLength(3);
    expect(fs.readFileSync(file1, 'utf-8')).toBe('created');
    expect(fs.readFileSync(file2, 'utf-8')).toBe('modified');
    expect(fs.readFileSync(file3, 'utf-8')).toBe('also created');
  });

  // ── Atomic Rollback ───────────────────────────────────────────────

  it('atomic rollback: first entry succeeds, second fails, first rolled back', async () => {
    const file1 = path.join(tmpDir, 'rollback-1.txt');
    const nonExistent = path.join(tmpDir, 'does-not-exist.txt');

    const patchSet = localPatchSet({
      entries: [
        makePatchEntry({ targetPath: file1, operation: 'create', newContent: 'temporary' }),
        makePatchEntry({ targetPath: nonExistent, operation: 'modify', newContent: 'fail' }),
      ],
    });

    const result = await service.applyPatch(patchSet);
    expect(result.success).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(result.error).toBeDefined();
    // file1 should have been rolled back (removed because it was created)
    expect(fs.existsSync(file1)).toBe(false);
  });

  // ── Path Traversal Blocked ────────────────────────────────────────

  it('path traversal blocked: targetPath with ".." escaping workspace', async () => {
    const escapePath = path.resolve(tmpDir, '..', 'escape.txt');

    const patchSet = localPatchSet({
      entries: [makePatchEntry({ targetPath: escapePath, operation: 'create', newContent: 'hacked' })],
    });

    await expect(service.applyPatch(patchSet)).rejects.toThrow(/path traversal blocked/i);
  });

  // ── Empty Entries ─────────────────────────────────────────────────

  it('empty entries results in no-op success', async () => {
    const patchSet = localPatchSet({ entries: [] });

    const result = await service.applyPatch(patchSet);
    expect(result.success).toBe(true);
    expect(result.appliedEntries).toHaveLength(0);
  });

  // ── Create File in Nested Directory ───────────────────────────────

  it('create file in nested directory: parent dirs created automatically', async () => {
    const targetPath = path.join(tmpDir, 'deep', 'nested', 'dir', 'file.txt');

    const patchSet = localPatchSet({
      entries: [makePatchEntry({ targetPath, operation: 'create', newContent: 'nested content' })],
    });

    const result = await service.applyPatch(patchSet);
    expect(result.success).toBe(true);
    expect(fs.readFileSync(targetPath, 'utf-8')).toBe('nested content');
  });

  // ── Modify Non-Existent File ──────────────────────────────────────

  it('modify non-existent file results in failure + rollback', async () => {
    const nonExistent = path.join(tmpDir, 'no-such-file.txt');

    const patchSet = localPatchSet({
      entries: [makePatchEntry({ targetPath: nonExistent, operation: 'modify', newContent: 'new' })],
    });

    const result = await service.applyPatch(patchSet);
    expect(result.success).toBe(false);
    expect(result.error).toContain('does not exist');
  });

  // ── Audit Trail ───────────────────────────────────────────────────

  it('audit trail: every operation logged to audit log', async () => {
    const targetPath = path.join(tmpDir, 'audited.txt');

    const patchSet = localPatchSet({
      entries: [makePatchEntry({ targetPath, operation: 'create', newContent: 'audited' })],
    });

    await service.applyPatch(patchSet);

    const entries = service.getAuditLog().getEntries();
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0].action).toBe('apply-patch');
    expect(entries[0].result).toBe('success');
    expect(entries[0].aiId).toBe(patchSet.aiId);
    expect(entries[0].operationId).toBe(patchSet.operationId);
  });
});
