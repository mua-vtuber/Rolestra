import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, statSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initArenaRoot } from '../src/arena-root';
import { ProjectService } from '../src/project-service';

let root: string;
let svc: ProjectService;

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'rolestra-ps-'));
  await initArenaRoot(root);
  svc = new ProjectService(root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('ProjectService.createNewProject', () => {
  it('폴더 + meta.json 생성', async () => {
    const p = await svc.createNewProject({
      slug: 'demo',
      name: 'Demo Project',
      description: '',
      permissionMode: 'hybrid',
    });
    const projDir = path.join(root, 'projects', 'demo');
    expect(statSync(projDir).isDirectory()).toBe(true);
    const meta = JSON.parse(readFileSync(path.join(projDir, '.arena', 'meta.json'), 'utf-8'));
    expect(meta.id).toBe(p.id);
    expect(meta.slug).toBe('demo');
    expect(meta.kind).toBe('new');
    expect(meta.permissionMode).toBe('hybrid');
  });

  it('중복 slug는 throw', async () => {
    await svc.createNewProject({ slug: 'dup', name: 'A', description: '', permissionMode: 'hybrid' });
    await expect(
      svc.createNewProject({ slug: 'dup', name: 'B', description: '', permissionMode: 'hybrid' }),
    ).rejects.toThrow(/already exists/);
  });

  it('잘못된 slug는 schema 검증으로 throw', async () => {
    await expect(
      svc.createNewProject({ slug: 'Invalid Slug!', name: 'X', description: '', permissionMode: 'hybrid' }),
    ).rejects.toThrow();
  });
});

describe('ProjectService.linkExternal', () => {
  it('junction 생성 + meta의 externalLink = realpath', async () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'rolestra-out-'));
    writeFileSync(path.join(outside, 'file.txt'), 'x');
    try {
      const p = await svc.linkExternal({
        slug: 'ext',
        name: 'Ext',
        description: '',
        permissionMode: 'hybrid',
        externalPath: outside,
      });
      expect(p.kind).toBe('external');
      expect(p.externalLink).toBe(realpathSync(outside));
      const linkReal = realpathSync(path.join(root, 'projects', 'ext', 'link'));
      expect(linkReal).toBe(realpathSync(outside));
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('external + permissionMode=auto는 금지', async () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'rolestra-out2-'));
    try {
      await expect(
        svc.linkExternal({
          slug: 'auto-ext',
          name: 'X',
          description: '',
          permissionMode: 'auto',
          externalPath: outside,
        }),
      ).rejects.toThrow(/auto mode is not allowed/i);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('external 중복 slug는 throw', async () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'rolestra-out3-'));
    try {
      await svc.linkExternal({
        slug: 'dup-ext', name: 'A', description: '', permissionMode: 'hybrid', externalPath: outside,
      });
      await expect(
        svc.linkExternal({
          slug: 'dup-ext', name: 'B', description: '', permissionMode: 'hybrid', externalPath: outside,
        }),
      ).rejects.toThrow(/already exists/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('ProjectService.importProject', () => {
  it('폴더 복사 후 meta 생성', async () => {
    const src = mkdtempSync(path.join(tmpdir(), 'rolestra-src-'));
    mkdirSync(path.join(src, 'nested'));
    writeFileSync(path.join(src, 'nested', 'a.txt'), 'hi');
    try {
      const p = await svc.importProject({
        slug: 'imp',
        name: 'Imported',
        description: '',
        permissionMode: 'hybrid',
        sourcePath: src,
      });
      expect(p.kind).toBe('imported');
      expect(statSync(path.join(root, 'projects', 'imp', 'nested', 'a.txt')).isFile()).toBe(true);
    } finally {
      rmSync(src, { recursive: true, force: true });
    }
  });

  it('import 중복 slug는 throw', async () => {
    const src = mkdtempSync(path.join(tmpdir(), 'rolestra-src2-'));
    try {
      await svc.importProject({
        slug: 'dup-imp', name: 'A', description: '', permissionMode: 'hybrid', sourcePath: src,
      });
      await expect(
        svc.importProject({
          slug: 'dup-imp', name: 'B', description: '', permissionMode: 'hybrid', sourcePath: src,
        }),
      ).rejects.toThrow(/already exists/);
    } finally {
      rmSync(src, { recursive: true, force: true });
    }
  });
});
