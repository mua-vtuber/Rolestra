import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isPathWithin } from '../src/path-guard';

let root: string;
let outside: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'rolestra-pg-root-'));
  outside = mkdtempSync(path.join(tmpdir(), 'rolestra-pg-out-'));
  mkdirSync(path.join(root, 'inner'));
  writeFileSync(path.join(root, 'inner', 'file.txt'), 'hello');
  writeFileSync(path.join(outside, 'secret.txt'), 'leak');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('isPathWithin', () => {
  it('루트 하위 경로는 true', () => {
    expect(isPathWithin(root, path.join(root, 'inner', 'file.txt'))).toBe(true);
  });

  it('루트 자체는 true', () => {
    expect(isPathWithin(root, root)).toBe(true);
  });

  it('루트 밖 경로는 false', () => {
    expect(isPathWithin(root, path.join(outside, 'secret.txt'))).toBe(false);
  });

  it('.. traversal은 false', () => {
    expect(isPathWithin(root, path.join(root, '..', 'etc', 'passwd'))).toBe(false);
  });

  it('symlink이 root 밖을 가리키면 false (realpath 해결 후)', () => {
    if (process.platform === 'win32') {
      return;  // Windows 일반 사용자 symlink 권한 제한
    }
    const linkPath = path.join(root, 'escape-link');
    symlinkSync(outside, linkPath);
    expect(isPathWithin(root, path.join(linkPath, 'secret.txt'))).toBe(false);
  });

  it('존재하지 않는 경로도 루트 하위면 true (새 파일 생성 예상)', () => {
    expect(isPathWithin(root, path.join(root, 'new-file-not-yet.txt'))).toBe(true);
  });
});
