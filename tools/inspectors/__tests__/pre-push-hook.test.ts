/**
 * pre-push 훅의 차단 조건 — WP11c 항목 5.
 *
 * 예전 훅은 `set -e` 아래에서 검사기를 그냥 불렀다. 그래서 검사기 자체가
 * 죽으면 (tsx 실패, 문법 오류, 의존성 깨짐) `failClosed` 가 꺼져 있어도
 * push 가 막혔다. "지금은 목록만 보여 준다" 던 약속이 검사기 사고 한 번에
 * 뒤집히고, 사용자는 자기 변경과 무관한 이유로 밀려난다.
 *
 * 여기서는 훅 스크립트를 실제 bash 로 돌린다. 검사기 자리에는 가짜 `npx`
 * 를 PATH 앞에 놓아 상황을 만들어 준다 — 정상 통과 / 안전 위반 / 검사기
 * 사고 / 지난 report 잔재 / 깨진 report.
 *
 * 각 실행은 임시 작업 폴더에서 돌아 저장소 안 report.json 을 건드리지
 * 않는다.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const HOOK = join(REPO_ROOT, '.githooks', 'pre-push');

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'rolestra-prepush-'));
  mkdirSync(join(workDir, 'tools', 'inspectors'), { recursive: true });
  mkdirSync(join(workDir, 'bin'), { recursive: true });
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/**
 * PATH 앞에 놓을 가짜 `npx`. 훅이 실제로 부르는 것은 `npx tsx …` 하나뿐
 * 이라, 그 자리에서 원하는 상황을 만들면 된다. `body` 는 bash 본문이다.
 */
function installFakeNpx(body: string): void {
  const script = `#!/usr/bin/env bash\n${body}\n`;
  const path = join(workDir, 'bin', 'npx');
  writeFileSync(path, script, 'utf8');
  chmodSync(path, 0o755);
}

interface HookResult {
  status: number;
  output: string;
}

function runHook(): HookResult {
  try {
    const stdout = execFileSync('bash', [HOOK], {
      cwd: workDir,
      encoding: 'utf-8',
      // stderr 를 붙잡아 둔다 — 가짜 검사기가 일부러 내는 오류 문구가
      // 시험 출력에 섞이면 진짜 문제와 구분되지 않는다.
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: `${join(workDir, 'bin')}:${process.env.PATH ?? ''}`,
      },
    });
    return { status: 0, output: stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      status: e.status ?? 1,
      output: `${e.stdout ?? ''}${e.stderr ?? ''}`,
    };
  }
}

/** report 를 남기는 가짜 검사기 본문. */
function reportWriter(buildShouldFail: boolean, exitCode: number): string {
  return [
    'cat > tools/inspectors/report.json <<JSON',
    JSON.stringify({ buildShouldFail, safetyHitCount: buildShouldFail ? 3 : 0 }),
    'JSON',
    `exit ${exitCode}`,
  ].join('\n');
}

describe('pre-push 훅 — 무엇이 push 를 막는가 (WP11c 5)', () => {
  it('위반이 없으면 통과한다', () => {
    installFakeNpx(reportWriter(false, 0));
    const res = runHook();
    expect(res.status).toBe(0);
  });

  it('failClosed 가 켜져 위반이 잡히면 막는다', () => {
    installFakeNpx(reportWriter(true, 1));
    const res = runHook();
    expect(res.status).toBe(1);
    expect(res.output).toContain('안전 카테고리 위반');
  });

  it('검사기가 죽으면 (report 없음) 막지 않고 원인을 알린다', () => {
    installFakeNpx('echo "SyntaxError: 검사기 폭발" >&2\nexit 1');
    const res = runHook();
    expect(res.status).toBe(0);
    expect(res.output).toContain('결과를 남기지 못했습니다');
  });

  it('검사기가 죽어도 지난 실행의 report 를 이번 결과로 읽지 않는다', () => {
    // 예전 report 가 위반을 담고 있어도, 이번 실행이 죽었으면 그것으로
    // push 를 막으면 안 된다 — 이번 트리의 판정이 아니다.
    writeFileSync(
      join(workDir, 'tools', 'inspectors', 'report.json'),
      JSON.stringify({ buildShouldFail: true, safetyHitCount: 9 }),
      'utf8',
    );
    installFakeNpx('echo "검사기 폭발" >&2\nexit 1');
    const res = runHook();
    expect(res.status).toBe(0);
    expect(res.output).toContain('결과를 남기지 못했습니다');
  });

  it('report 가 깨진 JSON 이어도 막지 않는다', () => {
    installFakeNpx(
      'printf "{ not json" > tools/inspectors/report.json\nexit 1',
    );
    const res = runHook();
    expect(res.status).toBe(0);
    expect(res.output).toContain('결과를 남기지 못했습니다');
  });
});
