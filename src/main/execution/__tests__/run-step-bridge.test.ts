/**
 * run-step-bridge 단위 테스트 — R12-C2 P5 T26 land.
 *
 * 검증 (순수 함수 + 타입 contract):
 *   - composePatchApplySideEffect (1-line 합성):
 *     - dryRun + success → "dry-run 미적용 (N files)"
 *     - dryRun + failure → "dry-run 실패: <error>"
 *     - apply + success → "파일 N 개 적용"
 *     - apply + failure(rollback) → "적용 실패 + rollback: <error>"
 *     - apply + failure(no rollback) → "적용 실패: <error>"
 *     - error 누락 시 'unknown' fallback
 *   - buildPatchApplyRunStep:
 *     - dryRun + success NewRunStep 합성 (inputJson / outputJson / sideEffectSummary)
 *     - apply + success appliedCount = N
 *     - apply + 부분 success (appliedCount < entryCount)
 *     - apply + failure + rollback
 *     - apply + failure + no rollback
 *     - actorKind=employee + actorId blank → throw
 *     - actorKind=user + actorId set → throw
 *     - actorKind=system + actorId null → OK
 *     - meetingId blank → throw
 *     - channelId blank → throw
 *     - round 음수 → throw
 *     - turnIndex 음수 → throw
 *     - round 정수 X (소수) → throw
 *     - durationMs 음수 → throw
 *     - durationMs Infinity → throw
 *     - inputJson targetPaths 보존
 *     - inputJson 에 newContent / originalContent 직접 보존 X
 *     - nextStepCard = null / stepKind = 'tool_invoke' 강제
 *     - empty entries 도 throw 하지 않음 (의도적 no-op 영속)
 *   - buildCommandRunStep:
 *     - success outputJson (exitCode / stdoutBytes / stderrBytes / durationMs)
 *     - success sideEffectSummary "<command> 실행 (exit <code>)"
 *     - exit 1 도 success kind (정책상 commandRunner 가 throw 하지 않은 케이스)
 *     - failure outputJson (failed: true / error)
 *     - failure sideEffectSummary "<command> 실패: <error>"
 *     - command blank → throw
 *     - cwd blank → throw
 *     - failure error blank → throw
 *     - actor identity 검증 동일 (user + actorId set → throw)
 *     - context invariants 동일 (meetingId blank → throw)
 *     - inputJson 의 args 배열 통째 보존 (truncate 없음)
 *     - stdoutBytes UTF-8 정확 (한글 byte 길이)
 *     - stepKind = 'tool_invoke' / nextStepCard = null
 *
 * 본 sub-task (T26) 의 스코프:
 *   - PatchSet / ApplyResult / CommandRequest / CommandResult → NewRunStep 변환
 *     본체.
 *   - 영속 자체는 RunStepService 책임 — 본 bridge 는 그 직전 단계까지만.
 *   - 회의 orchestrator wire / IPC 발송 / DB 영속 모두 caller 책임 (P6 의 다른
 *     sub-task).
 */

import { describe, expect, it } from 'vitest';
import {
  RunStepBridgeInvariantError,
  buildCommandRunStep,
  buildPatchApplyRunStep,
  composePatchApplySideEffect,
} from '../run-step-bridge';
import type {
  ApplyResult,
  CommandRequest,
  CommandResult,
  PatchSet,
} from '../../../shared/execution-types';

// ── shared fixtures ─────────────────────────────────────────────────

function makePatchSet(overrides?: Partial<PatchSet>): PatchSet {
  return {
    operationId: 'op-1',
    aiId: 'codex',
    conversationId: 'conv-1',
    dryRun: false,
    entries: [
      {
        targetPath: '/repo/src/foo.ts',
        operation: 'modify',
        newContent: 'console.log("hi");',
        originalContent: '',
      },
      {
        targetPath: '/repo/src/bar.ts',
        operation: 'create',
        newContent: 'export const x = 1;',
      },
    ],
    ...overrides,
  };
}

