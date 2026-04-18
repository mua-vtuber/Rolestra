import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
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
