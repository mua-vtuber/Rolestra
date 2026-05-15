/**
 * MeetingSession — R12-C2 T10a 통째 재작성.
 *
 * 옛 12 단계 SSM (`SessionStateMachine`) + TurnManager 단순 라운드로빈 모델
 * 폐기. 새 모델은 phase loop (gather → tally → quick_vote → free_discussion →
 * compose_minutes → handoff) — phase 전환은 orchestrator 가 직접 관리하고,
 * Session 은 단순 *상태 보관소* 역할만.
 *
 * 5 책임 영역:
 *   1. 회의 정체성 (meetingId / channelId / projectId / topic / participants)
 *   2. 현재 phase + 라운드 카운터 + 진행 중 의견 화면 ID
 *   3. 발화 ID 카운터 (회의 단위 in-memory + OpinionService.nextLabelHint
 *      가 진실원천 fallback 으로 활용)
 *   4. 메시지 버퍼 (provider history adaption — 회의 시작 시 topic system 메시지
 *      seed + interruptWithUserMessage / appendUserMessage 끼어들기)
 *   5. abort flag — orchestrator 가 phase loop 안에서 매 단계 가드.
 *
 * caller 가 의존하는 surface (시그니처 보존):
 *   - 생성자 (옛과 동일 인자)
 *   - get title / get topic / get messages / get participants
 *   - addMessage / createMessage / getMessagesForProvider
 *   - interruptWithUserMessage(message) — D-A T2.5 dispatcher 가 호출
 *   - appendUserMessage(message) — D-A T5 auto-trigger 가 호출
 *   - toInfo() — IPC 응답 IPC-safe projection
 *
 * 새로 도입한 surface (T10a):
 *   - get currentPhase / setPhase / get currentRound / incrementRound / resetRound
 *   - get currentOpinionScreenId / setCurrentOpinionScreenId
 *   - nextLabel(providerId) — 발화 ID `<provider>_<n>` 발급
 *   - get aborted / abort()
 *
 * 옛 SSM / DeepDebate / TurnManager 의존 모두 제거. `sessionMachine` getter
 * 도 삭제 — 새 orchestrator + turn-executor + IPC handler 어디에서도 호출 X.
 *
 * spec docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md
 *  - §5    D-B 흐름 (의견 트리 + 깊이 cap 3 + 발화 ID 카운터)
 *  - §11.18 직원 응답 JSON schema (4 종)
 */

import { randomUUID } from 'node:crypto';
import type { Message } from '../../../shared/provider-types';
import type { Participant } from '../../../shared/engine-types';
import type { SsmContext } from '../../../shared/ssm-context-types';
import type { ConversationTaskSettings } from '../../../shared/config-types';
import type { MeetingPhase } from '../../../shared/meeting-flow-types';
import type { ChannelRole } from '../../../shared/channel-role-types';
import type { PermissionSet } from '../../../shared/permission-set-types';
import type { SourceHandoffContext } from '../../../shared/handoff/source-handoff-context';
import type {
  ChannelService,
  PermissionChangedPayload,
} from '../../channels/channel-service';
import { PERMISSION_CHANGED_EVENT } from '../../channels/channel-service';
import type { ChannelPermissionResolver } from '../../permissions/channel-permission-resolver';
import {
  adaptMessagesForProvider,
  type ParticipantMessage,
} from '../../engine/history';
import { buildTopicSystemPrompt } from './meeting-prompt-labels';

/**
 * Sentinel participant id / name for the auto-injected topic system message
 * (D-A T2.5, spec §5.5). Picked so it never collides with a real provider id
 * (which are non-empty alphanumeric) and so renderer surfaces filtering AI
 * vs system messages can match on this exact literal.
 */
export const SYSTEM_TOPIC_PARTICIPANT_ID = '__system__';
export const SYSTEM_TOPIC_PARTICIPANT_NAME = 'system';

/**
 * IPC-safe projection used when the renderer asks for the current meeting
 * state. Contains identifiers + phase + round metadata only — message bodies
 * are streamed separately over `stream:meeting-turn-*`.
 */
export interface MeetingSessionInfo {
  meetingId: string;
  channelId: string;
  projectId: string;
  title: string;
  topic: string;
  /** 새 phase 문자열 (`gather` | `tally` | ...) — 옛 ConversationState 와 다름. */
  phase: MeetingPhase;
  participants: Participant[];
  /** `free_discussion` 안 라운드 카운터. 다른 phase 에서 0. */
  currentRound: number;
  /** 진행 중 의견 화면 ID (`ITEM_NNN`). free_discussion 외 phase 에서 null. */
  currentOpinionScreenId: string | null;
  /** abort 플래그. UI 가 종료 표시 / 입력 disable 결정. */
  aborted: boolean;
}

