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

import { randomUUID } from 'node:crypto';
import type { Channel } from '../../../shared/channel-types';
import {
  isDesignDepartmentRole,
  type ChannelRole,
} from '../../../shared/channel-role-types';
import {
  resolveHandoffChain,
  type ChainResolverOutcome,
  type ResolvedReceiverChannel,
  type WorkflowChainKind,
} from '../../handoff/handoff-chain-resolver';
import type { HandoffPendingState } from '../../handoff/handoff-pending-state';
import type { HandoffDispatchService } from '../../handoff/handoff-dispatch-service';
import {
  serializeHandoffPackage,
  type HandoffPackage,
} from '../../../shared/schema/handoff-package';
import type {
  MeetingPhase,
  Step1OpinionGatherSchemaType,
  Step25QuickVoteSchemaType,
  Step3FreeDiscussionSchemaType,
} from '../../../shared/meeting-flow-types';
import { USER_AUTHOR_LITERAL } from '../../../shared/message-types';
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
import type { MeetingMinutesComposeResult } from '../../../shared/meeting-minutes-types';
import type { MeetingReviewGateService } from '../../meeting-review/meeting-review-gate-service';
import type { DesignCheckpointService } from '../../design-checkpoints/design-checkpoint-service';
import type { PlanningDesignCheckService } from '../../planning-design-check/planning-design-check-service';
import type {
  PlanningDesignCheckPayloadContext,
  PlanningDesignCheckReceiverContext,
  PlanningDesignCheckRecord,
} from '../../../shared/planning-design-check-types';
import type { RunStepService } from '../run-step/run-step-service';
import { OPINION_DEPTH_CAP } from '../screen-id';
import { tryGetLogger } from '../../log/logger-accessor';
import type { MeetingSession } from './meeting-session';
import type { ParticipantMessage } from '../../engine/history';
import type { MeetingTurnExecutor } from './meeting-turn-executor';
import type { providerRegistry } from '../../providers/registry';
import { resolveNotificationLabel } from '../../notifications/notification-labels';
import {
  INTER_TURN_DELAY_MS,
  MEETING_PAUSE_POLL_INTERVAL_MS,
} from '../../../shared/timeouts';
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
import {
  buildDesignReturnHandoffPackage,
  buildImplementationHandoffPackage,
  normalizePlanningDesignCheckResult,
} from '../workflows/planning-design-check-workflow';
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
  IdeaRequestMoreResult,
} from '../../../shared/opinion-types';

/** Alias for the registry's instance type — same pattern as turn-executor. */
type ProviderRegistry = typeof providerRegistry;

type HandoffPhaseResult =
  | { kind: 'dispatched'; dispatchRowId: string }
  | { kind: 'pending' }
  | { kind: 'fallback' }
  | { kind: 'review_gate_pending' };

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
  /**
   * R12-C2 T28 — 'check' 분기 사용자 결재 모달이 [확인] / [취소] 결정 *전* 까지
   * 합성된 HandoffPackage 를 잠시 보관하는 회의 단위 휘발성 boundary. orchestrator
   * 가 chain resolver 결과 + receiver channel.handoff_mode='check' 분기에서 put,
   * IPC handler (handoff:approve / cancel) 가 take.
   */
  handoffPendingState: HandoffPendingState;
  /**
   * R12-C2 T28 — handoff_dispatch row 영속 service (T27 land). 'auto' 분기에서
   * orchestrator 가 즉시 호출. 'check' 분기 [확인] 후는 IPC handler 가 호출 — 본
   * deps 는 'auto' path 전용.
   */
  handoffDispatchService: HandoffDispatchService;
  /**
   * R12-C2 planning minutes review gate. 기획 회의록은 handoff 직전에 사용자
   * 검토 화면을 통과해야 하므로, compose_minutes 직후 pending row 를 남긴다.
   * 테스트/구형 wiring 보호를 위해 optional — 없으면 기존 minutes card path.
   */
  meetingReviewGateService?: MeetingReviewGateService;
  /**
   * R12-C2 3차 — 디자인 와이어프레임 가벼운 확인. 공식 승인 게이트가 아니므로
   * 회의 흐름을 대기시키지 않고, 회의 #1 산출물 안내 카드와 사용자 note 만
   * 저장한다.
   */
  designCheckpointService?: DesignCheckpointService;
  planningDesignCheckService?: PlanningDesignCheckService;
  /**
   * R12-C2 T28 — chain resolver 의 받는 채널 lookup helper. role + projectId 로
   * 단일 채널 식별 + handoff_mode + designated worker provider 를 caller (factory)
   * 가 channelService 통해 wire. role 별 multiple 채널 (R13+) 는 R12-C2 가정 X.
   * null 반환 = 받는 부서 채널 0 건 (chain unhandled 또는 invariant 위반 — chain
   * resolver 가 분기).
   */
  resolveReceiverChannel: (
    projectId: string,
    role: ChannelRole,
  ) => ResolvedReceiverChannel | null;
  /**
   * R12-C2 T28 — chain resolver 가 합성하는 mission card 의 UUID 생성 factory.
   * 보통 `crypto.randomUUID`, 테스트는 fixed UUID stub.
   */
  missionCardIdFactory: () => string;
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

/**
 * R12-C2 T28 — channel.role → chain resolver workflowKind 매핑. design.* 4 종은
 * 'design' 으로 압축 (chain resolver 입력 단위), 'idea' / 'planning' / 'implement' /
 * 'audit' / 'review' 는 1:1 매핑, system 채널 (role=null) 은 'general'.
 *
 * 매핑 안 되는 role (이론적으로 null + system) 은 null 반환 — caller (orchestrator)
 * 가 chain resolver 호출 자체 skip.
 */
function mapChannelRoleToWorkflowKind(
  channel: Channel,
): WorkflowChainKind | null {
  if (channel.role === null) return 'general';
  switch (channel.role) {
    case 'idea':
      return 'idea';
    case 'planning':
      return 'planning';
    case 'implement':
      return 'implement';
    case 'audit':
      return 'audit';
    case 'review':
      return 'review';
    case 'general':
      return 'general';
    case 'design.ui':
    case 'design.ux':
    case 'design.character':
    case 'design.background':
      return 'design';
    default: {
      // exhaustive 가드 — 새 role 추가 시 case 누락 검출.
      const _exhaustive: never = channel.role;
      void _exhaustive;
      return null;
    }
  }
}

