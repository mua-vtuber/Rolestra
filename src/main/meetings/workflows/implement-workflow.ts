/**
 * implement-workflow — R12-C2 P5 T24 land. spec §3 line 75 / §4 line 143 /
 * §11.13 line 883.
 *
 * 구현 부서 (channel.role === 'implement') = R12-C2 시점 *simple 1 명*. 풀세트
 * 회의 X — designated worker 1 명이 mission card 받아 *단일 turn* 으로 코드
 * 변경을 produce → ExecutionService dryRun → 사용자 승인 → atomic apply →
 * 자동으로 검토 (audit) 부서로 인계 (T25 / T27 wire).
 *
 * 본 모듈은 *types + 순수 helper* 만 land — orchestrator / IPC / DB / 파일
 * 시스템 의존 X. T16a (design-workflow) / T17 (audit / review) 와 같은
 * thin extension 설계. orchestrator wire (mission card 수신 → designated
 * worker resolve → ExecutionService 호출 → audit 인계 dispatch) 는 P5/P6 의
 * 다른 sub-task (T25 audit→planning / T26 ExecutionService RunStep / T27
 * handoff_dispatch row) 책임. 본 sub-task 의 스코프:
 *
 *   1. {@link implementResponseSchema} — designated worker JSON 응답 형식
 *      (file 변경 list + 요약). zod 검증.
 *   2. {@link ImplementWorkflowResult} / {@link ImplementWorkflowAbortReason} —
 *      orchestrator finalize 단계 outcome 매핑 type.
 *   3. {@link ImplementMissionContext} — designated worker prompt builder 입력
 *      형식.
 *   4. {@link buildImplementPromptBody} — mission card kind 별 prompt body
 *      합성. 응답 schema 안내 포함.
 *   5. {@link extractImplementPatchEntries} — response → PatchEntry[] 변환
 *      (path-guard: 절대 경로 / `..` traversal 거부 + workspaceRoot 봉인).
 *   6. {@link buildImplementPatchSet} — PatchSet wrapper (operationId / aiId /
 *      conversationId / dryRun 결합).
 *   7. {@link ImplementApplyPending} — 사용자 dryRun 승인 대기 promise holder
 *      (idea-workflow 의 IdeaUserPickPending 패턴).
 *   8. Errors / role guard / capability mapping.
 *
 * **R12-C2 시점 wiring 상태:** orchestrator caller 가 mission card → 본 모듈
 * 호출 → ExecutionService → ImplementWorkflowResult 반환. 분담 / tier system
 * / worktree 분할 등 R12-W phase 의 multi-worker 흐름은 본 모듈 *위에 얹는*
 * 형태로 add-on (본 모듈 자체는 1 명 simple 만).
 *
 * spec docs/specs/2026-05-01-rolestra-channel-roles-design.md
 *  - §3 line 75       구현 부서 능력 (코드 생성 + 파일 쓰기 + 명령 실행 + diff 적용)
 *  - §4 line 143      구현 매트릭스 row (R12-C2 = simple 1 명, 회의 X, ExecutionService apply)
 *  - §11.13 line 883  ImplementVariant SsmBox layout (T18 land)
 *
 * plan docs/plans/2026-05-04-rolestra-phase-r12-c2.md
 *  - line 433-441  T24 산출 (implement-workflow, designated 1 명, dryRun + apply)
 */

import * as path from 'node:path';
import { z } from 'zod';

import type { ChannelRole } from '../../../shared/channel-role-types';
import type { PatchEntry, PatchSet } from '../../../shared/execution-types';
import type {
  MissionCard,
  MissionCardKind,
} from '../../../shared/schema/mission-card';
import type { RoleId } from '../../../shared/role-types';

// ── designated worker JSON 응답 schema ──────────────────────────────

