/**
 * ApprovalSystemMessageInjector — spec §7.7 "다음 턴 시스템 메시지로 주입" 구현
 * (R7-Task6).
 *
 * `ApprovalService` 가 `'decided'` 이벤트를 발사하면 구독하여, 다음 조건이 모두
 * 성립할 때 단 한 번의 `MessageService.append` 로 kind='system' 메시지를 주입한다.
 *   1. `decision ∈ {'reject', 'conditional'}` — approve 는 주입할 이유 없음.
 *   2. `comment != null` 이고 `trim()` 후 길이 > 0 — 비어있는 comment 는 AI 에게
 *      줄 정보가 없다.
 *   3. 승인 row 에 `meetingId`, `channelId` 가 모두 살아있음 — mode_transition /
 *      review_outcome 처럼 routing 대상이 없는 approval 은 skip. (meetingId 만
 *      null, channelId 만 null 어느 쪽이든 skip 한다.)
 *
 * 주입된 system 메시지는 두 역할을 동시에 수행한다:
 *   a. Thread 에 SystemMessage 컴포넌트로 사용자에게 표시 (spec §7.7 "코멘트 자체가
 *      채팅에도 사용자 메시지로 표시").
 *   b. 다음 턴 MeetingTurnExecutor 가 conversation-scroll 을 AI 에게 전달할 때
 *      role='system' 로 prepended 되어 AI 가 거절/조건 사유를 읽는다 (§7.7).
 *
 * 비핵심 실패(예: channelService 가 없는 channel 로 append → trigger abort)는
 * `console.warn` 으로만 남기고 이벤트 루프에는 예외를 흘리지 않는다 —
 * `ApprovalService.decide` 가 이미 상태 전이를 commit 했기 때문에, 후속 side-effect
 * 의 실패가 역방향으로 전파되면 renderer 는 `decide` 요청이 성공했는데도 에러
 * banner 를 보게 된다. (MessageService.append emit guard 와 동일 철학.)
 *
 * 중복 발사 방지는 하지 않는다 — `decided` 는 id 당 한 번만 발사되는 계약이므로
 * (AlreadyDecidedError 가 재호출을 막는다), injector 가 별도 dedupe 를 둘 필요가
 * 없다. 테스트에서 같은 id 로 두 번 emit 하는 경우는 append 도 두 번 일어나며,
 * 이는 ApprovalService 계약 위반 쪽을 고쳐야 할 시그널이다.
 */

import type { Message } from '../../shared/message-types';
import { resolveNotificationLabel } from '../notifications/notification-labels';
import {
  APPROVAL_DECIDED_EVENT,
  type ApprovalDecidedPayload,
} from './approval-service';

/**
 * `ApprovalService` 에서 필요한 surface 만 좁힌 view — 테스트가 EventEmitter 만
 * 가진 fake 로 돌아갈 수 있게 만든다.
 */
export interface ApprovalSystemMessageSource {
  on(event: typeof APPROVAL_DECIDED_EVENT, listener: (payload: ApprovalDecidedPayload) => void): this;
  off(event: typeof APPROVAL_DECIDED_EVENT, listener: (payload: ApprovalDecidedPayload) => void): this;
}

/** `MessageService.append` 만 필요하므로 그 부분만 발췌한 인터페이스. */
export interface ApprovalSystemMessageSink {
  append(input: {
    channelId: string;
    meetingId?: string | null;
    authorId: string;
    authorKind: 'user' | 'member' | 'system';
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    meta?: { approvalRef?: string; [k: string]: unknown } | null;
  }): Message;
}

export interface ApprovalSystemMessageInjectorDeps {
  approvalService: ApprovalSystemMessageSource;
  messageService: ApprovalSystemMessageSink;
}

/** R10-Task12: locale-aware label resolution. Was a frozen Korean
 *  dictionary in R7; now reads through `notification-labels.ts` so
 *  `setNotificationLocale('en')` reaches this code path too. */
function resolveDecisionPrefix(decision: 'reject' | 'conditional'): string {
  return resolveNotificationLabel(
    decision === 'reject'
      ? 'approvalSystemMessage.rejectPrefix'
      : 'approvalSystemMessage.conditionalPrefix',
  );
}

function formatSystemMessage(
  decision: 'reject' | 'conditional',
  comment: string,
): string {
  return `${resolveDecisionPrefix(decision)} ${comment}`;
}

export class ApprovalSystemMessageInjector {
  private readonly listener: (payload: ApprovalDecidedPayload) => void;
  private wired = false;

  constructor(private readonly deps: ApprovalSystemMessageInjectorDeps) {
    this.listener = (payload) => this.handleDecided(payload);
  }

  /**
   * ApprovalService 의 'decided' 이벤트에 구독을 건다. 반환되는 disposer 를
   * 앱 종료 시점에 호출하면 listener 를 명시적으로 떼낼 수 있다. 중복 wire()
   * 는 no-op (두 번째 호출은 첫 번째 disposer 와 동일한 함수를 반환).
   */
  wire(): () => void {
    if (!this.wired) {
      this.deps.approvalService.on(APPROVAL_DECIDED_EVENT, this.listener);
      this.wired = true;
    }
    return (): void => {
      if (this.wired) {
        this.deps.approvalService.off(APPROVAL_DECIDED_EVENT, this.listener);
        this.wired = false;
      }
    };
  }

  private handleDecided(payload: ApprovalDecidedPayload): void {
    const { item, decision, comment } = payload;

    // Filter 1: decision
    if (decision !== 'reject' && decision !== 'conditional') {
      return;
    }

    // Filter 2: non-empty comment (trim)
    if (comment === null) return;
    const trimmed = comment.trim();
    if (trimmed.length === 0) return;

    // Filter 3: routable context
    if (item.channelId === null || item.meetingId === null) {
      return;
    }

    const content = formatSystemMessage(decision, trimmed);

    try {
      this.deps.messageService.append({
        channelId: item.channelId,
        meetingId: item.meetingId,
        authorId: 'system',
        authorKind: 'system',
        role: 'system',
        content,
        meta: { approvalRef: item.id },
      });
    } catch (err) {
      // TODO R2-log: swap for structured logger.
      console.warn(
        '[rolestra.approvals.injector] messages.append failed:',
        {
          approvalId: item.id,
          decision,
          name: err instanceof Error ? err.name : undefined,
          message: err instanceof Error ? err.message : String(err),
        },
      );
    }
  }
}