/**
 * R12-C2 T28 — opinion tree 통째 flat list 변환. audit chain 의 verdict 분류 +
 * problem 추출 입력으로 사용. depth 무제한 (현재 cap 3) recursive walk.
 */
function collectOpinionsFromTree(tree: OpinionTreeNode[]): Opinion[] {
  const result: Opinion[] = [];
  const walk = (node: OpinionTreeNode): void => {
    result.push(node.opinion);
    for (const child of node.children) walk(child);
  };
  for (const root of tree) walk(root);
  return result;
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
  private readonly handoffPendingState: HandoffPendingState;
  private readonly handoffDispatchService: HandoffDispatchService;
  private readonly meetingReviewGateService: MeetingReviewGateService | null;
  private readonly designCheckpointService: DesignCheckpointService | null;
  private readonly planningDesignCheckService: PlanningDesignCheckService | null;
  private readonly resolveReceiverChannel: MeetingOrchestratorDeps['resolveReceiverChannel'];
  private readonly missionCardIdFactory: MeetingOrchestratorDeps['missionCardIdFactory'];
  private readonly interTurnDelayMs: number;
  private readonly onFinalized?: MeetingOrchestratorDeps['onFinalized'];

  /**
   * R12-C2 T28 — runComposeMinutesPhase 직후 회의의 chain target 을 1 회 resolve
   * 한 결과 cache. classifier hasNextChain 컨텍스트 + runHandoffPhase 분기에서
   * 동일 outcome 재사용. null = 아직 미산출 (compose_minutes 진입 전 또는
   * 회의 abort).
   */
  private resolvedChain: ChainResolverOutcome | null = null;
  /**
   * R12-C2 T28 — 회의록 markdown 파일 절대 경로 cache. compose_minutes 단계에서
   * meetingMinutesService 가 path 반환 시점에 set, runHandoffPhase / stream emit
   * 시 재사용. null = 회의록 미작성 (fallback 도 실패).
   */
  private cachedMinutesPath: string | null = null;
  private pendingReviewGateId: string | null = null;

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
  private nextIdeaGatherContextMarkdown: string | null = null;

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
    this.handoffPendingState = deps.handoffPendingState;
    this.handoffDispatchService = deps.handoffDispatchService;
    this.meetingReviewGateService = deps.meetingReviewGateService ?? null;
    this.designCheckpointService = deps.designCheckpointService ?? null;
    this.planningDesignCheckService = deps.planningDesignCheckService ?? null;
    this.resolveReceiverChannel = deps.resolveReceiverChannel;
    this.missionCardIdFactory = deps.missionCardIdFactory;
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
    this.resolvedChain = null;
    this.cachedMinutesPath = null;
    this.pendingReviewGateId = null;

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
        let ideaResult = await this.runAwaitingUserPickPhase();
        while (ideaResult.outcome === 'request_more') {
          if (this.session.aborted) return await this.finalize('aborted');
          await this.runGatherPhase();
          if (this.session.aborted) return await this.finalize('aborted');
          this.transitionToPhase('tally');
          ideaResult = await this.runAwaitingUserPickPhase();
        }
        if (this.session.aborted || ideaResult.outcome === 'aborted') {
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

  /**
   * R12-C2 card UX — 사용자가 선택한 아이디어를 유지한 채 추가 아이디어를
   * 더 모으도록 요청. DB 에 현재 선택/지시를 먼저 기록한 뒤 pending 을
   * `request_more` 로 풀어 phase loop 를 gather 로 되돌린다.
   */
  requestMoreIdeas(
    input: IdeaFinalizeSelectionInput,
  ): IdeaRequestMoreResult {
    if (!this.running) {
      throw new Error(
        `[MeetingOrchestrator] requestMoreIdeas: meeting "${this.session.meetingId}" is not running`,
      );
    }
    if (!this.ideaPending || !this.ideaPending.isWaiting) {
      throw new Error(
        `[MeetingOrchestrator] requestMoreIdeas: meeting "${this.session.meetingId}" ` +
          `is not in awaiting_user_pick phase (current=${this.session.currentPhase})`,
      );
    }

    const contextMarkdown = this.buildIdeaRequestMoreContextMarkdown(input);
    const result = this.opinionService.requestMoreIdeas(input);
    this.nextIdeaGatherContextMarkdown = contextMarkdown;
    this.appendIdeaRequestMoreTrace(contextMarkdown, input);
    this.ideaPending.requestMore(input);
    return result;
  }

  private buildIdeaRequestMoreContextMarkdown(
    input: IdeaFinalizeSelectionInput,
  ): string {
    const selectedSet = new Set(input.selectedScreenIds);
    const tally = this.opinionService.tally(this.session.meetingId);
    const selectedNodes = tally.tree.filter(
      (node) => selectedSet.has(node.screenId) && node.opinion.kind === 'root',
    );
    const selected =
      input.selectedScreenIds.length > 0
        ? input.selectedScreenIds.join(', ')
        : '(선택 아이디어 없음)';
    const comment = (input.userComment ?? '').trim();
    const lines = [
      '이미 선택된 아이디어는 유지하고, 중복하지 않는 보강 아이디어를 추가로 제안하세요.',
      '기존 선택과 같은 말을 반복하지 말고, 새 관점 / 보완 조건 / 대안만 제시하세요.',
      '',
      `유지할 아이디어: ${selected}`,
    ];
    for (const node of selectedNodes) {
      lines.push('');
      lines.push(`- ${node.screenId}`);
      lines.push(`  제목: ${node.opinion.title ?? '(제목 없음)'}`);
      lines.push(`  본문: ${node.opinion.content ?? '(본문 없음)'}`);
      lines.push(`  근거: ${node.opinion.rationale ?? '(근거 없음)'}`);
    }
    if (comment.length > 0) {
      lines.push('', '사용자 추가 수집 지시:', comment);
    }
    return lines.join('\n');
  }

  private appendIdeaRequestMoreTrace(
    contextMarkdown: string,
    input: IdeaFinalizeSelectionInput,
  ): void {
    const selected =
      input.selectedScreenIds.length > 0
        ? input.selectedScreenIds.join(', ')
        : '(선택 아이디어 없음)';
    const comment = (input.userComment ?? '').trim();
    this.session.interruptWithUserMessage({
      id: randomUUID(),
      role: 'user',
      content: contextMarkdown,
      participantId: USER_AUTHOR_LITERAL,
      participantName: USER_AUTHOR_LITERAL,
    });

    try {
      this.messageService.append({
        channelId: this.session.channelId,
        meetingId: this.session.meetingId,
        authorId: 'system',
        authorKind: 'system',
        role: 'system',
        content: `추가 아이디어 수집 요청 — 유지할 아이디어: ${selected}`,
        meta: {
          ideaPick: {
            decision: 'request_more',
            selectedScreenIds: input.selectedScreenIds,
            userComment: comment,
            contextMarkdown,
          },
        },
      });
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] idea request-more trace append failed',
        errorPayload(err),
      );
    }
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

  /**
   * Persist user-visible transcript cards for newly inserted opinion rows.
   *
   * The turn executor keeps raw JSON only in provider history. Once
   * OpinionService has created durable opinion rows, this method mirrors those
   * rows into chat messages using the existing `meta.opinion` card contract.
   */
  private appendOpinionTranscriptCards(inserted: readonly Opinion[]): void {
    if (inserted.length === 0) return;

    let tally: OpinionTallyResult;
    try {
      tally = this.opinionService.tally(this.session.meetingId);
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] transcript card tally threw',
        errorPayload(err),
      );
      return;
    }

    for (const opinion of inserted) {
      const screenId = tally.uuidToScreen[opinion.id];
      if (!screenId) {
        console.warn(
          '[MeetingOrchestrator] transcript card skipped: screen id missing',
          {
            meetingId: this.session.meetingId,
            opinionId: opinion.id,
          },
        );
        continue;
      }

      const authorProviderId = opinion.authorProviderId;
      try {
        this.messageService.append({
          channelId: this.session.channelId,
          meetingId: this.session.meetingId,
          authorId: authorProviderId ?? USER_AUTHOR_LITERAL,
          authorKind: authorProviderId === null ? 'user' : 'member',
          role: authorProviderId === null ? 'user' : 'assistant',
          content: opinion.content ?? '',
          meta: {
            opinion: {
              opinionRef: opinion.id,
              opinionKind: opinion.kind,
              opinionScreenId: screenId,
              authorLabel: opinion.authorLabel,
              opinionTitle: opinion.title,
              opinionRationale: opinion.rationale,
            },
          },
        });
      } catch (err) {
        console.warn(
          '[MeetingOrchestrator] transcript card append failed',
          errorPayload(err),
        );
      }
    }
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
    const requestMoreContextMarkdown = this.nextIdeaGatherContextMarkdown;
    this.nextIdeaGatherContextMarkdown = null;

    for (const speaker of this.session.aiParticipants) {
      if (this.session.aborted) return;
      await this.waitWhilePaused();
      const suggestedLabel = this.session.nextLabel(speaker.id);
      const turnStartedAt = Date.now();
      const turnResult = await this.turnExecutor.requestOpinionGather(speaker, {
        suggestedLabel,
        requestMoreContextMarkdown,
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
      const result = this.opinionService.gather({
        meetingId: this.session.meetingId,
        channelId: this.session.channelId,
        round: 0,
        responses,
      });
      this.appendOpinionTranscriptCards(result.inserted);
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
      const opinionId = queue.shift();
      if (opinionId === undefined) break;

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

        this.appendOpinionTranscriptCards(result.additions);

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
    const ideaNodes = tally.tree.filter((node) => node.opinion.kind === 'root');
    const snapshot: IdeaPickSnapshot = {
      meetingId: this.session.meetingId,
      channelId: this.session.channelId,
      selectedScreenIds: ideaNodes
        .filter((node) => node.opinion.status === 'agreed')
        .map((node) => node.screenId),
      cards: ideaNodes.map((node) => ({
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
    let decision: Awaited<ReturnType<IdeaUserPickPending['wait']>>;
    try {
      decision = await pending.wait();
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

    if (decision.kind === 'request_more') {
      return {
        meetingId: this.session.meetingId,
        outcome: 'request_more',
        requestMoreInput: decision.input,
      };
    }

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
          this.appendOpinionTranscriptCards(insertResult.inserted);
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
      const wireframeMinutes = await this.runComposeMinutesPhase({ ordinal: 1 });
      if (this.session.aborted) {
        return { meetingId, outcome: 'aborted', abortReason: { kind: 'aborted' } };
      }
      if (wireframeMinutes !== null) {
        this.createWireframeCheckpoint(wireframeMinutes);
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
      const finalDesignMinutes = await this.runComposeMinutesPhase({ ordinal: 2 });
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

      // step 7c — 디자인 -> 기획 검수 -> 구현/되돌림 분기.
      if (finalDesignMinutes !== null) {
        const handled = await this.runPlanningDesignCheckPhase({
          finalDesignMinutes,
          snapshot,
        });
        if (!handled) {
          await this.runHandoffPhase();
        }
      } else {
        await this.runHandoffPhase();
      }

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
    const last = tally.tree.at(-1);
    if (last === undefined) {
      throw new Error(
        `[MeetingOrchestrator] design-workflow snapshot — no latest root opinion found for meeting ${this.session.meetingId}`,
      );
    }
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
  }): Promise<MeetingMinutesComposeResult | null> {
    this.transitionToPhase('compose_minutes');
    const channel = this.lookupChannel();
    const maxRounds = resolveMaxRounds(channel);
    const composeStartedAt = Date.now();
    let composed = false;
    let composeResult:
      | Awaited<ReturnType<MeetingMinutesService['compose']>>
      | null = null;
    try {
      const result = await this.meetingMinutesService.compose({
        meetingId: this.session.meetingId,
        ordinal: options?.ordinal,
      });
      composeResult = result;
      composed = true;
      // R12-C2 T28 — chain resolver 의 audit chain 호출 시 회의록 본문 read 위해
      // path cache. file 본문 read 는 service 의 별 helper (`readMinutesBody`) 가
      // 책임 — 본 helper 는 path 보존만.
      this.cachedMinutesPath = result.minutesPath;
      const shouldDeferForPlanningReview =
        channel?.role === 'planning' &&
        options?.ordinal === undefined &&
        this.meetingReviewGateService !== null;

      if (!shouldDeferForPlanningReview) {
        this.appendMinutesCardMessage(result);
      }
      if (channel?.role === 'idea') {
        this.appendIdeaBundleArchive({
          body: result.body,
          minutesPath: result.minutesPath,
          source: result.source,
          providerId: result.providerId,
        });
      }
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] minutes compose threw',
        errorPayload(err),
      );
    }

    // R12-C2 T28 — chain resolver 1 회 호출. minutesComposed=true 시점에서
    // workflowKind 별 chain target 결정. resolved 결과를 cache 해서 (a)
    // classifier hasNextChain 컨텍스트 (b) runHandoffPhase 분기에서 재사용.
    //
    // R12-C2 시점 actual wire = idea→planning, audit→planning. 다른
    // workflowKind 는 chain resolver 안 placeholder branches 가 'no_chain'
    // 반환 → hasNextChain=false → classifier 룰 6 'end' 카드 발행.
    if (composed) {
      this.resolvedChain = await this.tryResolveChain();
    }

    if (
      composed &&
      composeResult !== null &&
      channel?.role === 'planning' &&
      options?.ordinal === undefined &&
      this.meetingReviewGateService !== null
    ) {
      const created = this.createPlanningMinutesReview(composeResult);
      if (!created) {
        this.appendMinutesCardMessage(composeResult);
      }
    }

    // R12-C2 T13 — minutes 작성 직후 boundary 분류. minutesComposed=true 로
    // §11.18.8b 룰 5 / 6 분기 (chain 정의 → handoff / 미정의 → end).
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
          hasNextChain: this.resolvedChain?.kind === 'chain_resolved',
          minutesComposed: true,
        },
        durationMs: composeEndedAt - composeStartedAt,
      });
    }
    return composeResult;
  }

  private createWireframeCheckpoint(result: MeetingMinutesComposeResult): void {
    if (this.designCheckpointService === null) return;
    try {
      const created = this.designCheckpointService.createWireframeCheckpoint({
        projectId: this.session.projectId,
        meetingId: this.session.meetingId,
        channelId: this.session.channelId,
        title: resolveNotificationLabel('wireframeCheckpoint.title'),
        documentPath: result.minutesPath,
        documentBodySnapshot: result.body,
        payloadJson: JSON.stringify({
          source: 'design_wireframe_minutes',
          meetingOrdinal: 1,
          noteForNextPhase:
            'R12-C2 3차 현재는 디자인 중간 산출물 안내 카드로 연결',
        }),
      });
      if (!created.shouldShowNotice) return;
      this.messageService.append({
        channelId: this.session.channelId,
        meetingId: this.session.meetingId,
        authorId: 'system',
        authorKind: 'system',
        role: 'system',
        content: resolveNotificationLabel('wireframeCheckpoint.readyMessage'),
        meta: {
          wireframeCheckpoint: {
            id: created.checkpoint.id,
            kind: created.checkpoint.kind,
            status: created.checkpoint.status,
            channelId: created.checkpoint.channelId,
            title: created.checkpoint.title,
          },
        },
      });
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] wireframe checkpoint create or notice append failed',
        errorPayload(err),
      );
    }
  }

  private appendMinutesCardMessage(
    result: Awaited<ReturnType<MeetingMinutesService['compose']>>,
  ): void {
    try {
      this.messageService.append({
        channelId: this.session.channelId,
        meetingId: this.session.meetingId,
        authorId: 'system',
        authorKind: 'system',
        role: 'system',
        content: result.body,
        meta: {
          minutes: {
            minutesPath: result.minutesPath,
            minutesSource: result.source,
            minutesProviderId: result.providerId,
          },
        },
      });
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] minutes append failed',
        errorPayload(err),
      );
    }
  }

  private createPlanningMinutesReview(
    result: Awaited<ReturnType<MeetingMinutesService['compose']>>,
  ): boolean {
    if (this.meetingReviewGateService === null) return false;
    const outcome = this.resolvedChain;
    if (outcome === null || outcome.kind !== 'chain_resolved') {
      return false;
    }

    try {
      const gate = this.meetingReviewGateService.createPending({
        projectId: this.session.projectId,
        meetingId: this.session.meetingId,
        sourceChannelId: this.session.channelId,
        targetChannelId: outcome.package.target.channelId,
        targetRole: outcome.package.target.channelRole,
        kind: 'planning_minutes',
        title: resolveNotificationLabel(
          'meetingReviewSystemMessage.planningMinutesTitle',
        ),
        documentPath: result.minutesPath,
        documentBodySnapshot: result.body,
        payloadJson: JSON.stringify({ handoffPackage: outcome.package }),
      });
      this.messageService.append({
        channelId: this.session.channelId,
        meetingId: this.session.meetingId,
        authorId: 'system',
        authorKind: 'system',
        role: 'system',
        content: resolveNotificationLabel(
          'meetingReviewSystemMessage.planningReviewReady',
        ),
        meta: {
          reviewGate: {
            id: gate.id,
            kind: gate.kind,
            status: gate.status,
            sourceChannelId: gate.sourceChannelId,
            targetChannelId: gate.targetChannelId,
            targetRole: gate.targetRole,
            title: gate.title,
          },
        },
      });
      this.pendingReviewGateId = gate.id;
      return true;
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] planning review gate create or notice append failed',
        errorPayload(err),
      );
      return false;
    }
  }

  private async runPlanningDesignCheckPhase(input: {
    finalDesignMinutes: MeetingMinutesComposeResult;
    snapshot: DesignSnapshotPaths;
  }): Promise<boolean> {
    if (this.planningDesignCheckService === null) return false;
    const designChannel = this.lookupChannel();
    if (designChannel === null || !isDesignDepartmentRole(designChannel.role)) {
      return false;
    }
    const planningReceiver = this.resolveReceiverChannel(
      this.session.projectId,
      'planning',
    );
    if (planningReceiver === null) return false;

    const implementationReceiver = this.resolveReceiverChannel(
      this.session.projectId,
      'implement',
    );

    const designReceiver = this.resolveReceiverChannel(
      this.session.projectId,
      designChannel.role,
    );
    const planningContext = this.resolvePlanningDesignCheckContext();
    const payload: PlanningDesignCheckPayloadContext = {
      sourceHandoffDispatchId:
        this.session.sourceHandoffContext?.dispatchRowId ?? null,
      designReceiver: receiverContextFromResolved(designReceiver),
      implementationReceiver: receiverContextFromResolved(implementationReceiver),
    };

    const request = this.planningDesignCheckService.createRequest({
      projectId: this.session.projectId,
      sourceDesignMeetingId: this.session.meetingId,
      designChannelId: this.session.channelId,
      designChannelRole: designChannel.role,
      planningChannelId: planningReceiver.channelId,
      implementationChannelId: implementationReceiver?.channelId ?? null,
      finalDesignMinutesPath: input.finalDesignMinutes.minutesPath,
      finalDesignMinutesBody: input.finalDesignMinutes.body,
      workBundleKey: planningContext.workBundleKey,
      originalPlanningMinutesId: planningContext.originalPlanningMinutesId,
      originalPlanningMinutesPath: planningContext.originalPlanningMinutesPath,
      originalPlanningMinutesBody: planningContext.originalPlanningMinutesBody,
      originalPlanningMinutesMissingReason:
        planningContext.originalPlanningMinutesMissingReason,
      snapshotDesktopPath: input.snapshot.desktopPath,
      snapshotMobilePath: input.snapshot.mobilePath,
      payloadJson: JSON.stringify(payload),
    });

    this.appendPlanningDesignCheckRecord(
      request,
      resolveNotificationLabel(
        'planningDesignCheckSystemMessage.designCheckRequestDispatched',
      ),
    );

    if (planningContext.originalPlanningMinutesMissingReason !== null) {
      const needsUser = this.planningDesignCheckService.recordNeedsUserDecision({
        id: request.id,
        reason: planningContext.originalPlanningMinutesMissingReason,
        payloadJson: JSON.stringify({
          missingOriginalPlanningMinutes: true,
        }),
      });
      this.appendPlanningDesignCheckRecord(
        needsUser,
        resolveNotificationLabel(
          'planningDesignCheckSystemMessage.needsUserDecision',
        ),
      );
      return true;
    }

    const speaker = this.participantFromProviderId(
      planningReceiver.assignedProviderId,
    );
    const skippedReason = resolveNotificationLabel(
      'planningDesignCheckSystemMessage.staffMissingReason',
    );
    if (speaker === null) {
      const needsUser = this.planningDesignCheckService.recordNeedsUserDecision({
        id: request.id,
        reason: skippedReason,
      });
      this.appendPlanningDesignCheckRecord(
        needsUser,
        resolveNotificationLabel(
          'planningDesignCheckSystemMessage.needsUserDecision',
        ),
      );
      return true;
    }

    const result = await this.turnExecutor.requestPlanningDesignCheck(speaker, {
      request,
      speaker,
      suggestedLabel: this.session.nextLabel(speaker.id),
    });
    if (result.kind !== 'ok') {
      const needsUser = this.planningDesignCheckService.recordNeedsUserDecision({
        id: request.id,
        reason: skippedReason,
        payloadJson: JSON.stringify({ skipped: result }),
      });
      this.appendPlanningDesignCheckRecord(
        needsUser,
        resolveNotificationLabel(
          'planningDesignCheckSystemMessage.needsUserDecision',
        ),
      );
      return true;
    }

    const normalized = normalizePlanningDesignCheckResult(result.payload);
    if (normalized.verdict === 'aligned') {
      const aligned = this.planningDesignCheckService.recordAligned({
        id: request.id,
        reason: normalized.reason,
        payloadJson: JSON.stringify({ reviewerProviderId: result.providerId }),
      });
      if (implementationReceiver === null) {
        const needsUser =
          this.planningDesignCheckService.recordNeedsUserDecision({
            id: request.id,
            reason: resolveNotificationLabel(
              'planningDesignCheckSystemMessage.alignedButNoImplementationChannel',
            ),
          });
        this.appendPlanningDesignCheckRecord(
          needsUser,
          resolveNotificationLabel(
            'planningDesignCheckSystemMessage.needsUserDecision',
          ),
        );
        return true;
      }
      const pkg = buildImplementationHandoffPackage({
        request: aligned,
        implementationReceiver,
        missionCardId: this.missionCardIdFactory(),
        generatedAt: Date.now(),
      });
      const dispatchRowId = this.dispatchAutoHandoffPackage(pkg);
      if (dispatchRowId === null) {
        const needsUser =
          this.planningDesignCheckService.recordNeedsUserDecision({
            id: aligned.id,
            reason: resolveNotificationLabel(
              'planningDesignCheckSystemMessage.implementationDispatchFailed',
            ),
          });
        this.appendPlanningDesignCheckRecord(
          needsUser,
          resolveNotificationLabel(
            'planningDesignCheckSystemMessage.implementationDispatchFailed',
          ),
        );
        return true;
      }
      const stored = this.planningDesignCheckService.setImplementationDispatchId(
        aligned.id,
        dispatchRowId,
      );
      this.appendPlanningDesignCheckRecord(
        stored,
        resolveNotificationLabel(
          'planningDesignCheckSystemMessage.alignedDispatched',
        ),
      );
      return true;
    }

    const branch = this.planningDesignCheckService.recordMisaligned({
      id: request.id,
      reason: normalized.reason,
      revisionDirection: normalized.revisionDirection,
      payloadJson: JSON.stringify({ reviewerProviderId: result.providerId }),
    });
    if (branch.action === 'return_to_design' && designReceiver !== null) {
      const pkg = buildDesignReturnHandoffPackage({
        request: branch.record,
        designReceiver,
        missionCardId: this.missionCardIdFactory(),
        generatedAt: Date.now(),
      });
      const dispatchRowId = this.dispatchAutoHandoffPackage(pkg);
      if (dispatchRowId === null) {
        const needsUser =
          this.planningDesignCheckService.recordNeedsUserDecision({
            id: branch.record.id,
            reason: resolveNotificationLabel(
              'planningDesignCheckSystemMessage.designReturnDispatchFailed',
            ),
          });
        this.appendPlanningDesignCheckRecord(
          needsUser,
          resolveNotificationLabel(
            'planningDesignCheckSystemMessage.designReturnDispatchFailed',
          ),
        );
        return true;
      }
      const stored = this.planningDesignCheckService.setDesignReturnDispatchId(
        branch.record.id,
        dispatchRowId,
      );
      this.appendPlanningDesignCheckRecord(
        stored,
        resolveNotificationLabel(
          'planningDesignCheckSystemMessage.designReturnDispatched',
        ),
      );
      return true;
    }

    const needsUser =
      branch.action === 'needs_user_decision'
        ? branch.record
        : this.planningDesignCheckService.recordNeedsUserDecision({
            id: request.id,
            reason: resolveNotificationLabel(
              'planningDesignCheckSystemMessage.designReturnTargetMissing',
            ),
          });
    this.appendPlanningDesignCheckRecord(
      needsUser,
      resolveNotificationLabel(
        'planningDesignCheckSystemMessage.needsUserDecision',
      ),
    );
    return true;
  }

  private resolvePlanningDesignCheckContext(): {
    workBundleKey: string | null;
    originalPlanningMinutesId: string | null;
    originalPlanningMinutesPath: string | null;
    originalPlanningMinutesBody: string | null;
    originalPlanningMinutesMissingReason: string | null;
  } {
    const source = this.session.sourceHandoffContext;
    if (source === null) {
      return missingPlanningMinutesContext(
        resolveNotificationLabel(
          'planningDesignCheckSystemMessage.missingSourceHandoffReason',
        ),
        `design-meeting:${this.session.meetingId}`,
      );
    }

    const priorCheck =
      this.planningDesignCheckService?.findByDesignReturnDispatchId(
        source.dispatchRowId,
      ) ?? null;
    if (priorCheck !== null) {
      return {
        workBundleKey:
          priorCheck.workBundleKey ??
          bundleKeyFromPlanningMinutes(priorCheck.originalPlanningMinutesId) ??
          `planning-design-check:${priorCheck.id}`,
        originalPlanningMinutesId: priorCheck.originalPlanningMinutesId,
        originalPlanningMinutesPath: priorCheck.originalPlanningMinutesPath,
        originalPlanningMinutesBody: priorCheck.originalPlanningMinutesBody,
        originalPlanningMinutesMissingReason:
          priorCheck.originalPlanningMinutesMissingReason,
      };
    }

    if (
      source.handoffPackage.sender.channelRole === 'planning' &&
      source.minutesMeetingId !== null &&
      source.minutesPath !== null &&
      source.minutesBody !== null &&
      source.minutesBody.trim().length > 0
    ) {
      return {
        workBundleKey: bundleKeyFromPlanningMinutes(source.minutesMeetingId),
        originalPlanningMinutesId: source.minutesMeetingId,
        originalPlanningMinutesPath: source.minutesPath,
        originalPlanningMinutesBody: source.minutesBody,
        originalPlanningMinutesMissingReason: null,
      };
    }

    return missingPlanningMinutesContext(
      resolveNotificationLabel(
        'planningDesignCheckSystemMessage.missingPlanningMinutesBodyReason',
      ),
      `source-handoff:${source.dispatchRowId}`,
    );
  }

  private participantFromProviderId(providerId: string): Participant | null {
    const provider = this.providerRegistry.get(providerId);
    if (provider === undefined) return null;
    return {
      id: providerId,
      providerId,
      displayName: provider.displayName ?? providerId,
      isActive: true,
    };
  }

  private dispatchAutoHandoffPackage(pkg: HandoffPackage): string | null {
    try {
      const row = this.handoffDispatchService.dispatch(pkg);
      try {
        this.streamBridge.emitHandoffDispatched({
          meetingId: this.session.meetingId,
          dispatchRowId: row.id,
          senderChannelId: pkg.sender.channelId,
          targetChannelId: pkg.target.channelId,
          mode: pkg.mode,
          dispatchedAt: row.dispatchedAt,
        });
      } catch (err) {
        console.warn(
          '[MeetingOrchestrator] planning design check dispatch stream emit failed',
          errorPayload(err),
        );
      }
      return row.id;
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] planning design check dispatch failed',
        errorPayload(err),
      );
      return null;
    }
  }

  private appendPlanningDesignCheckRecord(
    record: ReturnType<PlanningDesignCheckService['get']>,
    content: string,
  ): void {
    const meta = {
      planningDesignCheck: {
        id: record.id,
        status: record.status,
        verdict: record.verdict,
        returnCount: record.returnCount,
        sourceDesignMeetingId: record.sourceDesignMeetingId,
        designChannelId: record.designChannelId,
        planningChannelId: record.planningChannelId,
        implementationChannelId: record.implementationChannelId,
        title: record.requestTitle,
        reason: record.reason,
        revisionDirection: record.revisionDirection,
        userDecision: record.userDecision,
      },
    };
    try {
      this.messageService.append({
        channelId: this.session.channelId,
        meetingId: this.session.meetingId,
        authorId: 'system',
        authorKind: 'system',
        role: 'system',
        content,
        meta,
      });
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] planning design check message append failed',
        errorPayload(err),
      );
    }

    let minutesChannel: Channel | undefined;
    try {
      minutesChannel = this.channelService
        .listByProject(this.session.projectId)
        .find((channel) => channel.kind === 'system_minutes');
    } catch {
      minutesChannel = undefined;
    }
    if (minutesChannel === undefined) return;
    try {
      this.messageService.append({
        channelId: minutesChannel.id,
        meetingId: this.session.meetingId,
        authorId: 'system',
        authorKind: 'system',
        role: 'system',
        content: buildPlanningDesignCheckArchive(record, content),
        meta,
      });
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] planning design check archive append failed',
        errorPayload(err),
      );
    }
  }

  private appendIdeaBundleArchive(input: {
    body: string;
    minutesPath: string;
    source: 'moderator' | 'moderator-retry' | 'fallback';
    providerId: string | null;
  }): void {
    const minutesChannel = this.channelService
      .listByProject(this.session.projectId)
      .find((channel) => channel.kind === 'system_minutes');
    if (minutesChannel === undefined) {
      console.warn(
        '[MeetingOrchestrator] idea bundle archive skipped — system_minutes channel not found',
      );
      return;
    }

    try {
      this.messageService.append({
        channelId: minutesChannel.id,
        meetingId: this.session.meetingId,
        authorId: 'system',
        authorKind: 'system',
        role: 'system',
        content: input.body,
        meta: {
          minutes: {
            minutesPath: input.minutesPath,
            minutesSource: input.source,
            minutesProviderId: input.providerId,
          },
          reviewGate: {
            kind: 'idea_bundle',
            status: 'approved',
            sourceChannelId: this.session.channelId,
            targetRole: 'planning',
          },
        },
      });
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] idea bundle archive append failed',
        errorPayload(err),
      );
    }
  }

  /**
   * R12-C2 T28 — chain resolver 1 회 호출 helper. workflowKind 매핑 + caller
   * injection (resolveReceiverChannel / missionCardIdFactory / generatedAt) 합성.
   *
   * 본 helper 는 *try/catch* — chain resolver 가 throw 해도 회의 흐름은 멈추지
   * 않는다. throw 시 null 반환 → caller 가 hasNextChain=false 로 진행 (회의 종결
   * path). 실제 user-facing 인계가 막혀도 회의록 자체는 land 되므로 사용자 정보
   * 손실 없음.
   *
   * R12-C2 시점 audit 채널만 actual chain wire — 다른 채널은 chain resolver 안
   * placeholder branches 가 'no_chain' 반환.
   */
  private async tryResolveChain(options?: {
    designSnapshot?: DesignSnapshotPaths;
    finalDesignMinutesBody?: string;
  }): Promise<ChainResolverOutcome | null> {
    const channel = this.lookupChannel();
    if (channel === null) return null;
    const workflowKind = mapChannelRoleToWorkflowKind(channel);
    if (workflowKind === null) return null;

    try {
      // audit chain 만 auditInput 채워야 함 — opinions 통째 + minutes markdown.
      let auditInput:
        | { opinions: readonly Opinion[]; auditMinutesMarkdown: string }
        | undefined;
      if (workflowKind === 'audit') {
        const tally = this.opinionService.tally(this.session.meetingId);
        const opinions = collectOpinionsFromTree(tally.tree);
        const minutesBody = (await this.tryReadCachedMinutesBody()) ?? '';
        if (minutesBody.trim().length === 0) {
          // 회의록 본문 빈 = chain resolver invariant 위반 (T25 buildAuditHandoffPayload
          // 가 throw). 본 시점 chain 결정 자체를 skip — runHandoffPhase 가 fallback
          // path (system message + Notification) 진행.
          return null;
        }
        auditInput = { opinions, auditMinutesMarkdown: minutesBody };
      }

      return resolveHandoffChain({
        workflowKind,
        sender: {
          meetingId: this.session.meetingId,
          channelId: this.session.channelId,
          channelRole: channel.role,
          projectId: this.session.projectId,
        },
        auditInput,
        designInput:
          workflowKind === 'design'
            ? {
                finalDesignMinutesMarkdown: options?.finalDesignMinutesBody,
                snapshotDesktopPath: options?.designSnapshot?.desktopPath ?? null,
                snapshotMobilePath: options?.designSnapshot?.mobilePath ?? null,
              }
            : undefined,
        resolveReceiverChannel: (role: ChannelRole) =>
          this.resolveReceiverChannel(this.session.projectId, role),
        missionCardIdFactory: this.missionCardIdFactory,
        generatedAt: Date.now(),
      });
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] resolveHandoffChain threw',
        errorPayload(err),
      );
      return null;
    }
  }

  /**
   * R12-C2 T28 — 회의록 markdown 파일 본문 읽기. cachedMinutesPath 가 set 되어 있
   * 어야 호출 (compose 직후 — 본 helper 는 그 직후 1 회만 사용). meetingMinutesService
   * 가 ordinal 별 파일 read 를 담당하므로 본 helper 는 1 회 호출 wrap.
   *
   * R12-C2 시점 audit chain 의 회의는 단일 회의 (ordinal=1) — design 두 회의
   * (#1 wireframe + #2 implementation) 와 다름. 본 helper 는 *audit chain 전용* —
   * design / 다른 chain 추가 시 ordinal 분기 필요 (T28 시점 audit 만 actual wire).
   */
  private async tryReadCachedMinutesBody(): Promise<string | null> {
    if (this.cachedMinutesPath === null) return null;
    try {
      return await this.meetingMinutesService.readMinutesBody({
        meetingId: this.session.meetingId,
        ordinal: 1,
      });
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] cached minutes read threw',
        errorPayload(err),
      );
      return null;
    }
  }

  private async runHandoffPhase(): Promise<HandoffPhaseResult> {
    this.transitionToPhase('handoff');

    if (this.pendingReviewGateId !== null) {
      try {
        this.messageService.append({
          channelId: this.session.channelId,
          meetingId: this.session.meetingId,
          authorId: 'system',
          authorKind: 'system',
          role: 'system',
          content: resolveNotificationLabel('meetingMinutesHandoff.reviewGatePending'),
          meta: {
            reviewGateId: this.pendingReviewGateId,
            handoff: 'review_gate_pending',
          },
        });
      } catch (err) {
        console.warn(
          '[MeetingOrchestrator] review gate pending message append failed',
          errorPayload(err),
        );
      }
      return { kind: 'review_gate_pending' };
    }

    // R12-C2 T28 — chain resolver outcome 분기.
    //
    //   no_chain (또는 미산출 fallback)
    //     → 회의 종결만 surface (이전 fallback path 유지: Notification + system msg).
    //
    //   chain_resolved + receiver mode='check'
    //     → HandoffPendingState.put + emitHandoffRequired
    //       사용자 결재 모달이 열리면 [확인] / [취소] 결정. dispatch 호출 X (IPC
    //       handler 가 책임).
    //
    //   chain_resolved + receiver mode='auto'
    //     → HandoffDispatchService.dispatch + emitHandoffDispatched
    //       사용자 확인 없이 즉시 dispatch. Notification 발송은 T30 책임.
    //
    // 회의 자체는 모든 분기에서 phase='handoff' transition 후 finalize('accepted')
    // 로 종결 — pending 분기에서도 회의는 종결, dispatch 만 보류.
    const outcome = this.resolvedChain;

    if (outcome === null || outcome.kind === 'no_chain') {
      this.runHandoffFallback();
      return { kind: 'fallback' };
    }

    // chain_resolved branch — outcome.package 사용.
    const pkg = outcome.package;

    if (pkg.mode === 'auto') {
      // 즉시 dispatch.
      try {
        const row = this.handoffDispatchService.dispatch(pkg);
        try {
          this.streamBridge.emitHandoffDispatched({
            meetingId: this.session.meetingId,
            dispatchRowId: row.id,
            senderChannelId: pkg.sender.channelId,
            targetChannelId: pkg.target.channelId,
            mode: pkg.mode,
            dispatchedAt: row.dispatchedAt,
          });
        } catch (err) {
          console.warn(
            '[MeetingOrchestrator] emitHandoffDispatched threw',
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
            content: resolveNotificationLabel('meetingMinutesHandoff.autoDispatched'),
            meta: { handoff: 'auto', dispatchRowId: row.id },
          });
        } catch (err) {
          console.warn(
            '[MeetingOrchestrator] auto handoff system message append failed',
            errorPayload(err),
          );
        }
        return { kind: 'dispatched', dispatchRowId: row.id };
      } catch (err) {
        console.warn(
          '[MeetingOrchestrator] handoffDispatchService.dispatch threw',
          errorPayload(err),
        );
        // dispatch 실패 시 fallback path — 회의 종결만 알림.
        this.runHandoffFallback();
        return { kind: 'fallback' };
      }
    }

    // mode === 'check' — pending state 등록 + stream emit.
    try {
      this.handoffPendingState.put(this.session.meetingId, pkg);
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] handoffPendingState.put threw',
        errorPayload(err),
      );
      // pending 등록 실패 시 fallback — chain 정보 손실 안되게 system message 만.
      this.runHandoffFallback();
      return { kind: 'fallback' };
    }

    try {
      this.streamBridge.emitHandoffRequired({
        meetingId: this.session.meetingId,
        senderChannelId: pkg.sender.channelId,
        targetChannelId: pkg.target.channelId,
        packageJson: serializeHandoffPackage(pkg),
        minutesPath: this.cachedMinutesPath,
        dispatchedAt: pkg.dispatchedAt,
      });
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] emitHandoffRequired threw',
        errorPayload(err),
      );
    }

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
        content: resolveNotificationLabel('meetingMinutesHandoff.pendingUserApproval'),
        meta: { handoff: 'check' },
      });
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] check handoff system message append failed',
        errorPayload(err),
      );
    }
    return { kind: 'pending' };
  }

  /**
   * R12-C2 T28 — chain resolver 가 'no_chain' 반환 또는 dispatch / pending put
   * 실패 시 fallback path. 사용자에게 회의 종결만 알림 — 받는 부서 진입 X.
   */
  private runHandoffFallback(): void {
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
        '[MeetingOrchestrator] handoff fallback notify threw',
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
        content: resolveNotificationLabel('meetingMinutesHandoff.noChain'),
        meta: { handoff: 'no_chain' },
      });
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] handoff fallback system message append failed',
        errorPayload(err),
      );
    }
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
        content: resolveNotificationLabel('meetingMinutesHandoff.maxRoundsPause', {
          screenId,
          maxRounds,
        }),
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
      await this.delay(MEETING_PAUSE_POLL_INTERVAL_MS);
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

