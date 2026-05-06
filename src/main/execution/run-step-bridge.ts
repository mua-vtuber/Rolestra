/**
 * run-step-bridge — R12-C2 P5 T26 land. spec §11.19.2 / §11.19.4 +
 * docs/plans/2026-05-04-rolestra-phase-r12-c2.md line 453-462.
 *
 * ExecutionService 의 *결과* (PatchSet → ApplyResult, CommandRequest →
 * CommandResult / 실패) 를 RunStep row 1 개로 변환하는 thin module. T15
 * (idea) / T16a (design) / T17 (audit / review) / T24 (implement) / T25
 * (audit-handoff-dispatch) 와 같은 패턴 — types + 순수 helper 만, orchestrator
 * wire / DB 영속 / IPC 발송 X.
 *
 *   { PatchSet, ApplyResult }      → buildPatchApplyRunStep    → NewRunStep
 *   { CommandRequest, CommandResult|error } → buildCommandRunStep → NewRunStep
 *
 * 변환된 NewRunStep 은 RunStepService.appendOne / appendForTurn 에 그대로
 * 넘기면 영속됨. 본 bridge 가 step_kind='tool_invoke' / nextStepCard=null
 * 강제 + side_effect_summary 1-line 합성 + inputJson / outputJson 직렬화
 * 까지 책임지고, *호출 시점* (회의 turn 안 어느 단계에 호출되는가) 은 caller
 * (orchestrator) 가 결정한다.
 *
 * **R12-C2 시점 wire 상태 (의도된 미작업):**
 *   - ExecutionService 안에 RunStepService 의존 *주입 X*. 본 bridge 는 caller
 *     쪽 (회의 orchestrator / approval-decision-router 등) 에서 명시 호출.
 *     ExecutionService 본체 책임 = audit log + circuit breaker 까지만 — 영속
 *     레이어 (RunStep) 는 분리.
 *   - tool 호출이 *회의 outside* 에서 일어나면 (예: 사용자 직접 결재 후 적용)
 *     meetingId / turnIndex 가 없을 수 있음. 본 bridge 는 *회의 안 호출* 만
 *     변환 — 회의 외 호출은 caller 가 RunStep 영속 자체를 skip.
 *   - inputJson / outputJson 은 caller 가 raw 통째 전달 — truncate / sanitize
 *     는 본 모듈 책임 X (spec §11.19.4 truncate 금지).
 *
 * **silent fallback 금지 (CLAUDE.md):**
 *   - meetingId / channelId blank → throw (영속 시 FK 위반 → 회의 abort 회피)
 *   - actorKind / actorId 정합 어긋남 → throw (RunStepService.assertValid 의
 *     pre-flight — bridge 시점에서 1차 차단해 디버깅 용이)
 *   - round / turnIndex / durationMs 음수 → throw (단조 증가 invariant 위반)
 *
 * spec docs/specs/2026-05-01-rolestra-channel-roles-design.md
 *  - §11.19.2  RunStep 도메인 (step_kind / actor_kind / next_step_card)
 *  - §11.19.4  영속 정책 (truncate 금지 / atomic write / append-only)
 *
 * plan docs/plans/2026-05-04-rolestra-phase-r12-c2.md
 *  - line 453-462  T26 산출 (ExecutionService dryRun 의 RunStep 영속)
 */

import type {
  ApplyResult,
  CommandRequest,
  CommandResult,
  PatchSet,
} from '../../shared/execution-types';
import type {
  NewRunStep,
  RunStepActorKind,
} from '../../shared/run-step-types';

// ── invariants ─────────────────────────────────────────────────────────

/**
 * Bridge 시점의 invariant 위반 통합 throw class. silent fallback 금지 —
 * caller 가 잘못된 입력을 넘기면 즉시 throw. RunStepService.assertValid 의
 * pre-flight 로 작동 (bridge 시점 1차 차단 → service insert 시점에 다시
 * 도달할 일 없음 → 디버깅 시 호출 위치 빠르게 특정).
 */
export class RunStepBridgeInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunStepBridgeInvariantError';
  }
}

