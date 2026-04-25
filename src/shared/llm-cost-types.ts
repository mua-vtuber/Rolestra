/**
 * LLM 비용 / 토큰 audit 도메인 타입 (R11-Task5).
 *
 * 마이그레이션 014 (R11-Task8) 가 `llm_cost_audit_log` append-only 테이블을
 * 만들고, MeetingSummaryService 가 LLM 호출 시점에 한 행씩 적재한다.
 * Settings 의 "누적 비용" 카드는 IPC `llm:cost-summary` 로 집계 결과를 받는다.
 *
 * USD 단가는 사용자가 Settings 에서 직접 입력한 값 (Decision D5) — R11
 * default 는 0 이라 `estimatedUsd` 는 null 가능. token 량만으로도 가시화는
 * 충분히 의미가 있다.
 */

/**
 * 단일 LLM 호출 audit row. 마이그레이션 014 컬럼과 1:1 camelCase 매핑.
 *
 * - `meetingId` — 회의 종료 후 요약 호출은 meetingId 가 있고, 분류기/스모크
 *   호출은 null.
 * - `tokenIn` / `tokenOut` — provider 가 보고한 prompt / completion 토큰 수.
 *   provider 가 보고하지 않으면 0 으로 적재 (over-counting 방지).
 * - `createdAt` — Date.now() millisecond.
 */
export interface LlmCostAuditEntry {
  id: number;
  meetingId: string | null;
  providerId: string;
  tokenIn: number;
  tokenOut: number;
  createdAt: number;
}

/**
 * `llm:cost-summary` 응답 — provider 별 + 전체 합계.
 *
 * - `byProvider[].estimatedUsd` — 사용자가 Settings 에 입력한 단가가 있을 때만
 *   계산. 단가가 0 이거나 미설정이면 null.
 * - `periodStartAt` / `periodEndAt` — 집계 구간 (요청 시점 기준 N일).
 *   default 는 R11-Task8 결정 (30일 권장).
 */
export interface LlmCostSummary {
  byProvider: Array<{
    providerId: string;
    tokenIn: number;
    tokenOut: number;
    estimatedUsd: number | null;
  }>;
  totalTokens: number;
  periodStartAt: number;
  periodEndAt: number;
}
