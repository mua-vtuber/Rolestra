/**
 * Circuit Breaker 도메인 타입 — R10-Task1 + R10-Task9 persistence.
 *
 * R9 는 `src/main/queue/circuit-breaker.ts` 에 in-memory counter 만 유지했다.
 * R10-Task9 에서 migration 012 `circuit_breaker_state` 테이블이 추가되면서
 * (project_id, tripwire) 를 PRIMARY KEY 로 하는 4 row/project 를 부팅 시
 * hydrate, record 시 debounced flush 하는 방식으로 전환된다(Decision D6).
 *
 * 여기서는 in-memory/persistence 양쪽에서 공유하는 enum + record 스키마만
 * 정의한다. Service 로직은 main-process 전용.
 */

/**
 * 4 tripwire enum — R9 에서 이미 service 안에 inline 으로 존재했지만
 * R10 persistence 를 위해 shared 로 이동.
 *
 * - `files_per_turn`       : 단일 턴에서 변경한 파일 수가 한계 초과.
 * - `cumulative_cli_ms`    : 세션 누적 CLI 실행 시간이 한계 초과.
 * - `queue_streak`         : 큐 항목을 연속으로 N 건 이상 자동 실행.
 * - `same_error`           : 같은 카테고리의 오류가 연속 N 회 발생.
 */
export type CircuitBreakerTripwire =
  | 'files_per_turn'
  | 'cumulative_cli_ms'
  | 'queue_streak'
  | 'same_error';

export const CIRCUIT_BREAKER_TRIPWIRES: readonly CircuitBreakerTripwire[] = [
  'files_per_turn',
  'cumulative_cli_ms',
  'queue_streak',
  'same_error',
] as const;

/**
 * 012 `circuit_breaker_state` 테이블의 row — R10-Task9.
 *
 * PRIMARY KEY `(project_id, tripwire)` 이므로 project 당 정확히 4 row 가
 * 앱 수명 동안 idempotent 하게 유지된다(`INSERT OR IGNORE` seed).
 *
 * - `counter`        : 현재 누적값. tripwire 별 단위 상이(파일 수/ms/건수).
 * - `limit`          : 발동 한계(설정 UI 에서 조정 가능, 기본값은
 *                      `DEFAULT_CIRCUIT_BREAKER_LIMITS`).
 * - `lastResetAt`    : 가장 최근 counter reset 시점(ms epoch). 재개 버튼
 *                      또는 autonomyMode 토글 때 갱신.
 * - `lastUpdatedAt`  : 가장 최근 record 시점(ms epoch). flush debounce 의
 *                      "최근" 기준.
 */
export interface CircuitBreakerStateRecord {
  projectId: string;
  tripwire: CircuitBreakerTripwire;
  counter: number;
  limit: number;
  lastResetAt: number;
  lastUpdatedAt: number;
}

/**
 * tripwire 별 기본 한계 — R9 에서 service inline 상수로 존재했던 값.
 *
 * `files_per_turn`  : 단일 턴 20 파일 초과 시 fire.
 * `cumulative_cli_ms`: 세션 누적 10분(600_000 ms) 초과 시 fire.
 * `queue_streak`    : 큐 연속 자동 실행 5건 초과 시 fire.
 * `same_error`      : 동일 카테고리 오류 3연속 시 fire.
 */
export const DEFAULT_CIRCUIT_BREAKER_LIMITS: Readonly<
  Record<CircuitBreakerTripwire, number>
> = Object.freeze({
  files_per_turn: 20,
  cumulative_cli_ms: 600_000,
  queue_streak: 5,
  same_error: 3,
});
