/**
 * handoff-dispatch row 타입 — R12-C2 P6 T27. spec §11.22.3 (handoff_dispatch
 * 데이터 source) + migration 022 컬럼과 1:1 매핑.
 *
 * 본 타입은 *main process 안 영속 boundary 전용* — IPC / renderer 쪽으로는
 * {@link HandoffPackage} (`src/shared/schema/handoff-package.ts`) 형식이
 * 통용된다. row 와 HandoffPackage 의 매핑은 HandoffDispatchService 책임.
 *
 * 관련 모듈:
 *   - migration 022-handoff-dispatch.ts        DB schema (원천)
 *   - src/shared/schema/handoff-package.ts     IPC + builder layer
 *   - HandoffDispatchService                   row ↔ HandoffPackage 매핑 + 영속
 */

import type { HandoffMode } from '../../shared/channel-role-types';

/**
 * handoff_dispatch row 의 *완전한* shape — id / opened_at / created_at 모두 채워진
 * 영속된 row. service 가 select / dispatch return 시 본 type 으로 반환.
 *
 * SQL snake_case 컬럼은 repository 안에서 camelCase 로 매핑 — main process 코드는
 * camelCase 만 통용 (CodingRule).
 */
export interface HandoffDispatchRow {
  /** UUID v4. row PK. */
  id: string;
  /** 보낸 회의 식별자 (= sender.meetingId). FK CASCADE. */
  fromMeetingId: string;
  /** 보낸 부서 채널 (= sender.channelId). FK CASCADE. */
  fromChannelId: string;
  /** 받는 부서 채널 (= target.channelId). FK CASCADE. */
  toChannelId: string;
  /** 인계 사유 (자유 텍스트). UI 라벨 "인계 사유" 자리. */
  reason: string;
  /**
   * 회의록 식별자 (= 회의 id). 회의록 본문은 파일 한 곳 — 본 컬럼은 식별자만.
   * NULL = 회의 외 진입 (사용자 변경 요청 등 — caller 가 mission card body 만으로
   * 작업 시작).
   */
  minutesId: string | null;
  /**
   * MissionCard 직렬화 JSON 문자열 (`serializeMissionCard` 결과). 받는 부서
   * designated worker prompt 컨텍스트.
   */
  missionCardJson: string;
  /** handoff_mode 분기 — 'check' (사용자 결재 모달) / 'auto' (자동 + Notification). */
  mode: HandoffMode;
  /** 보낸 시각 Unix epoch ms. 회의 종결 직후. */
  dispatchedAt: number;
  /**
   * 받는 부서 첫 진입 시각 Unix epoch ms. NULL = 미열람. service.open 이 첫 호출
   * 시점에 1 회만 set (이후 호출은 idempotent — 기존 값 유지).
   */
  openedAt: number | null;
  /**
   * row insert 시각 Unix epoch ms. 보통 dispatchedAt 과 동일하지만 별 컬럼으로
   * 보존 — 향후 retry / 재발송 시 dispatchedAt != createdAt 구분 가능.
   */
  createdAt: number;
}

/**
 * 영속 *전* (insert 직전) row — service 가 id (UUID) + createdAt (now) +
 * openedAt (NULL) 채우기 전의 입력 형식.
 *
 * caller 는 본 type 의 모든 필드를 채워서 service.dispatch 에 넘긴다 — service
 * 가 누락 필드 알아서 채우는 일은 *없음* (silent fallback 금지).
 */
export type NewHandoffDispatch = Omit<
  HandoffDispatchRow,
  'id' | 'openedAt' | 'createdAt'
>;