/**
 * 구현 부서 designated worker 단일 turn 응답 schema. 회의 X 라 step1-style
 * `opinions` 배열이 아니라 *file 변경 list + 요약* 의 새 형식.
 *
 * 빈 `patches` 배열은 거부 — 임무 카드를 받은 직원이 코드 변경 0 건이라면
 * 작업 자체가 무의미. 본 schema 가 거부 → orchestrator 가 1 회 재요청 +
 * 2 회 실패 시 회의 abort (`'designated_worker_failed'`).
 *
 * `operation`:
 *   - `'create'`  새 파일 생성. `newContent` 필수.
 *   - `'modify'`  기존 파일 덮어쓰기. `newContent` 필수.
 *   - `'delete'`  파일 삭제. `newContent` 무시 (선택 가능, 검증 안 함).
 *
 * `targetPath` 는 *workspaceRoot 기준 상대 경로* — caller (orchestrator) 가
 * {@link extractImplementPatchEntries} 호출 시 workspaceRoot 와 join + path-guard
 * 검증. 절대 경로 / `..` traversal 은 helper 가 거부.
 *
 * `reasoning` 은 audit log + UI 표시 용도 — 빈 문자열 허용 (직원 주석 X).
 */
export const implementResponseSchema = z
  .object({
    name: z.string().min(1),
    label: z.string().min(1),
    summary: z
      .string()
      .min(1, 'implement summary must not be empty — designated worker explains the change in 1~3 lines'),
    patches: z
      .array(
        z
          .object({
            operation: z.enum(['create', 'modify', 'delete']),
            targetPath: z.string().min(1),
            newContent: z.string().optional(),
            reasoning: z.string(),
          })
          .strict(),
      )
      .min(1, 'implement response must contain at least 1 patch entry'),
  })
  .strict();

/** {@link implementResponseSchema} 의 inferred type. */
export type ImplementResponse = z.infer<typeof implementResponseSchema>;

// ── prompt builder ──────────────────────────────────────────────────

/**
 * `ImplementMissionContext` — orchestrator (caller) 가 designated worker 에게
 * 보낼 prompt 합성 시 본 객체 1 건을 {@link buildImplementPromptBody} 에 넘김.
 *
 * `inputFileSnippets` 는 mission card payload.inputFiles 가 가리키는 파일들의
 * *현재 본문* — caller 가 파일 시스템에서 미리 읽어와 prepend. 빈 배열 허용
 * (mission card 가 inputFiles 비어 있는 경우 — 새 파일 scratch 작성).
 *
 * 본 helper 는 workspaceRoot 자체는 본문에 노출 X — 직원에게는 *상대 경로*
 * 로 보여 path-guard 우회 시도 어려움 (절대 경로 시 path-guard 가 거부).
 */
export interface ImplementMissionContext {
  /** 임무 카드 (T23 land schema). */
  missionCard: MissionCard;
  /** 발화자 displayName (provider) — prompt 안 직원 식별. */
  speakerDisplayName: string;
  /**
   * 발화 ID (예: `claude_1`) — 응답 JSON `label` 자리. 회의 X 이므로 회의 단위
   * 카운터가 아닌 단일 turn 식별자.
   */
  suggestedLabel: string;
  /**
   * mission card payload.inputFiles 에 대한 *현재 본문* snippet list. 빈 배열
   * 허용 — caller 가 파일 미존재 / 읽기 실패 시 silent skip 가능 (직원 prompt
   * 가 "(파일 없음)" 표기). 절대 경로 노출 차단 위해 path 는 workspaceRoot
   * 기준 상대 경로로 정규화.
   */
  inputFileSnippets: ReadonlyArray<{
    path: string;
    content: string;
  }>;
}

/**
 * mission card kind 별 designated worker prompt body 합성. 응답 schema 안내
 * 포함. orchestrator 가 본 결과를 turn-executor 의 system + user 메시지 자리에
 * 합성.
 *
 * design-workflow 의 buildDesignedTaskPromptBody 와 같은 thin builder 패턴 —
 * 본 함수는 *문자열 합성* 만, prompt 발송 자체는 caller 책임.
 */
