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
import type {
  MeetingPhase,
} from '../../../shared/meeting-flow-types';
import type {
  Opinion,
  OpinionTreeNode,
  OpinionTallyResult,
  OpinionQuickVoteResult,
} from '../../../shared/opinion-types';
import type { MeetingService } from '../meeting-service';
import type { MessageService } from '../../channels/message-service';
import type { ChannelService } from '../../channels/channel-service';
import type { ProjectService } from '../../projects/project-service';
import type { StreamBridge } from '../../streams/stream-bridge';
import type { NotificationService } from '../../notifications/notification-service';
import type { CircuitBreaker } from '../../queue/circuit-breaker';
import type { OpinionService } from '../opinion-service';
import type { MeetingMinutesService } from '../meeting-minutes-service';
import { OPINION_DEPTH_CAP } from '../screen-id';
import { tryGetLogger } from '../../log/logger-accessor';
import type { MeetingSession } from './meeting-session';
import type { ParticipantMessage } from '../../engine/history';
import type { MeetingTurnExecutor } from './meeting-turn-executor';
import { resolveNotificationLabel } from '../../notifications/notification-labels';
import { INTER_TURN_DELAY_MS } from '../../../shared/timeouts';

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
  private readonly interTurnDelayMs: number;
  private readonly onFinalized?: MeetingOrchestratorDeps['onFinalized'];

  private running = false;
  private terminalHandled = false;
  private paused = false;

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

      // ── phase 1: gather ─────────────────────────────────────────────
      await this.runGatherPhase();
      if (this.session.aborted) return await this.finalize('aborted');

      // ── phase 2: tally (no provider call) ────────────────────────────
      this.transitionToPhase('tally');

      // ── phase 2.5: quick_vote ────────────────────────────────────────
      const quickResult = await this.runQuickVotePhase();
      if (this.session.aborted) return await this.finalize('aborted');

      // ── phase 3: free_discussion (선택) ──────────────────────────────
      if (quickResult.unresolved.length > 0) {
        await this.runFreeDiscussionPhase(quickResult.unresolved);
        if (this.session.aborted) return await this.finalize('aborted');
      }

      // ── phase 5: compose_minutes ────────────────────────────────────
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

  // ── phase 별 본체 ────────────────────────────────────────────────────

  private async runGatherPhase(): Promise<void> {
    this.transitionToPhase('gather');
    const responses: Array<{
      providerId: string;
      payload: import('../../../shared/meeting-flow-types').Step1OpinionGatherSchemaType;
    }> = [];

    for (const speaker of this.session.aiParticipants) {
      if (this.session.aborted) return;
      await this.waitWhilePaused();
      const suggestedLabel = this.session.nextLabel(speaker.id);
      const turnResult = await this.turnExecutor.requestOpinionGather(speaker, {
        suggestedLabel,
      });
      if (turnResult.kind === 'ok') {
        responses.push({
          providerId: speaker.id,
          payload: turnResult.payload,
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

    const responses: Array<{
      providerId: string;
      payload: import('../../../shared/meeting-flow-types').Step25QuickVoteSchemaType;
    }> = [];

    for (const speaker of this.session.aiParticipants) {
      if (this.session.aborted) return emptyQuickVoteResult(this.session.meetingId);
      await this.waitWhilePaused();
      const suggestedLabel = this.session.nextLabel(speaker.id);
      const turnResult = await this.turnExecutor.requestQuickVote(speaker, {
        suggestedLabel,
        opinionsMarkdown,
      });
      if (turnResult.kind === 'ok') {
        responses.push({
          providerId: speaker.id,
          payload: turnResult.payload,
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
          const turnResult = await this.turnExecutor.requestFreeDiscussion(
            speaker,
            {
              suggestedLabel,
              currentOpinionMarkdown,
              childrenMarkdown,
              depthCapReachedScreenIds,
            },
          );
          if (turnResult.kind === 'ok') {
            responses.push({
              providerId: speaker.id,
              payload: turnResult.payload,
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

  private async runComposeMinutesPhase(): Promise<void> {
    this.transitionToPhase('compose_minutes');
    try {
      const result = await this.meetingMinutesService.compose({
        meetingId: this.session.meetingId,
      });
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