export interface MeetingSessionOptions {
  meetingId: string;
  channelId: string;
  projectId: string;
  /** User-provided meeting topic (spec §7.5 "주제 단일 입력 3~200 자"). */
  topic: string;
  /**
   * Participants ordered for turn rotation. MUST contain at least two
   * non-user participants. Callers may include the implicit 'user'
   * sentinel (id === 'user') — it is counted separately.
   */
  participants: Participant[];
  /**
   * Execution context — projectPath / permissionMode / autonomyMode 가 turn
   * 실행 단계에서 PathGuard / PermissionFlagBuilder 에 전달되어 사용된다.
   * meetingId / channelId / projectId 정합성 체크는 생성자에서 enforce.
   */
  ssmCtx: SsmContext;
  /**
   * R12-W T9 — 세션이 속한 채널의 부서 role. ChannelService 가 채널 fetch
   * 후 caller (meeting-orchestrator 또는 meeting-service) 가 전달.
   * `null` = system 채널 / DM / legacy user 채널 (회의 컨텍스트 X — turn
   * executor 가 PromptComposer 의 channelRole=null 분기로 라우팅).
   */
  channelRole: ChannelRole;
  /** Optional display title; defaults to the topic string. */
  title?: string;
  /** Conversation/task mode policy settings. T10a 은 사용 X — 옛 호환 시그니처. */
  taskSettings?: ConversationTaskSettings;
  /**
   * R12-C2 T29 — 받는 부서 H2 진입 시 topic system message *직후* 에 추가로 주입
   * 되는 system message. 보통 보낸 부서 회의록 markdown 본문 + 받는 부서 작업
   * list 통째 — orchestrator gather phase 의 첫 turn provider history 안에 포함
   * 되어 직원이 컨텍스트 잃지 않고 의견 제시.
   *
   * 일반 회의 (channel:start-meeting) 진입 시 undefined — topic 만 있는 평소 흐름.
   * H2 진입 (handoff:start-meeting-from-package) 시 caller (handoff-handler) 가
   * 합성한 markdown 본문 1 회 주입.
   */
  priorContextSystemMessage?: string;
  /**
   * HandoffPackageCard 에서 시작된 회의의 원본 인계 정보. 디자인 회의가
   * 승인된 기획 회의록에서 시작됐는지, 또는 기획 검수의 디자인 되돌림으로
   * 다시 시작됐는지 추적할 때 사용한다.
   */
  sourceHandoffContext?: SourceHandoffContext;
}

export class MeetingSession {
  readonly meetingId: string;
  readonly channelId: string;
  readonly projectId: string;
  readonly topic: string;
  readonly ssmCtx: SsmContext;
  /**
   * R12-W T9 — 세션이 속한 채널의 부서 role. PromptComposer 의 channelRole
   * 분기 source. session 생성 시점 한 번 캡쳐, life-cycle 동안 불변.
   * 채널이 부서 재할당 (rare) 되면 새 회의를 시작해야 한다 — 회의 중간
   * role 변경은 phase loop 의 의미를 깨므로 의도적으로 immutable.
   */
  readonly channelRole: ChannelRole;

  private _title: string;
  private _messages: ParticipantMessage[];
  private readonly _participants: Participant[];
  private _taskSettings: ConversationTaskSettings | null;
  readonly sourceHandoffContext: SourceHandoffContext | null;

  // ── R12-C2 T10a 신규 상태 ─────────────────────────────────────────────
  private _phase: MeetingPhase = 'gather';
  private _round = 0;
  private _currentOpinionScreenId: string | null = null;
  private _aborted = false;

