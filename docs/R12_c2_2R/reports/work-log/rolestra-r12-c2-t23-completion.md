---
name: R12-C2 T23 종결 — 임무 카드 schema + designated-worker-resolver (P5 진입 1 호, 2026-05-07)
description: R12-C2 Round 2 P5 진입 1 호 완료. 구현 부서 작업 단위 schema (MissionCard discriminated union — 'spec' / 'fix' / 'change-request') + 부서장 핀 → drag_order → fallback 3-tier designated-worker-resolver. T16b 임시 capability-first-match resolver 통째 흡수. T36 / T37 진입 전엔 caller 가 빈 핀 + null dragOrder 전달 → fallback path 만 동작. 다음 T24 (implement-workflow simple 1 명) 진입 가이드.
type: project
originSessionId: continuation
---
# R12-C2 T23 종결 (2026-05-07)

worktree `feat/r12-c2-redesign-r2`, base `5826af6` (= T22 tasks.json sync). production commit `4bd94b7`. 7 파일 / +1180 / -134 (4 신규 + 3 변경).

**Why:** spec docs/R12_c2_2R/plans/2026-05-04-rolestra-phase-r12-c2.md line 418-431 — *부서별 회의 흐름* (idea / planning / design / review / audit) 가 P3-P4 에 모두 land 되었지만, *구현 부서* 의 작업 단위 schema (capability manifest = 임무 카드) + 받는 직원 결정 알고리즘 (designated-worker-resolver) 이 부재. T16b 가 design-workflow 안에 임시 capability-first-match resolver 를 넣어두었지만 (1) 부서장 핀 / drag_order 무시 (2) design-workflow 단일 모듈 안에 응크리고 있어 implement / audit / planning 등 다른 workflow 가 재사용 불가. T23 = (a) MissionCard schema 정식화 (T24 implement-workflow / T25 audit→planning / T27 handoff_dispatch.mission_card_json 영속의 토대) + (b) resolver 를 별 모듈로 승격 + 3-tier 알고리즘 통째 land (부서장 핀 / drag_order 데이터 source 가 T36/T37 에서 진입할 때 caller 갱신만으로 우선순위 발동).

**How to apply:** 새 세션 진입 시 T24 (P5 진입 2 호 — implement-workflow simple 1 명) 권장. T24 의존 = T23 = 충족. T24 = `src/main/meetings/workflows/implement-workflow.ts` 신규 — designated worker 1 명 spec 받아 ExecutionService dryRun → 사용자 승인 → atomic apply → rollback (R7 흐름 그대로). 분담 / tier system / worktree 분할은 R12-W (별 phase) — R12-C2 안 X. T24 의 designated worker 결정 = T23 의 `resolveDesignatedWorker(candidates, 'implement')` 그대로 호출.

## 핵심 결정

### 알고리즘 자체는 3-tier 통째 land — caller wiring 만 점진

플랜 line 605-623 본문은 "T23 *주의*: 부서장 핀 실 컬럼 (T36) / drag_order 1번 (T37) 는 P7 phase — T23 = resolver 알고리즘 + fallback path 만 land". 두 해석 가능:
1. *알고리즘 자체* 도 fallback 만 land (step 2 / step 3 분기 미작성)
2. *알고리즘은 통째 land* 하되 caller (orchestrator) 가 step 2 / step 3 데이터 source 를 미연결 → 자연 fallback

채택 = **2번**. 근거:
- 알고리즘 통째 land 시 T36 / T37 진입 시 *caller wiring 1 줄* 만 갱신하면 즉시 우선순위 발동.
- 알고리즘 절반만 land 시 T36 / T37 시 resolver 본체 재작성 — 분기 누락 / 회귀 위험 존재.
- 단위 테스트도 통째 작성 가능 → 알고리즘 자체의 결정성을 land 시점에 봉인.

caller (`MeetingOrchestrator.collectDesignedWorkerCandidates`) 가 모든 후보에 `isDepartmentHead: {}` + `dragOrder: null` 전달 → step 2 (핀) 실패 → step 3 (drag_order) 실패 → step 4 (capability fallback) 동작. = T16b 임시 resolver 와 동일 동작 보존.

### MissionCardKind 3 종 — 'spec' / 'fix' / 'change-request'

근거 = 플랜 line 423-426 카논 그대로 + 각 종별 진입점 분리:

| kind | 발화자 | 진입점 | T24+ 소비처 |
|------|--------|--------|-------------|
| `'spec'` | 기획 부서 회의 종결 | planning 회의록 + root agreed opinion | implement-workflow (T24) |
| `'fix'` | audit NG verdict | audit 회의록 + 발견된 문제 list (≥ 1) | planning 부서 자동 인계 (T25) |
| `'change-request'` | 사용자 free-form | 채팅창 직접 발화 | 받는 부서 designated worker 자체 해석 |

3 종 모두 공통 base (`body` / `inputFiles` / `expectedOutputs`) — 받는 부서 designated worker 가 *공통 형식* 으로 prompt 합성 가능. 종별 metadata (`rootOpinionId` / `auditMinutesMarkdown` + `problemList` / `userMessage`) 는 *원본 출처* reference — 받는 직원이 필요 시 본문 참조.

### ResolvedDesignatedWorker { candidate, source } — source 라벨 미래 telemetry 토대

resolver 반환을 plain `DesignatedWorkerCandidate` 가 아닌 `{ candidate, source }` wrapper 로 결정. 근거:
- `source` = `'department-head-pin' | 'drag-order' | 'capability-fallback'` — 결정 path 라벨.
- T23 시점 caller (orchestrator) 는 source 미사용 (그저 `.candidate` 언래핑) — 회의 동작 자체는 path 와 무관.
- 미래 telemetry / UI 알림 ("📌 부서장 핀으로 선택됨" / "🎯 드래그 순서 1 번" / "🎲 자율 모드 default") 분기 가능.
- T36 / T37 land 후 사용자가 "왜 이 직원이 선택됐는지" 알아야 할 시점이 옴 — 본 시점에 source 라벨 추가하면 wrapper 재설계 비용 발생. 미리 land.

### mission-card schema = zod v4 discriminatedUnion + strict()

근거:
- T27 handoff_dispatch.mission_card_json 영속 boundary — JSON 파싱 시 즉시 검증 필요.
- `strict()` = extra field 거부 — 미래 schema 진화 시 silent drop 차단 (forward compat 통째 거부).
- `discriminatedUnion('kind', [...])` = TypeScript narrowing 자동 + zod 가 kind 기준으로 적절한 schema 선택.
- `parseMissionCardJson` / `serializeMissionCard` round-trip 테스트로 invariant 봉인.

### design-workflow 의 resolver re-export 보존 (현재 caller 0)

design-workflow.ts 가 새 모듈로 resolver 재export 유지. 근거:
- 현재 caller = orchestrator 1 곳 (T23 에서 새 모듈로 import 직접 전환).
- 미래 audit-workflow / implement-workflow / planning-workflow 가 designated worker 호명 시 본 캐치성 import 가능.
- 재export 는 비용 0 (extra runtime symbol X) + design-workflow 가 *디자인 부서 책임* 분기점이라 호환 가치 큼.

`capabilityForKind(DesignedTaskKind) → RoleId` 만 design-workflow 책임 유지 (디자인 부서의 task kind → capability 매핑은 디자인 도메인 지식이라 resolver 모듈로 이전 X).

## 신규 4 + 변경 3 = 7 파일

**신규 4:**
- `src/shared/schema/mission-card.ts` — MissionCard 본체 (id UUID + payload + assignedProviderId + targetChannelId + createdAt) + 종별 payload zod schema (specMissionPayloadSchema / fixMissionPayloadSchema / changeRequestMissionPayloadSchema) + `buildMissionCard` / `parseMissionCardJson` / `serializeMissionCard` 경계 helper + MissionCardInvariantError (zod ZodError cause 보존).
- `src/shared/schema/__tests__/mission-card.test.ts` — 30 항목 (ALL_MISSION_CARD_KINDS 1 + payload schema 12 + cardSchema 6 + buildMissionCard 5 + parseMissionCardJson 4 + serializeMissionCard 1 + 1 misc).
- `src/main/meetings/designated-worker-resolver.ts` — DesignatedWorkerCandidate (providerId / displayName / roles / isDepartmentHead `Partial<Record<RoleId, boolean>>` / dragOrder `number | null`) + ResolvedDesignatedWorker { candidate, source } + DesignatedWorkerResolutionSource union + ALL_DESIGNATED_WORKER_RESOLUTION_SOURCES + DesignatedWorkerNotFoundError (capability 필드 보존) + resolveDesignatedWorker 본체 (step 1 capability filter throw if 0 → step 2 핀 첫 직원 → step 3 최소 dragOrder → step 4 fallback 첫 capable).
- `src/main/meetings/__tests__/designated-worker-resolver.test.ts` — 21 항목 (sources enum 1 + step 1 filter 3 + step 2 핀 5 + step 3 drag 5 + step 4 fallback 3 + priority combination 3 + 1 misc).

