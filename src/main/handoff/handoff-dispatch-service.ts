/**
 * HandoffDispatchService — R12-C2 P6 T27 부서 → 부서 *외주 의뢰서* 영속/조회
 * 본체.
 *
 * 사무실 메타포: 보낸 부서 회의가 끝나면 외주 의뢰서 한 장을 발송하고
 * (`dispatch`), 받는 부서가 처음 열어보면 도장 찍어 (`open`), 보낸 / 받은
 * 의뢰서 list 를 추적 (`track*`).
 *
 * 책임 (T27 plan line 478):
 *   - {@link dispatch}            HandoffPackage → handoff_dispatch row 영속
 *                                 (id UUID + createdAt now + openedAt null)
 *   - {@link open}                받는 부서 첫 진입 시 opened_at 캐시 (idempotent)
 *   - {@link trackByMeeting}      회의 단위 의뢰서 list (1 건 또는 0 건)
 *   - {@link trackByChannel}      받는 채널 단위 의뢰서 list (전체 / 미열람만)
 *   - {@link findById}            단일 의뢰서 lookup
 *
 * append-only + idempotent 정책:
 *   - row 는 한 번 영속되면 변경되지 않음 (audit trail). update / delete *공개
 *     메서드 없음*.
 *   - opened_at 만 NULL → epoch 으로 1 회 채워질 수 있음 — 두 번째 호출 이후는
 *     기존 값 유지 (open 이 idempotent).
 *
 * thin module 정책 (T16a/T17/T24/T25/T26 동일):
 *   - 본 service 는 HandoffPackage 검증 + row 매핑 + 영속만 — orchestrator wire,
 *     IPC handler, UI surface 는 *caller 책임*. caller 는 P6 다른 sub-task:
 *       T28 HandoffApprovalModal + B handoff_mode 우회 룰 wire
 *       T29 HandoffPackageCard 받는 부서 첫 화면 surface
 *       T30 검토 → 리뷰 Notification (auto 분기)
 *
 * spec docs/specs/2026-05-01-rolestra-channel-roles-design.md
 *  §11.18.8c   handoff_mode 우회 룰
 *  §11.22      H2. 받는 부서 첫 화면 인계 패키지
 *  §11.16      부서 lock 사이클 (인계 시점 = lock 풀림)
 */

import { randomUUID } from 'node:crypto';
import {
  buildHandoffPackage,
  serializeHandoffPackage,
  type HandoffPackage,
} from '../../shared/schema/handoff-package';
import {
  parseMissionCardJson,
  serializeMissionCard,
  type MissionCard,
} from '../../shared/schema/mission-card';
import type { HandoffDispatchRepository } from './handoff-dispatch-repository';
import type { HandoffDispatchRow } from './handoff-dispatch-types';

// ── invariant error ─────────────────────────────────────────────────

/**
 * HandoffDispatchService 메서드의 invariant 위반 시 throw — caller (orchestrator
 * / IPC handler) 가 catch 후 인계 abort + 사용자 노출 에러 분기.
 *
 * `HandoffPackageInvariantError` (zod 검증 실패) 는 본 service 가 *catch 하지
 * 않고 그대로 전파* — caller 가 두 종류의 에러를 구분해 처리. 이는 T26 의
 * `RunStepBridgeInvariantError` 가 `MissionCardInvariantError` 를 wrap 하지 않는
 * 정책과 동일.
 */
export class HandoffDispatchInvariantError extends Error {
  constructor(message: string) {
    super(`[HandoffDispatch] ${message}`);
    this.name = 'HandoffDispatchInvariantError';
  }
}

// ── service ─────────────────────────────────────────────────────────

export class HandoffDispatchService {
  constructor(private readonly repo: HandoffDispatchRepository) {}

