import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inferRepoRoot, resolveNodeModulesBin, resolvePackageBinEntry } from '../resolve-bin';

describe('resolvePackageBinEntry', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dev-fresh-resolve-bin-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('resolves a string-form bin field', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ bin: 'cli.js' }));
    writeFileSync(join(root, 'cli.js'), '// fixture');

    expect(resolvePackageBinEntry(root, 'ignored-when-string')).toBe(join(root, 'cli.js'));
  });

  it('resolves an object-form bin field by the given key — mirrors @electron/rebuild\'s real shape', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ bin: { 'electron-rebuild': 'lib/cli.js' } }));
    mkdirSync(join(root, 'lib'));
    writeFileSync(join(root, 'lib', 'cli.js'), '// fixture');

    expect(resolvePackageBinEntry(root, 'electron-rebuild')).toBe(join(root, 'lib', 'cli.js'));
  });

  it('throws (never returns a fabricated path) when package.json is missing', () => {
    expect(() => resolvePackageBinEntry(root, 'anything')).toThrow(/package\.json not found/);
  });

  it('throws when the bin key is absent from an object-form bin field', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ bin: { 'some-other-name': 'cli.js' } }));

    expect(() => resolvePackageBinEntry(root, 'electron-vite')).toThrow(/could not resolve/);
  });

  it('throws when the resolved file does not actually exist on disk', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ bin: 'missing.js' }));

    expect(() => resolvePackageBinEntry(root, 'ignored')).toThrow(/does not exist/);
  });
});

describe('resolveNodeModulesBin', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dev-fresh-node-modules-bin-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('resolves a SCOPED package (@electron/rebuild) by joining node_modules/<scope>/<name>', () => {
    const pkgDir = join(root, 'node_modules', '@electron', 'rebuild');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ bin: { 'electron-rebuild': 'lib/cli.js' } }));
    mkdirSync(join(pkgDir, 'lib'));
    writeFileSync(join(pkgDir, 'lib', 'cli.js'), '// fixture');

    expect(resolveNodeModulesBin(root, '@electron/rebuild', 'electron-rebuild'))
      .toBe(join(pkgDir, 'lib', 'cli.js'));
  });

  it('resolves an unscoped package', () => {
    const pkgDir = join(root, 'node_modules', 'electron-vite');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ bin: { 'electron-vite': 'bin/electron-vite.js' } }));
    mkdirSync(join(pkgDir, 'bin'));
    writeFileSync(join(pkgDir, 'bin', 'electron-vite.js'), '// fixture');

    expect(resolveNodeModulesBin(root, 'electron-vite', 'electron-vite'))
      .toBe(join(pkgDir, 'bin', 'electron-vite.js'));
  });
});

describe('inferRepoRoot', () => {
  it('walks up two directory levels from tools/dev-fresh/', () => {
    const thisFileDir = join('D:', 'repo', 'tools', 'dev-fresh');
    expect(inferRepoRoot(thisFileDir)).toBe(join('D:', 'repo'));
  });
});