**변경 3:**
- `src/main/meetings/workflows/design-workflow.ts` — T16b 임시 resolver 본체 통째 제거 (DesignatedWorkerCandidate interface / resolveDesignatedWorker 구현 / DesignatedWorkerNotFoundError class — 약 75 lines) → 새 모듈 재export 4 줄로 축소. capabilityForKind 만 design-workflow 책임 유지 (디자인 도메인 매핑).
- `src/main/meetings/workflows/__tests__/design-workflow.test.ts` — describe('resolveDesignatedWorker', ...) 블록 8 항목 통째 제거 (designated-worker-resolver.test.ts 로 이전 + 5 추가 항목 with pin/dragOrder 분기). DesignatedWorkerCandidate / resolveDesignatedWorker / DesignatedWorkerNotFoundError import 제거. capabilityForKind 3 항목 보존.
- `src/main/meetings/engine/meeting-orchestrator.ts` — design-workflow import block 분리 → 디자인 도메인 helper (capabilityForKind / extractDesignedTaskOpinion / DesignSnapshotPaths / DesignedTaskContext / DesignedTaskKind / DesignWorkflowResult) 와 resolver (DesignatedWorkerNotFoundError / resolveDesignatedWorker / DesignatedWorkerCandidate) 별 분리. collectDesignedWorkerCandidates 가 모든 후보에 `isDepartmentHead: {}` + `dragOrder: null` 전달 (T23 wiring 주석 명시 — T36 / T37 land 시 wiring 갱신 위치). runAssigningDesignatedTaskPhase 가 ResolvedDesignatedWorker 의 .candidate 언래핑 (`const resolved = ...; const speaker = resolved.candidate;`).

## 검증

- typecheck:node + typecheck:web **0**
- vitest **3614 PASS / 13 skip** (T22 baseline 3572 → +42)
  - 신규 51 (mission-card 30 + designated-worker-resolver 21)
  - 제거 9 (design-workflow.test.ts 의 resolver 단위 테스트 8 + capabilityForKind 1 ineligible)
  - 순증 +42
- inspect:safety **99** (T22 동일, T23 위반 0 — 신규 코드 모두 순수 helper / 마이그레이션 0)

## 미작업 (의도)

- 부서장 핀 UI surface (T36 — P7 phase) → 본 T23 시점에 caller 가 `isDepartmentHead: {}` 전달, step 2 발동 X.
- 드래그 순서 UI surface (T37 — P7 phase) → 본 T23 시점에 caller 가 `dragOrder: null` 전달, step 3 발동 X.
- T24 implement-workflow / T25 audit NG → 기획 인계 / T27 handoff_dispatch.mission_card_json 영속 = 본 schema + resolver *consumer*. 본 sub-task 는 *공급* 면만 land.
- mission-card 의 IPC 등록 = T27 (handoff-service) 책임 — 본 sub-task 시점엔 schema 정의만.

## 다음 = T24 (P5 진입 2 호)

T24 의존 = T23 = 충족. **T24 핵심:**
- `src/main/meetings/workflows/implement-workflow.ts` 신규 — designated worker 1 명 spec 받아 코드 작성
- ExecutionService dryRun → 사용자 승인 → atomic apply → rollback (R7 흐름 그대로 재사용)
- 분담 / tier system / worktree 분할 = R12-W (별 phase) — R12-C2 안 X (designated 1 명 simple 만)

**T24 *주의*:**
- ExecutionService 의 dryRun / apply / rollback 모든 step 의 RunStep 영속은 T26 책임 — T24 시점엔 ExecutionService 호출만, RunStep persistence 분기 미진입.
- `MissionCard` payload.kind === 'spec' 의 `rootOpinionId` 와 `planningMinutesMarkdown` 만 T24 가 직접 소비 — 'fix' / 'change-request' 분기는 T25 / T26 / T27 책임.
- ImplementVariant SsmBox (T18 land) 는 본 phase 에서 wire — designated AI 표시 + 진행도 + 작업 중 파일 list.

T24 진입 시 *반드시* 확인:
- T23 의 resolveDesignatedWorker 호출 path — orchestrator collectDesignedWorkerCandidates 와 동일 패턴 재사용 (구현 부서 채널 의 멤버 + ProviderRegistry join).
- ExecutionService 의 R7 dryRun → approve → apply → rollback 흐름 (`docs/decisions/r7-cli-permission.md` 참조).
- `OpinionService.gather` 의 root opinion 등록 path — implement-workflow 가 designated worker 응답을 root opinion 으로 기록.
