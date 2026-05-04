/**
 * ApprovalNotificationBridge — R7-Task11 spec §7.8 approval_pending 트리거.
 *
 * ApprovalService 의 `'created'` 이벤트를 구독해 `NotificationService.show`
 * 를 `kind='approval_pending'` 으로 호출한다. 다음 두 가지 gate 는
 * NotificationService 내부(prefs + focus)에 맡기므로 여기서는 중복하지 않는다:
 *   - prefs.approval_pending.enabled=false → show() 가 null 반환, OS 알림 0.
 *   - 포커스된 창 존재 → show() 가 null 반환, OS 알림 0.
 *
 * Bridge 고유 책임:
 *   1. `'created'` 이벤트를 적절한 `ShowNotificationInput` 으로 변환(제목/본문
 *      은 approval kind 별로 한국어 고정 라벨 — Task 12 가 필요 시 renderer
 *      치환으로 i18n).
 *   2. 같은 approval id 에 대해 짧은 창(기본 5s) 내 중복 show 를 억제 —
 *      ApprovalService 가 같은 row 에 두 번 'created' 를 emit 하지는 않지만
 *      테스트에서 repeat emit 이 실수로 발생해도 OS 알림이 2 번 터지지 않도록
 *      방어선.
 *
 * 클릭 경로는 NotificationService.handleClick → 'clicked' 이벤트 → StreamBridge
 * → `stream:notification-clicked`(같은 Task 11). 렌더러가 이 이벤트를 받아
 * #승인-대기 채널로 라우팅한다.
 */

import type { ApprovalItem } from '../../shared/approval-types';
import { APPROVAL_CREATED_EVENT } from './approval-service';
import { resolveNotificationLabel } from '../notifications/notification-labels';

/** NotificationService 중 bridge 가 필요한 최소 surface. */
export interface ApprovalNotificationSink {
  show(input: {
    kind: 'approval_pending';
    title: string;
    body: string;
    channelId?: string | null;
  }): unknown;
}

/** ApprovalService 에서 필요한 surface 만 좁힌 view — 테스트가 EventEmitter 만
 *  가진 fake 로 돌아갈 수 있게 만든다(같은 패턴 SystemMessageInjector 참고). */
export interface ApprovalNotificationSource {
  on(
    event: typeof APPROVAL_CREATED_EVENT,
    listener: (item: ApprovalItem) => void,
  ): this;
  off(
    event: typeof APPROVAL_CREATED_EVENT,
    listener: (item: ApprovalItem) => void,
  ): this;
}

export interface ApprovalNotificationBridgeDeps {
  approvalService: ApprovalNotificationSource;
  notificationService: ApprovalNotificationSink;
  /** 중복 suppress 윈도우(ms). 기본 5000. */
  dedupeWindowMs?: number;
  /** 테스트가 시계를 고정하기 위한 훅. 기본 `Date.now`. */
  now?: () => number;
}

const DEFAULT_DEDUPE_WINDOW_MS = 5_000;

/**
 * Approval kind 별 title/body 라벨. R11-Task11 (D9) 이후 모든 fixed
 * string 은 main-process `notification-labels` dictionary 에서 해석되며,
 * 본 파일은 payload-derived summary 만 직접 합성한다. 비어있는 summary
 * 는 dictionary fallback (`approvalNotificationBridge.<kind>.body`) 로
 * 떨어져 ko/en 양쪽이 일관되게 렌더된다.
 */
const KIND_BODY_BUILDERS: Readonly<
  Record<ApprovalItem['kind'], (item: ApprovalItem) => string | null>
> = Object.freeze({
  cli_permission: (item) => summariseCliPermission(item),
  mode_transition: (item) => summariseModeTransition(item),
  review_outcome: () => null,
  failure_report: () => null,
  // R9-Task6: `circuit_breaker` is emitted by v3-side-effects when an
  // autonomy tripwire fires. The primary user-facing notification is
  // the dedicated `handleBreakerFired` path (richer per-tripwire
  // copy), but ApprovalService 'created' still fires here — R7-Task11
  // wiring must not leave the bridge in the "missing kind" failure
  // branch, so we fall back to the dictionary entry (D9 — locale aware).
  circuit_breaker: () => null,
});