export function buildImplementPromptBody(ctx: ImplementMissionContext): string {
  const lines: string[] = [];

  lines.push(`[현재 단계: 구현 부서 — ${headerForKind(ctx.missionCard.payload.kind)}]`);
  lines.push('');

  // kind 별 미션 본문
  lines.push(missionForKind(ctx.missionCard.payload.kind));
  lines.push('');

  // 카드 본문
  lines.push('[임무 카드 본문]');
  lines.push(ctx.missionCard.payload.body);
  lines.push('');

  // kind 별 추가 컨텍스트 (planning minutes / audit minutes / user message)
  const extra = extraContextForPayload(ctx.missionCard);
  if (extra !== null) {
    lines.push(extra);
    lines.push('');
  }

  // 입력 파일 list + 본문 snippet
  if (ctx.missionCard.payload.inputFiles.length > 0) {
    lines.push('[입력 파일 list]');
    for (const filePath of ctx.missionCard.payload.inputFiles) {
      lines.push(`- ${filePath}`);
    }
    lines.push('');
  }
  if (ctx.inputFileSnippets.length > 0) {
    lines.push('[입력 파일 본문]');
    for (const snippet of ctx.inputFileSnippets) {
      lines.push(`--- ${snippet.path}`);
      lines.push(snippet.content);
      lines.push('---');
    }
    lines.push('');
  }

  // 출력 기대치
  if (ctx.missionCard.payload.expectedOutputs.length > 0) {
    lines.push('[출력 기대치]');
    for (const expected of ctx.missionCard.payload.expectedOutputs) {
      lines.push(`- ${expected}`);
    }
    lines.push('');
  }

  // 응답 형식 안내
  lines.push(
    '응답은 *JSON 한 객체만* — markdown code fence 사용 금지, JSON 외 본문 금지.',
  );
  lines.push(
    '`patches` 안 `targetPath` 는 *workspaceRoot 기준 상대 경로* (예: `src/foo.ts`).',
  );
  lines.push('절대 경로 / `..` traversal 은 시스템이 거부합니다.');
  lines.push('');
  lines.push('```json (스키마 — 그대로 따르기)');
  lines.push('{');
  lines.push(`  "name": "${escapeForPrompt(ctx.speakerDisplayName)}",`);
  lines.push(`  "label": "${escapeForPrompt(ctx.suggestedLabel)}",`);
  lines.push('  "summary": "<무엇을 했는지 1~3 줄>",');
  lines.push('  "patches": [');
  lines.push('    {');
  lines.push('      "operation": "create" | "modify" | "delete",');
  lines.push('      "targetPath": "<workspaceRoot 기준 상대 경로>",');
  lines.push('      "newContent": "<create / modify 시 새 파일 본문 통째>",');
  lines.push('      "reasoning": "<이 변경이 왜 필요한지>"');
  lines.push('    }');
  lines.push('  ]');
  lines.push('}');
  lines.push('```');
  lines.push('');
  lines.push(
    '`patches` 길이 ≥ 1 필수 — 변경 0 건 응답은 시스템이 거부합니다.',
  );
  lines.push(
    'truncate 금지 — `newContent` 는 변경 후 파일 본문 *통째*. 차이만 적지 마십시오.',
  );
  return lines.join('\n');
}

function headerForKind(kind: MissionCardKind): string {
  switch (kind) {
    case 'spec':
      return '기획 → 구현 정상 chain';
    case 'fix':
      return 'audit NG → 재기획 후 수정';
    case 'change-request':
      return '사용자 변경 요청';
  }
}

function missionForKind(kind: MissionCardKind): string {
  switch (kind) {
    case 'spec':
      return [
        '[미션]',
        '아래 [임무 카드 본문] + [참고 회의록] 을 읽고, 합의된 spec 을 그대로',
        '코드로 옮겨 작성하세요. spec 의도와 다른 추가 / 누락 / 임의 해석 금지.',
      ].join('\n');
    case 'fix':
      return [
        '[미션]',
        '아래 [임무 카드 본문] + [참고 회의록 — audit] 의 *문제 list* 를 읽고,',
        '각 문제를 수정하세요. audit 가 발견한 문제만 처리 — 추가 정리 / 리팩토링',
        '금지 (검토는 문제 발견만, 처리는 구현이 받은 만큼만).',
      ].join('\n');
    case 'change-request':
      return [
        '[미션]',
        '아래 [임무 카드 본문] + [사용자 메시지] 의 변경 요청을 그대로 코드에',
        '반영하세요. 사용자 의도가 모호하면 *임의 추측 X* — 해당 patch 의',
        '`reasoning` 필드에 "사용자 의도 모호" 표기 + 가장 좁은 해석 적용.',
      ].join('\n');
  }
}