function makeApplyResult(overrides?: Partial<ApplyResult>): ApplyResult {
  return {
    success: true,
    appliedEntries: [
      {
        targetPath: '/repo/src/foo.ts',
        operation: 'modify',
        newContent: 'console.log("hi");',
      },
      {
        targetPath: '/repo/src/bar.ts',
        operation: 'create',
        newContent: 'export const x = 1;',
      },
    ],
    rolledBack: false,
    ...overrides,
  };
}

const baseCtx = {
  meetingId: 'meeting-1',
  channelId: 'ch-1',
  round: 0,
  turnIndex: 3,
  durationMs: 12,
  actorKind: 'employee' as const,
  actorId: 'codex',
};

// ── composePatchApplySideEffect ─────────────────────────────────────

describe('composePatchApplySideEffect', () => {
  it('dryRun + success → "dry-run 미적용 (N files)"', () => {
    expect(
      composePatchApplySideEffect({
        dryRun: true,
        success: true,
        appliedCount: 0,
        entryCount: 3,
        rolledBack: false,
      }),
    ).toBe('dry-run 미적용 (3 files)');
  });

  it('dryRun + failure → "dry-run 실패: <error>"', () => {
    expect(
      composePatchApplySideEffect({
        dryRun: true,
        success: false,
        appliedCount: 0,
        entryCount: 1,
        error: 'invalid patch',
        rolledBack: false,
      }),
    ).toBe('dry-run 실패: invalid patch');
  });

  it('apply + success → "파일 N 개 적용"', () => {
    expect(
      composePatchApplySideEffect({
        dryRun: false,
        success: true,
        appliedCount: 2,
        entryCount: 2,
        rolledBack: false,
      }),
    ).toBe('파일 2 개 적용');
  });

  it('apply + failure + rollback → "적용 실패 + rollback: <error>"', () => {
    expect(
      composePatchApplySideEffect({
        dryRun: false,
        success: false,
        appliedCount: 1,
        entryCount: 2,
        error: 'EACCES',
        rolledBack: true,
      }),
    ).toBe('적용 실패 + rollback: EACCES');
  });

  it('apply + failure + no rollback → "적용 실패: <error>"', () => {
    expect(
      composePatchApplySideEffect({
        dryRun: false,
        success: false,
        appliedCount: 0,
        entryCount: 2,
        error: 'permission denied',
        rolledBack: false,
      }),
    ).toBe('적용 실패: permission denied');
  });

  it('error 누락 → "unknown" fallback', () => {
    expect(
      composePatchApplySideEffect({
        dryRun: false,
        success: false,
        appliedCount: 0,
        entryCount: 1,
        rolledBack: true,
      }),
    ).toBe('적용 실패 + rollback: unknown');
  });
});

// ── buildPatchApplyRunStep ──────────────────────────────────────────

