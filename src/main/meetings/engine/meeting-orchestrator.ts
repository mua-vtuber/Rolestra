/**
 * MeetingOrchestrator — R12-C2 T10a 통째 재작성.
 *
 * 옛 모델: 12 단계 SSM (`SessionStateMachine`) 의 transition map 을
 * 따라가며 turn-executor 를 라운드로빈 호출, terminal (`DONE`/`FAILED`)
 * 에서 consensus_decision approval gate + composeMinutes (옛) + #회의록
 * post 를 처리. WAIT_STATES 분기 / consensus approval gate / SSM listener
 * (`wireV3SideEffects`) / 옛 minutes-composer 모두 폐기.
 *
 * 새 모델: phase loop (spec §5):
 *
 *   1. gather             → 직원별 의견 제시 (`requestOpinionGather`)
 *   2. tally              → 시스템 취합 + 화면 ID 부여 (no-network)
 *   2.5 quick_vote        → 일괄 동의 투표 + 만장일치 즉시 agreed
 *   3. free_discussion    → 의견 1 건씩 라운드 누적 (cap = channels.max_rounds)
 *   5. compose_minutes    → MeetingMinutesService.compose
 *   6. handoff            → handoff_mode='check' Notification 발송 / 'auto' no-op
 *
 * abort / pause / resume / handleUserInterjection / injectInitialUserMessage
 * + onFinalized 콜백 invariant 그대로 유지 — caller (channel-handler /
 * meeting-handler / queue / auto-trigger / D-A T2.5 dispatcher / D-A T5
 * auto-trigger) 가 옛 시그니처 그대로 호출.
 *
 * 발화 ID (label) 정책:
 *   - 회의 boot 직후 each AI participant 의 `OpinionService.nextLabelHint`
 *     결과로 `MeetingSession.primeLabelCounter` 호출 — 앱 재시작 시 in-memory
 *     카운터 복원.
 *   - 매 turn 호출 *전* `session.nextLabel(provider.id)` 으로 suggestedLabel
 *     발급 (counter +1). turn-executor 가 prompt hint 로 동봉. invalid-schema
 *     skip 도 카운터는 이미 증가 — spec §11.18.1 = 발화 시도 단위.
 *
 * spec docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md
 *   - §5     D-B 흐름 (의견 트리 + 깊이 cap 3 + 발화 ID 카운터)
 *   - §11.13a 회의록 카드 (R12-S R-T9 already implements card primitives)
 *   - §11.14 channels.max_rounds (NULL = 무제한, 부서 디폴트 5)
 *   - §11.16 handoff_mode (check | auto)
 *   - §11.18 직원 응답 JSON schema 4 종 + retry/skip 흐름
 */

import type { Channel } from '../../../shared/channel-types';
import { isDesignDepartmentRole } from '../../../shared/channel-role-types';
import type {
  MeetingPhase,
  Step1OpinionGatherSchemaType,
  Step25QuickVoteSchemaType,
  Step3FreeDiscussionSchemaType,
} from '../../../shared/meeting-flow-types';
import type {
  Opinion,
  OpinionTreeNode,
  OpinionTallyResult,
  OpinionQuickVoteResult,
} from '../../../shared/opinion-types';
import type { Participant } from '../../../shared/engine-types';
import type { NewRunStep, NextStepCard } from '../../../shared/run-step-types';
import type { MeetingService } from '../meeting-service';
import type { MessageService } from '../../channels/message-service';
import type { ChannelService } from '../../channels/channel-service';
import type { ProjectService } from '../../projects/project-service';
import type { StreamBridge } from '../../streams/stream-bridge';
import type { NotificationService } from '../../notifications/notification-service';
import type { CircuitBreaker } from '../../queue/circuit-breaker';
import type { OpinionService } from '../opinion-service';
import type { MeetingMinutesService } from '../meeting-minutes-service';
import type { RunStepService } from '../run-step/run-step-service';
import { OPINION_DEPTH_CAP } from '../screen-id';
import { tryGetLogger } from '../../log/logger-accessor';
import type { MeetingSession } from './meeting-session';
import type { ParticipantMessage } from '../../engine/history';
import type { MeetingTurnExecutor } from './meeting-turn-executor';
import type { providerRegistry } from '../../providers/registry';
import { resolveNotificationLabel } from '../../notifications/notification-labels';
import { INTER_TURN_DELAY_MS } from '../../../shared/timeouts';
import {
  classifyNextStepWithDetails,
  type NextStepClassifierContext,
} from './next-step-classifier';
import {
  IdeaUserPickPending,
  type IdeaPickSnapshot,
  type IdeaUserPickAbortReason,
  type IdeaWorkflowResult,
} from '../workflows/idea-workflow';
import {
  capabilityForKind,
  extractDesignedTaskOpinion,
  type DesignSnapshotPaths,
  type DesignedTaskContext,
  type DesignedTaskKind,
  type DesignWorkflowResult,
} from '../workflows/design-workflow';
// T23: resolver 본체는 designated-worker-resolver 모듈로 이전 — design-workflow 재export 도
// 가능하지만 직접 참조가 호출 위치 분리에 더 명확.
import {
  DesignatedWorkerNotFoundError,
  resolveDesignatedWorker,
  type DesignatedWorkerCandidate,
} from '../designated-worker-resolver';
import type {
  IdeaFinalizeSelectionInput,
  IdeaFinalizeSelectionResult,
} from '../../../shared/opinion-types';

/** Alias for the registry's instance type — same pattern as turn-executor. */
type ProviderRegistry = typeof providerRegistry;

export interface MeetingOrchestratorDeps {
  session: MeetingSession;
  turnExecutor: MeetingTurnExecutor;
  streamBridge: StreamBridge;
  messageService: MessageService;
  meetingService: MeetingService;
  channelService: ChannelService;
  projectService: ProjectService;
  notificationService: NotificationService;
  /**
   * orchestrator 자체는 사용 안 함 — turn-executor 가 직접 받아 turn-error
   * 분류로 호출. main/index.ts factory 가 turn-executor 와 같은 instance 를
   * 양쪽에 주입할 수 있도록 옵셔널로 받아둔다 (의존 graph 가독성 유지).
   */
  circuitBreaker?: CircuitBreaker;
  /** R12-C2 P2-2 — 의견 트리 + 투표 service. */
  opinionService: OpinionService;
  /** R12-C2 P2-3 — step 5 모더레이터 회의록 service. */
  meetingMinutesService: MeetingMinutesService;
  /**
   * R12-C2 T13 — 회의 turn 진행 일지 영속 service. orchestrator 가 매 turn
   * 후 (그리고 phase 경계 시스템 호출 시) NextStep 분류 결과를
   * `step_kind='next_step_classify'` row 로 적층. spec §11.18.8 + §11.19.
   */
  runStepService: RunStepService;
  /**
   * R12-C2 T16b — design-workflow 의 시스템→지정 직원 phase 가 직원 capability
   * (`design.ux` / `design.ui`) 를 lookup 하기 위해 사용. session.aiParticipants
   * 의 providerId 를 ProviderInfo 로 join 해서 roles 추출. 풀세트 / idea 부서
   * 흐름은 본 deps 사용 안 함 (idle pass-through).
   */
  providerRegistry: ProviderRegistry;
  /**
   * R12-C2 T16c — design-workflow step 7b (generating_snapshot) 본체. 회의 #2
   * 합의 직후 design_implementation root opinion (HTML/CSS) 을 desktop +
   * mobile PNG 로 렌더 + ArenaRoot 봉인 안 atomic 저장. orchestrator 는 결과
   * paths 를 stream:design-snapshot-ready emit + outcome.snapshot 에 담음.
   *
   * idea / 풀세트 흐름은 본 deps 사용 안 함 (idle pass-through). 테스트는
   * fake `captureDesignSnapshot` 주입 가능.
   */
  designSnapshotService: {
    captureDesignSnapshot: (req: {
      htmlContent: string;
      meetingId: string;
      sourceOpinionUuid: string;
    }) => Promise<{
      desktopPath: string;
      mobilePath: string;
      generatedAt: number;
      sourceOpinionUuid: string;
    }>;
  };
  /** Opt-out hook for tests — disables the inter-turn delay. */
  interTurnDelayMs?: number;
  /**
   * R9-Task7: optional post-finalise callback. Invoked exactly once per
   * run, immediately after {@link MeetingService.finish} settles the
   * meeting row (accepted / rejected / aborted). The autonomy-queue loop
   * uses this to drive `QueueService.complete(item, ...)` +
   * `startNext(projectId)` when the owning project is in `queue` mode.
   */
  onFinalized?: (info: {
    meetingId: string;
    projectId: string;
    channelId: string;
    outcome: 'accepted' | 'rejected' | 'aborted';
  }) => void | Promise<void>;
}