function buildPlanningDesignCheckArchive(
  record: PlanningDesignCheckRecord,
  headline: string,
): string {
  const lines: string[] = [];
  lines.push(`# ${record.requestTitle}`);
  lines.push('');
  lines.push(headline);
  lines.push('');
  lines.push(`상태: ${record.status}`);
  lines.push(`판단: ${record.verdict ?? 'pending'}`);
  lines.push(`되돌림 횟수: ${record.returnCount}`);
  if (record.workBundleKey !== null) {
    lines.push(`작업 묶음: ${record.workBundleKey}`);
  }
  if (record.originalPlanningMinutesPath !== null) {
    lines.push(`원래 기획 회의록: ${record.originalPlanningMinutesPath}`);
  }
  if (record.originalPlanningMinutesMissingReason !== null) {
    lines.push(`원래 기획 회의록 누락: ${record.originalPlanningMinutesMissingReason}`);
  }
  lines.push(`최종 디자인 회의록: ${record.finalDesignMinutesPath}`);
  if (record.snapshotDesktopPath !== null) {
    lines.push(`데스크톱 스냅샷: ${record.snapshotDesktopPath}`);
  }
  if (record.snapshotMobilePath !== null) {
    lines.push(`모바일 스냅샷: ${record.snapshotMobilePath}`);
  }
  if (record.reason !== null) {
    lines.push('');
    lines.push('## 기획 검수 의견');
    lines.push(record.reason);
  }
  if (record.revisionDirection !== null) {
    lines.push('');
    lines.push('## 수정 방향');
    lines.push(record.revisionDirection);
  }
  if (record.userDecision !== null) {
    lines.push('');
    lines.push('## 사용자 판단');
    lines.push(userDecisionLabel(record.userDecision));
    if (record.userDecisionNote !== null) {
      lines.push(record.userDecisionNote);
    }
    if (record.userDecisionDispatchId !== null) {
      lines.push(`인계 ID: ${record.userDecisionDispatchId}`);
    }
  }
  lines.push('');
  lines.push('## 요청서 본문');
  lines.push(record.requestBody);
  return lines.join('\n');
}

