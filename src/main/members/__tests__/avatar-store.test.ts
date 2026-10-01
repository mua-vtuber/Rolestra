/**
 * AvatarStore — copy / forget validation matrix (R8-Task5).
 *
 * All tests use a per-test temp ArenaRoot so we don't need to mock fs and
 * we exercise the real `fs.copyFileSync` / `mkdirSync` / `unlinkSync`
 * behaviour the production code depends on.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AvatarStore, AvatarValidationError } from '../avatar-store';
import { AVATAR_MAX_BYTES } from '../../../shared/member-profile-types';

interface TestEnv {
  arenaRoot: string;
  store: AvatarStore;
  cleanup(): void;
}

function createEnv(): TestEnv {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rolestra-avatar-store-'));
  fs.mkdirSync(path.join(dir, 'avatars'), { recursive: true });
  // Minimal ArenaRootService surface — only `avatarsPath()` is consumed.
  const fakeArena = {
    avatarsPath: () => path.join(dir, 'avatars'),
  } as never;
  const store = new AvatarStore(fakeArena);
  return {
    arenaRoot: dir,
    store,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

function writeFixture(dir: string, name: string, bytes: number): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, Buffer.alloc(bytes, 0xa0));
  return p;
}

let env: TestEnv;

beforeEach(() => {
  env = createEnv();
});

afterEach(() => {
  env.cleanup();
});

describe('AvatarStore.copy — happy path', () => {
  it('copies a png into <arena>/avatars/<providerId>.png and returns POSIX relative path', () => {
    const src = writeFixture(env.arenaRoot, 'src.png', 1024);
    const result = env.store.copy('p1', src);
    expect(result.relativePath).toBe('avatars/p1.png');
    expect(result.absolutePath).toBe(
      path.join(env.arenaRoot, 'avatars', 'p1.png'),
    );
    expect(fs.existsSync(result.absolutePath)).toBe(true);
  });

  it.each(['jpg', 'jpeg', 'webp', 'gif'])(
    'accepts allowed extension .%s',
    (ext) => {
      const src = writeFixture(env.arenaRoot, `src.${ext}`, 256);
      const result = env.store.copy('p1', src);
      expect(result.relativePath).toBe(`avatars/p1.${ext}`);
    },
  );

  it('treats uppercase extension as the lowercase canonical (.JPEG → jpeg)', () => {
    const src = writeFixture(env.arenaRoot, 'src.JPEG', 128);
    const result = env.store.copy('p1', src);
    expect(result.relativePath).toBe('avatars/p1.jpeg');
  });
});

describe('AvatarStore.copy — validation rejections', () => {
  it('rejects unsupported extension with code=ext_not_allowed', () => {
    const src = writeFixture(env.arenaRoot, 'src.bmp', 128);
    let captured: AvatarValidationError | null = null;
    try {
      env.store.copy('p1', src);
    } catch (e) {
      if (e instanceof AvatarValidationError) captured = e;
    }
    expect(captured).not.toBeNull();
    expect(captured!.code).toBe('ext_not_allowed');
  });

  it('rejects extensionless file with code=ext_not_allowed', () => {
    const src = writeFixture(env.arenaRoot, 'noext', 128);
    expect(() => env.store.copy('p1', src)).toThrow(AvatarValidationError);
  });

  it('rejects oversize file with code=size_exceeded', () => {
    const src = writeFixture(env.arenaRoot, 'huge.png', AVATAR_MAX_BYTES + 1);
    let captured: AvatarValidationError | null = null;
    try {
      env.store.copy('p1', src);
    } catch (e) {
      if (e instanceof AvatarValidationError) captured = e;
    }
    expect(captured).not.toBeNull();
    expect(captured!.code).toBe('size_exceeded');
  });

  it('rejects missing source with code=source_missing', () => {
    expect(() => env.store.copy('p1', '/no/such/file.png')).toThrow(
      AvatarValidationError,
    );
    try {
      env.store.copy('p1', '/no/such/file.png');
    } catch (e) {
      if (e instanceof AvatarValidationError) {
        expect(e.code).toBe('source_missing');
      }
    }
  });

  it('rejects when source is a directory (not a regular file)', () => {
    const dirSrc = path.join(env.arenaRoot, 'subdir.png');
    fs.mkdirSync(dirSrc);
    expect(() => env.store.copy('p1', dirSrc)).toThrow(AvatarValidationError);
  });
});

describe('AvatarStore.copy — sibling cleanup', () => {
  it('removes stale png when the new upload is jpg for the same providerId', () => {
    // First upload — png
    const src1 = writeFixture(env.arenaRoot, 'first.png', 256);
    env.store.copy('p1', src1);
    expect(
      fs.existsSync(path.join(env.arenaRoot, 'avatars', 'p1.png')),
    ).toBe(true);

    // Second upload — jpg should evict the png
    const src2 = writeFixture(env.arenaRoot, 'second.jpg', 256);
    env.store.copy('p1', src2);
    expect(
      fs.existsSync(path.join(env.arenaRoot, 'avatars', 'p1.png')),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(env.arenaRoot, 'avatars', 'p1.jpg')),
    ).toBe(true);
  });

  it('overwrites in place when the new upload uses the same extension', () => {
    const dst = path.join(env.arenaRoot, 'avatars', 'p1.png');

    const src1 = writeFixture(env.arenaRoot, 'first.png', 256);
    env.store.copy('p1', src1);
    const sizeBefore = fs.statSync(dst).size;

    const src2 = writeFixture(env.arenaRoot, 'second.png', 1024);
    env.store.copy('p1', src2);
    const sizeAfter = fs.statSync(dst).size;
    expect(sizeBefore).not.toBe(sizeAfter);
    expect(sizeAfter).toBe(1024);
  });

  it('does not touch other providerIds', () => {
    const src1 = writeFixture(env.arenaRoot, 'a.png', 128);
    const src2 = writeFixture(env.arenaRoot, 'b.jpg', 128);
    env.store.copy('p1', src1);
    env.store.copy('p2', src2);
    expect(
      fs.existsSync(path.join(env.arenaRoot, 'avatars', 'p1.png')),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(env.arenaRoot, 'avatars', 'p2.jpg')),
    ).toBe(true);
  });
});

describe('AvatarStore.forget', () => {
  it('removes all custom files for the providerId across allowed extensions', () => {
    // Plant two extensions — only one should normally exist, but `forget`
    // should sweep both regardless (defence-in-depth for past bugs).
    fs.writeFileSync(path.join(env.arenaRoot, 'avatars', 'p1.png'), 'x');
    fs.writeFileSync(path.join(env.arenaRoot, 'avatars', 'p1.jpg'), 'x');
    env.store.forget('p1');
    expect(
      fs.existsSync(path.join(env.arenaRoot, 'avatars', 'p1.png')),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(env.arenaRoot, 'avatars', 'p1.jpg')),
    ).toBe(false);
  });

  it('is idempotent when no files exist', () => {
    expect(() => env.store.forget('p-never-uploaded')).not.toThrow();
  });
});