/**
 * 화면 ID list 의 prompt-friendly markdown 표 — quick_vote phase prompt 안에 들어감.
 *
 * orchestrator 안 helper — turn-executor 는 *생성된 markdown* 만 받고 트리
 * 구조는 모르게 분리.
 */
function renderOpinionsMarkdown(tree: OpinionTreeNode[]): string {
  if (tree.length === 0) return '(의견 없음)';
  const lines: string[] = [];
  lines.push('| 화면 ID | 발의자 | 제목 | 본문 | 근거 |');
  lines.push('|---------|--------|------|------|------|');
  for (const node of tree) {
    appendRow(lines, node);
    for (const child of node.children) {
      appendRow(lines, child);
      for (const grand of child.children) {
        appendRow(lines, grand);
      }
    }
  }
  return lines.join('\n');
}

function appendRow(lines: string[], node: OpinionTreeNode): void {
  const op = node.opinion;
  const cell = (s: string | null | undefined): string =>
    (s ?? '')
      .replace(/\|/g, '\\|')
      .replace(/\r?\n/g, ' ');
  lines.push(
    `| ${node.screenId} | ${cell(op.authorLabel)} | ${cell(op.title)} | ${cell(op.content)} | ${cell(op.rationale)} |`,
  );
}

/** 진행 중 root 의견의 markdown body (free_discussion phase prompt 안 동봉). */
function renderCurrentOpinionMarkdown(node: OpinionTreeNode): string {
  const op = node.opinion;
  const lines: string[] = [];
  lines.push(`현재 진행 의견: **${node.screenId}** (${op.authorLabel} 발의)`);
  if (op.title) lines.push(`제목: ${op.title}`);
  if (op.content) lines.push(`본문: ${op.content}`);
  if (op.rationale) lines.push(`근거: ${op.rationale}`);
  return lines.join('\n');
}

/** 자식 의견 list markdown — 화면 ID + kind + 작성자 + 제목 / 본문. */
function renderChildrenMarkdown(node: OpinionTreeNode): string {
  if (node.children.length === 0) return '(자식 의견 없음)';
  const lines: string[] = [];
  for (const child of node.children) {
    const c = child.opinion;
    lines.push(`- ${child.screenId} [${c.kind}] (${c.authorLabel}): ${c.title ?? '(제목 없음)'}`);
    if (c.content) lines.push(`  - 본문: ${c.content}`);
    if (c.rationale) lines.push(`  - 근거: ${c.rationale}`);
    for (const grand of child.children) {
      const g = grand.opinion;
      lines.push(`  - ${grand.screenId} [${g.kind}] (${g.authorLabel}): ${g.title ?? '(제목 없음)'}`);
      if (g.content) lines.push(`    - 본문: ${g.content}`);
      if (g.rationale) lines.push(`    - 근거: ${g.rationale}`);
    }
  }
  return lines.join('\n');
}

/**
 * 깊이 cap 도달 의견 (depth = OPINION_DEPTH_CAP - 1 — 즉 손자 수준) 의 화면 ID
 * list. 직원이 이 의견에 자식 추가 시 OpinionService.freeDiscussionRound 가
 * `OpinionDepthCapError` throw — prompt 단계에서 미리 안내.
 */
function collectDepthCapReached(tree: OpinionTreeNode[]): string[] {
  const result: string[] = [];
  const walk = (node: OpinionTreeNode): void => {
    if (node.depth >= OPINION_DEPTH_CAP - 1) result.push(node.screenId);
    for (const child of node.children) walk(child);
  };
  for (const root of tree) walk(root);
  return result;
}

/**
 * 트리 통째 검사: 모든 의견의 status 가 `'pending'` 외 (즉 agreed/rejected/excluded).
 * spec §11.18.8b 룰 4 의 입력. 빈 트리는 caller 가 미리 분기 — 본 함수는 비공개
 * 호출자가 *non-empty 트리* 만 넘긴다고 가정.
 */
function isAllResolved(tree: OpinionTreeNode[]): boolean {
  const walk = (node: OpinionTreeNode): boolean => {
    if (node.opinion.status === 'pending') return false;
    for (const child of node.children) {
      if (!walk(child)) return false;
    }
    return true;
  };
  for (const root of tree) {
    if (!walk(root)) return false;
  }
  return true;
}

/** tally 결과의 전체 트리에서 노드 1 개를 UUID 로 검색. */
function findNodeByUuid(
  tree: OpinionTreeNode[],
  uuid: string,
): OpinionTreeNode | null {
  for (const root of tree) {
    if (root.opinion.id === uuid) return root;
    for (const child of root.children) {
      if (child.opinion.id === uuid) return child;
      for (const grand of child.children) {
        if (grand.opinion.id === uuid) return grand;
      }
    }
  }
  return null;
}

export class MeetingOrchestrator {
  private readonly session: MeetingSession;
  private readonly turnExecutor: MeetingTurnExecutor;
  private readonly streamBridge: StreamBridge;
  private readonly messageService: MessageService;
  private readonly meetingService: MeetingService;
  private readonly channelService: ChannelService;
  private readonly projectService: ProjectService;
  private readonly notificationService: NotificationService;
  private readonly opinionService: OpinionService;
  private readonly meetingMinutesService: MeetingMinutesService;
  private readonly runStepService: RunStepService;
  private readonly providerRegistry: ProviderRegistry;
  private readonly designSnapshotService: MeetingOrchestratorDeps['designSnapshotService'];
  private readonly interTurnDelayMs: number;
  private readonly onFinalized?: MeetingOrchestratorDeps['onFinalized'];

  private running = false;
  private terminalHandled = false;
  private paused = false;
  /**
   * R12-C2 T13 — 회의 안 turn 순서 카운터. 첫 NextStep 분류 호출 = 0,
   * 매 호출마다 +1. RunStep.turnIndex 와 stream payload 의 turnIndex 에 들어감.
   * 회의 한 번 (orchestrator instance 한 번) 의 lifetime.
   */
  private turnIndexCounter = 0;

  /**
   * R12-C2 T15 — idea-workflow awaiting_user_pick phase 진입 시 set, IPC
   * `meetings:idea-finalize-selection` 응답 시 commit / orchestrator.stop()
   * 시 cancel. NULL = 진입 X 또는 settled 후 cleanup.
   *
   * 한 회의 lifetime 안에서 idea-workflow 는 1 회만 진입하므로 단발 instance.
   */
  private ideaPending: IdeaUserPickPending | null = null;

  constructor(deps: MeetingOrchestratorDeps) {
    this.session = deps.session;
    this.turnExecutor = deps.turnExecutor;
    this.streamBridge = deps.streamBridge;
    this.messageService = deps.messageService;
    this.meetingService = deps.meetingService;
    this.channelService = deps.channelService;
    this.projectService = deps.projectService;
    this.notificationService = deps.notificationService;
    this.opinionService = deps.opinionService;
    this.meetingMinutesService = deps.meetingMinutesService;
    this.runStepService = deps.runStepService;
    this.providerRegistry = deps.providerRegistry;
    this.designSnapshotService = deps.designSnapshotService;
    this.interTurnDelayMs = deps.interTurnDelayMs ?? INTER_TURN_DELAY_MS;
    this.onFinalized = deps.onFinalized;
  }

  get isRunning(): boolean {
    return this.running;
  }

  // ── caller-facing surface (시그니처 보존) ───────────────────────────────

  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.terminalHandled = false;
    this.paused = false;
    this.turnIndexCounter = 0;

    const runStartedAt = Date.now();
    tryGetLogger()?.info({
      component: 'meeting',
      action: 'run-start',
      result: 'success',
      metadata: {
        meetingId: this.session.meetingId,
        channelId: this.session.channelId,
        projectId: this.session.projectId,
        topic: this.session.topic,
        participantCount: this.session.participants.length,
      },
    });

