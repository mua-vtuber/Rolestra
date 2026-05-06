/**
 * Dashboard 진행률 패널 (H1) 도메인 타입 — R12-C2 P3 T19 land.
 *
 * RunStep 영속 기록부 (§11.19) 위 *부서별 진행률* 집계 결과 schema.
 * `RunStepAggregator` (`src/main/meetings/run-step/run-step-aggregator.ts`)
 * 가 query-time 산출하고 IPC `dashboard:progress-snapshot` 응답으로 전달.
 *
 * 갱신: A RunStep 새 row → `stream:dashboard-progress-changed` push → renderer
 * zustand store invalidate → re-fetch (spec §11.21.4).
 *
 * H1 surface 본격 land = T40 (P7-5 dashboard layout). 본 T19 는 *데이터
 * source* 만 정식화 — UI hookup 은 T40 이 본 schema 따라 wire.
 *
 * spec docs/specs/2026-05-01-rolestra-channel-roles-design.md
 *  §11.19 A. RunStep 영속 기록부 (cross-cutting)
 *  §11.21 H1. 대시보드 진행률 패널
 */

import type { RoleId } from './role-types';
import type { RunStepKind } from './run-step-types';

// ── 부서 상태 4 종 ──────────────────────────────────────────────────────

/**
 * 부서 채널 1 개의 현재 상태:
 *  - `idle`              회의 한 번도 없음 (RunStep row 0 + active meeting 없음)
 *  - `in-meeting`        활성 회의 진행 중 (gather / tally / quick_vote /
 *                        free_discussion / awaiting_user_pick /
 *                        assigning_designated_task / compose_minutes /
 *                        generating_snapshot)
 *  - `handoff-pending`   활성 회의 phase='handoff' (인계 카드 발행 후 사용자
 *                        confirm 대기 — 회의록은 작성됐으나 다음 부서로
 *                        넘어가지 못한 단계)
 *  - `done`              과거 회의 산출물 있음 + 활성 회의 없음 (다음 라운드
 *                        대기 중 안식)
 *
 * 매핑은 query-time 에 RunStepAggregator 가 결정 — `meetings.ended_at`
 * (활성 여부 source-of-truth) + `meetings.state` (phase) + `run_step` row
 * 존재 여부 3 신호 합성.
 *
 * spec §11.21.2 / T19 작업 정의.
 */
export type DepartmentStatus = 'idle' | 'in-meeting' | 'handoff-pending' | 'done';

/** {@link DepartmentStatus} 모든 값 — UI chip / zod enum 용. */
export const ALL_DEPARTMENT_STATUSES: readonly DepartmentStatus[] = [
  'idle',
  'in-meeting',
  'handoff-pending',
  'done',
] as const;

// ── step_kind 분포 ──────────────────────────────────────────────────────

/**
 * RunStepKind 10 enum 모두 포함하는 카운트 record. *0 디폴트 명시* —
 * 부서가 한 종류 step 만 발생시켜도 다른 9 종은 `0` 으로 surface (UI 가
 * `record[kind] ?? 0` 분기 없이 안전하게 read).
 *
 * spec §11.19.2 RunStepKind enum 과 1:1.
 */
export type StepKindCounts = Record<RunStepKind, number>;

/**
 * {@link StepKindCounts} 의 0 디폴트 시드. aggregator 가 새 부서 카운트
 * 시작점으로 사용. const 가 아닌 *factory* — 호출자가 mutate 해도 다른
 * 부서 카운트에 영향 X (얕은 복사 회피).
 */
export function emptyStepKindCounts(): StepKindCounts {
  return {
    opinion_gather: 0,
    opinion_tally: 0,
    quick_vote: 0,
    free_discussion: 0,
    minutes_compose: 0,
    next_step_classify: 0,
    handoff_dispatch: 0,
    tool_invoke: 0,
    approval_request: 0,
    inspector_check: 0,
  };
}

// ── 부서별 진행률 ───────────────────────────────────────────────────────

/**
 * 한 부서 채널 1 개의 진행률 snapshot. 프로젝트 안 같은 role 채널이 여러 개
 * 있으면 각 채널마다 1 row — aggregator 는 채널 합치지 않는다 (사용자 사용
 * 패턴 = "기획 채널 A / 기획 채널 B" 분리). UI 가 부서별 묶어 표시할지는
 * 자유.
 */
export interface DepartmentProgress {
  /** FK channels.id. */
  channelId: string;
  /** 채널 이름 (UI 라벨 — channels.name 그대로). */
  channelName: string;
  /** 채널의 부서 매핑 (NULL 채널은 본 surface 에서 제외). */
  role: RoleId;
  status: DepartmentStatus;
  /**
   * 활성 회의 ID — `status='in-meeting'` 또는 `'handoff-pending'` 일 때만 채움.
   * 그 외는 NULL.
   */
  activeMeetingId: string | null;
  /**
   * 활성 회의의 현재 라운드 (1-based, RunStep `round` 컬럼 MAX). NULL =
   * 활성 회의 없음 또는 RunStep row 없음.
   */
  currentRound: number | null;
  /**
   * 채널의 max_rounds — `channels.max_rounds` 그대로. NULL = 무제한
   * (사용자가 명시적으로 무제한 선택). UI 가 `null` 이면 "—" 표시 권장.
   */
  maxRounds: number | null;
  /** 채널 안 RunStep row 의 step_kind 별 count. */
  stepKindCounts: StepKindCounts;
  /** 채널 안 RunStep row 총 개수 (= step_kind 별 count 의 합). */
  totalSteps: number;
}

// ── 프로젝트 진행률 패널 ────────────────────────────────────────────────

/**
 * 프로젝트 1 개의 진행률 snapshot. dashboard `H1` surface 의 단일 fetch
 * 응답 schema.
 *
 * `departments` 는 *role 매핑된* 채널만 (NULL role 인 system / DM /
 * legacy user 는 제외). 정렬은 aggregator 가 결정 (RoleId 카탈로그 순서
 * — `ALL_ROLE_IDS` 순회 → 같은 role 안 채널은 channels.created_at ASC).
 *
 * 갱신 정책 (spec §11.21.4):
 *  - 첫 mount 시 1 회 fetch
 *  - `stream:dashboard-progress-changed` push 받으면 invalidate → re-fetch
 *  - zustand 1 분 TTL 내 재조회 X (renderer 책임)
 */
export interface DashboardProgressSnapshot {
  projectId: string;
  departments: DepartmentProgress[];
  /** 산출 시각 (Unix epoch ms). 같은 fetch 안 모든 row 공통 timestamp. */
  generatedAt: number;
}
