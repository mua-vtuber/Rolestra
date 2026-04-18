import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';

export async function createLink(linkPath: string, targetRealPath: string): Promise<void> {
  // 이미 존재하면 제거 후 재생성 (idempotent)
  try {
    await removeLink(linkPath);
  } catch {
    // ignore
  }

  if (process.platform === 'win32') {
    await runMklinkJunction(linkPath, targetRealPath);
    return;
  }
  await fs.symlink(targetRealPath, linkPath, 'dir');
}

export async function removeLink(linkPath: string): Promise<void> {
  try {
    const st = await fs.lstat(linkPath);
    if (!st.isSymbolicLink() && !st.isDirectory()) {
      throw new Error(`${linkPath} is neither symlink nor directory`);
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }

  if (process.platform === 'win32') {
    await fs.rmdir(linkPath);
    return;
  }
  await fs.unlink(linkPath);
}

export async function resolveLink(linkPath: string): Promise<string> {
  return realpathSync(linkPath);
}

function runMklinkJunction(linkPath: string, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('cmd.exe', ['/c', 'mklink', '/J', linkPath, target], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stderrChunks: string[] = [];
    proc.stderr.on('data', (c: Buffer) => stderrChunks.push(c.toString('utf-8')));
    proc.on('exit', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`mklink /J failed (exit ${code}): ${stderrChunks.join('')}`));
    });
    proc.on('error', reject);
  });
}