  /**
   * HandoffPackage → handoff_dispatch row 영속. 본 메서드는 *경계 (boundary)
   * dispatch* — caller 가 schema 검증 안 한 raw 객체를 넘겨도 본 메서드가
   * `buildHandoffPackage` 한 번 더 통과시켜 안전 영속.
   *
   * caller 가 채울 책임:
   *   - HandoffPackage 의 모든 필드 (sender / target / reason / nextActions /
   *     missionCard / mode / dispatchedAt / minutesMeetingId)
   *   - missionCard 는 caller 가 `buildMissionCard` 통과한 검증된 카드
   *   - dispatchedAt 은 보통 `Date.now()` (테스트 가능성 위해 외부 주입)
   *
   * service 가 자동 채움:
   *   - row.id            UUID v4
   *   - row.createdAt     `now` (`Date.now()` — 외부 주입 X. dispatchedAt 과 보통
   *                       동일하지만 향후 retry 시점 구분 가능하도록 별 컬럼)
   *   - row.openedAt      null (받는 부서 미열람)
   *   - row.minutesId     pkg.minutesMeetingId (1:1 mapping)
   *   - row.missionCardJson  serializeMissionCard(pkg.missionCard)
   *
   * Invariant (zod 외 추가):
   *   - 본 서비스는 `buildHandoffPackage` 가 이미 self-handoff / target mismatch
   *     를 차단하므로 별도 검증 X. 그래도 caller 의 잘못된 입력 (예: 빈
   *     missionCard 직렬화) 은 SqliteError (CHECK 위반) 로 즉시 throw.
   *
   * @returns 영속된 row (id / createdAt / openedAt 채워진 상태).
   * @throws  {HandoffPackageInvariantError}    pkg schema 위반
   * @throws  {HandoffDispatchInvariantError}   dispatch 도메인 invariant 위반
   */
  dispatch(pkg: HandoffPackage): HandoffDispatchRow {
    // 1) zod 재검증 — IPC / 외부 source 에서 들어온 raw object 가능성 차단.
    const validated = buildHandoffPackage(pkg);

    // 2) 추가 도메인 invariant — caller 가 이미 검증한 필드라도 본 service
    //    레이어에서 한 번 더 체크 (영속 직전 마지막 방어선).
    if (!Number.isFinite(validated.dispatchedAt) || validated.dispatchedAt < 0) {
      throw new HandoffDispatchInvariantError(
        `dispatchedAt must be a finite non-negative epoch (got ${validated.dispatchedAt})`,
      );
    }
    if (validated.reason.trim().length === 0) {
      throw new HandoffDispatchInvariantError(
        'reason must not be blank (whitespace-only rejected)',
      );
    }

    // 3) row 합성 + insert.
    const row: HandoffDispatchRow = {
      id: randomUUID(),
      fromMeetingId: validated.sender.meetingId,
      fromChannelId: validated.sender.channelId,
      toChannelId: validated.target.channelId,
      reason: validated.reason,
      minutesId: validated.minutesMeetingId,
      missionCardJson: serializeMissionCard(validated.missionCard),
      mode: validated.mode,
      dispatchedAt: validated.dispatchedAt,
      openedAt: null,
      createdAt: Date.now(),
    };

    this.repo.insert(row);
    return row;
  }

  /**
   * 받는 부서가 의뢰서를 *처음* 열어볼 때 opened_at 캐시. 두 번째 호출부터는
   * 기존 값 유지 (idempotent — 사용자가 채널을 여러 번 들락날락해도 첫 진입
   * 시점만 보존).
   *
   * @param id      handoff_dispatch row id
   * @param now     열람 시각 Unix epoch ms (caller 가 `Date.now()` 또는 테스트
   *                주입). 음수 / NaN 거부.
   * @returns       row 자체 (열람 시각 포함). id 가 미존재면 null.
   *
   * @throws {HandoffDispatchInvariantError}  id 빈 문자열 / now invariant 위반
   */
  open(id: string, now: number): HandoffDispatchRow | null {
    if (id.trim().length === 0) {
      throw new HandoffDispatchInvariantError('id must not be empty');
    }
    if (!Number.isFinite(now) || now < 0) {
      throw new HandoffDispatchInvariantError(
        `now must be a finite non-negative epoch (got ${now})`,
      );
    }

    // markOpened 은 opened_at IS NULL 일 때만 update — 이미 set 이면 0 row
    // 영향. 두 case 모두 row 를 다시 select 해서 latest 상태 반환.
    this.repo.markOpened(id, now);
    return this.repo.findById(id);
  }