describe('buildPatchApplyRunStep', () => {
  it('dryRun + success — NewRunStep 합성', () => {
    const step = buildPatchApplyRunStep({
      ...baseCtx,
      patchSet: makePatchSet({ dryRun: true }),
      applyResult: { success: true, appliedEntries: [], rolledBack: false },
    });

    expect(step.stepKind).toBe('tool_invoke');
    expect(step.nextStepCard).toBeNull();
    expect(step.sideEffectSummary).toBe('dry-run 미적용 (2 files)');

    const inputObj = JSON.parse(step.inputJson) as Record<string, unknown>;
    expect(inputObj.dryRun).toBe(true);
    expect(inputObj.entryCount).toBe(2);
    expect(inputObj.targetPaths).toEqual([
      '/repo/src/foo.ts',
      '/repo/src/bar.ts',
    ]);
    expect(inputObj.operationId).toBe('op-1');

    const outputObj = JSON.parse(step.outputJson) as Record<string, unknown>;
    expect(outputObj.success).toBe(true);
    expect(outputObj.appliedCount).toBe(0);
    expect(outputObj.rolledBack).toBe(false);
    expect(outputObj.error).toBeNull();
  });

  it('apply + success appliedCount = N', () => {
    const step = buildPatchApplyRunStep({
      ...baseCtx,
      patchSet: makePatchSet(),
      applyResult: makeApplyResult(),
    });
    expect(step.sideEffectSummary).toBe('파일 2 개 적용');
    const out = JSON.parse(step.outputJson) as Record<string, unknown>;
    expect(out.appliedCount).toBe(2);
    expect(out.success).toBe(true);
  });

  it('apply + 부분 success (appliedCount < entryCount)', () => {
    const step = buildPatchApplyRunStep({
      ...baseCtx,
      patchSet: makePatchSet(),
      applyResult: makeApplyResult({
        success: true,
        appliedEntries: makeApplyResult().appliedEntries.slice(0, 1),
      }),
    });
    expect(step.sideEffectSummary).toBe('파일 1 개 적용');
    const out = JSON.parse(step.outputJson) as Record<string, unknown>;
    expect(out.appliedCount).toBe(1);
  });

  it('apply + failure + rollback', () => {
    const step = buildPatchApplyRunStep({
      ...baseCtx,
      patchSet: makePatchSet(),
      applyResult: {
        success: false,
        appliedEntries: [],
        error: 'EACCES /repo/src/bar.ts',
        rolledBack: true,
      },
    });
    expect(step.sideEffectSummary).toBe(
      '적용 실패 + rollback: EACCES /repo/src/bar.ts',
    );
    const out = JSON.parse(step.outputJson) as Record<string, unknown>;
    expect(out.success).toBe(false);
    expect(out.rolledBack).toBe(true);
    expect(out.error).toBe('EACCES /repo/src/bar.ts');
  });

  it('apply + failure + no rollback', () => {
    const step = buildPatchApplyRunStep({
      ...baseCtx,
      patchSet: makePatchSet(),
      applyResult: {
        success: false,
        appliedEntries: [],
        error: 'denied',
        rolledBack: false,
      },
    });
    expect(step.sideEffectSummary).toBe('적용 실패: denied');
    const out = JSON.parse(step.outputJson) as Record<string, unknown>;
    expect(out.rolledBack).toBe(false);
  });

  it('actorKind=employee + actorId blank → throw', () => {
    expect(() =>
      buildPatchApplyRunStep({
        ...baseCtx,
        actorId: '   ',
        patchSet: makePatchSet(),
        applyResult: makeApplyResult(),
      }),
    ).toThrow(RunStepBridgeInvariantError);
  });

  it('actorKind=employee + actorId null → throw', () => {
    expect(() =>
      buildPatchApplyRunStep({
        ...baseCtx,
        actorId: null,
        patchSet: makePatchSet(),
        applyResult: makeApplyResult(),
      }),
    ).toThrow(/actorId/);
  });

  it('actorKind=user + actorId set → throw', () => {
    expect(() =>
      buildPatchApplyRunStep({
        ...baseCtx,
        actorKind: 'user',
        actorId: 'someone',
        patchSet: makePatchSet(),
        applyResult: makeApplyResult(),
      }),
    ).toThrow(/incompatible/);
  });

  it('actorKind=system + actorId null → OK', () => {
    const step = buildPatchApplyRunStep({
      ...baseCtx,
      actorKind: 'system',
      actorId: null,
      patchSet: makePatchSet(),
      applyResult: makeApplyResult(),
    });
    expect(step.actorKind).toBe('system');
    expect(step.actorId).toBeNull();
  });

  it('meetingId blank → throw', () => {
    expect(() =>
      buildPatchApplyRunStep({
        ...baseCtx,
        meetingId: '',
        patchSet: makePatchSet(),
        applyResult: makeApplyResult(),
      }),
    ).toThrow(/meetingId/);
  });

  it('channelId blank → throw', () => {
    expect(() =>
      buildPatchApplyRunStep({
        ...baseCtx,
        channelId: '   ',
        patchSet: makePatchSet(),
        applyResult: makeApplyResult(),
      }),
    ).toThrow(/channelId/);
  });

  it('round 음수 → throw', () => {
    expect(() =>
      buildPatchApplyRunStep({
        ...baseCtx,
        round: -1,
        patchSet: makePatchSet(),
        applyResult: makeApplyResult(),
      }),
    ).toThrow(/round/);
  });

  it('turnIndex 음수 → throw', () => {
    expect(() =>
      buildPatchApplyRunStep({
        ...baseCtx,
        turnIndex: -2,
        patchSet: makePatchSet(),
        applyResult: makeApplyResult(),
      }),
    ).toThrow(/turnIndex/);
  });

  it('round 소수 → throw', () => {
    expect(() =>
      buildPatchApplyRunStep({
        ...baseCtx,
        round: 1.5,
        patchSet: makePatchSet(),
        applyResult: makeApplyResult(),
      }),
    ).toThrow(/round/);
  });

  it('durationMs 음수 → throw', () => {
    expect(() =>
      buildPatchApplyRunStep({
        ...baseCtx,
        durationMs: -1,
        patchSet: makePatchSet(),
        applyResult: makeApplyResult(),
      }),
    ).toThrow(/durationMs/);
  });

  it('durationMs Infinity → throw', () => {
    expect(() =>
      buildPatchApplyRunStep({
        ...baseCtx,
        durationMs: Number.POSITIVE_INFINITY,
        patchSet: makePatchSet(),
        applyResult: makeApplyResult(),
      }),
    ).toThrow(/durationMs/);
  });

  it('inputJson targetPaths 보존', () => {
    const step = buildPatchApplyRunStep({
      ...baseCtx,
      patchSet: makePatchSet(),
      applyResult: makeApplyResult(),
    });
    const obj = JSON.parse(step.inputJson) as { targetPaths: string[] };
    expect(obj.targetPaths).toHaveLength(2);
    expect(obj.targetPaths[0]).toBe('/repo/src/foo.ts');
  });

  it('inputJson 에 newContent / originalContent 직접 보존 X', () => {
    const step = buildPatchApplyRunStep({
      ...baseCtx,
      patchSet: makePatchSet(),
      applyResult: makeApplyResult(),
    });
    expect(step.inputJson).not.toContain('console.log');
    expect(step.inputJson).not.toContain('export const');
  });

  it('empty entries 도 throw 하지 않음 (의도적 no-op 영속)', () => {
    const step = buildPatchApplyRunStep({
      ...baseCtx,
      patchSet: makePatchSet({ entries: [] }),
      applyResult: { success: true, appliedEntries: [], rolledBack: false },
    });
    expect(step.sideEffectSummary).toBe('파일 0 개 적용');
  });

  it('stepKind = tool_invoke / nextStepCard = null 강제', () => {
    const step = buildPatchApplyRunStep({
      ...baseCtx,
      patchSet: makePatchSet(),
      applyResult: makeApplyResult(),
    });
    expect(step.stepKind).toBe('tool_invoke');
    expect(step.nextStepCard).toBeNull();
  });
});