  // ── R12-W T8: 채널 권한 캐시 + invalidation ─────────────────────────
  /**
   * 회의 시작 시 hydrate 되는 채널 권한 snapshot. null = 아직 미초기화.
   * `getPermissions(resolver)` 첫 호출이 hydration + cache 입력. 사용자가
   * 권한을 바꾸면 ChannelService 가 `'permission-changed'` 발사 →
   * `_permissionSnapshotDirty = true` → 다음 turn 재조회.
   */
  private _permissionSnapshot: PermissionSet | null = null;
  private _permissionSnapshotDirty = false;
  /**
   * 'permission-changed' listener 핸들. attach/detach 쌍으로만 다루며 외부에서
   * 직접 호출하지 않는다. 메모리 누수 방지 — session dispose 시 detach 필수.
   */
  private _permissionListener:
    | ((p: PermissionChangedPayload) => void)
    | null = null;
  /**
   * 발화 ID 카운터 — provider 별 누적. 회의 종료 시 객체 통째 GC.
   * OpinionService.nextLabelHint 는 DB 진실원천 fallback (앱 재시작 시 복원용).
   */
  private readonly _labelCounter = new Map<string, number>();

  constructor(options: MeetingSessionOptions) {
    const { meetingId, channelId, projectId, topic, participants, ssmCtx } =
      options;

    if (!meetingId) {
      throw new Error('[MeetingSession] meetingId must be non-empty');
    }
    if (!channelId) {
      throw new Error('[MeetingSession] channelId must be non-empty');
    }
    if (!projectId) {
      throw new Error('[MeetingSession] projectId must be non-empty');
    }
    if (typeof topic !== 'string' || topic.trim().length < 3) {
      throw new Error(
        '[MeetingSession] topic must be a string of at least 3 characters',
      );
    }

    if (ssmCtx.meetingId !== meetingId) {
      throw new Error(
        `[MeetingSession] ssmCtx.meetingId (${ssmCtx.meetingId}) must match meetingId (${meetingId})`,
      );
    }
    if (ssmCtx.channelId !== channelId) {
      throw new Error(
        `[MeetingSession] ssmCtx.channelId (${ssmCtx.channelId}) must match channelId (${channelId})`,
      );
    }
    if (ssmCtx.projectId !== projectId) {
      throw new Error(
        `[MeetingSession] ssmCtx.projectId (${ssmCtx.projectId}) must match projectId (${projectId})`,
      );
    }

    const aiParticipants = participants.filter((p) => p.id !== 'user');
    if (aiParticipants.length < 2) {
      throw new Error(
        `[MeetingSession] a meeting requires at least 2 AI participants (got ${aiParticipants.length})`,
      );
    }

    this.meetingId = meetingId;
    this.channelId = channelId;
    this.projectId = projectId;
    this.topic = topic;
    this.ssmCtx = ssmCtx;
    this.channelRole = options.channelRole;
    this._title = options.title ?? topic;
    this._messages = [];
    this._participants = [...participants];
    this._taskSettings = options.taskSettings ?? null;
    this.sourceHandoffContext = options.sourceHandoffContext ?? null;

    // D-A T2.5 / spec §5.5 — 회의 주제 첫 system 메시지 주입. round2.6 회귀
    // 차단 invariant — _messages[0] 은 항상 topic 시스템 메시지.
    this._messages.push({
      id: randomUUID(),
      role: 'system',
      content: buildTopicSystemPrompt(topic),
      participantId: SYSTEM_TOPIC_PARTICIPANT_ID,
      participantName: SYSTEM_TOPIC_PARTICIPANT_NAME,
    });

    // R12-C2 T29 — 받는 부서 H2 진입 시 보낸 부서 회의록 + 작업 list 를 topic
    // 직후 system message 로 주입. provider history 안 두 번째 system 메시지로
    // 들어가 직원이 첫 turn 시 컨텍스트 잃지 않음.
    if (
      typeof options.priorContextSystemMessage === 'string' &&
      options.priorContextSystemMessage.trim().length > 0
    ) {
      this._messages.push({
        id: randomUUID(),
        role: 'system',
        content: options.priorContextSystemMessage,
        participantId: SYSTEM_TOPIC_PARTICIPANT_ID,
        participantName: SYSTEM_TOPIC_PARTICIPANT_NAME,
      });
    }
  }

  // ── Identity / metadata ──────────────────────────────────────────

  get title(): string {
    return this._title;
  }

  set title(value: string) {
    this._title = value;
  }

  get messages(): readonly ParticipantMessage[] {
    return this._messages;
  }

  get participants(): readonly Participant[] {
    return this._participants;
  }

  /** AI 참가자만 — 'user' sentinel 제외. orchestrator turn loop 가 활용. */
  get aiParticipants(): readonly Participant[] {
    return this._participants.filter((p) => p.id !== 'user');
  }

  get taskSettings(): ConversationTaskSettings | null {
    return this._taskSettings;
  }

