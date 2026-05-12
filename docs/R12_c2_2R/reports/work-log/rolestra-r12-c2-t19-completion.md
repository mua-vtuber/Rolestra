---
name: R12-C2 T19 종결 — RunStep aggregator + dashboard:progress-snapshot IPC + stream wire (P3 진입 6 호, 2026-05-06)
description: R12-C2 Round 2 P3 진입 6 호 완료. 부서별 RunStep step_kind 집계 + IPC + stream wire — H1 대시보드 (T40) 의 데이터 source. 다음 T20 ([##본문] 파서) 진입 가이드.
type: project
---

# R12-C2 T19 종결 (2026-05-06)

worktree `feat/r12-c2-redesign-r2`, base `b4377dc` (= T18 work-log mirror, T18 production `81e3a94` 위). 14 파일 / +1169 / -5 (4 신규 + 10 변경).

production commit `209e97c`.

**Why:** spec §11.19 (RunStep 영속 기록부) + §11.21 (H1 대시보드 진행률 패널) — RunStep 위 *부서별 진행률 집계* 는 cross-cutting 데이터 source. T18 의 SsmBox 5 variant 가 placeholder slot 만 land 됐고, T40 (H1 합계 패널) 이 본 IPC 응답 + stream push 로 surface 를 hookup 예정. 본 sub-task 는 *데이터 source* 만 정식화 — UI 본체는 T40 + R12-W phase 에서 진행. P3 진입 6 호 = T15 (idea) + T16 (design) + T17 (review/audit) + T18 (SsmBox 5 variant) 다음 자리.

**How to apply:** 새 세션 진입 시 T20 (P4 진입 1 호 — 일반 채널 [##본문] 파서 + 의견 게시 모달) 진입. T20 은 T13 (NextStep classifier) + T14 (MessageRenderer 카드) 의존 — 둘 다 충족. T22 (일반 채널 RunStep 분기) 가 본 aggregator 의 일반 채널 카운트 hookup.

## 핵심 결정 + 산출

### 4 신규 + 10 변경 = 14 파일

**신규 4:**
- `src/shared/dashboard-progress-types.ts` — DepartmentStatus 4 종 + DepartmentProgress + DashboardProgressSnapshot + StepKindCounts (RunStepKind 10 enum 0 디폴트 명시 / `emptyStepKindCounts()` factory)
- `src/main/meetings/run-step/run-step-aggregator.ts` — RunStepAggregator 본체. channelRepo + meetingRepo + runStepRepo 합성. `getProgressSnapshot(projectId)` 단일 method. role=null 채널 제외 + ALL_ROLE_IDS 카탈로그 정렬 + 같은 role 안 channels.created_at ASC stable sort
- `src/main/ipc/handlers/dashboard-progress-handler.ts` — accessor 패턴 (run-step-handler / dashboard-handler 와 동일). `setRunStepAggregatorAccessor` + `handleDashboardProgressSnapshot`
- `src/main/meetings/run-step/__tests__/run-step-aggregator.test.ts` — 12 항목 (4 status 매트릭스 / role=null 제외 / step_kind 분포 / currentRound MAX / null currentRound / ALL_ROLE_IDS 정렬 / 같은 role 안 created_at ASC / 프로젝트 격리 / 빈 프로젝트 / unknown projectId)

**변경 10:**
- `src/shared/stream-events.ts` — StreamDashboardProgressChangedPayload (signal-only: projectId + sourceChannelId) + `'stream:dashboard-progress-changed'` 변종
- `src/main/streams/stream-bridge.ts` — KNOWN_EVENT_TYPES + isPayloadValidForType case + `StreamBridgeServices.runStep` + `runStepChannelToProject` lookup + connect 분기 (lookup null/throw skip 안전망 + malformed payload skip) + `emitDashboardProgressChanged` helper
- `src/main/meetings/run-step/run-step-service.ts` — `extends EventEmitter` + RunStepServiceEvents 타입 + `setMaxListeners(20)` + transaction commit 후 row 별 `emit('appended')` (listener throw isolate)
- `src/main/meetings/run-step/__tests__/run-step-service.test.ts` — 4 항목 신규 (emit 순서 / empty no-emit / rollback no-emit / listener throw isolate)
- `src/main/streams/__tests__/stream-bridge.test.ts` — 5 항목 신규 (runStep wire / null lookup skip / lookup 없음 skip / malformed payload skip / emitDashboardProgressChanged helper)
- `src/shared/ipc-types.ts` — `'dashboard:progress-snapshot'` 채널 + DashboardProgressSnapshot import
- `src/shared/ipc-schemas.ts` — dashboardProgressSnapshotSchema + v3ChannelSchemas 등록
- `src/main/ipc/router.ts` — handleDashboardProgressSnapshot 등록
- `src/main/index.ts` — RunStepAggregator 인스턴스 + accessor + StreamBridge.connect 에 runStep + runStepChannelToProject (channelRepo.get 위) 주입
- `docs/R12_c2_2R/plans/2026-05-04-rolestra-phase-r12-c2.md.tasks.json` — T19 status='completed' + description 종결 매트릭스

### Status 매핑 (spec §11.21.2)
```
activeMeeting        | totalSteps | status
---------------------|------------|------------------
null                 | 0          | 'idle'
null                 | >0         | 'done'
state='handoff'      | any        | 'handoff-pending'
state=other          | any        | 'in-meeting'
```

`meetings.state` 는 free-text (CHECK 제약 없음) — 알 수 없는 phase 디폴트 `'in-meeting'`. `'handoff'` 만 명시 분기.

### currentRound 결정
활성 회의의 RunStep row 들 중 `MAX(round)`. row 0 → `null` (회의는 시작됐으나 첫 turn 도 안 든 phase 진입 직후). `allSteps` 는 채널의 *모든* RunStep — 활성 회의 이전 *과거 회의* row 도 포함. `activeMeetingId` 로 한 번 더 필터해서 *현재* 라운드만 추출.

### maxRounds — channels.max_rounds 그대로
NULL 보존 (사용자가 명시적으로 무제한 선택). UI 가 `null` 이면 "—" 표시 권장. `MEETING_DEFAULT_MAX_ROUNDS=5` fallback 은 *orchestrator* 책임 (T8) — aggregator 는 raw 값 surface.

### 정렬: ALL_ROLE_IDS + created_at
`ROLE_ORDER_INDEX` (`Map<RoleId, number>`) 로 O(1) 조회 — 카탈로그 순서 (idea → planning → design.ui → design.ux → design.character → design.background → implement → review → audit → general). 같은 role 안에서는 channels.listByProject 가 이미 created_at ASC 로 돌려주므로 JS Array.sort stable (ES2019+) 만 보장하면 자연 정렬.

### Stream wire (RunStep 'appended' → invalidate signal)
- `RunStepService.appendForTurn` 의 transaction commit *후* row 별로 `emit('appended', step)`. listener throw 는 try/catch isolate — 한 listener 실패가 caller / 다른 listener 영향 X.
- `StreamBridge.connect({ runStep, runStepChannelToProject })` — bridge 는 channelId → projectId 룩업. lookup `null` 이면 skip (DM / global system general / legacy user 의 project_id IS NULL). lookup 없이 runStep 만 주입되면 silent skip — 부분 wiring 안전망.
- payload 는 *signal-only* — `{ projectId, sourceChannelId }` 만. renderer 가 받으면 zustand store invalidate → `dashboard:progress-snapshot` IPC 재호출 (spec §11.21.4).

### 검증
- typecheck:web 0 / typecheck:node 0
- vitest 3474 PASS / 13 skip (T18 baseline 3452 → +22 = aggregator 12 + appended 4 + stream-bridge integration 5 + emit helper 1)
- inspect:safety 95 (T18 동일, 신규 코드 위반 0)

### 신중하게 처리한 부분
1. **`getProgressSnapshot(unknownProjectId)`** — throw 안 함, 빈 `departments: []` 반환. 사용자가 갓 import 한 빈 프로젝트에서도 H1 패널이 즉시 mount 되어야 하기 때문 (silent fallback 아님 — 도메인 적으로 "역할 매핑된 채널이 0 개" 가 의미 있는 정상 상태).
2. **`role=null` 명시 분기** — system / DM / legacy user 채널 (project_id 가 있어도 role 미매핑) 은 H1 surface 대상 X. listByProject 결과를 `channel.role === null` 분기로 skip.
3. **transaction commit *후* emit** — RunStepService 가 row 별 emit 을 commit 안에서 하면 listener throw 시 transaction rollback 위험. commit 후 try/catch 로 listener 실패가 영속 결과를 깨뜨리지 않도록 분리.
4. **lookup null 분기** — channelRepo.get 가 row 못 찾는 케이스 (이미 삭제된 채널 / FK 경고 race) + project_id IS NULL (DM / global) 둘 다 같은 분기 (skip). `channel?.projectId ?? null`.
5. **isPayloadValidForType 누락 발견** — 본 T19 작업 중 stream:idea-pick-snapshot / stream:designed-task-assigned / stream:design-snapshot-ready 의 case 가 switch 에 없어 호출 시 silent drop. T15/T16 follow-up 권장 (본 T19 종결 외).

## 다음 진입 (T20)

**T20 — P4 진입 1 호 — 일반 채널 [##본문] 파서 + 의견 게시 모달**

산출 (plan 기준):
- `src/shared/parsers/double-hash-parser.ts` 신규 — `[##본문]` 검출 (한 메시지 안 여러 개 가능) + opinion kind 분기 (self-raised / user-raised)
- 일반 채널 헤더 우측 [의견 게시] 버튼 + `<PostOpinionModal>` (제목 + 본문 입력)
- general-channel-flow 안 파서 호출 wire (P1.5 회귀 차단 위에)

Verify: vitest unit (한 메시지 [##] 0/1/N + edge cases) + e2e.

T20 의존 = T13 (NextStep classifier) + T14 (MessageRenderer 카드) — 둘 다 land. T20 → T21 (일반 SsmBox final variant) → T22 (일반 채널 RunStep 분기) 순서로 P4 묶음 종결.

T20 진입 전 `git worktree list` + `git status` 로 `feat/r12-c2-redesign-r2` 위 작업 중인지 확인. 새 base = `209e97c` (T19 production) + work-log mirror commit.

## tasks.json 상태
- T0~T19 = `completed`
- T20~T35 = `pending`
