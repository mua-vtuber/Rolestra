/**
 * Unit tests for ConsensusFolderService (R2 Task 14).
 *
 * Coverage:
 *   - writeDocument happy path: file exists, content matches, no tmp leak.
 *   - concurrent writeDocument (Promise.all): both resolve, final file exists.
 *   - stale lock reclamation: dead pid + aged mtime → reclaim and proceed.
 *   - live lock timeout: fresh sentinel from live pid → LockTimeoutError.
 *   - withLock retries under contention: second caller waits for first.
 *   - removeLock is idempotent (does not throw on already-deleted dir).
 *
 * Tests use injectable `timeoutMs` / `staleMs` where possible so wall-clock
 * budgets stay in the low-hundreds-of-milliseconds range.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConsensusFolderService,
  LockTimeoutError,
} from '../consensus-folder-service';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rolestra-consensus-task14-'));
}

function cleanupDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('ConsensusFolderService', () => {
  let tmpRoot: string;
  let service: ConsensusFolderService;

  beforeEach(() => {
    tmpRoot = makeTmpDir();
    // `consensusRoot` mirrors what ArenaRootService.consensusPath() returns.
    service = new ConsensusFolderService(tmpRoot);
  });

  afterEach(() => {
    cleanupDir(tmpRoot);
  });

  // ── writeDocument ─────────────────────────────────────────────────

  it('writeDocument writes content and leaves no tmp file behind', async () => {
    await service.writeDocument('doc.md', 'hello');

    const docPath = path.join(tmpRoot, 'documents', 'doc.md');
    expect(fs.existsSync(docPath)).toBe(true);
    expect(fs.readFileSync(docPath, 'utf8')).toBe('hello');

    // No stray `.tmp.*` or `.lock` artefacts.
    const entries = fs.readdirSync(path.join(tmpRoot, 'documents'));
    expect(entries.filter((e) => e.includes('.tmp.'))).toHaveLength(0);
    expect(entries.filter((e) => e.endsWith('.lock'))).toHaveLength(0);
  });

  it('writeDocument creates nested directories under documents/', async () => {
    await service.writeDocument('folder/sub/nested.md', 'n');
    const docPath = path.join(tmpRoot, 'documents', 'folder', 'sub', 'nested.md');
    expect(fs.existsSync(docPath)).toBe(true);
    expect(fs.readFileSync(docPath, 'utf8')).toBe('n');
  });

  it('writeDocument is atomic: second write overwrites first (last-writer-wins)', async () => {
    await service.writeDocument('doc.md', 'first');
    await service.writeDocument('doc.md', 'second');
    const docPath = path.join(tmpRoot, 'documents', 'doc.md');
    expect(fs.readFileSync(docPath, 'utf8')).toBe('second');
  });

  it('concurrent writeDocument calls serialise and both complete', async () => {
    const results = await Promise.all([
      service.writeDocument('doc.md', 'AAAAA'),
      service.writeDocument('doc.md', 'BBBBB'),
    ]);
    expect(results).toEqual([undefined, undefined]);

    const docPath = path.join(tmpRoot, 'documents', 'doc.md');
    const finalContent = fs.readFileSync(docPath, 'utf8');
    // Serialisation means the final file is ONE of the two full writes —
    // never an interleaving. The order is non-deterministic.
    expect(['AAAAA', 'BBBBB']).toContain(finalContent);

    // Sentinel must be gone after both releases.
    const lockPath = `${docPath}.lock`;
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  // ── withLock: stale reclamation ────────────────────────────────────

  it('reclaims a stale lock owned by a non-existent pid', async () => {
    // Seed documents/ so writeDocument's target path resolves cleanly.
    const docsDir = path.join(tmpRoot, 'documents');
    fs.mkdirSync(docsDir, { recursive: true });
    const target = path.join(docsDir, 'doc.md');
    const lockPath = `${target}.lock`;

    // Simulate a crashed writer: sentinel exists, pid belongs to no one.
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, 'pid'), '999999', 'utf8');
    // Age the sentinel so it passes the mtime gate.
    const ancient = new Date(Date.now() - 60_000);
    fs.utimesSync(lockPath, ancient, ancient);

    await service.writeDocument('doc.md', 'reclaimed');
    expect(fs.readFileSync(target, 'utf8')).toBe('reclaimed');
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('reclaims a stale lock with unreadable pid file', async () => {
    const docsDir = path.join(tmpRoot, 'documents');
    fs.mkdirSync(docsDir, { recursive: true });
    const target = path.join(docsDir, 'doc.md');
    const lockPath = `${target}.lock`;

    // Sentinel present but NO pid file → isStale returns true unconditionally.
    fs.mkdirSync(lockPath);

    await service.writeDocument('doc.md', 'ok');
    expect(fs.readFileSync(target, 'utf8')).toBe('ok');
  });

  // ── withLock: timeout on live lock ─────────────────────────────────

  it('throws LockTimeoutError when a live pid holds the lock past budget', async () => {
    const docsDir = path.join(tmpRoot, 'documents');
    fs.mkdirSync(docsDir, { recursive: true });
    const target = path.join(docsDir, 'doc.md');
    const lockPath = `${target}.lock`;

    // Simulate a live owner: use OUR pid (guaranteed alive) and leave
    // mtime fresh so the stale gate does NOT fire.
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, 'pid'), String(process.pid), 'utf8');

    await expect(
      service.withLock(target, async () => 'unreachable', {
        timeoutMs: 200,
        staleMs: 30_000,
      }),
    ).rejects.toBeInstanceOf(LockTimeoutError);

    // The sentinel should still be present (we never owned it, so the
    // finally block must not have removed it).
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it('LockTimeoutError carries the lock path and timeout budget', async () => {
    const docsDir = path.join(tmpRoot, 'documents');
    fs.mkdirSync(docsDir, { recursive: true });
    const target = path.join(docsDir, 'doc.md');
    const lockPath = `${target}.lock`;

    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, 'pid'), String(process.pid), 'utf8');

    try {
      await service.withLock(target, async () => undefined, {
        timeoutMs: 150,
      });
      throw new Error('expected LockTimeoutError');
    } catch (err) {
      expect(err).toBeInstanceOf(LockTimeoutError);
      const e = err as LockTimeoutError;
      expect(e.lockPath).toBe(lockPath);
      expect(e.timeoutMs).toBe(150);
      expect(e.message).toContain('Lock timeout');
    }
  });

  // ── withLock: retry under contention ──────────────────────────────

  it('withLock second caller waits until first releases', async () => {
    const docsDir = path.join(tmpRoot, 'documents');
    fs.mkdirSync(docsDir, { recursive: true });
    const target = path.join(docsDir, 'doc.md');

    const events: string[] = [];

    const first = service.withLock(target, async () => {
      events.push('first:start');
      await new Promise((r) => setTimeout(r, 150));
      events.push('first:end');
    });

    // Small delay so `first` has definitely acquired the sentinel.
    await new Promise((r) => setTimeout(r, 20));

    const second = service.withLock(target, async () => {
      events.push('second:start');
    });

    await Promise.all([first, second]);

    // Strict ordering: second cannot start before first ends.
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('withLock returns the inner function result', async () => {
    const docsDir = path.join(tmpRoot, 'documents');
    fs.mkdirSync(docsDir, { recursive: true });
    const target = path.join(docsDir, 'doc.md');

    const value = await service.withLock(target, async () => 42);
    expect(value).toBe(42);
  });

  it('withLock releases the sentinel even when fn throws', async () => {
    const docsDir = path.join(tmpRoot, 'documents');
    fs.mkdirSync(docsDir, { recursive: true });
    const target = path.join(docsDir, 'doc.md');
    const lockPath = `${target}.lock`;

    await expect(
      service.withLock(target, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(fs.existsSync(lockPath)).toBe(false);
  });

  // ── removeLock idempotency (behavioural check via withLock) ───────

  it('withLock tolerates sentinel disappearing between fn and finally', async () => {
    const docsDir = path.join(tmpRoot, 'documents');
    fs.mkdirSync(docsDir, { recursive: true });
    const target = path.join(docsDir, 'doc.md');
    const lockPath = `${target}.lock`;

    await service.withLock(target, async () => {
      // Yank the sentinel out from under the finally block.
      fs.rmSync(lockPath, { recursive: true, force: true });
    });

    // Should complete without throwing — removeLock swallows ENOENT.
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});