/**
 * RunStepActorKind 와 actorId 정합 검증 (RunStepService.assertValid 와 동일
 * rule). bridge 시점의 1차 차단.
 */
function assertActorIdentity(
  actorKind: RunStepActorKind,
  actorId: string | null,
): void {
  if (actorKind === 'employee') {
    if (actorId === null || actorId.trim() === '') {
      throw new RunStepBridgeInvariantError(
        `run-step-bridge: actorKind='employee' requires non-blank actorId — caller passed ${
          actorId === null ? 'null' : 'blank string'
        }`,
      );
    }
    return;
  }
  // system / moderator / user — actorId 반드시 null
  if (actorId !== null) {
    throw new RunStepBridgeInvariantError(
      `run-step-bridge: actorKind='${actorKind}' is incompatible with actorId being set — caller must pass actorId=null`,
    );
  }
}

/**
 * meetingId / channelId / round / turnIndex / durationMs 의 도메인 invariant
 * 검증. RunStep row insert 전 1차 차단 (FK 위반 / CHECK 위반은 SqliteError
 * 까지 갔다가 throw 되지만 메시지가 흐릿함 — bridge 단 throw 가 더 명확).
 */
function assertContextInvariants(ctx: {
  meetingId: string;
  channelId: string;
  round: number;
  turnIndex: number;
  durationMs: number;
}): void {
  if (ctx.meetingId.trim() === '') {
    throw new RunStepBridgeInvariantError(
      'run-step-bridge: meetingId must be non-blank (RunStep FK to meetings.id)',
    );
  }
  if (ctx.channelId.trim() === '') {
    throw new RunStepBridgeInvariantError(
      'run-step-bridge: channelId must be non-blank (RunStep FK to channels.id)',
    );
  }
  if (!Number.isInteger(ctx.round) || ctx.round < 0) {
    throw new RunStepBridgeInvariantError(
      `run-step-bridge: round must be non-negative integer — received ${ctx.round}`,
    );
  }
  if (!Number.isInteger(ctx.turnIndex) || ctx.turnIndex < 0) {
    throw new RunStepBridgeInvariantError(
      `run-step-bridge: turnIndex must be non-negative integer — received ${ctx.turnIndex}`,
    );
  }
  if (!Number.isFinite(ctx.durationMs) || ctx.durationMs < 0) {
    throw new RunStepBridgeInvariantError(
      `run-step-bridge: durationMs must be finite non-negative — received ${ctx.durationMs}`,
    );
  }
}

// ── apply-patch bridge ─────────────────────────────────────────────────

/**
 * caller (orchestrator) 가 buildPatchApplyRunStep 에 넘기는 입력. ApplyResult /
 * PatchSet 은 ExecutionService.applyPatch 가 그대로 돌려준 객체. 회의 컨텍스트
 * (meetingId / channelId / round / turnIndex / actor) 는 caller 만 알고 있음.
 */
export interface PatchApplyBridgeInput {
  /** ExecutionService.applyPatch 에 넘긴 PatchSet 그대로. */
  readonly patchSet: PatchSet;
  /** ExecutionService.applyPatch 의 반환값 그대로. */
  readonly applyResult: ApplyResult;
  /** apply 호출 소요 시간 (ms). caller 가 측정 (Date.now() 차이). */
  readonly durationMs: number;
  /** RunStep 영속 컨텍스트. */
  readonly meetingId: string;
  readonly channelId: string;
  readonly round: number;
  readonly turnIndex: number;
  readonly actorKind: RunStepActorKind;
  readonly actorId: string | null;
}