function receiverContextFromResolved(
  receiver: ResolvedReceiverChannel | null,
): PlanningDesignCheckReceiverContext | null {
  if (receiver === null) return null;
  return {
    channelId: receiver.channelId,
    handoffMode: receiver.handoffMode,
    assignedProviderId: receiver.assignedProviderId,
  };
}

function bundleKeyFromPlanningMinutes(meetingId: string | null): string | null {
  return meetingId === null ? null : `planning-minutes:${meetingId}`;
}

function missingPlanningMinutesContext(
  reason: string,
  fallbackWorkBundleKey: string,
): {
  workBundleKey: string;
  originalPlanningMinutesId: null;
  originalPlanningMinutesPath: null;
  originalPlanningMinutesBody: null;
  originalPlanningMinutesMissingReason: string;
} {
  return {
    workBundleKey: fallbackWorkBundleKey,
    originalPlanningMinutesId: null,
    originalPlanningMinutesPath: null,
    originalPlanningMinutesBody: null,
    originalPlanningMinutesMissingReason: reason,
  };
}

function userDecisionLabel(
  decision: PlanningDesignCheckRecord['userDecision'],
): string {
  switch (decision) {
    case 'send_to_implementation':
      return resolveNotificationLabel(
        'planningDesignCheck.decisionLabel.send_to_implementation',
      );
    case 'request_design_revision':
      return resolveNotificationLabel(
        'planningDesignCheck.decisionLabel.request_design_revision',
      );
    case 'stop':
      return resolveNotificationLabel('planningDesignCheck.decisionLabel.stop');
    case null:
      return '';
    default: {
      const _exhaustive: never = decision;
      return _exhaustive;
    }
  }
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
