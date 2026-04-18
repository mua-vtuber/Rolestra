import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCli } from '../src/cli-spawn';

let cwd: string;

beforeAll(() => {
  cwd = mkdtempSync(path.join(tmpdir(), 'rolestra-cli-'));
});
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

describe('runCli', () => {
  it('cwd 미지정 시 throw', async () => {
    await expect(
      runCli({ command: 'node', args: ['-v'], cwd: undefined as unknown as string }),
    ).rejects.toThrow(/cwd required/);
  });

  it('존재하지 않는 cwd는 throw', async () => {
    await expect(
      runCli({ command: 'node', args: ['-v'], cwd: '/non/existent/path/xyz' }),
    ).rejects.toThrow(/cwd/);
  });

  it('node -v 실행 성공', async () => {
    const r = await runCli({ command: 'node', args: ['-v'], cwd });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/^v\d+/);
  });

  it('cwd 내에서 process.cwd() 동작 확인', async () => {
    const { stdout } = await runCli({
      command: 'node',
      args: ['-e', 'console.log(process.cwd())'],
      cwd,
    });
    expect(stdout.trim()).toBe(path.resolve(cwd));
  });

  it('env 병합: 호출자 env가 Rolestra 고정값과 공존', async () => {
    const { stdout } = await runCli({
      command: 'node',
      args: ['-e', 'console.log(process.env.ROLESTRA_PROJECT_SLUG + "|" + process.env.MY_VAR)'],
      cwd,
      env: { MY_VAR: 'custom', ROLESTRA_PROJECT_SLUG: 'slug-x' },
    });
    expect(stdout.trim()).toBe('slug-x|custom');
  });
});
