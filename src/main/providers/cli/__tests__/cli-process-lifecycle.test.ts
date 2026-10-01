import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CliProcessManager } from '../cli-process';
import { CliSessionState } from '../cli-session-state';
import type { CliRuntimeConfig } from '../cli-provider';
import { asAbsolutePath } from '../../../../shared/absolute-path';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

function child(): ChildProcess {
  const proc = new EventEmitter();
  return Object.assign(proc, { killed: false, kill: vi.fn(() => true) }) as unknown as ChildProcess;
}

const config: CliRuntimeConfig = {
  command: process.execPath, args: [], inputFormat: 'stdin-json', outputFormat: 'stream-json',
  sessionStrategy: 'persistent', hangTimeout: { first: 1000, subsequent: 1000 },
  cwd: asAbsolutePath(process.cwd(), 'test.cwd'),
};

afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

describe('persistent CLI process lifecycle', () => {
  it('force-kills a process that accepted SIGTERM but has not exited', async () => {
    vi.useFakeTimers();
    const proc = child();
    vi.mocked(proc.kill).mockImplementation(() => {
      Object.defineProperty(proc, 'killed', { value: true, configurable: true });
      return true;
    });
    const manager = new CliProcessManager();
    manager.process = proc;
    manager.kill();
    await vi.advanceTimersByTimeAsync(3000);
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('keeps the replacement process when the previous process exits late', async () => {
    vi.useFakeTimers();
    const { execFile } = await import('node:child_process');
    const previous = child();
    const replacement = child();
    vi.mocked(execFile).mockReturnValueOnce(previous).mockReturnValueOnce(replacement);
    const manager = new CliProcessManager();
    const first = manager.spawnPersistent(config, new CliSessionState());
    await vi.advanceTimersByTimeAsync(500);
    await first;
    manager.kill();
    const second = manager.spawnPersistent(config, new CliSessionState());
    previous.emit('exit', 0, null);
    await vi.advanceTimersByTimeAsync(500);
    await second;
    expect(manager.process).toBe(replacement);
    manager.kill();
    expect(replacement.kill).toHaveBeenCalledWith('SIGTERM');
    replacement.emit('exit', 0, null);
  });

  it('rejects instead of waiting forever when startup exits before readiness', async () => {
    vi.useFakeTimers();
    const { execFile } = await import('node:child_process');
    const proc = child();
    vi.mocked(execFile).mockReturnValueOnce(proc);
    const manager = new CliProcessManager();
    const startup = manager.spawnPersistent(config, new CliSessionState());
    const settled = vi.fn();
    void startup.then(() => settled('resolved'), () => settled('rejected'));
    proc.emit('exit', 2, null);
    await vi.advanceTimersByTimeAsync(500);
    expect(settled).toHaveBeenCalledWith('rejected');
    expect(manager.process).toBeNull();
  });

  it('keeps the native missing-session diagnostic on early resume exit', async () => {
    vi.useFakeTimers();
    const { execFile } = await import('node:child_process');
    const proc = child();
    const stderr = new EventEmitter();
    Object.assign(stderr, { setEncoding: vi.fn() });
    Object.defineProperty(proc, 'stderr', { value: stderr });
    vi.mocked(execFile).mockReturnValueOnce(proc);
    const startup = new CliProcessManager().spawnPersistent(config, new CliSessionState());
    stderr.emit('data', 'No conversation found with session ID: saved-id\n');
    proc.emit('exit', 1, null);
    await expect(startup).rejects.toThrow('No conversation found with session ID');
  });
});
