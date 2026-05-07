/**
 * HandoffDispatchRowSummary — R12-C2 P6 T29 IPC 경계용 요약 타입.
 *
 * main process 의 `HandoffDispatchRow` (`src/main/handoff/handoff-dispatch-types.ts`)
 * 는 SQLite row 의 직접 매핑 — IPC 직렬화 시점에 mission_card_json 문자열을
 * 다시 검증된 HandoffPackage 로 inflate 해서 renderer 에 보낸다. 본 타입이 그
 * IPC payload 형식.
 *
 * renderer 가 받는 데이터는 (1) HandoffPackage 통째 (검증됨) + (2) row metadata
 * (id / openedAt / createdAt) 두 영역. row metadata 는 sender/target 정보처럼
 * package 안에 이미 있어도 *영속된 row* 의 식별자 (id) 와 *열람 도장* (openedAt)
 * 은 package 밖이라 별 필드.
 */

import type { HandoffPackage } from '../schema/handoff-package';

export interface HandoffDispatchRowSummary {
  /** handoff_dispatch row PK (UUID). IPC handoff:open 호출 시 caller 가 사용. */
  id: string;
  /** 검증된 HandoffPackage (mission_card_json + sender/target/reason 통째). */
  package: HandoffPackage;
  /**
   * 받는 부서 첫 진입 시각 Unix epoch ms. NULL = 미열람 (아직 카드 surface 안 됨).
   * mark opened 후 다음 lookup 시 채워진 값으로 반환된다.
   */
  openedAt: number | null;
  /** row insert 시각. dispatchedAt 과 동일 또는 약간 늦음. */
  createdAt: number;
}