  /**
   * Update the project path on the SSM context — called when the project
   * folder is resolved after the meeting has already started (e.g. external
   * link resolution lands late). 옛 SSM 의 setProjectPath 호환 시그니처.
   */
  setProjectPath(projectPath: string): void {
    // ssmCtx 는 readonly object — 새 fields 만 mutate (기존 caller invariant).
    (this.ssmCtx as { projectPath: string }).projectPath = projectPath;
  }

  // ── Phase / round / opinion ID (T10a 신규) ──────────────────────────

  get currentPhase(): MeetingPhase {
    return this._phase;
  }

  /** orchestrator phase loop 가 호출 — phase 전환 시 stream emit 도 별도. */
  setPhase(phase: MeetingPhase): void {
    this._phase = phase;
  }

  get currentRound(): number {
    return this._round;
  }

  incrementRound(): void {
    this._round += 1;
  }

  /**
   * 새 의견 진입 시 라운드 카운터 리셋 (channels.max_rounds cap 은 *의견별*
   * 적용). orchestrator 가 free_discussion phase 안 의견 1 건 합의 시 호출.
   */
  resetRound(): void {
    this._round = 0;
  }

  get currentOpinionScreenId(): string | null {
    return this._currentOpinionScreenId;
  }

  setCurrentOpinionScreenId(screenId: string | null): void {
    this._currentOpinionScreenId = screenId;
  }

  // ── 발화 ID 카운터 (T10a 신규) ─────────────────────────────────────

  /**
   * 회의 단위 발화 ID 발급 — 형식 `<providerId>_<n>` (예 `codex_1`, `codex_2`,
   * `claude_1`). 호출 시점마다 카운터 +1, 발급된 ID 반환.
   *
   * OpinionService.nextLabelHint 는 *DB 기반 fallback* 으로 앱 재시작 시 복원
   * 용도. 정상 흐름에서는 본 in-memory 카운터가 진실원천. orchestrator 가
   * meeting boot 직후 nextLabelHint 결과로 카운터 prime 가능.
   *
   * @param providerId — provider 식별자 (label 의 prefix). 표시 이름 (Codex)
   *   이 아닌 *id* 사용 (codex). label 과 author_provider_id 의 매핑 일관성을
   *   위해 caller (turn-executor) 가 결정.
   */
  nextLabel(providerId: string): string {
    const next = (this._labelCounter.get(providerId) ?? 0) + 1;
    this._labelCounter.set(providerId, next);
    return `${providerId}_${next}`;
  }

  /**
   * 카운터 prime — DB 에 이미 발급된 label 이 있을 때 (앱 재시작 / 회의
   * 재진입 etc.) `nextLabelHint` 결과로 in-memory 카운터를 미리 끌어올림.
   * 호출 후 nextLabel(providerId) 부터 hint 값으로 시작.
   *
   * @param providerId — counter key
   * @param nextNumber — 다음 발급될 번호 (1-based). DB 가 비어있으면 1.
   */
  primeLabelCounter(providerId: string, nextNumber: number): void {
    if (nextNumber < 1) {
      throw new Error(
        `[MeetingSession] primeLabelCounter: nextNumber must be ≥ 1 (got ${nextNumber})`,
      );
    }
    // 저장 = 마지막 발급 번호 (= next - 1). nextLabel 이 +1 해서 발급.
    this._labelCounter.set(providerId, nextNumber - 1);
  }

  // ── abort (T10a 신규) ──────────────────────────────────────────────

  get aborted(): boolean {
    return this._aborted;
  }

  /**
   * abort 플래그 set + phase=`aborted`. orchestrator 가 phase loop 진입 직전
   * 매 단계 가드 — abort 후 새 phase 진입 X. 이미 진행 중인 turn-executor
   * 호출은 자체 abort signal 로 별도 끊는다 (turn-executor 책임).
   */
  abort(): void {
    if (this._aborted) return;
    this._aborted = true;
    this._phase = 'aborted';
  }

  // ── Message management ───────────────────────────────────────────

  /** Append a pre-constructed message to the in-memory buffer. */
  addMessage(message: ParticipantMessage): void {
    this._messages.push(message);
  }