// ── buildCommandRunStep ─────────────────────────────────────────────

const baseRequest: CommandRequest = {
  command: 'git',
  args: ['status', '--short'],
  cwd: '/repo',
};

describe('buildCommandRunStep', () => {
  it('success outputJson + sideEffectSummary', () => {
    const result: CommandResult = {
      exitCode: 0,
      stdout: 'M src/foo.ts',
      stderr: '',
      durationMs: 42,
    };
    const step = buildCommandRunStep({
      kind: 'success',
      ...baseCtx,
      request: baseRequest,
      result,
    });
    expect(step.sideEffectSummary).toBe('git 실행 (exit 0)');
    const out = JSON.parse(step.outputJson) as Record<string, unknown>;
    expect(out.exitCode).toBe(0);
    expect(out.stdoutBytes).toBe(12); // 'M src/foo.ts' UTF-8 = 12
    expect(out.stderrBytes).toBe(0);
    expect(out.durationMs).toBe(42);
  });

  it('exit 1 도 success kind (commandRunner 가 throw 하지 않은 케이스)', () => {
    const step = buildCommandRunStep({
      kind: 'success',
      ...baseCtx,
      request: baseRequest,
      result: { exitCode: 1, stdout: '', stderr: 'fatal', durationMs: 8 },
    });
    expect(step.sideEffectSummary).toBe('git 실행 (exit 1)');
    const out = JSON.parse(step.outputJson) as Record<string, unknown>;
    expect(out.exitCode).toBe(1);
    expect(out.stderrBytes).toBe(5);
  });

  it('failure outputJson + sideEffectSummary', () => {
    const step = buildCommandRunStep({
      kind: 'failure',
      ...baseCtx,
      request: baseRequest,
      error: 'ENOENT: spawn git',
    });
    expect(step.sideEffectSummary).toBe('git 실패: ENOENT: spawn git');
    const out = JSON.parse(step.outputJson) as Record<string, unknown>;
    expect(out.failed).toBe(true);
    expect(out.error).toBe('ENOENT: spawn git');
  });

  it('command blank → throw', () => {
    expect(() =>
      buildCommandRunStep({
        kind: 'success',
        ...baseCtx,
        request: { command: '   ', args: [], cwd: '/repo' },
        result: { exitCode: 0, stdout: '', stderr: '', durationMs: 1 },
      }),
    ).toThrow(/command must be non-blank/);
  });

  it('cwd blank → throw', () => {
    expect(() =>
      buildCommandRunStep({
        kind: 'success',
        ...baseCtx,
        request: { command: 'git', args: [], cwd: '' },
        result: { exitCode: 0, stdout: '', stderr: '', durationMs: 1 },
      }),
    ).toThrow(/cwd must be non-blank/);
  });

  it('failure error blank → throw', () => {
    expect(() =>
      buildCommandRunStep({
        kind: 'failure',
        ...baseCtx,
        request: baseRequest,
        error: '   ',
      }),
    ).toThrow(/error must be non-blank/);
  });

  it('actor identity 검증 동일 (user + actorId set → throw)', () => {
    expect(() =>
      buildCommandRunStep({
        kind: 'success',
        ...baseCtx,
        actorKind: 'user',
        actorId: 'someone',
        request: baseRequest,
        result: { exitCode: 0, stdout: '', stderr: '', durationMs: 1 },
      }),
    ).toThrow(/incompatible/);
  });

  it('context invariants 동일 (meetingId blank → throw)', () => {
    expect(() =>
      buildCommandRunStep({
        kind: 'success',
        ...baseCtx,
        meetingId: '',
        request: baseRequest,
        result: { exitCode: 0, stdout: '', stderr: '', durationMs: 1 },
      }),
    ).toThrow(/meetingId/);
  });

  it('inputJson 의 args 배열 통째 보존 (truncate 없음)', () => {
    const longArgs = Array.from({ length: 20 }, (_, i) => `arg-${i}`);
    const step = buildCommandRunStep({
      kind: 'success',
      ...baseCtx,
      request: { command: 'find', args: longArgs, cwd: '/repo' },
      result: { exitCode: 0, stdout: '', stderr: '', durationMs: 1 },
    });
    const inObj = JSON.parse(step.inputJson) as { args: string[] };
    expect(inObj.args).toHaveLength(20);
    expect(inObj.args[19]).toBe('arg-19');
  });

  it('stdoutBytes UTF-8 정확 (한글 byte 길이)', () => {
    const step = buildCommandRunStep({
      kind: 'success',
      ...baseCtx,
      request: baseRequest,
      result: { exitCode: 0, stdout: '한', stderr: '글', durationMs: 1 },
    });
    const out = JSON.parse(step.outputJson) as Record<string, number>;
    expect(out.stdoutBytes).toBe(3); // '한' UTF-8 = 3 bytes
    expect(out.stderrBytes).toBe(3);
  });

  it('stepKind = tool_invoke / nextStepCard = null 강제', () => {
    const step = buildCommandRunStep({
      kind: 'success',
      ...baseCtx,
      request: baseRequest,
      result: { exitCode: 0, stdout: '', stderr: '', durationMs: 1 },
    });
    expect(step.stepKind).toBe('tool_invoke');
    expect(step.nextStepCard).toBeNull();
  });
});