    try {
      this.consumePendingAdvisory();
      this.primeLabelCounters();

      // ── R12-C2 T16b: design 부서 분기 (gather phase 자체 우회) ────────
      // 디자인 부서는 step 1 가 풀세트의 'gather' (전 직원 의견 모으기) 가
      // 아니라 'assigning_designated_task' (지정 직원 1 명 발화) 로 시작 —
      // design-workflow 가 자체 안에서 7-step 통째 진행 + compose_minutes
      // 두 번 + (T16c land 시) snapshot + handoff 까지 다 처리.
      const channel = this.lookupChannel();
      if (channel && isDesignDepartmentRole(channel.role)) {
        const designResult = await this.runDesignWorkflow();
        if (this.session.aborted || designResult.outcome === 'aborted') {
          return await this.finalize('aborted');
        }
        return await this.finalize('accepted');
      }

      // ── phase 1: gather ─────────────────────────────────────────────
      await this.runGatherPhase();
      if (this.session.aborted) return await this.finalize('aborted');

      // ── phase 2: tally (no provider call) ────────────────────────────
      this.transitionToPhase('tally');

      // ── R12-C2 T15: idea-workflow 분기 (D-B-Light + USER_PICK) ──────
      if (channel?.role === 'idea') {
        const ideaResult = await this.runAwaitingUserPickPhase();
        if (this.session.aborted) return await this.finalize('aborted');
        if (ideaResult.outcome === 'aborted') {
          return await this.finalize('aborted');
        }
        // idea variant: quick_vote / free_discussion skip → 바로 compose_minutes
      } else {
        // ── phase 2.5: quick_vote (풀세트만) ───────────────────────────
        const quickResult = await this.runQuickVotePhase();
        if (this.session.aborted) return await this.finalize('aborted');

        // ── phase 3: free_discussion (선택, 풀세트만) ─────────────────
        if (quickResult.unresolved.length > 0) {
          await this.runFreeDiscussionPhase(quickResult.unresolved);
          if (this.session.aborted) return await this.finalize('aborted');
        }
      }

      // ── phase 5: compose_minutes (모든 부서 공통) ──────────────────
      await this.runComposeMinutesPhase();
      if (this.session.aborted) return await this.finalize('aborted');

      // ── phase 6: handoff ────────────────────────────────────────────
      await this.runHandoffPhase();

      await this.finalize('accepted');
    } catch (err) {
      console.error('[MeetingOrchestrator] run threw', errorPayload(err));
      try {
        await this.finalize('aborted');
      } catch (finalizeErr) {
        console.warn(
          '[MeetingOrchestrator] finalize during catch threw',
          errorPayload(finalizeErr),
        );
      }
    } finally {
      this.running = false;
      tryGetLogger()?.info({
        component: 'meeting',
        action: 'run-end',
        result: 'success',
        latencyMs: Date.now() - runStartedAt,
        metadata: {
          meetingId: this.session.meetingId,
          channelId: this.session.channelId,
          finalPhase: this.session.currentPhase,
        },
      });
    }
  }

  /** Stop the loop. Aborts in-flight turn + flips session.aborted = true.
   *  finalize('aborted') 는 phase loop 가 다음 가드에서 자연 진입한다. */
  stop(): void {
    if (!this.running) return;
    this.session.abort();
    this.turnExecutor.abort();
    // T15: idea-workflow awaiting_user_pick suspend 가 있으면 reject —
    // phase loop 이 IdeaUserPickPending.wait() 에서 풀려나 finalize 진입.
    if (this.ideaPending && this.ideaPending.isWaiting) {
      this.ideaPending.cancel({ kind: 'aborted' });
    }
  }

  /**
   * R12-C2 T15 — IPC `meeting:idea-finalize-selection` 핸들러가 외부에서
   * 호출. awaiting_user_pick phase 진입한 회의에서 사용자 commit 받아 두
   * 작업을 단일 동기 호출로 처리:
   *
   *   1. OpinionService.finalizeIdeaSelection 호출 — DB 영속
   *      (selected → agreed / unselected → excluded / userComment → user-raised)
   *   2. ideaPending.commit(input) — phase loop wait() 풀어 compose_minutes 진입
   *
   * (1) 이 throw 시 (2) 호출 X — pending 은 wait 상태 유지, UI 가 입력 보정
   * 후 재 commit 가능 (단, 본 sub-task 의 IdeaUserPickPending 은 single-use
   * 라 throw 후에는 별 instance 가 필요. 이 한정은 IPC 핸들러 측 zod schema
   * 검증으로 거의 차단됨 — 0+0 은 schema X / handler 측 추가 검증).
   *
   * 호출자 (IPC 핸들러) 가 IdeaPickValidationError / UnknownScreenIdError
   * 를 catch 해 IPC 응답의 reason 으로 매핑.
   */
  submitIdeaPick(
    input: IdeaFinalizeSelectionInput,
  ): IdeaFinalizeSelectionResult {
    if (!this.running) {
      throw new Error(
        `[MeetingOrchestrator] submitIdeaPick: meeting "${this.session.meetingId}" is not running`,
      );
    }
    if (!this.ideaPending || !this.ideaPending.isWaiting) {
      throw new Error(
        `[MeetingOrchestrator] submitIdeaPick: meeting "${this.session.meetingId}" ` +
          `is not in awaiting_user_pick phase (current=${this.session.currentPhase})`,
      );
    }
    // (1) OpinionService.finalizeIdeaSelection — throw 시 caller 가 catch.
    //     pending 은 wait 상태 유지 (single-use 한정 위반 가능성은 caller 책임).
    const result = this.opinionService.finalizeIdeaSelection(input);
    // (2) phase loop wait() 풀기. 이후 phase loop 가 compose_minutes 진입.
    this.ideaPending.commit(input);
    return result;
  }

  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    try {
      this.meetingService.updateState(
        this.session.meetingId,
        this.session.currentPhase,
        null,
      );
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] pause updateState failed',
        errorPayload(err),
      );
    }
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    try {
      this.meetingService.updateState(
        this.session.meetingId,
        this.session.currentPhase,
        null,
      );
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] resume updateState failed',
        errorPayload(err),
      );
    }
  }

  /**
   * D-A T2.5 dispatcher 가 호출 — user 메시지를 session 메시지 버퍼에 push.
   * 다음 turn 경계에서 prompt 안 자연 포함.
   */
  handleUserInterjection(message: ParticipantMessage): void {
    this.session.interruptWithUserMessage(message);
  }

  /**
   * D-A T5 auto-trigger 가 호출 — user 의 첫 메시지 (회의 spawn 트리거) 를
   * session 버퍼에 push. 첫 turn 진입 전.
   */
  injectInitialUserMessage(message: ParticipantMessage): void {
    this.session.appendUserMessage(message);
  }

  // ── R12-C2 T13: NextStep 분류 + RunStep 영속 + stream emit ───────────

  /**
   * 한 turn (직원 발화 또는 phase 경계 시스템 호출) 의 분류 + 영속 + 통지.
   * spec §11.18.8 + §11.19.
   *
   * 본 helper 는 *signal layer* — 결과 카드의 모달 등장 / 회의 자동 종결 등
   * behavior change 는 적용 안. orchestrator 의 phase loop 은 본 helper 호출
   * 후에도 평소대로 진행 (T28+ 가 결과 전파군 카드의 실제 후행 동작 wire).
   *
   * 실패는 *조용히 로깅만* — 분류 / 영속 / emit 어느 단계가 throw 해도 회의
   * 흐름은 멈추지 않는다 (RunStep 일지의 부재가 회의 진행을 막아서는 안 됨).
   */
  private classifyAndPersistTurn(args: {
    phase: MeetingPhase;
    /** 'employee' = 직원 발화, 'moderator' = 모더레이터 boundary, 'system' = 시스템 boundary. */
    actorKind: 'employee' | 'moderator' | 'system';
    /** `actorKind='employee'` 일 때만 채워야 함 — actorId 의 진실원천. */
    speaker: Participant | null;
    response:
      | Step1OpinionGatherSchemaType
      | Step25QuickVoteSchemaType
      | Step3FreeDiscussionSchemaType
      | null;
    context: NextStepClassifierContext;
    /** turn 시작 ~ 분류 호출 시점까지의 ms. 없으면 0. */
    durationMs: number;
  }): NextStepCard | null {
    const { phase, actorKind, speaker, response, context, durationMs } = args;

    let detail: ReturnType<typeof classifyNextStepWithDetails>;
    try {
      detail = classifyNextStepWithDetails({ phase, response, context });
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] classifyNextStepWithDetails threw',
        errorPayload(err),
      );
      return null;
    }

    const turnIndex = this.turnIndexCounter;
    this.turnIndexCounter += 1;

    const actorId = actorKind === 'employee' ? speaker?.id ?? null : null;

    const newRow: NewRunStep = {
      meetingId: this.session.meetingId,
      channelId: this.session.channelId,
      round: context.currentRound,
      turnIndex,
      actorKind,
      actorId,
      stepKind: 'next_step_classify',
      // truncate 금지 (spec §11.19.4) — caller 가 넘긴 response 통째 직렬화.
      inputJson: JSON.stringify({ phase, response, context }),
      outputJson: JSON.stringify({
        card: detail.card,
        natural: detail.natural,
        capOverride: detail.capOverride,
      }),
      nextStepCard: detail.card,
      sideEffectSummary: null,
      durationMs,
    };

    let persisted: ReturnType<RunStepService['appendOne']>;
    try {
      persisted = this.runStepService.appendOne(newRow);
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] runStepService.appendOne threw',
        errorPayload(err),
      );
      return detail.card;
    }

    try {
      this.streamBridge.emitNextStepClassified({
        meetingId: this.session.meetingId,
        channelId: this.session.channelId,
        runStepId: persisted.id,
        phase,
        round: context.currentRound,
        turnIndex,
        card: detail.card,
        capOverride: detail.capOverride,
      });
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] emitNextStepClassified threw',
        errorPayload(err),
      );
    }

    return detail.card;
  }

  /**
   * 자유 토론 시점의 트리 스냅샷에서 *전체 트리* 가 모두 resolved 인지 +
   * 어딘가 깊이 cap 도달했는지 산출. classifier context 의 핵심 입력.
   */
  private snapshotTreeFlags(): {
    allOpinionsResolved: boolean;
    depthCapReached: boolean;
  } {
    let allOpinionsResolved = false;
    let depthCapReached = false;
    try {
      const tally = this.opinionService.tally(this.session.meetingId);
      // 빈 트리 = "없음" — resolved 도 unresolved 도 아님. classifier 룰 4 미발동.
      if (tally.tree.length > 0) {
        allOpinionsResolved = isAllResolved(tally.tree);
      }
      depthCapReached = collectDepthCapReached(tally.tree).length > 0;
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] snapshotTreeFlags tally threw',
        errorPayload(err),
      );
    }
    return { allOpinionsResolved, depthCapReached };
  }

  // ── phase 별 본체 ────────────────────────────────────────────────────

  private async runGatherPhase(): Promise<void> {
    this.transitionToPhase('gather');
    const responses: Array<{
      providerId: string;
      payload: import('../../../shared/meeting-flow-types').Step1OpinionGatherSchemaType;
    }> = [];
    const channel = this.lookupChannel();
    const maxRounds = resolveMaxRounds(channel);

    for (const speaker of this.session.aiParticipants) {
      if (this.session.aborted) return;
      await this.waitWhilePaused();
      const suggestedLabel = this.session.nextLabel(speaker.id);
      const turnStartedAt = Date.now();
      const turnResult = await this.turnExecutor.requestOpinionGather(speaker, {
        suggestedLabel,
      });
      const turnEndedAt = Date.now();
      if (turnResult.kind === 'ok') {
        responses.push({
          providerId: speaker.id,
          payload: turnResult.payload,
        });
        // R12-C2 T13 — 발화 직후 NextStep 분류 + RunStep 영속 + stream emit.
        // gather phase 트리는 본 발화가 막 들어가기 *전* 상태 (orchestrator 가
        // 모든 응답 모은 후 한 번에 opinionService.gather 호출). classifier 는
        // 빈/부분 트리 위에서 동작 — 룰 1 (additions) 미적용 phase 라 대부분
        // 'wait' 분류.
        this.classifyAndPersistTurn({
          phase: 'gather',
          actorKind: 'employee',
          speaker,
          response: turnResult.payload,
          context: {
            ...this.snapshotTreeFlags(),
            currentRound: 0,
            maxRounds,
            hasNextChain: false,
            minutesComposed: false,
          },
          durationMs: turnEndedAt - turnStartedAt,
        });
      }
      await this.delay(this.interTurnDelayMs);
    }

    try {
      this.opinionService.gather({
        meetingId: this.session.meetingId,
        channelId: this.session.channelId,
        round: 0,
        responses,
      });
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] opinionService.gather threw',
        errorPayload(err),
      );
    }
  }

  private async runQuickVotePhase(): Promise<OpinionQuickVoteResult> {
    this.transitionToPhase('quick_vote');
    const tally = this.opinionService.tally(this.session.meetingId);
    const opinionsMarkdown = renderOpinionsMarkdown(tally.tree);
    const channel = this.lookupChannel();
    const maxRounds = resolveMaxRounds(channel);

    const responses: Array<{
      providerId: string;
      payload: import('../../../shared/meeting-flow-types').Step25QuickVoteSchemaType;
    }> = [];

    for (const speaker of this.session.aiParticipants) {
      if (this.session.aborted) return emptyQuickVoteResult(this.session.meetingId);
      await this.waitWhilePaused();
      const suggestedLabel = this.session.nextLabel(speaker.id);
      const turnStartedAt = Date.now();
      const turnResult = await this.turnExecutor.requestQuickVote(speaker, {
        suggestedLabel,
        opinionsMarkdown,
      });
      const turnEndedAt = Date.now();
      if (turnResult.kind === 'ok') {
        responses.push({
          providerId: speaker.id,
          payload: turnResult.payload,
        });
        // R12-C2 T13 — quick_vote 직원 응답 직후 분류. 만장일치 / 분기 결정은
        // 모든 응답 모은 후 opinionService.quickVote 가 처리하므로, 본 발화
        // 시점의 classifier 컨텍스트는 *직전 트리* 기준. 대부분 'wait' 분류
        // (Rule 4 발동은 quickVote 결과 반영 후 free_discussion 진입 시점).
        this.classifyAndPersistTurn({
          phase: 'quick_vote',
          actorKind: 'employee',
          speaker,
          response: turnResult.payload,
          context: {
            ...this.snapshotTreeFlags(),
            currentRound: 1,
            maxRounds,
            hasNextChain: false,
            minutesComposed: false,
          },
          durationMs: turnEndedAt - turnStartedAt,
        });
      }
      await this.delay(this.interTurnDelayMs);
    }

    try {
      return this.opinionService.quickVote({
        meetingId: this.session.meetingId,
        round: 1,
        responses,
      });
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] opinionService.quickVote threw',
        errorPayload(err),
      );
      return emptyQuickVoteResult(this.session.meetingId);
    }
  }

  /**
   * 자유 토론 phase. unresolved 의견 1 개씩 처리. 각 의견에 대해 max_rounds
   * 라운드 cap 안에서 라운드 누적. 자식 의견 추가 시 unresolved 큐 뒤에 push
   * (다음 의견 진입 시 다룸).
   */
  private async runFreeDiscussionPhase(initialUnresolved: string[]): Promise<void> {
    this.transitionToPhase('free_discussion');

    const channel = this.lookupChannel();
    const maxRounds = resolveMaxRounds(channel);

    // 큐 — 처음 unresolved 가 head, 자유 토론 안 새로 등장한 자식 의견은 tail.
    const queue: string[] = [...initialUnresolved];
    let nextRound = 2; // step 1 = round 0, step 2.5 = round 1, step 3 시작 = round 2

    while (queue.length > 0) {
      if (this.session.aborted) return;
      const opinionId = queue.shift()!;

      // 매 의견 진입 시 tally 다시 — 직전 round 의 자식 추가 / status 갱신 반영.
      const tally = this.opinionService.tally(this.session.meetingId);
      const node = findNodeByUuid(tally.tree, opinionId);
      if (!node) {
        // 트리에 없는 UUID — 본 의견 이미 합의 / 제외 처리됨. skip.
        continue;
      }
      if (node.opinion.status !== 'pending') {
        // 다른 round 에서 합의/제외 처리된 의견. skip.
        continue;
      }

      this.session.setCurrentOpinionScreenId(node.screenId);
      this.session.resetRound();
      // 매 의견 진입 시 phase-changed 재방출 (round=0 + opinion screen id 갱신).
      this.emitPhaseChanged(this.session.currentPhase);

      let agreedThisOpinion = false;
      let opinionRound = 0;

      while (opinionRound < maxRounds) {
        if (this.session.aborted) return;
        opinionRound += 1;
        this.session.incrementRound();
        // round 변경에 맞춰 phase-changed 재방출.
        this.emitPhaseChanged(this.session.currentPhase);

        // round 진입 시점의 트리 (자식 의견 list 가 매 라운드 갱신).
        const roundTally = this.opinionService.tally(this.session.meetingId);
        const roundNode = findNodeByUuid(roundTally.tree, opinionId);
        if (!roundNode) break;

        const currentOpinionMarkdown = renderCurrentOpinionMarkdown(roundNode);
        const childrenMarkdown = renderChildrenMarkdown(roundNode);
        const depthCapReachedScreenIds = collectDepthCapReached(roundTally.tree);

        const responses: Array<{
          providerId: string;
          payload: import('../../../shared/meeting-flow-types').Step3FreeDiscussionSchemaType;
        }> = [];

        for (const speaker of this.session.aiParticipants) {
          if (this.session.aborted) return;
          await this.waitWhilePaused();
          const suggestedLabel = this.session.nextLabel(speaker.id);
          const turnStartedAt = Date.now();
          const turnResult = await this.turnExecutor.requestFreeDiscussion(
            speaker,
            {
              suggestedLabel,
              currentOpinionMarkdown,
              childrenMarkdown,
              depthCapReachedScreenIds,
            },
          );
          const turnEndedAt = Date.now();
          if (turnResult.kind === 'ok') {
            responses.push({
              providerId: speaker.id,
              payload: turnResult.payload,
            });
            // R12-C2 T13 — free_discussion 발화 직후 분류 + cap interlock 발동
            // 가능 위치 (§11.18.8d). additions 있고 cap 미도달이면 'continue';
            // additions 있어도 opinionRound >= maxRounds 면 interlock 으로 'end'.
            this.classifyAndPersistTurn({
              phase: 'free_discussion',
              actorKind: 'employee',
              speaker,
              response: turnResult.payload,
              context: {
                ...this.snapshotTreeFlags(),
                currentRound: opinionRound,
                maxRounds,
                hasNextChain: false,
                minutesComposed: false,
              },
              durationMs: turnEndedAt - turnStartedAt,
            });
          }
          await this.delay(this.interTurnDelayMs);
        }

        let result: ReturnType<OpinionService['freeDiscussionRound']>;
        try {
          result = this.opinionService.freeDiscussionRound({
            meetingId: this.session.meetingId,
            opinionId,
            round: nextRound,
            responses,
          });
        } catch (err) {
          // OpinionDepthCapError / UnknownScreenIdError / OpinionNotFoundError —
          // 본 의견의 라운드를 더 진행하지 않고 다음 의견으로. agreed 여부 미상.
          console.warn(
            '[MeetingOrchestrator] freeDiscussionRound threw',
            errorPayload(err),
          );
          break;
        }
        nextRound += 1;

        // 자식 의견 신규 추가 — 다음 진입 큐에 push.
        for (const child of result.additions) {
          queue.push(child.id);
        }

        if (result.agreed) {
          agreedThisOpinion = true;
          break;
        }
      }

      if (!agreedThisOpinion && opinionRound >= maxRounds) {
        // max_rounds 도달 — 사용자 호출. 본 sub-task 는 Notification 만, 실제
        // pause 흐름은 P6 R12-H 에서 본격. simple emit + system message.
        try {
          this.notifyMaxRoundsReached(node.screenId, maxRounds);
        } catch (err) {
          console.warn(
            '[MeetingOrchestrator] notifyMaxRoundsReached failed',
            errorPayload(err),
          );
        }
      }

      // 의견 1 개 종료 — opinion screen id 비움 (다음 의견 진입 시 재할당).
      this.session.setCurrentOpinionScreenId(null);
    }
  }

  /**
   * R12-C2 T15 — idea-workflow awaiting_user_pick phase 본체.
   *
   * 흐름:
   *   1. tally 결과로 IdeaPickSnapshot 생성 (root 카드만)
   *   2. transitionToPhase('awaiting_user_pick') — DB / stream 갱신
   *   3. emitIdeaPickSnapshot(snapshot) — UI 측 카드 list + 버튼 활성화
   *   4. IdeaUserPickPending 생성 + wait() — IPC 응답까지 정지
   *   5a. commit 응답 도착 → OpinionService.finalizeIdeaSelection 호출 +
   *       compose_minutes 진입 (caller 측)
   *   5b. abort (stop() 또는 cancel) → outcome='aborted' 반환
   *
   * IdeaPickValidationError (0+0 입력) 가 finalizeIdeaSelection 에서 throw
   * 시 caller (IPC 핸들러) 가 직접 받아 IPC 응답으로 반환. 본 메서드는 그
   * 경우 pending 을 다시 wait() — UI 가 추가 입력 후 재 commit. 단, 본
   * sub-task 는 single-use pending 이라 재시도 X — IPC 핸들러가 throw 후
   * 사용자가 UI 측에서 input 보정 후 재 commit. 즉 IPC 핸들러 측 검증만
   * 사실상 활용. 본 메서드는 한 번 commit 받으면 finalize 진행.
   */
  private async runAwaitingUserPickPhase(): Promise<IdeaWorkflowResult> {
    this.transitionToPhase('awaiting_user_pick');

    // tally 결과로 카드 list (root 만) snapshot 구성. gather schema 가 min(1)
    // 강제하므로 title/content/rationale 은 ≥ 1 char 보장 — 그래도 DB 가 nullable
    // 라 defensive coalesce.
    const tally = this.opinionService.tally(this.session.meetingId);
    const snapshot: IdeaPickSnapshot = {
      meetingId: this.session.meetingId,
      channelId: this.session.channelId,
      cards: tally.tree.map((node) => ({
        screenId: node.screenId,
        uuid: node.opinion.id,
        title: node.opinion.title ?? '',
        content: node.opinion.content ?? '',
        rationale: node.opinion.rationale ?? '',
        authorLabel: node.opinion.authorLabel,
        authorProviderId: node.opinion.authorProviderId,
      })),
    };
    try {
      this.streamBridge.emitIdeaPickSnapshot(snapshot);
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] emitIdeaPickSnapshot threw',
        errorPayload(err),
      );
    }

    // suspend until IPC commit / cancel. submitIdeaPick 가 OpinionService
    // 의 finalizeIdeaSelection 까지 동기 호출 후 commit — 본 wait() 가 풀린
    // 시점엔 이미 DB 가 갱신된 상태. phase loop 는 그저 다음 phase 로 진행.
    const pending = new IdeaUserPickPending();
    this.ideaPending = pending;
    try {
      await pending.wait();
    } catch (reason) {
      this.ideaPending = null;
      const abortReason =
        typeof reason === 'object' && reason !== null && 'kind' in reason
          ? (reason as IdeaUserPickAbortReason)
          : ({ kind: 'aborted' } as IdeaUserPickAbortReason);
      return {
        meetingId: this.session.meetingId,
        outcome: 'aborted',
        abortReason,
      };
    }
    this.ideaPending = null;

    return {
      meetingId: this.session.meetingId,
      outcome: 'committed',
    };
  }

  // ── R12-C2 T16b: design-workflow phase 메서드 ───────────────────────

  /**
   * 회의 참가 직원 list 를 ProviderRegistry 와 join 해서 capability 매칭에
   * 쓰일 후보 배열로 변환. design-workflow.resolveDesignatedWorker 의 입력.
   *
   * Provider 가 registry 에 없는 경우 (구성 시 삭제됨 etc.) 는 silent skip —
   * 직원 list 자체는 회의 시점에 이미 검증됨. roles=[] 인 직원도 그대로 포함
   * (resolveDesignatedWorker 가 capability 매칭 0 인 경우 throw).
   */
  private collectDesignedWorkerCandidates(): DesignatedWorkerCandidate[] {
    const candidates: DesignatedWorkerCandidate[] = [];
    for (const speaker of this.session.aiParticipants) {
      const provider = this.providerRegistry.get(speaker.id);
      if (!provider) continue;
      // T23 wiring: 부서장 핀 (T36) / drag_order (T37) UI 가 P7 phase 에 진입하므로
      // 본 시점에는 모든 후보에 빈 핀 + null dragOrder 전달 → resolver 가 step 4
      // (capability fallback) 만 동작. T36 / T37 land 시 caller 갱신만으로
      // 우선순위 발동.
      candidates.push({
        providerId: speaker.id,
        displayName: speaker.displayName,
        roles: provider.roles,
        isDepartmentHead: {},
        dragOrder: null,
      });
    }
    return candidates;
  }

  /**
   * 시스템→지정 직원 단일 turn 지시 phase. spec §5.2 / §11.18.9.
   *
   * 흐름:
   *   1. transitionToPhase('assigning_designated_task') + emit phase-changed
   *   2. resolveDesignatedWorker(candidates, capabilityForKind(kind))
   *      → 매칭 직원 0 명 → DesignatedWorkerNotFoundError 그대로 propagate
   *      (caller 의 design-workflow 가 outcome='aborted' / abortReason 매핑)
   *   3. emitDesignedTaskAssigned (UI 진행 표시)
   *   4. requestAssigningDesignatedTask 1차 → ok+opinions≥1 시 성공 path
   *      / ok+빈 opinions 시 또는 skipped 시 → 1 회 retry
   *      / 두 번째도 실패 시 → throw DesignatedTaskFailedError
   *   5. 성공 시 OpinionService.gather 1 건 호출 (root opinion 등록)
   *
   * 반환: 등록된 opinion uuid + content (caller 가 다음 step priorContent 로 활용).
   */
  private async runAssigningDesignatedTaskPhase(
    kind: DesignedTaskKind,
    meetingOrdinal: 1 | 2,
    priorContent: string,
  ): Promise<{ opinionUuid: string; content: string }> {
    this.transitionToPhase('assigning_designated_task');

    const capability = capabilityForKind(kind);
    const candidates = this.collectDesignedWorkerCandidates();
    // T23: resolveDesignatedWorker 가 ResolvedDesignatedWorker 반환 → candidate 언래핑.
    // source 필드 (department-head-pin / drag-order / capability-fallback) 는
    // 본 호출 경로에서 미사용 (T36 / T37 land 후 telemetry / UI 노출 시 활용 예정).
    const resolved = resolveDesignatedWorker(candidates, capability);
    const speaker = resolved.candidate;
    const speakerParticipant = this.session.aiParticipants.find(
      (p) => p.id === speaker.providerId,
    );
    if (!speakerParticipant) {
      // resolveDesignatedWorker 가 candidates 안에서 골랐고 candidates 자체는
      // session.aiParticipants 로부터 만들었으므로 방어 — 발생 시 fail-loud.
      throw new Error(
        `[MeetingOrchestrator] designated speaker '${speaker.providerId}' missing from session participants`,
      );
    }

    const suggestedLabel = this.session.nextLabel(speaker.providerId);

    try {
      this.streamBridge.emitDesignedTaskAssigned({
        meetingId: this.session.meetingId,
        channelId: this.session.channelId,
        taskKind: kind,
        meetingOrdinal,
        assignedProviderId: speaker.providerId,
        assignedAuthorLabel: suggestedLabel,
      });
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] emitDesignedTaskAssigned threw',
        errorPayload(err),
      );
    }

    const ctxBase: DesignedTaskContext = {
      kind,
      meetingOrdinal,
      priorContent,
      speakerDisplayName: speaker.displayName,
      suggestedLabel,
    };

    let lastCause: 'empty-opinions' | 'turn-skipped' = 'turn-skipped';
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (this.session.aborted) {
        throw new (await import('../workflows/design-workflow')).DesignatedTaskFailedError(
          kind,
          meetingOrdinal,
          'turn-skipped',
          `meeting aborted before designated-task attempt ${attempt}`,
        );
      }
      // attempt 2 는 같은 prompt 재호출 — turn-executor 자체 retry 와 별개
      // ("빈 opinions 응답" 은 schema 통과로 turn-executor 가 ok 반환하므로
      //  caller 측 retry 가 필요. spec §11.18.9c).
      const turnStartedAt = Date.now();
      const result = await this.turnExecutor.requestAssigningDesignatedTask(
        speakerParticipant,
        ctxBase,
      );
      const turnEndedAt = Date.now();

      if (result.kind === 'ok') {
        const extracted = extractDesignedTaskOpinion(result.payload);
        if (extracted !== null) {
          // 성공 — root opinion 1 건 등록.
          const channel = this.lookupChannel();
          const maxRounds = resolveMaxRounds(channel);
          const insertResult = this.opinionService.gather({
            meetingId: this.session.meetingId,
            channelId: this.session.channelId,
            round: 0,
            responses: [
              { providerId: speaker.providerId, payload: result.payload },
            ],
          });
          this.classifyAndPersistTurn({
            phase: 'assigning_designated_task',
            actorKind: 'employee',
            speaker: speakerParticipant,
            response: result.payload,
            context: {
              ...this.snapshotTreeFlags(),
              currentRound: 0,
              maxRounds,
              hasNextChain: false,
              minutesComposed: false,
            },
            durationMs: turnEndedAt - turnStartedAt,
          });
          // OpinionService.gather 가 입력 순서대로 row 를 push — 단일 응답이라
          // 첫 inserted row 가 본 turn 의 root opinion.
          const inserted = insertResult.inserted[0];
          if (!inserted) {
            // gather 가 빈 inserted 반환 = service 측 invariant 위반 — fail-loud.
            throw new Error(
              `[MeetingOrchestrator] OpinionService.gather returned empty inserted for designated-task '${kind}'`,
            );
          }
          return {
            opinionUuid: inserted.id,
            content: inserted.content ?? extracted.content,
          };
        }
        // ok + 빈 opinions → 다음 attempt.
        lastCause = 'empty-opinions';
        continue;
      }
      // skipped (provider-error / invalid-schema / aborted / work-status-gate).
      lastCause = 'turn-skipped';
    }

    // 2 attempts 모두 실패 — caller 가 DesignWorkflowAbortReason 으로 매핑.
    const designWorkflowMod = await import('../workflows/design-workflow');
    throw new designWorkflowMod.DesignatedTaskFailedError(
      kind,
      meetingOrdinal,
      lastCause,
      `designated-task '${kind}' failed twice (cause=${lastCause}, capability=${capability})`,
    );
  }

  /**
   * Playwright PNG 생성 phase placeholder. T16c sub-task 가 본체 wire — 본
   * R12-C2 T16c land — placeholder throw 가 실제 본체로 교체됨.
   *
   * 흐름:
   *   1. transitionToPhase('generating_snapshot') — UI 상태 갱신
   *   2. designSnapshotService.captureDesignSnapshot — desktop + mobile PNG
   *      atomic 저장 (PathGuard 봉인 ArenaRoot 안)
   *   3. streamBridge.emitDesignSnapshotReady — DesignPreview UI 활성화 신호
   *   4. DesignSnapshotPaths 반환 (caller 가 outcome.snapshot 에 담음)
   *
   * 실패 분기 (caller catch 후 abortReason='snapshot_failed' 매핑):
   *   - 빈 content / 봉인 위반 / capture fn throw / 빈 PNG buffer
   *
   * 회의록 자체는 이미 작성된 상태에서 snapshot 만 실패하므로 — 회의록은
   * 디스크에 남고 PNG 만 X. spec §11.18.9d "회의록 자체는 이미 작성된 상태"
   * 부합.
   */
  private async runGeneratingSnapshotPhase(args: {
    sourceOpinionUuid: string;
    htmlContent: string;
  }): Promise<DesignSnapshotPaths> {
    this.transitionToPhase('generating_snapshot');
    const result = await this.designSnapshotService.captureDesignSnapshot({
      htmlContent: args.htmlContent,
      meetingId: this.session.meetingId,
      sourceOpinionUuid: args.sourceOpinionUuid,
    });
    try {
      this.streamBridge.emitDesignSnapshotReady({
        meetingId: this.session.meetingId,
        channelId: this.session.channelId,
        desktopPath: result.desktopPath,
        mobilePath: result.mobilePath,
        generatedAt: result.generatedAt,
        sourceOpinionUuid: result.sourceOpinionUuid,
      });
    } catch (err) {
      // stream emit 실패는 disk PNG 자체에 영향 X — UI 상태 동기화만 누락.
      // 다음 회의 / 앱 재시작 시 caller (renderer) 가 재구독하면 paths 는 그대로.
      console.warn(
        '[MeetingOrchestrator] design-snapshot stream emit threw',
        errorPayload(err),
      );
    }
    return result;
  }

  /**
   * R12-C2 T16b — 디자인 부서 7 단계 통합. spec §5.2.
   *
   * 단일 회의 lifetime 안에서 풀세트 phase loop (quick_vote → free_discussion
   * → compose_minutes) 를 *두 번* 거치며, 그 사이/후로 시스템→지정 직원 단일
   * turn (assigning_designated_task) 을 3 회 / Playwright snapshot 1 회 끼워넣음.
   *
   *   step 1.   assigning_designated_task wireframe_drafting (UX 직원 → 회의 #1 시드)
   *   step 2-4. 회의 #1 (quick_vote → free_discussion → compose_minutes #1)
   *   step 5.   assigning_designated_task wireframe_revision (UI 직원, prior=회의록 #1)
   *   step 6.   assigning_designated_task design_implementation (UI 직원, prior=수정 와이어프레임 → 회의 #2 시드)
   *   step 7a.  회의 #2 (quick_vote → free_discussion → compose_minutes #2)
   *   step 7b.  generating_snapshot (Playwright PNG, T16c 본체 land 전 placeholder throw)
   *   step 7c.  handoff (풀세트와 동일 — runHandoffPhase 재사용)
   *
   * 회의록은 ordinal 별 분리 (`minutes-1.md` + `minutes-2.md`) — 두 회의의
   * 의사결정 분리 audit 용. round 카운터는 회의 ordinal 별 reset (
   * compose_minutes #1 직후 session.resetForNextDesignMeeting 호출).
   *
   * 실패 분기:
   *   - DesignatedWorkerNotFoundError (capability 직원 0 명) → abortReason
   *     {kind:'designated_task_failed', taskKind, meetingOrdinal, message}
   *   - DesignatedTaskFailedError (1 회 재요청 + 2 회 실패) → 같은 abortReason
   *   - generating_snapshot throw → abortReason {kind:'snapshot_failed', message}
   *   - session.aborted → abortReason {kind:'aborted'}
   */
  private async runDesignWorkflow(): Promise<DesignWorkflowResult> {
    const meetingId = this.session.meetingId;
    try {
      // step 1 — 와이어프레임 작성 (UX 직원).
      const channel = this.lookupChannel();
      const planningHandoff =
        channel?.purpose && channel.purpose.length > 0
          ? channel.purpose
          : this.session.topic;
      const step1 = await this.runAssigningDesignatedTaskPhase(
        'wireframe_drafting',
        1,
        planningHandoff,
      );
      if (this.session.aborted) {
        return { meetingId, outcome: 'aborted', abortReason: { kind: 'aborted' } };
      }

      // step 2-4 — 회의 #1 (와이어프레임).
      const quickResult1 = await this.runQuickVotePhase();
      if (this.session.aborted) {
        return { meetingId, outcome: 'aborted', abortReason: { kind: 'aborted' } };
      }
      if (quickResult1.unresolved.length > 0) {
        await this.runFreeDiscussionPhase(quickResult1.unresolved);
        if (this.session.aborted) {
          return { meetingId, outcome: 'aborted', abortReason: { kind: 'aborted' } };
        }
      }
      await this.runComposeMinutesPhase({ ordinal: 1 });
      if (this.session.aborted) {
        return { meetingId, outcome: 'aborted', abortReason: { kind: 'aborted' } };
      }
      const minutes1 = await this.readMinutesBody(1);

      // 회의 #1 종결 — 회의 #2 진입 전 round 카운터 reset (회의 ordinal 별
      // 1 부터 다시 카운트). 발화 ID 카운터는 reset X — 직원 식별 일관성 유지.
      this.session.resetRound();

      // step 5 — 와이어프레임 수정 (UI 직원).
      void step1;
      const step5 = await this.runAssigningDesignatedTaskPhase(
        'wireframe_revision',
        1,
        minutes1,
      );
      if (this.session.aborted) {
        return { meetingId, outcome: 'aborted', abortReason: { kind: 'aborted' } };
      }

      // step 6 — HTML/CSS 작성 (UI 직원, 회의 #2 시드).
      await this.runAssigningDesignatedTaskPhase(
        'design_implementation',
        2,
        step5.content,
      );
      if (this.session.aborted) {
        return { meetingId, outcome: 'aborted', abortReason: { kind: 'aborted' } };
      }

      // step 7a — 회의 #2 (디자인).
      const quickResult2 = await this.runQuickVotePhase();
      if (this.session.aborted) {
        return { meetingId, outcome: 'aborted', abortReason: { kind: 'aborted' } };
      }
      if (quickResult2.unresolved.length > 0) {
        await this.runFreeDiscussionPhase(quickResult2.unresolved);
        if (this.session.aborted) {
          return { meetingId, outcome: 'aborted', abortReason: { kind: 'aborted' } };
        }
      }
      await this.runComposeMinutesPhase({ ordinal: 2 });
      if (this.session.aborted) {
        return { meetingId, outcome: 'aborted', abortReason: { kind: 'aborted' } };
      }

      // step 7b — Playwright snapshot (T16c land). 회의 #2 의 마지막 root opinion
      // (= step 6 design_implementation 응답) 을 desktop + mobile PNG 로 렌더 +
      // PathGuard 봉인 안 atomic 저장. 실패 시 통합 catch 가 abortReason='snapshot_failed'.
      const designImplOpinion = await this.findLatestDesignImplementationOpinion();
      const snapshot = await this.runGeneratingSnapshotPhase({
        sourceOpinionUuid: designImplOpinion.id,
        htmlContent: designImplOpinion.content,
      });
      if (this.session.aborted) {
        return { meetingId, outcome: 'aborted', abortReason: { kind: 'aborted' } };
      }

      // step 7c — handoff (풀세트와 동일 — runHandoffPhase 재사용).
      await this.runHandoffPhase();

      return { meetingId, outcome: 'committed', snapshot };
    } catch (err) {
      if (err instanceof DesignatedWorkerNotFoundError) {
        return {
          meetingId,
          outcome: 'aborted',
          abortReason: {
            kind: 'designated_task_failed',
            taskKind: 'wireframe_drafting',
            meetingOrdinal: 1,
            message: err.message,
          },
        };
      }
      const designWorkflowMod = await import('../workflows/design-workflow');
      if (err instanceof designWorkflowMod.DesignatedTaskFailedError) {
        return {
          meetingId,
          outcome: 'aborted',
          abortReason: {
            kind: 'designated_task_failed',
            taskKind: err.taskKind,
            meetingOrdinal: err.meetingOrdinal,
            message: err.message,
          },
        };
      }
      // T16c land — runGeneratingSnapshotPhase 본체에서 던지는 분기들:
      //   - SnapshotCaptureError (capture fn / 빈 PNG buffer)
      //   - SnapshotPathOutsideConsensusError (PathGuard 봉인 위반)
      //   - findLatestDesignImplementationOpinion 의 빈 content / no root throw
      // 이 외 예기치 않은 throw 도 같은 분기 — 회의록은 이미 디스크에 land 상태
      // (compose_minutes #2 직후) 라 회의록만 남고 PNG 만 X. spec §11.18.9d 부합.
      return {
        meetingId,
        outcome: 'aborted',
        abortReason: {
          kind: 'snapshot_failed',
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  /**
   * 회의 #N (ordinal) 의 회의록 본문을 디스크에서 읽어 step 5 priorContent
   * 로 활용. compose 결과는 caller 에 반환되지만 별도 in-memory cache 없이
   * 재읽기 — 회의록 service 단일 진실 원천 유지.
   */
  private async readMinutesBody(ordinal: 1 | 2): Promise<string> {
    return this.meetingMinutesService.readMinutesBody({
      meetingId: this.session.meetingId,
      ordinal,
    });
  }

  /**
   * 회의 #2 시드 = `design_implementation` root opinion. opinion 트리에서
   * 가장 마지막 root (kind='root', author=design.ui 직원) 의 uuid + content
   * 를 반환. runDesignWorkflow 가 step 6 직후 step 7a 회의 #2 가 끝난 후
   * snapshot 호출에 사용.
   *
   * 트리 구조: design 부서 회의는 root 3 개 누적 — step 1 (drafting), step 5
   * (revision), step 6 (implementation). 마지막 root (created_at 기준) 를
   * implementation 으로 가정 (design-workflow 진행 순서).
   *
   * content 가 NULL / 빈 문자열이면 throw — generating_snapshot 입력 자체가
   * 없으므로 snapshot 시도 의미 없음. caller (runDesignWorkflow) 의 catch 가
   * snapshot_failed 로 매핑한다.
   */
  private async findLatestDesignImplementationOpinion(): Promise<{
    id: string;
    content: string;
  }> {
    const tally = this.opinionService.tally(this.session.meetingId);
    if (tally.tree.length === 0) {
      throw new Error(
        `[MeetingOrchestrator] design-workflow snapshot — no root opinion found for meeting ${this.session.meetingId}`,
      );
    }
    // tally tree 가 created_at 오름차순으로 정렬되어 있다고 가정 — 마지막 root 가 step 6.
    const last = tally.tree[tally.tree.length - 1]!;
    const content = last.opinion.content ?? '';
    if (content.trim().length === 0) {
      throw new Error(
        `[MeetingOrchestrator] design-workflow snapshot — design_implementation opinion '${last.opinion.id}' has empty content`,
      );
    }
    return { id: last.opinion.id, content };
  }

  private async runComposeMinutesPhase(options?: {
    ordinal?: 1 | 2;
  }): Promise<void> {
    this.transitionToPhase('compose_minutes');
    const channel = this.lookupChannel();
    const maxRounds = resolveMaxRounds(channel);
    const composeStartedAt = Date.now();
    let composed = false;
    try {
      const result = await this.meetingMinutesService.compose({
        meetingId: this.session.meetingId,
        ordinal: options?.ordinal,
      });
      composed = true;
      // 채팅창 회의록 카드 — meta.minutesPath / meta.minutesSource 로 renderer 가
      // 카드 컴포넌트 (T12) 와 매핑. 본 sub-task 는 system message 1 건.
      try {
        this.messageService.append({
          channelId: this.session.channelId,
          meetingId: this.session.meetingId,
          authorId: 'system',
          authorKind: 'system',
          role: 'system',
          content: result.body,
          meta: {
            minutesPath: result.minutesPath,
            minutesSource: result.source,
            minutesProviderId: result.providerId,
          },
        });
      } catch (err) {
        console.warn(
          '[MeetingOrchestrator] minutes append failed',
          errorPayload(err),
        );
      }
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] minutes compose threw',
        errorPayload(err),
      );
    }

    // R12-C2 T13 — minutes 작성 직후 boundary 분류. minutesComposed=true 로
    // §11.18.8b 룰 5 / 6 분기 (chain 정의 → handoff / 미정의 → end). 본 sub-task
    // 의 hasNextChain 은 항상 false (chain DB 컬럼 미land — T28+ 작업).
    if (composed) {
      const composeEndedAt = Date.now();
      this.classifyAndPersistTurn({
        phase: 'compose_minutes',
        actorKind: 'moderator',
        speaker: null,
        response: null,
        context: {
          ...this.snapshotTreeFlags(),
          currentRound: 0,
          maxRounds,
          hasNextChain: false,
          minutesComposed: true,
        },
        durationMs: composeEndedAt - composeStartedAt,
      });
    }
  }

  private async runHandoffPhase(): Promise<void> {
    this.transitionToPhase('handoff');
    const channel = this.lookupChannel();
    const handoffMode = channel?.handoffMode ?? 'check';
    if (handoffMode === 'check') {
      try {
        const title = resolveNotificationLabel('meetingMinutes.handoffTitle');
        const body = resolveNotificationLabel('meetingMinutes.handoffBody', {
          topic: this.session.topic,
        });
        this.notificationService.show({
          kind: 'meeting_state',
          title,
          body,
          channelId: this.session.channelId,
        });
      } catch (err) {
        console.warn(
          '[MeetingOrchestrator] handoff notify threw',
          errorPayload(err),
        );
      }
      try {
        this.messageService.append({
          channelId: this.session.channelId,
          meetingId: this.session.meetingId,
          authorId: 'system',
          authorKind: 'system',
          role: 'system',
          content: '회의가 끝났습니다 — 다음 부서 인계는 사용자 승인 대기 중입니다.',
          meta: { handoff: 'check' },
        });
      } catch (err) {
        console.warn(
          '[MeetingOrchestrator] handoff system message append failed',
          errorPayload(err),
        );
      }
    }
    // 'auto' 는 P6 R12-H 책임 — 본 sub-task no-op.
  }

  // ── helpers ──────────────────────────────────────────────────────────

  /**
   * 회의 boot 직후 ProjectService.consumePendingAdvisory slot 을 1 회 읽어
   * system message 로 prepend. 옛 R11-Task10 invariant 그대로.
   */
  private consumePendingAdvisory(): void {
    let advisory: string | null = null;
    try {
      advisory = this.projectService.consumePendingAdvisory(
        this.session.projectId,
      );
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] consumePendingAdvisory failed',
        errorPayload(err),
      );
      return;
    }
    if (advisory === null || advisory.length === 0) return;
    const prefix = resolveNotificationLabel(
      'approvalSystemMessage.modeTransitionAdvisoryPrefix',
    );
    const content = `${prefix} ${advisory}`;
    try {
      this.messageService.append({
        channelId: this.session.channelId,
        meetingId: this.session.meetingId,
        authorId: 'system',
        authorKind: 'system',
        role: 'system',
        content,
        meta: null,
      });
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] advisory append failed',
        errorPayload(err),
      );
    }
  }

  /**
   * 회의 재시작 / 재진입 시 (앱 재시작 후) DB 의 nextLabelHint 결과로
   * MeetingSession 의 in-memory 카운터를 prime. 첫 회의에서는 hint = 1 이라
   * 카운터도 0 → 1 로 prime — nextLabel 첫 호출이 `_1` 발급.
   */
  private primeLabelCounters(): void {
    for (const p of this.session.aiParticipants) {
      try {
        const hint = this.opinionService.nextLabelHint(
          this.session.meetingId,
          p.id,
        );
        this.session.primeLabelCounter(p.id, hint);
      } catch (err) {
        console.warn(
          '[MeetingOrchestrator] primeLabelCounter failed',
          errorPayload(err),
        );
      }
    }
  }

  private transitionToPhase(phase: MeetingPhase): void {
    this.session.setPhase(phase);
    this.emitPhaseChanged(phase);
    try {
      this.meetingService.updateState(this.session.meetingId, phase, null);
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] meetingService.updateState failed',
        errorPayload(err),
      );
    }
  }

  private emitPhaseChanged(phase: MeetingPhase): void {
    const prev = this.session.currentPhase === phase ? null : null;
    // Note: session.currentPhase 가 이미 갱신된 상태에서 본 method 를 부른다 —
    // prev 추적은 별도 필드가 필요하나 본 sub-task 는 단순화하여 prev=null
    // 사용 (renderer SsmBox 가 prev 정보 활용 X — phase 자체만 사용).
    this.streamBridge.emitMeetingPhaseChanged({
      meetingId: this.session.meetingId,
      channelId: this.session.channelId,
      prevPhase: prev,
      phase,
      round: this.session.currentRound,
      currentOpinionScreenId: this.session.currentOpinionScreenId,
    });
    // 옛 신호도 *값만* 새 phase 문자열로 dispatch — schema 호환 (사용자 결정 ①).
    this.streamBridge.emitMeetingStateChanged({
      meetingId: this.session.meetingId,
      channelId: this.session.channelId,
      state: phase,
    });
  }

  private async finalize(
    outcome: 'accepted' | 'rejected' | 'aborted',
  ): Promise<void> {
    if (this.terminalHandled) return;
    this.terminalHandled = true;

    const finalPhase: MeetingPhase = outcome === 'aborted' ? 'aborted' : 'done';
    this.session.setPhase(finalPhase);
    this.emitPhaseChanged(finalPhase);

    try {
      this.meetingService.finish(this.session.meetingId, outcome, null);
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] meeting finish failed',
        errorPayload(err),
      );
    }

    // R9-Task7: fire the post-finalise hook — fire-and-forget.
    const hook = this.onFinalized;
    if (hook) {
      const info = {
        meetingId: this.session.meetingId,
        projectId: this.session.projectId,
        channelId: this.session.channelId,
        outcome,
      };
      try {
        void Promise.resolve(hook(info)).catch((err) => {
          console.warn(
            '[MeetingOrchestrator] onFinalized callback threw',
            errorPayload(err),
          );
        });
      } catch (err) {
        console.warn(
          '[MeetingOrchestrator] onFinalized sync threw',
          errorPayload(err),
        );
      }
    }
  }

  private notifyMaxRoundsReached(screenId: string, maxRounds: number): void {
    try {
      const title = resolveNotificationLabel('meetingMinutes.maxRoundsTitle');
      const body = resolveNotificationLabel('meetingMinutes.maxRoundsBody', {
        screenId,
        maxRounds: String(maxRounds),
      });
      this.notificationService.show({
        kind: 'meeting_state',
        title,
        body,
        channelId: this.session.channelId,
      });
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] maxRounds notify threw',
        errorPayload(err),
      );
    }
    try {
      this.messageService.append({
        channelId: this.session.channelId,
        meetingId: this.session.meetingId,
        authorId: 'system',
        authorKind: 'system',
        role: 'system',
        content: `의견 ${screenId} 가 ${maxRounds} 라운드 동안 합의에 이르지 못해 사용자 호출 — 회의를 일시 정지합니다.`,
        meta: { maxRoundsReached: true, screenId, maxRounds },
      });
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] maxRounds system message append failed',
        errorPayload(err),
      );
    }
  }

  private lookupChannel(): Channel | null {
    try {
      return this.channelService.get(this.session.channelId) ?? null;
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] channelService.get failed',
        errorPayload(err),
      );
      return null;
    }
  }

  private async waitWhilePaused(): Promise<void> {
    while (this.paused && !this.session.aborted) {
      await this.delay(500);
    }
  }

  private delay(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}