/**
 * { PatchSet, ApplyResult } → NewRunStep (`step_kind='tool_invoke'`).
 *
 * 직렬화 정책:
 *   - inputJson  = `{ operationId, aiId, conversationId, dryRun, entryCount,
 *                     targetPaths[] }` — PatchSet 전체 직렬화 시 entries 의
 *                     newContent / originalContent 가 거대해질 수 있어 *경로*
 *                     만 보존. 실제 내용은 audit log + 파일 시스템 양쪽에 이미
 *                     보존되므로 RunStep 안 중복 X.
 *   - outputJson = `{ success, appliedCount, error?, rolledBack }` — ApplyResult
 *                  직렬화. appliedEntries 의 newContent 는 마찬가지 이유로
 *                  count 만 보존.
 *   - sideEffectSummary  = 1-line 한글 요약 (UI / audit log 표시용).
 *
 * side_effect_summary 합성 (한글, plan line 459 의 "파일 X 작성" 양식 따라감):
 *   - dryRun + success         → "dry-run 미적용 (N files)"
 *   - dryRun + failure         → "dry-run 실패: <error>"
 *   - apply + success          → "파일 N 개 적용"  (N = appliedEntries.length)
 *   - apply + failure(rollback) → "적용 실패 + rollback: <error>"
 *   - apply + failure(noroll)  → "적용 실패: <error>"
 *
 * silent fallback 금지: empty entries 라도 throw 하지 않음 (caller 가 *의도적
 * no-op patch* 를 영속하고 싶을 수 있음 — 예: dryRun preview UI 가 빈 결과 받음).
 * 다만 entries 가 빈 PatchSet 의 sideEffectSummary 는 "(0 files)" 표기.
 */
export function buildPatchApplyRunStep(
  input: PatchApplyBridgeInput,
): NewRunStep {
  assertActorIdentity(input.actorKind, input.actorId);
  assertContextInvariants({
    meetingId: input.meetingId,
    channelId: input.channelId,
    round: input.round,
    turnIndex: input.turnIndex,
    durationMs: input.durationMs,
  });

  const { patchSet, applyResult } = input;

  const inputJson = JSON.stringify({
    operationId: patchSet.operationId,
    aiId: patchSet.aiId,
    conversationId: patchSet.conversationId,
    dryRun: patchSet.dryRun,
    entryCount: patchSet.entries.length,
    targetPaths: patchSet.entries.map((e) => e.targetPath),
  });

  const outputJson = JSON.stringify({
    success: applyResult.success,
    appliedCount: applyResult.appliedEntries.length,
    error: applyResult.error ?? null,
    rolledBack: applyResult.rolledBack,
  });

  const sideEffectSummary = composePatchApplySideEffect({
    dryRun: patchSet.dryRun,
    success: applyResult.success,
    appliedCount: applyResult.appliedEntries.length,
    entryCount: patchSet.entries.length,
    error: applyResult.error,
    rolledBack: applyResult.rolledBack,
  });

  return {
    meetingId: input.meetingId,
    channelId: input.channelId,
    round: input.round,
    turnIndex: input.turnIndex,
    actorKind: input.actorKind,
    actorId: input.actorId,
    stepKind: 'tool_invoke',
    inputJson,
    outputJson,
    nextStepCard: null,
    sideEffectSummary,
    durationMs: input.durationMs,
  };
}

interface PatchApplySideEffectArgs {
  dryRun: boolean;
  success: boolean;
  appliedCount: number;
  entryCount: number;
  error?: string;
  rolledBack: boolean;
}

/**
 * apply-patch sideEffectSummary 합성 — 사람이 읽는 1-line.
 * exported for unit-test 정밀 검증.
 */
export function composePatchApplySideEffect(
  args: PatchApplySideEffectArgs,
): string {
  if (args.dryRun) {
    if (args.success) {
      return `dry-run 미적용 (${args.entryCount} files)`;
    }
    return `dry-run 실패: ${args.error ?? 'unknown'}`;
  }
  if (args.success) {
    return `파일 ${args.appliedCount} 개 적용`;
  }
  if (args.rolledBack) {
    return `적용 실패 + rollback: ${args.error ?? 'unknown'}`;
  }
  return `적용 실패: ${args.error ?? 'unknown'}`;
}

// ── command bridge ─────────────────────────────────────────────────────

/**
 * caller 가 buildCommandRunStep 에 넘기는 입력. ExecutionService.runCommand 는
 * 성공 시 CommandResult, 실패 시 throw — 본 bridge 는 두 분기 모두 처리한다.
 *
 *   { request, result }              성공 케이스 (runCommand 가 result 반환).
 *   { request, error }               실패 케이스 (runCommand 가 throw — caller
 *                                    가 catch 후 error 객체와 함께 호출).
 *
 * 한 input 안에 result / error 가 둘 다 있으면 invariant — 둘 중 하나만 허용.
 */
