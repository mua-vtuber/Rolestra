/**
 * handoff-pending-state — R12-C2 P6 T28. spec §11.18.8c (handoff_mode 우회 룰).
 *
 * `handoff_mode='check'` 분기에서 사용자 결재 모달이 [확인] / [취소] 결정 *전*
 * 까지 합성된 HandoffPackage 를 잠시 보관하는 휘발성 boundary. 사용자가 채널을
 * 떠나도 모달이 닫혀도, 다시 진입 시 모달 재 surface 가 가능하도록 in-memory
 * Map 으로 회의 단위 (meetingId 키) 보존.
 *
 * 사무실 메타포: 결재 받을 외주 의뢰서가 *책상 위* 에 놓여 있다. 사용자가
 * [확인] 도장 찍기 전까지는 그대로 책상 위. [확인] = 외주 발송 (handoff_dispatch
 * 영속 + 받는 부서 진입). [취소] = 휴지통 (메모리에서 제거, dispatch X).
 *
 * 본 모듈의 정책 정합:
 *
 *   - **단일 보관처**: 한 회의는 외주 의뢰서 0 또는 1 건 (R12-C2 시점 단일 인계
 *     가정). put 호출 시 같은 meetingId 가 이미 있으면 throw — 사용자/감사 trail
 *     에 명시 노출 (silent overwrite 금지).
 *   - **휘발성**: app 재시작 시 모든 pending 사라짐. 의도 — 회의 진행 중 인계
 *     의뢰서가 책상에서 사라져도 사용자는 회의록을 보고 새 회의 소집 가능.
 *     영속화는 R13+ 책임 (DB 컬럼 별도, R12-C2 시점 우선순위 X).
 *   - **idempotent 조회**: `get` 은 read-only — 여러 번 호출해도 동일 row 반환
 *     (모달이 닫혔다 다시 열려도 동일 의뢰서 surface).
 *   - **명시 take**: `take` 만 메모리에서 제거 — IPC handoff:approve / cancel 의
 *     단일 호출 path. read-modify-write race 가 없도록 *동기 메서드*.
 *
 * 본 모듈은 *순수 상태 보관소* — DB 접근 / 시간 lookup / IPC emit 모두 caller
 * (orchestrator + IPC handler) 책임. 단위 테스트로 put / get / take / hasPending
 * + invariant 통째 검증.
 *
 * spec docs/specs/2026-05-01-rolestra-channel-roles-design.md
 *  - §11.18.8c   handoff_mode 우회 룰 (check = 모달, auto = 자동)
 *
 * plan docs/R12_c2_2R/plans/2026-05-04-rolestra-phase-r12-c2.md
 *  - line 484-499  T28 산출 (HandoffApprovalModal + B handoff_mode 우회 wire)
 */

import type { HandoffPackage } from '../../shared/schema/handoff-package';

// ── invariant error ──────────────────────────────────────────────────

/**
 * `HandoffPendingState` 메서드의 invariant 위반 시 throw — caller (orchestrator
 * / IPC handler) 가 catch 후 사용자 노출 에러 분기. silent overwrite / silent
 * skip 금지 (CLAUDE.md).
 */
export class HandoffPendingStateInvariantError extends Error {
  constructor(message: string) {
    super(`[HandoffPendingState] ${message}`);
    this.name = 'HandoffPendingStateInvariantError';
  }
}

// ── service ──────────────────────────────────────────────────────────

export class HandoffPendingState {
  private readonly map = new Map<string, HandoffPackage>();

  /**
   * 합성된 HandoffPackage 를 회의 단위 등록. 동일 meetingId 가 이미 있으면 throw —
   * 한 회의가 두 번 'handoff' phase 에 진입할 수 없다는 invariant 보존.
   *
   * caller (orchestrator) 책임:
   *   - HandoffPackage 는 이미 `buildHandoffPackage` 통과한 검증된 객체
   *   - meetingId 는 보낸 회의의 UUID (= pkg.sender.meetingId)
   *
   * @throws {HandoffPendingStateInvariantError}  meetingId blank / 이미 존재
   */
  put(meetingId: string, pkg: HandoffPackage): void {
    if (meetingId.trim().length === 0) {
      throw new HandoffPendingStateInvariantError('meetingId must not be empty');
    }
    if (this.map.has(meetingId)) {
      throw new HandoffPendingStateInvariantError(
        `pending package already exists for meeting ${meetingId} — silent overwrite forbidden`,
      );
    }
    if (pkg.sender.meetingId !== meetingId) {
      throw new HandoffPendingStateInvariantError(
        `meetingId (${meetingId}) does not match pkg.sender.meetingId (${pkg.sender.meetingId}) — ` +
          'caller must use the same id',
      );
    }
    this.map.set(meetingId, pkg);
  }

  /**
   * 회의 단위 pending 의뢰서 lookup. 모달 재 surface / 채널 unread badge 판정에
   * 사용. read-only — 메모리에서 제거 X.
   *
   * @returns  존재하면 HandoffPackage, 미존재면 null.
   */
  get(meetingId: string): HandoffPackage | null {
    return this.map.get(meetingId) ?? null;
  }

  /**
   * 회의 단위 pending 의뢰서 *take* — IPC handoff:approve / cancel 의 단일 entry.
   * approve 시 caller 가 take 결과 받아 HandoffDispatchService.dispatch 호출,
   * cancel 시 caller 가 take 결과 *버림* (DB 영속 X).
   *
   * @returns  존재하면 HandoffPackage 후 메모리 제거, 미존재면 null (no-op).
   */
  take(meetingId: string): HandoffPackage | null {
    const pkg = this.map.get(meetingId) ?? null;
    if (pkg !== null) {
      this.map.delete(meetingId);
    }
    return pkg;
  }

  /**
   * pending 존재 여부. UI badge / 사이드바 dot 표시 용 — 가벼운 폴링/이벤트 갱신.
   * read-only.
   */
  hasPending(meetingId: string): boolean {
    return this.map.has(meetingId);
  }

  /**
   * 받는 채널 단위 pending 의뢰서 list. 받는 채널 사이드바 unread badge 합산용 —
   * 한 채널이 여러 회의에서 pending 받을 수 있음 (R13+ 가능, R12-C2 단일 가정
   * 위반은 caller 의 다른 invariant 가 차단).
   */
  listByReceiverChannel(channelId: string): HandoffPackage[] {
    const result: HandoffPackage[] = [];
    for (const pkg of this.map.values()) {
      if (pkg.target.channelId === channelId) {
        result.push(pkg);
      }
    }
    return result;
  }

  /** 테스트 / dev hook — 모든 pending 즉시 비움. production 코드 호출 금지. */
  clear(): void {
    this.map.clear();
  }
}
