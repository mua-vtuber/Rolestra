import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asAbsolutePath, type AbsolutePath } from '../../../shared/absolute-path';
import { createTmpDir } from '../../../test-utils/integration-helpers';
import {
  CHAT_CLI_INSTRUCTIONS_DIR_NAME, ChatCliInstructionFile, ChatCliInstructionsInsideWorkspaceError,
  chatCliInstructionFilePath, chatCliInstructionsDir, resetChatCliInstructionsDir,
} from '../chat-cli-instructions';

describe('chat CLI instruction files (spec 2026-09-29 §B2)', () => {
  let root: AbsolutePath;
  let dir: AbsolutePath;
  let cwd: AbsolutePath;

  beforeEach(() => {
    root = createTmpDir('rolestra-chat-instructions-');
    dir = chatCliInstructionsDir(path.join(root, 'userData'));
    cwd = asAbsolutePath(path.join(root, 'consensus'), 'test');
    mkdirSync(cwd, { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('lives under the app data folder with a name per session scope and persona', () => {
    expect(dir).toBe(path.join(root, 'userData', CHAT_CLI_INSTRUCTIONS_DIR_NAME));
    const a = chatCliInstructionFilePath(dir, 'room:alice', 'Persona A');
    expect(chatCliInstructionFilePath(dir, 'room:alice', 'Persona A')).toBe(a);
    expect(chatCliInstructionFilePath(dir, 'room:bob', 'Persona A')).not.toBe(a);
    expect(chatCliInstructionFilePath(dir, 'room:alice', 'Persona B')).not.toBe(a);
    expect(path.dirname(a)).toBe(dir);
    expect(path.basename(a)).not.toContain('alice');
  });

  it('writes once per owner, rewrites a missing file and deletes it on discard', () => {
    const owner = new ChatCliInstructionFile();
    const file = chatCliInstructionFilePath(dir, 'room:alice', 'Persona A');
    expect(owner.prepare(file, cwd, 'Persona A')).toBe(file);
    expect(readFileSync(file, 'utf8')).toBe('Persona A');

    // A later turn of the same session does not rewrite the file.
    const past = new Date(Date.now() - 60_000);
    utimesSync(file, past, past);
    // Compare the stored timestamp: filesystems may round the requested time.
    const storedMtime = statSync(file).mtimeMs;
    owner.prepare(file, cwd, 'Persona A');
    expect(statSync(file).mtimeMs).toBe(storedMtime);

    rmSync(file);
    owner.prepare(file, cwd, 'Persona A');
    expect(readFileSync(file, 'utf8')).toBe('Persona A');

    owner.discard();
    expect(existsSync(file)).toBe(false);
    owner.discard();
  });

  it('replaces the previous file when the persona changes', () => {
    const owner = new ChatCliInstructionFile();
    const first = owner.prepare(chatCliInstructionFilePath(dir, 'room:alice', 'Persona A'), cwd, 'Persona A');
    const second = owner.prepare(chatCliInstructionFilePath(dir, 'room:alice', 'Persona B'), cwd, 'Persona B');
    expect(existsSync(first)).toBe(false);
    expect(readFileSync(second, 'utf8')).toBe('Persona B');
    expect(readdirSync(dir)).toEqual([path.basename(second)]);
  });

  it('keeps two owners of different sessions apart', () => {
    const alice = new ChatCliInstructionFile();
    const bob = new ChatCliInstructionFile();
    const aliceFile = alice.prepare(chatCliInstructionFilePath(dir, 'room:alice', 'Same persona'), cwd, 'Same persona');
    const bobFile = bob.prepare(chatCliInstructionFilePath(dir, 'room:bob', 'Same persona'), cwd, 'Same persona');
    alice.discard();
    expect(existsSync(aliceFile)).toBe(false);
    expect(readFileSync(bobFile, 'utf8')).toBe('Same persona');
  });

  it('refuses a folder inside the CLI working folder and an empty persona, writing nothing', () => {
    const owner = new ChatCliInstructionFile();
    const inside = asAbsolutePath(path.join(cwd, 'app-data', CHAT_CLI_INSTRUCTIONS_DIR_NAME), 'test');
    expect(() => owner.prepare(chatCliInstructionFilePath(inside, 'room:alice', 'P'), cwd, 'P'))
      .toThrow(ChatCliInstructionsInsideWorkspaceError);
    expect(existsSync(inside)).toBe(false);
    expect(() => owner.prepare(chatCliInstructionFilePath(dir, 'room:alice', ' '), cwd, ' '))
      .toThrow('Scoped chat CLI requires a nonempty persona');
    expect(existsSync(dir)).toBe(false);
  });

  it('removes instruction files left by an earlier run at startup', () => {
    const owner = new ChatCliInstructionFile();
    const file = owner.prepare(chatCliInstructionFilePath(dir, 'room:alice', 'P'), cwd, 'P');
    resetChatCliInstructionsDir(dir);
    expect(existsSync(file)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('creates a missing folder at startup', () => {
    resetChatCliInstructionsDir(dir);
    expect(statSync(dir).isDirectory()).toBe(true);
  });

  it('never deletes folders or files it did not create, even when user data lives inside the folder', () => {
    const owner = new ChatCliInstructionFile();
    const ours = owner.prepare(chatCliInstructionFilePath(dir, 'room:alice', 'P'), cwd, 'P');
    const hex = '0123456789abcdef0123456789abcdef';
    const folderHex = 'fedcba9876543210fedcba9876543210';
    // A consensus folder pointed inside this folder, with its own data.
    mkdirSync(path.join(dir, 'consensus', 'documents'), { recursive: true });
    writeFileSync(path.join(dir, 'consensus', 'documents', `${hex}.md`), 'user document');
    // A folder whose name matches the file pattern, and near-miss file names.
    mkdirSync(path.join(dir, `${folderHex}.md`));
    writeFileSync(path.join(dir, `${folderHex}.md`, 'inside.txt'), 'kept');
    const survivors = ['notes.md', `${hex.toUpperCase()}.md`, `${hex}.txt`, `${hex}0.md`, `x${hex}.md`];
    for (const name of survivors) writeFileSync(path.join(dir, name), 'kept');

    resetChatCliInstructionsDir(dir);

    expect(existsSync(ours)).toBe(false);
    expect(readdirSync(dir).sort()).toEqual([...survivors, 'consensus', `${folderHex}.md`].sort());
    expect(readFileSync(path.join(dir, 'consensus', 'documents', `${hex}.md`), 'utf8')).toBe('user document');
    expect(readFileSync(path.join(dir, `${folderHex}.md`, 'inside.txt'), 'utf8')).toBe('kept');
  });
});
