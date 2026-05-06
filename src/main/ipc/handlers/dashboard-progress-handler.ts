/**
 * dashboard:progress-snapshot IPC handler — R12-C2 P3 T19.
 *
 * H1 진행률 패널 (spec §11.21) 의 fetch entry. 호출자 (renderer) 가
 * `projectId` 를 넘기면 RunStepAggregator 가 query-time 산출한
 * DashboardProgressSnapshot 을 그대로 wrap 해 응답.
 *
 * accessor 패턴: main 부팅이 lazy `() => RunStepAggregator` closure 를
 * 1 회 wire — 호출이 wire 이전에 들어오면 deterministic 한 "not initialized"
 * 에러로 throw (`run-step-handler.ts` / `dashboard-handler.ts` 와 동일
 * 패턴).
 *
 * 본 handler 는 service 호출 + 결과 wrap 만 — 비즈니스 로직 0. 분포 산출
 * / status 매핑 / 정렬은 모두 RunStepAggregator 책임.
 *
 * spec docs/specs/2026-05-01-rolestra-channel-roles-design.md
 *  §11.19 A. RunStep 영속 기록부
 *  §11.21 H1. 대시보드 진행률 패널
 */

import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { RunStepAggregator } from '../../meetings/run-step/run-step-aggregator';

let aggregatorAccessor: (() => RunStepAggregator) | null = null;

/** Lazy wiring — main/index.ts 가 RunStepAggregator 생성 후 1 회 호출. */
export function setRunStepAggregatorAccessor(
  fn: () => RunStepAggregator,
): void {
  aggregatorAccessor = fn;
}

function getAggregator(): RunStepAggregator {
  if (!aggregatorAccessor) {
    throw new Error(
      'dashboard-progress handler: aggregator not initialized',
    );
  }
  return aggregatorAccessor();
}

/** dashboard:progress-snapshot — projectId 의 부서별 진행률 fetch. */
export function handleDashboardProgressSnapshot(
  data: IpcRequest<'dashboard:progress-snapshot'>,
): IpcResponse<'dashboard:progress-snapshot'> {
  const snapshot = getAggregator().getProgressSnapshot(data.projectId);
  return { snapshot };
}