function extraContextForPayload(card: MissionCard): string | null {
  switch (card.payload.kind) {
    case 'spec': {
      return [
        '[참고 회의록 — planning]',
        card.payload.planningMinutesMarkdown,
      ].join('\n');
    }
    case 'fix': {
      const lines: string[] = [];
      lines.push('[참고 회의록 — audit]');
      lines.push(card.payload.auditMinutesMarkdown);
      lines.push('');
      lines.push('[문제 list]');
      for (const problem of card.payload.problemList) {
        lines.push(`- (${problem.opinionId}) ${problem.title}`);
        if (problem.content.trim().length > 0) {
          lines.push(`  ${problem.content}`);
        }
      }
      return lines.join('\n');
    }
    case 'change-request': {
      return ['[사용자 메시지]', card.payload.userMessage].join('\n');
    }
  }
}

function escapeForPrompt(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ── patch entry extraction (path-guard) ─────────────────────────────

/**
 * designated worker JSON 응답 → {@link PatchEntry} 배열 변환. path-guard:
 *
 *   1. 절대 경로 (`/foo` / `C:\foo` 등) → throw
 *   2. `..` traversal → throw (workspaceRoot 봉인 위반)
 *   3. workspaceRoot 와 path.resolve 후 `path.relative` 가 `..` 로 시작하면 throw
 *   4. 빈 path / 공백만 있는 path → throw
 *
 * `operation === 'create' | 'modify'` 이고 `newContent` 가 undefined → throw
 * (schema 단계에서 optional 이라 caller 가 반드시 검증).
 *
 * `operation === 'delete'` 이면 `newContent` 무시 + 결과 entry 의 newContent
 * 도 undefined.
 *
 * 본 함수는 IO 없음 — 파일 읽기 / 쓰기 / 존재 검사 X. PatchApplier
 * (ExecutionService) 가 실제 적용 시 다시 검증.
 */
export function extractImplementPatchEntries(input: {
  response: ImplementResponse;
  workspaceRoot: string;
}): PatchEntry[] {
  if (
    typeof input.workspaceRoot !== 'string' ||
    input.workspaceRoot.trim().length === 0
  ) {
    throw new ImplementResponseInvariantError(
      'workspaceRoot must be a non-empty absolute path',
    );
  }
  if (!path.isAbsolute(input.workspaceRoot)) {
    throw new ImplementResponseInvariantError(
      `workspaceRoot must be absolute (got '${input.workspaceRoot}')`,
    );
  }
  const resolvedRoot = path.resolve(input.workspaceRoot);

  const entries: PatchEntry[] = [];
  for (let i = 0; i < input.response.patches.length; i++) {
    const patch = input.response.patches[i];
    const rel = patch.targetPath.trim();
    if (rel.length === 0) {
      throw new ImplementResponseInvariantError(
        `patch[${i}].targetPath must not be blank`,
      );
    }
    if (path.isAbsolute(rel)) {
      throw new ImplementResponseInvariantError(
        `patch[${i}].targetPath must be relative — got absolute '${rel}'`,
      );
    }

    const resolvedTarget = path.resolve(resolvedRoot, rel);
    const relativeToRoot = path.relative(resolvedRoot, resolvedTarget);
    if (
      relativeToRoot.length === 0 ||
      relativeToRoot === '.' ||
      relativeToRoot.startsWith('..') ||
      path.isAbsolute(relativeToRoot)
    ) {
      throw new ImplementResponseInvariantError(
        `patch[${i}].targetPath '${rel}' escapes workspaceRoot — '..' traversal blocked`,
      );
    }

    if (
      (patch.operation === 'create' || patch.operation === 'modify') &&
      typeof patch.newContent !== 'string'
    ) {
      throw new ImplementResponseInvariantError(
        `patch[${i}].newContent required for operation '${patch.operation}'`,
      );
    }

    const entry: PatchEntry = {
      operation: patch.operation,
      targetPath: resolvedTarget,
    };
    if (patch.operation !== 'delete') {
      entry.newContent = patch.newContent;
    }
    entries.push(entry);
  }
  return entries;
}

// ── PatchSet builder ────────────────────────────────────────────────

/**
 * PatchEntry[] + metadata → {@link PatchSet}. ExecutionService.applyPatch 가
 * 받는 형식. operationId / aiId / conversationId 는 caller 가 결정 — 본 helper
 * 는 wrapper.
 *
 * 사용 흐름 (caller, T26/T27 wire 시점):
 *   1. dryRun=true 호출 → ExecutionService.generateDiff → 사용자 모달 표시
 *   2. 사용자 승인 시 dryRun=false 새 PatchSet (operationId 새로) → applyPatch
 *   3. apply 결과 ApplyResult.success → audit 자동 인계
 *   4. apply rollback / 사용자 거부 → ImplementWorkflowAbortReason 매핑
 *
 * dryRun preview 와 실제 apply 는 *서로 다른 operationId* — audit log 가 두
 * 단계를 분리 추적 가능 (사용자 승인 시점이 audit log 에 별도 row 로 남음).
 */
export function buildImplementPatchSet(input: {
  entries: PatchEntry[];
  operationId: string;
  aiId: string;
  conversationId: string;
  dryRun: boolean;
}): PatchSet {
  if (input.entries.length === 0) {
    throw new ImplementResponseInvariantError(
      'cannot build PatchSet with zero entries — implement response invariant violated',
    );
  }
  if (input.operationId.trim().length === 0) {
    throw new ImplementResponseInvariantError('operationId must not be blank');
  }
  if (input.aiId.trim().length === 0) {
    throw new ImplementResponseInvariantError('aiId must not be blank');
  }
  if (input.conversationId.trim().length === 0) {
    throw new ImplementResponseInvariantError(
      'conversationId must not be blank',
    );
  }
  return {
    operationId: input.operationId,
    aiId: input.aiId,
    conversationId: input.conversationId,
    entries: input.entries,
    dryRun: input.dryRun,
  };
}

// ── apply pending state (dryRun 사용자 승인 대기) ───────────────────

/**
 * 사용자 dryRun 승인 결정 — IPC 핸들러가 모달 응답 받아 commit 시 전달.
 *
 *   - `{ approved: true }`           atomic apply 진행
 *   - `{ approved: false, reason }`  abort + abortReason='dryrun_rejected_by_user'
 */
export type ImplementApplyDecision =
  | { approved: true }
  | { approved: false; reason: string };

/**
 * orchestrator 가 dryRun 결과 사용자에게 모달로 표시 후 응답까지 정지하도록
 * 만드는 promise holder. idea-workflow 의 `IdeaUserPickPending` 패턴 그대로.
 *
 * 단일 사용 — 한 임무 카드 lifetime 안에서 1 회만 wait/commit. commit 후
 * 재사용 X. 사용자 응답 전에 orchestrator.stop() 호출되면 cancel(reason)
 * 으로 reject.
 */
export class ImplementApplyPending {
  private resolveFn: ((decision: ImplementApplyDecision) => void) | null = null;
  private rejectFn:
    | ((reason: ImplementApplyAbortReason) => void)
    | null = null;
  private settled = false;

  wait(): Promise<ImplementApplyDecision> {
    if (this.settled) {
      throw new Error(
        '[ImplementApplyPending] wait() called on settled instance — pending state is single-use',
      );
    }
    return new Promise<ImplementApplyDecision>((resolve, reject) => {
      this.resolveFn = resolve;
      this.rejectFn = reject;
    });
  }

  commit(decision: ImplementApplyDecision): void {
    if (this.settled) {
      throw new Error(
        '[ImplementApplyPending] commit() called on settled instance — duplicate commit',
      );
    }
    if (!this.resolveFn) {
      throw new Error(
        '[ImplementApplyPending] commit() called before wait() — no pending promise',
      );
    }
    this.settled = true;
    this.resolveFn(decision);
    this.resolveFn = null;
    this.rejectFn = null;
  }

  cancel(reason: ImplementApplyAbortReason): void {
    if (this.settled) return;
    if (this.rejectFn) {
      this.settled = true;
      this.rejectFn(reason);
      this.resolveFn = null;
      this.rejectFn = null;
    }
  }

  get isSettled(): boolean {
    return this.settled;
  }

  get isWaiting(): boolean {
    return !this.settled && this.resolveFn !== null;
  }
}

/** orchestrator stop / replace 시 reject reason. */
export type ImplementApplyAbortReason =
  | { kind: 'aborted' }
  | { kind: 'replaced'; message: string };

// ── workflow result + abort reasons ─────────────────────────────────

/**
 * implement-workflow 진행 결과 — orchestrator (P5/P6 wire) 가 finalize 단계에서
 * outcome 반환에 활용. idea-workflow 의 `IdeaWorkflowResult` / design-workflow
 * 의 `DesignWorkflowResult` 와 같은 패턴.
 */
export interface ImplementWorkflowResult {
  meetingId: string;
  outcome: 'committed' | 'aborted';
  /** outcome === 'committed' 일 때 — 적용된 PatchEntry list (audit 인계 시 reference). */
  appliedEntries?: ReadonlyArray<PatchEntry>;
  /** outcome === 'aborted' 일 때 — abort 단계 분류. */
  abortReason?: ImplementWorkflowAbortReason;
}

/**
 * abort 분류 — orchestrator stop / 직원 응답 실패 / 사용자 dryRun 거부 /
 * apply rollback 등 분기. 사용자 알림 메시지 + audit log 추적 분리 위해
 * *각 단계마다 별도 종*.
 *
 *   - `'aborted'`                    orchestrator.stop() — 사용자 회의 중단
 *                                    버튼 / 큐 cancel 등.
 *   - `'designated_worker_failed'`   직원 응답 turn 누적 실패 (turn skip /
 *                                    schema mismatch / provider error 2 회).
 *   - `'invalid_response'`           응답 schema 통과 X (truncate / patches 0).
 *                                    1 회 재요청 후에도 실패 시 본 분기로 abort.
 *   - `'dryrun_rejected_by_user'`    사용자가 dryRun preview 모달에서 거부.
 *                                    audit log + 알림이 별도 분류 (UX 분리).
 *   - `'apply_failed'`               atomic apply 가 실패 + rollback 실행.
 *                                    파일 시스템 에러 / 권한 거부 등.
 *   - `'replaced'`                   orchestrator 가 이 임무 카드를 새 카드로
 *                                    교체 (사용자 reset 등).
 */
export type ImplementWorkflowAbortReason =
  | { kind: 'aborted' }
  | { kind: 'designated_worker_failed'; message: string }
  | { kind: 'invalid_response'; message: string }
  | { kind: 'dryrun_rejected_by_user'; message: string }
  | { kind: 'apply_failed'; message: string }
  | { kind: 'replaced'; message: string };

// ── errors ──────────────────────────────────────────────────────────

/**
 * implement-workflow 의 schema / path-guard / metadata 위반 throw. orchestrator
 * 가 catch 후 abort + abortReason 매핑 ('invalid_response' 또는
 * 'designated_worker_failed' 분기는 caller 가 결정 — schema 미스 vs 직원
 * 거부의 차이는 caller context).
 */
export class ImplementResponseInvariantError extends Error {
  constructor(message: string) {
    super(`[ImplementResponse] ${message}`);
    this.name = 'ImplementResponseInvariantError';
  }
}

// ── role guard + capability mapping ─────────────────────────────────

/**
 * 채널이 구현 부서인지 확인. design / audit / review 의 role guard 와 같은
 * 패턴 — 문자열 리터럴이 코드 곳곳에 흩어지지 않도록 본 helper 경유.
 */
export function isImplementDepartmentRole(role: ChannelRole): boolean {
  return role === 'implement';
}

/**
 * mission card kind → designated worker 가 보유해야 할 capability (RoleId).
 *
 * R12-C2 시점에는 *모든 kind ('spec' / 'fix' / 'change-request') → 'implement'*.
 * 향후 R12-W phase 에서 sub-task 분담 (frontend / backend / test 등 sub-skill)
 * 진입 시 본 매핑이 갱신될 수 있음 — 본 helper 가 단일 진실 원천.
 */
export function capabilityForMissionKind(_kind: MissionCardKind): RoleId {
  return 'implement';
}
