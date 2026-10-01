/**
 * fail-closed 스위치 — R12-C2 T41.
 *
 * 스위치가 실제로 exit code 를 바꾸는지를 `run.ts` 를 그대로 돌려 확인한다.
 * 룰 로직을 흉내 내지 않고 진짜 실행을 보는 이유: 이 스위치의 값어치는
 * "훅과 CI 가 이 exit code 로 판단한다" 는 데 있고, 그 경로를 건너뛰면
 * 시험이 아무것도 지켜 주지 못한다.
 *
 * 실행마다 임시 report 경로를 줘서 저장소 안 `report.json` 을 건드리지
 * 않는다.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { INSPECTOR_CONFIG, resolveFailClosed } from '../config';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

interface RunResult {
  status: number;
  stdout: string;
  report: {
    phase: 'phase-1' | 'phase-2';
    failClosed: boolean;
    safetyHitCount: number;
    safetyViolation: boolean;
    buildShouldFail: boolean;
  };
}

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'rolestra-inspect-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/**
 * run.ts 를 tsx 로 실행하고 exit code + report 를 돌려준다. execFile 이라
 * 셸 문자열이 끼지 않는다 (규칙 #4).
 */
function runInspector(args: readonly string[], env: NodeJS.ProcessEnv): RunResult {
  const reportAbs = join(workDir, 'report.json');
  let status = 0;
  let stdout = '';
  try {
    stdout = execFileSync(
      process.execPath,
      [
        join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
        join(REPO_ROOT, 'tools', 'inspectors', 'run.ts'),
        ...args,
        `--report=${reportAbs}`,
        '--silent',
      ],
      { cwd: REPO_ROOT, env: { ...process.env, ...env }, encoding: 'utf-8' },
    );
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    status = e.status ?? 1;
    stdout = e.stdout ?? '';
  }
  return {
    status,
    stdout,
    report: JSON.parse(readFileSync(reportAbs, 'utf-8')) as RunResult['report'],
  };
}

describe('resolveFailClosed', () => {
  it('환경변수가 없으면 config 값을 그대로 쓴다', () => {
    expect(resolveFailClosed({})).toBe(INSPECTOR_CONFIG.failClosed);
  });

  it("'1' 과 'true' 만 켠다", () => {
    expect(resolveFailClosed({ ROLESTRA_INSPECTOR_FAIL_CLOSED: '1' })).toBe(true);
    expect(resolveFailClosed({ ROLESTRA_INSPECTOR_FAIL_CLOSED: 'true' })).toBe(
      true,
    );
  });

  it('그 밖의 값은 config 값을 그대로 쓴다 (조용히 켜지 않는다)', () => {
    for (const v of ['0', 'false', '', 'yes', 'TRUE']) {
      expect(resolveFailClosed({ ROLESTRA_INSPECTOR_FAIL_CLOSED: v }), v).toBe(
        INSPECTOR_CONFIG.failClosed,
      );
    }
  });
});

describe('phase 2 exit code', () => {
  it('현재 트리는 안전 카테고리 hit 0 건이라 통과한다', () => {
    const res = runInspector(['--phase=2'], {});
    expect(res.report.safetyHitCount).toBe(0);
    expect(res.report.safetyViolation).toBe(false);
    expect(res.report.buildShouldFail).toBe(false);
    expect(res.status).toBe(0);
  });

  it('failClosed 를 켜도 hit 0 건이면 그대로 통과한다', () => {
    const res = runInspector(['--phase=2'], {
      ROLESTRA_INSPECTOR_FAIL_CLOSED: '1',
    });
    expect(res.report.failClosed).toBe(true);
    expect(res.report.safetyHitCount).toBe(0);
    expect(res.status).toBe(0);
  });

  it('기본 설정은 failClosed=false — 전환은 사용자 승인 게이트', () => {
    // 이 시험이 깨지면 누군가 승인 없이 스위치를 켠 것이다.
    expect(INSPECTOR_CONFIG.failClosed).toBe(false);
    expect(runInspector(['--phase=2'], {}).report.failClosed).toBe(false);
  });

  it('phase 1 은 안전 위반 판정 자체를 하지 않는다', () => {
    const res = runInspector([], { ROLESTRA_INSPECTOR_FAIL_CLOSED: '1' });
    expect(res.report.phase).toBe('phase-1');
    expect(res.report.safetyViolation).toBe(false);
    expect(res.status).toBe(0);
  });
});