// ── 모듈 helpers ──────────────────────────────────────────────────────

/** channels.max_rounds = NULL → Infinity, 정수 → 그 값. spec §11.14 결정. */
function resolveMaxRounds(channel: Channel | null): number {
  const raw = channel?.maxRounds;
  if (raw === null || raw === undefined) return Number.POSITIVE_INFINITY;
  if (raw <= 0) return Number.POSITIVE_INFINITY;
  return raw;
}

function emptyQuickVoteResult(meetingId: string): OpinionQuickVoteResult {
  return {
    meetingId,
    agreed: [],
    unresolved: [],
    votesInserted: 0,
  };
}

function errorPayload(err: unknown): { name?: string; message: string } {
  if (err instanceof Error) {
    return { name: err.name, message: err.message };
  }
  return { message: String(err) };
}

// 컴파일러가 deps 파일들이 unused import 가 없도록 — Opinion 도메인 타입을
// 본 모듈이 사용한다고 명시.
type _OpinionUsed = Opinion;
type _TallyUsed = OpinionTallyResult;
type _CircuitBreakerUsed = CircuitBreaker;
export type {
  _OpinionUsed as _OpinionTypeUsed,
  _TallyUsed as _TallyTypeUsed,
  _CircuitBreakerUsed as _CircuitBreakerTypeUsed,
};