  /** Construct and append a participant message in one step. */
  createMessage(options: {
    id?: string;
    participantId: string;
    participantName: string;
    role: Message['role'];
    content: Message['content'];
    metadata?: Record<string, unknown>;
  }): ParticipantMessage {
    const msg: ParticipantMessage = {
      id: options.id ?? randomUUID(),
      role: options.role,
      content: options.content,
      participantId: options.participantId,
      participantName: options.participantName,
      metadata: options.metadata,
    };
    this._messages.push(msg);
    return msg;
  }

  /**
   * Return the history formatted for the given provider — anthropic / openai /
   * Ollama have slightly different role strings + tool-call conventions.
   * Adapter 는 engine/history.ts (shared asset) 에 그대로.
   */
  getMessagesForProvider(participantId: string): Message[] {
    return adaptMessagesForProvider(this._messages, participantId);
  }

  /**
   * Append a user message to the meeting buffer. New phase loop model 에서
   * TurnManager interrupt flag 가 사라졌으므로 본 method 와 appendUserMessage
   * 의 구별이 흐려졌다 — 둘 다 메시지 push 만 하고 phase loop 가 다음 turn
   * 경계에서 자연스럽게 prompt 안에 user 메시지 포함.
   *
   * @throws when `message.role !== 'user'` — 옛 시그니처 그대로 enforce.
   */
  interruptWithUserMessage(message: ParticipantMessage): void {
    if (message.role !== 'user') {
      throw new Error(
        `[MeetingSession] interruptWithUserMessage requires role='user' (got '${message.role}')`,
      );
    }
    this._messages.push(message);
  }

  /**
   * D-A T5 auto-trigger seed — 회의 첫 user 메시지를 메시지 버퍼에 push.
   * interruptWithUserMessage 와 동일 효과 (새 phase loop 모델은 둘 다 push
   * 만) — 옛 시그니처 호환을 위해 둘 다 보존.
   */
  appendUserMessage(message: ParticipantMessage): void {
    if (message.role !== 'user') {
      throw new Error(
        `[MeetingSession] appendUserMessage requires role='user' (got '${message.role}')`,
      );
    }
    this._messages.push(message);
  }

  // ── Serialization ────────────────────────────────────────────────

  /** Produce an IPC-safe projection for renderer / logging consumers. */
  toInfo(): MeetingSessionInfo {
    return {
      meetingId: this.meetingId,
      channelId: this.channelId,
      projectId: this.projectId,
      title: this._title,
      topic: this.topic,
      phase: this._phase,
      participants: [...this._participants],
      currentRound: this._round,
      currentOpinionScreenId: this._currentOpinionScreenId,
      aborted: this._aborted,
    };
  }

  // ── R12-W T8: 채널 권한 캐시 + invalidation ─────────────────────────

  /**
   * ChannelService 의 `'permission-changed'` event 를 구독해 본 세션
   * 채널에 변경이 발생하면 cache dirty 마킹. 회의 시작 직후 (gather phase
   * 첫 turn 전) 한 번 호출. 멱등 — 두 번째 호출 무시.
   */
  attachPermissionInvalidation(svc: ChannelService): void {
    if (this._permissionListener !== null) return;
    this._permissionListener = (p) => {
      if (p.channelId === this.channelId) {
        this._permissionSnapshotDirty = true;
      }
    };
    svc.on(PERMISSION_CHANGED_EVENT, this._permissionListener);
  }

  /**
   * 구독 해제. 회의 종료 / dispose 시 호출. 미부착 상태에서는 no-op.
   * 같은 svc 인스턴스로 attach/detach 대칭이 invariant — 다른 svc 를 넘기면
   * listener 가 영구히 살아남는다 (메모리 누수). 단위 테스트가 listenerCount
   * 로 검증.
   */
  detachPermissionInvalidation(svc: ChannelService): void {
    if (this._permissionListener === null) return;
    svc.off(PERMISSION_CHANGED_EVENT, this._permissionListener);
    this._permissionListener = null;
  }

  /**
   * 채널 권한 set 을 반환. 첫 호출이면 resolver 통해 hydration 후 cache,
   * 이후는 cache 사용. 사용자가 권한을 바꿔 dirty=true 이면 재조회 후 cache
   * 갱신. resolver 에러는 propagate (silent fallback 금지).
   */
  getPermissions(resolver: ChannelPermissionResolver): PermissionSet {
    if (this._permissionSnapshot === null || this._permissionSnapshotDirty) {
      this._permissionSnapshot = resolver.resolve(this.channelId);
      this._permissionSnapshotDirty = false;
    }
    return this._permissionSnapshot;
  }
}
