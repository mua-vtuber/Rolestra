import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLink, removeLink, resolveLink } from '../src/junction';

let tmpRoot: string;
let target: string;
let linkPath: string;

beforeAll(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'rolestra-jct-'));
  target = path.join(tmpRoot, 'target');
  mkdirSync(target);
  writeFileSync(path.join(target, 'marker.txt'), 'here');
  linkPath = path.join(tmpRoot, 'link');
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('junction', () => {
  it('createLink + resolveLink round-trip', async () => {
    await createLink(linkPath, target);
    const resolved = await resolveLink(linkPath);
    expect(resolved).toBe(target);
  });

  it('link 경유 파일 접근 가능', async () => {
    const marker = path.join(linkPath, 'marker.txt');
    expect(statSync(marker).isFile()).toBe(true);
  });

  it('removeLink 후 접근 불가', async () => {
    await removeLink(linkPath);
    expect(() => statSync(path.join(linkPath, 'marker.txt'))).toThrow();
  });
});