  /**
   * 단일 의뢰서 lookup. 모달 / 카드 surface 시 id 알고 있을 때.
   * row 없으면 null.
   */
  findById(id: string): HandoffDispatchRow | null {
    return this.repo.findById(id);
  }

  /**
   * 보낸 회의의 의뢰서 list. R12-C2 시점은 회의 1 → 의뢰서 0/1 건이라 list
   * 형식이 과도해 보일 수 있지만 R13+ 복수 부서 인계 대비 type 보존.
   */
  trackByMeeting(meetingId: string): HandoffDispatchRow[] {
    return this.repo.listByFromMeeting(meetingId);
  }

  /**
   * 받는 채널의 의뢰서 list. `unopenedOnly=true` 일 때 미열람만 — 받는 부서
   * 채널 entry 시 H2 첫 surface candidate list 조회.
   */
  trackByChannel(
    toChannelId: string,
    options: { unopenedOnly?: boolean } = {},
  ): HandoffDispatchRow[] {
    if (options.unopenedOnly === true) {
      return this.repo.listUnopenedByToChannel(toChannelId);
    }
    return this.repo.listByToChannel(toChannelId);
  }

  /**
   * 같은 의뢰서를 IPC payload (HandoffPackage 형태) 로 다시 inflate. 받는 부서
   * UI 가 row + 회의록 본문 + mission card body 를 surface 할 때, row 안의
   * mission_card_json 을 *이미 검증된 mission card* 로 풀어 둘 필요가 있음 —
   * 본 helper 가 한 곳에서 직렬화/역직렬화의 짝을 보장. caller 는 IPC handler
   * 안에서 본 메서드 결과를 그대로 IPC 응답 payload 로 사용 가능.
   *
   * 본 메서드는 row 를 *받지만* HandoffPackage 의 nextActions 를 모르므로
   * caller 가 빈 배열 또는 회의록 추출 결과를 명시적으로 넘긴다 (silent
   * fallback 금지).
   */
  serializeRowToPackage(
    row: HandoffDispatchRow,
    nextActions: readonly string[],
  ): string {
    const pkg: HandoffPackage = buildHandoffPackage({
      sender: {
        meetingId: row.fromMeetingId,
        channelId: row.fromChannelId,
        // channelRole 는 row 안에 없음 — caller 가 모르는 정보지만, 본 helper 는
        // boundary serialize 전용이라 NULL 로 deflate. 받는 부서 UI 가 channelRole
        // 이 필요하면 caller (IPC handler) 가 별 query 로 lookup 후 보완.
        channelRole: null,
      },
      target: {
        channelId: row.toChannelId,
        channelRole: null,
      },
      reason: row.reason,
      minutesMeetingId: row.minutesId,
      nextActions,
      missionCard: parseRowMissionCard(row.missionCardJson),
      mode: row.mode,
      dispatchedAt: row.dispatchedAt,
    });
    return serializeHandoffPackage(pkg);
  }
}

/**
 * row.missionCardJson 을 검증된 MissionCard 로 deflate. 본 helper 는 service 안
 * private 위치에 두지 않고 module-private 으로 둬 — 향후 별 caller (예: trace
 * tooling) 가 row 를 직접 검증할 일이 생기면 export 1 회 추가로 충분.
 *
 * JSON 파싱 실패 / schema 불일치 시 MissionCardInvariantError 그대로 전파
 * (caller 가 인계 abort 분기).
 */
function parseRowMissionCard(missionCardJson: string): MissionCard {
  return parseMissionCardJson(missionCardJson);
}
