import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DiffGenerator } from '../diff-generator';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('DiffGenerator', () => {
  let tmpDir: string;
  let generator: DiffGenerator;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-test-'));
    generator = new DiffGenerator();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects new files', async () => {
    generator.snapshot(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'new.txt'), 'hello\n');
    const diffs = await generator.generateDiffs(tmpDir);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].file).toContain('new.txt');
    expect(diffs[0].diff).toContain('hello');
  });

  it('detects modified files', async () => {
    fs.writeFileSync(path.join(tmpDir, 'existing.txt'), 'before\n');
    generator.snapshot(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'existing.txt'), 'after\n');
    const diffs = await generator.generateDiffs(tmpDir);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].diff).toContain('before');
    expect(diffs[0].diff).toContain('after');
  });

  it('detects deleted files', async () => {
    fs.writeFileSync(path.join(tmpDir, 'toDelete.txt'), 'gone\n');
    generator.snapshot(tmpDir);
    fs.unlinkSync(path.join(tmpDir, 'toDelete.txt'));
    const diffs = await generator.generateDiffs(tmpDir);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].diff).toContain('gone');
  });

  it('returns empty for no changes', async () => {
    fs.writeFileSync(path.join(tmpDir, 'same.txt'), 'unchanged\n');
    generator.snapshot(tmpDir);
    const diffs = await generator.generateDiffs(tmpDir);
    expect(diffs).toHaveLength(0);
  });
});
