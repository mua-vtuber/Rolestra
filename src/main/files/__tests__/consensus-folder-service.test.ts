import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ConsensusFolderService } from '../consensus-folder-service';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'arena-consensus-test-'));
}

function cleanupDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('ConsensusFolderService', () => {
  let service: ConsensusFolderService;
  let tmpDir: string;

  beforeEach(() => {
    service = new ConsensusFolderService();
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    service.dispose();
    cleanupDir(tmpDir);
  });

  // ── getDefaultPath ──────────────────────────────────────────────

  it('returns a path under home directory', () => {
    const defaultPath = service.getDefaultPath();
    expect(defaultPath).toContain(os.homedir());
    expect(defaultPath).toContain('AI_Chat_Arena');
  });

  it('uses injected documentsPath when provided', () => {
    const custom = new ConsensusFolderService('/custom/docs');
    expect(custom.getDefaultPath()).toBe(path.join('/custom/docs', 'AI_Chat_Arena'));
    custom.dispose();
  });

  // ── initFolder ──────────────────────────────────────────────────

  it('creates folder at custom path', async () => {
    const customPath = path.join(tmpDir, 'consensus');
    const info = await service.initFolder(customPath);

    expect(info.folderPath).toBe(path.resolve(customPath));
    expect(info.exists).toBe(true);
    expect(info.isDefault).toBe(false);
    expect(fs.existsSync(path.resolve(customPath))).toBe(true);
  });

  it('creates folder at default path when customPath is null', async () => {
    const info = await service.initFolder(null);

    expect(info.folderPath).toBe(service.getDefaultPath());
    expect(info.isDefault).toBe(true);
  });

  it('creates folder at default path when customPath is undefined', async () => {
    const info = await service.initFolder();

    expect(info.folderPath).toBe(service.getDefaultPath());
    expect(info.isDefault).toBe(true);
  });

  it('is idempotent — second init does not destroy content', async () => {
    const customPath = path.join(tmpDir, 'consensus');
    await service.initFolder(customPath);

    const testFile = path.join(customPath, 'result.md');
    fs.writeFileSync(testFile, '# Test');

    await service.initFolder(customPath);
    expect(fs.readFileSync(testFile, 'utf-8')).toBe('# Test');
  });

  it('creates nested directories recursively', async () => {
    const deepPath = path.join(tmpDir, 'a', 'b', 'c', 'consensus');
    const info = await service.initFolder(deepPath);

    expect(info.exists).toBe(true);
    expect(fs.existsSync(path.resolve(deepPath))).toBe(true);
  });

  // ── getInfo ─────────────────────────────────────────────────────

  it('returns null before initialization', () => {
    expect(service.getInfo()).toBeNull();
  });

  it('returns info after initialization', async () => {
    const customPath = path.join(tmpDir, 'consensus');
    await service.initFolder(customPath);

    const info = service.getInfo();
    expect(info).not.toBeNull();
    expect(info!.folderPath).toBe(path.resolve(customPath));
    expect(info!.exists).toBe(true);
  });

  // ── getFolderPath ───────────────────────────────────────────────

  it('returns null before initialization', () => {
    expect(service.getFolderPath()).toBeNull();
  });

  it('returns path after initialization', async () => {
    const customPath = path.join(tmpDir, 'consensus');
    await service.initFolder(customPath);
    expect(service.getFolderPath()).toBe(path.resolve(customPath));
  });

  // ── isConsensusPath ─────────────────────────────────────────────

  it('returns false before initialization', () => {
    expect(service.isConsensusPath('/any/path')).toBe(false);
  });

  it('returns true for exact folder path', async () => {
    const customPath = path.join(tmpDir, 'consensus');
    await service.initFolder(customPath);
    expect(service.isConsensusPath(path.resolve(customPath))).toBe(true);
  });

  it('returns true for paths inside consensus folder', async () => {
    const customPath = path.join(tmpDir, 'consensus');
    await service.initFolder(customPath);

    expect(service.isConsensusPath(path.join(customPath, 'result.md'))).toBe(true);
    expect(service.isConsensusPath(path.join(customPath, 'sub', 'deep.md'))).toBe(true);
  });

  it('returns false for paths outside consensus folder', async () => {
    const customPath = path.join(tmpDir, 'consensus');
    await service.initFolder(customPath);

    expect(service.isConsensusPath(tmpDir)).toBe(false);
    expect(service.isConsensusPath('/some/other/path')).toBe(false);
  });

  // ── dispose ─────────────────────────────────────────────────────

  it('resets state after dispose', async () => {
    const customPath = path.join(tmpDir, 'consensus');
    await service.initFolder(customPath);
    expect(service.getInfo()).not.toBeNull();

    service.dispose();
    expect(service.getInfo()).toBeNull();
    expect(service.getFolderPath()).toBeNull();
    expect(service.isConsensusPath(path.resolve(customPath))).toBe(false);
  });
});
