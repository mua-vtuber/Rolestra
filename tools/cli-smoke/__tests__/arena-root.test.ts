import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initArenaRoot, getArenaRootConfig } from '../src/arena-root';

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'rolestra-ar-'));
  rmSync(root, { recursive: true, force: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('arena-root', () => {
  it('init이 4개 하위 디렉토리 생성', async () => {
    await initArenaRoot(root);
    for (const sub of ['consensus', 'projects', 'db', 'logs']) {
      expect(statSync(path.join(root, sub)).isDirectory()).toBe(true);
    }
  });

  it('init 재호출 idempotent', async () => {
    await initArenaRoot(root);
    await initArenaRoot(root);
    expect(existsSync(path.join(root, 'consensus'))).toBe(true);
  });

  it('getConfig는 절대경로 반환', async () => {
    await initArenaRoot(root);
    const cfg = getArenaRootConfig(root);
    expect(path.isAbsolute(cfg.root)).toBe(true);
    expect(cfg.consensusDir).toBe(path.join(cfg.root, 'consensus'));
  });

  it('루트가 파일이면 throw', () => {
    writeFileSync(root, 'i am a file');
    return expect(initArenaRoot(root)).rejects.toThrow();
  });
});