function summariseCliPermission(item: ApprovalItem): string | null {
  const p = item.payload as
    | { participantName?: string; toolName?: string; target?: string }
    | null;
  if (!p) return null;
  const who = typeof p.participantName === 'string' ? p.participantName : '';
  const tool = typeof p.toolName === 'string' ? p.toolName : '';
  const target = typeof p.target === 'string' ? p.target : '';
  const parts = [who, tool && target ? `${tool} (${target})` : tool || target]
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts.join(' — ') : null;
}

function summariseModeTransition(item: ApprovalItem): string | null {
  const p = item.payload as
    | { currentMode?: string; targetMode?: string }
    | null;
  if (!p) return null;
  return `${p.currentMode ?? '?'} → ${p.targetMode ?? '?'}`;
}

/** Compose the dotted dictionary key for an approval kind label leaf. */
function bridgeKey(
  kind: ApprovalItem['kind'],
  leaf: 'title' | 'body',
):
  | `approvalNotificationBridge.${ApprovalItem['kind']}.title`
  | `approvalNotificationBridge.${ApprovalItem['kind']}.body` {
  return `approvalNotificationBridge.${kind}.${leaf}` as
    | `approvalNotificationBridge.${ApprovalItem['kind']}.title`
    | `approvalNotificationBridge.${ApprovalItem['kind']}.body`;
}

export class ApprovalNotificationBridge {
  private readonly listener: (item: ApprovalItem) => void;
  private readonly lastSeen = new Map<string, number>();
  private wired = false;

  constructor(private readonly deps: ApprovalNotificationBridgeDeps) {
    this.listener = (item) => this.handleCreated(item);
  }

  wire(): () => void {
    if (!this.wired) {
      this.deps.approvalService.on(APPROVAL_CREATED_EVENT, this.listener);
      this.wired = true;
    }
    return (): void => {
      if (this.wired) {
        this.deps.approvalService.off(APPROVAL_CREATED_EVENT, this.listener);
        this.wired = false;
      }
    };
  }

  private handleCreated(item: ApprovalItem): void {
    const window = this.deps.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
    const now = (this.deps.now ?? Date.now)();
    const seenAt = this.lastSeen.get(item.id);
    if (seenAt !== undefined && now - seenAt < window) {
      return;
    }
    this.lastSeen.set(item.id, now);
    // Tiny LRU cleanup — keep the map from growing unbounded across long
    // sessions. 128 is a generous cap for an OS notification dedupe set
    // (users rarely outpace this in a single dedupe window).
    if (this.lastSeen.size > 128) {
      const cutoff = now - window;
      for (const [id, ts] of this.lastSeen) {
        if (ts < cutoff) this.lastSeen.delete(id);
      }
    }

    const summary = KIND_BODY_BUILDERS[item.kind](item);
    const title = resolveNotificationLabel(bridgeKey(item.kind, 'title'));
    const body =
      summary ?? resolveNotificationLabel(bridgeKey(item.kind, 'body'));
    try {
      this.deps.notificationService.show({
        kind: 'approval_pending',
        title,
        body,
        channelId: item.channelId,
      });
    } catch (err) {
      // NotificationService.show is defensive but we still isolate here
      // so an adapter bug cannot poison the ApprovalService listener chain.
      // TODO R2-log: swap for structured logger.
      console.warn(
        '[rolestra.approvals.notification-bridge] notificationService.show threw:',
        {
          approvalId: item.id,
          name: err instanceof Error ? err.name : undefined,
          message: err instanceof Error ? err.message : String(err),
        },
      );
    }
  }
}