export type CommandBridgeInput =
  | {
      readonly kind: 'success';
      readonly request: CommandRequest;
      readonly result: CommandResult;
      readonly durationMs: number;
      readonly meetingId: string;
      readonly channelId: string;
      readonly round: number;
      readonly turnIndex: number;
      readonly actorKind: RunStepActorKind;
      readonly actorId: string | null;
    }
  | {
      readonly kind: 'failure';
      readonly request: CommandRequest;
      readonly error: string;
      readonly durationMs: number;
      readonly meetingId: string;
      readonly channelId: string;
      readonly round: number;
      readonly turnIndex: number;
      readonly actorKind: RunStepActorKind;
      readonly actorId: string | null;
    };

/**
 * { CommandRequest, CommandResult | error } → NewRunStep (`step_kind='tool_invoke'`).
 *
 * 직렬화 정책:
 *   - inputJson  = `{ command, args, cwd }` — CommandRequest 통째.
 *   - outputJson:
 *       success → `{ exitCode, stdoutBytes, stderrBytes, durationMs }` (stdout
 *                 / stderr 본문은 RunStep 안 보존 X — audit log + caller 가
 *                 별도 보관).
 *       failure → `{ failed: true, error }` — error 메시지만.
 *   - sideEffectSummary 합성:
 *       success → "<command> 실행 (exit <code>)"
 *       failure → "<command> 실패: <error>"
 *
 * silent fallback 금지: command / cwd blank 면 throw — 회의 안 unstructured
 * 호출 차단.
 */
export function buildCommandRunStep(input: CommandBridgeInput): NewRunStep {
  assertActorIdentity(input.actorKind, input.actorId);
  assertContextInvariants({
    meetingId: input.meetingId,
    channelId: input.channelId,
    round: input.round,
    turnIndex: input.turnIndex,
    durationMs: input.durationMs,
  });

  if (input.request.command.trim() === '') {
    throw new RunStepBridgeInvariantError(
      'run-step-bridge: CommandRequest.command must be non-blank',
    );
  }
  if (input.request.cwd.trim() === '') {
    throw new RunStepBridgeInvariantError(
      'run-step-bridge: CommandRequest.cwd must be non-blank (PathGuard 의 anchor)',
    );
  }

  const inputJson = JSON.stringify({
    command: input.request.command,
    args: input.request.args,
    cwd: input.request.cwd,
  });

  let outputJson: string;
  let sideEffectSummary: string;

  if (input.kind === 'success') {
    outputJson = JSON.stringify({
      exitCode: input.result.exitCode,
      stdoutBytes: byteLength(input.result.stdout),
      stderrBytes: byteLength(input.result.stderr),
      durationMs: input.result.durationMs,
    });
    sideEffectSummary = `${input.request.command} 실행 (exit ${input.result.exitCode})`;
  } else {
    if (input.error.trim() === '') {
      throw new RunStepBridgeInvariantError(
        'run-step-bridge: failure CommandBridgeInput.error must be non-blank',
      );
    }
    outputJson = JSON.stringify({
      failed: true,
      error: input.error,
    });
    sideEffectSummary = `${input.request.command} 실패: ${input.error}`;
  }

  return {
    meetingId: input.meetingId,
    channelId: input.channelId,
    round: input.round,
    turnIndex: input.turnIndex,
    actorKind: input.actorKind,
    actorId: input.actorId,
    stepKind: 'tool_invoke',
    inputJson,
    outputJson,
    nextStepCard: null,
    sideEffectSummary,
    durationMs: input.durationMs,
  };
}

/**
 * UTF-8 byte length — Node 의 Buffer 의존 없이 전역 TextEncoder 사용 (renderer
 * 와도 호환되는 cross-process 안전 함수). 본 모듈 자체는 main-only 지만,
 * 동작이 동일해 테스트가 쉬워진다.
 */
function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}
