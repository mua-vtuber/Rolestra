/**
 * R12-C2 T11 — git hook 자동 wire (npm `prepare` script 가 호출).
 *
 * 목적: husky 같은 외부 의존 없이 `.githooks/` 폴더를 git 의 hooks path 로
 * 등록 (`git config core.hooksPath .githooks`).
 *
 * 안전 정책:
 *  - .git 디렉토리 / .githooks 폴더 부재 시 silent skip (npm install 만
 *    실행한 fork 사용자 보호)
 *  - 이미 다른 hooksPath 가 설정돼 있으면 silent skip (husky 등 충돌 방지)
 *  - 셸 스크립트는 실행 권한 자동 부여 (chmod +x)
 *
 * `prepare` 는 `npm install` 직후 1 회 자동 실행 — 신규 개발자 setup 1 회로
 * 검사관 hook 활성.
 */
import { existsSync, statSync, chmodSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function silentSkip(reason: string): void {
  // CI 등에서 noise 줄이기 위해 stdout 1 줄만
  process.stdout.write(`[inspector] hook install skipped — ${reason}\n`);
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(here, '..', '..');

  const gitDir = join(repoRoot, '.git');
  if (!existsSync(gitDir)) {
    silentSkip('not a git repo');
    return;
  }
  const hooksDir = join(repoRoot, '.githooks');
  if (!existsSync(hooksDir)) {
    silentSkip('.githooks/ 폴더 없음');
    return;
  }

  // 기존 hooksPath 확인 — 이미 다른 곳 설정돼 있으면 skip
  let currentHooksPath = '';
  try {
    currentHooksPath = execSync('git config --get core.hooksPath', {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
  } catch {
    // unset 상태 — OK
  }

  if (currentHooksPath !== '' && currentHooksPath !== '.githooks') {
    // stale path (project rename / 이전 worktree 잔재) 인 경우 override
    const isAbsolute =
      currentHooksPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(currentHooksPath);
    const stale = isAbsolute && !existsSync(currentHooksPath);
    if (stale) {
      execSync('git config core.hooksPath .githooks', { cwd: repoRoot });
      process.stdout.write(
        `[inspector] core.hooksPath stale (${currentHooksPath} not found) → .githooks 로 override\n`,
      );
    } else {
      silentSkip(`core.hooksPath 이미 ${currentHooksPath} 로 설정됨`);
      return;
    }
  } else if (currentHooksPath !== '.githooks') {
    execSync('git config core.hooksPath .githooks', { cwd: repoRoot });
    process.stdout.write('[inspector] git config core.hooksPath .githooks 적용\n');
  }

  // 실행 권한 부여
  for (const entry of readdirSync(hooksDir)) {
    const abs = join(hooksDir, entry);
    if (!statSync(abs).isFile()) continue;
    if (entry.endsWith('.md')) continue;
    chmodSync(abs, 0o755);
  }
}

main();
