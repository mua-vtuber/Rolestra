/**
 * cli-smoke 쪽 windows-command 트윈 테스트.
 *
 * 이 도구는 자체 tsconfig 로 빌드되어 `src/` 를 import 할 수 없어 모듈이
 * 복제되어 있다. 두 복사본이 갈라지는 것을 막기 위해 두 가지를 확인한다:
 *   1. 헤더 주석 아래 본문이 원본과 바이트 단위로 같은지
 *   2. 트윈 자체를 import 해서 분기 형태와 위험 인수 거부가 동작하는지
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CliArgUnsafeForCmdError,
  buildCmdCommandLine,
  resolveWindowsCommand,
} from '../src/windows-command';

/** A bare name no PATH entry can match — keeps assertions host-independent. */
const UNRESOLVABLE = 'rolestra-no-such-cli-9d3f';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const TWIN_PATH = path.join(REPO_ROOT, 'tools', 'cli-smoke', 'src', 'windows-command.ts');
const ORIGIN_PATH = path.join(
  REPO_ROOT,
  'src',
  'main',
  'providers',
  'cli',
  'windows-command.ts',
);

/** Everything after the leading block comment — the part that must match. */
function bodyAfterHeader(file: string): string {
  const source = readFileSync(file, 'utf-8').replace(/\r\n/g, '\n');
  const end = source.indexOf('*/');
  expect(end, `${file} must open with a block comment header`).toBeGreaterThan(-1);
  return source.slice(end + 2).trim();
}

describe('cli-smoke windows-command twin', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('body matches the app-side original byte for byte', () => {
    // Only the header comment may differ; the logic must never drift.
    expect(bodyAfterHeader(TWIN_PATH)).toBe(bodyAfterHeader(ORIGIN_PATH));
  });

  describe('on Windows', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
    });

    it('routes .cmd / unresolvable bare names through one verbatim cmd.exe line', () => {
      const args = ['--add-dir', 'C:\\some dir\\with (parens) & amp'];
      expect(resolveWindowsCommand('claude.cmd', args)).toEqual({
        resolvedCommand: 'cmd.exe',
        resolvedArgs: [buildCmdCommandLine('claude.cmd', args)],
        windowsVerbatimArguments: true,
      });
      expect(resolveWindowsCommand(UNRESOLVABLE, args)).toEqual({
        resolvedCommand: 'cmd.exe',
        resolvedArgs: [buildCmdCommandLine(UNRESOLVABLE, args)],
        windowsVerbatimArguments: true,
      });
    });

    it('keeps a command token with a space inside its own quote pair', () => {
      const target = 'C:\\shim test dir\\echo-args.cmd';
      expect(resolveWindowsCommand(target, ['-v']).resolvedArgs[0]).toContain(`"${target}"`);
    });

    it('passes .exe through directly and .ps1 through pwsh.exe', () => {
      expect(resolveWindowsCommand('tool.exe', ['-v'])).toEqual({
        resolvedCommand: 'tool.exe',
        resolvedArgs: ['-v'],
        windowsVerbatimArguments: false,
      });
      expect(resolveWindowsCommand('script.ps1', ['-P', 'v'])).toEqual({
        resolvedCommand: 'pwsh.exe',
        resolvedArgs: ['-NoProfile', '-File', 'script.ps1', '-P', 'v'],
        windowsVerbatimArguments: false,
      });
    });

    it('accepts quotes, %VAR% and balanced metacharacters on the cmd.exe branch', () => {
      expect(() =>
        resolveWindowsCommand('claude.cmd', ['-e', 'console.log("hi")', '%PATH%', 'a|b']),
      ).not.toThrow();
    });

    it('throws on args that cannot survive cmd.exe', () => {
      expect(() => resolveWindowsCommand('claude.cmd', ['a"b|c'])).toThrow(CliArgUnsafeForCmdError);
      expect(() => resolveWindowsCommand(UNRESOLVABLE, ['a\nb'])).toThrow(CliArgUnsafeForCmdError);
    });
  });

  it('returns command and args unchanged on non-Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    expect(resolveWindowsCommand('claude.cmd', ['a"b|c', '%PATH%'])).toEqual({
      resolvedCommand: 'claude.cmd',
      resolvedArgs: ['a"b|c', '%PATH%'],
      windowsVerbatimArguments: false,
    });
  });
});
