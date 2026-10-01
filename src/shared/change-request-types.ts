/**
 * 변경 요청 규모 — R12-C2 T33 (spec §11.17 위 §11.12.5).
 *
 * 자동 워크플로우가 도는 중에 사용자가 기능을 바꾸거나 더하고 싶을 때,
 * 그 규모에 따라 처리 경로가 다르다:
 *
 *   `small`   버튼 문구 / 색 / 사소한 표현 — 진행 중인 회의에 끼어든다.
 *   `medium`  요구사항 1 개 추가 / 작은 기능 — 회의를 멈추고 기획 부서로
 *             변경 인계, 재계획 후 재개. spec 이 정한 **기본값**.
 *   `large`   다른 기능 / 골격 변경 — 지금 흐름은 그대로 두고 대기열에 새
 *             할 일로 등록.
 */
export type ChangeRequestScale = 'small' | 'medium' | 'large';

/** 세 규모의 목록 — 화면의 라디오 선택지와 zod enum 이 함께 읽는 정본. */
export const CHANGE_REQUEST_SCALES = [
  'small',
  'medium',
  'large',
] as const satisfies ReadonlyArray<ChangeRequestScale>;

/**
 * spec §11.17 이 정한 기본 선택. 중간이 기본인 이유: 작은 변경으로 잘못
 * 처리하면 요구사항이 계획에 반영되지 않은 채 작업이 이어지고, 큰 변경으로
 * 잘못 처리하면 지금 필요한 변경이 한참 뒤로 밀린다.
 */
export const DEFAULT_CHANGE_REQUEST_SCALE: ChangeRequestScale = 'medium';

/** `meeting:change-request` 응답 — 규모별로 채워지는 자리가 다르다. */
export interface ChangeRequestOutcome {
  scale: ChangeRequestScale;
  /** 일시정지된 회의 id — 중간 변경일 때만. */
  pausedMeetingId: string | null;
  /** 기획 부서로 보낸 인계 row id — 중간 변경일 때만. */
  dispatchRowId: string | null;
  /** 대기열에 넣은 할 일 id — 큰 변경일 때만. */
  queueItemId: string | null;
}
