---
name: R12-C2 T16b 종결 — design-workflow orchestrator wire + capability resolver + 회의록 ordinal 분리 (P3 진입 4 호 split, 2026-05-06)
description: T16 (디자인 부서 7 단계 + Playwright snapshot) 의 *orchestrator wire* + capability resolver + 회의록 분리 land. T16a 위에 +837 라인 / -8 라인. T16c (Playwright snapshot + DesignPreview UI) 잔여.
type: project
originSessionId: 811454d0-001e-459b-9fd7-06faa0dcf623
---
# R12-C2 T16b 종결 (2026-05-06)

worktree `feat/r12-c2-redesign-r2`, base `84518a6` = T16a. T16b production commit `fc88d53`.
9 파일 / +837 / -8. work-log mirror 미발행 — T16 = T16a/b/c 누적 후 T16c 종결 시 단일 mirror 권장.

**Why:** T16a 가 types + skeleton 만 land (orchestrator wire X). T16b 는 그 위에 design-workflow 7-step 본체 + capability resolver 임시 + 회의록 ordinal 분리. T16c (Playwright snapshot 본체 + UI) 가 land 되기 전까지 step 7b 는 의도된 placeholder throw — design 부서 회의는 항상 outcome='aborted' / abortReason='snapshot_failed' 로 finalize.

**How to apply:** 새 세션 진입 시 (a) T16c (playwright-snapshot.ts + DesignPreview UI) 우선 권장 — design 부서 회의 정상 흐름 완성, (b) T16 work-log mirror 1 회 (T16a/b/c 누적 본문). T16b 안 capability-first-match resolver 는 T23 (E. designated-worker-resolver) land 시점에 정식 resolver (부서장 핀 + drag_order + fallback) 로 교체 — `resolveDesignatedWorker` 함수 시그니처 호환만 유지하면 import 1 줄 변경 + helper 통째 삭제.

## 산출 9 항목

### 1. design-workflow.ts 확장 (`src/main/meetings/workflows/design-workflow.ts`, +115 라인)

T16a skeleton 위에 phase wire 용 helper 추가:

- `DesignatedWorkerCandidate` interface — `{providerId, displayName, roles: readonly RoleId[]}`. orchestrator 가 `session.aiParticipants` ↔ `ProviderRegistry` join 한 결과를 본 type 으로 변환해서 resolver 에 전달.
- `capabilityForKind(kind)` — `wireframe_drafting` → `'design.ux'` / `wireframe_revision` + `design_implementation` → `'design.ui'`. spec §11.18.9a 매트릭스.
- `resolveDesignatedWorker(candidates, capability)` — capability-first-match. drag_order 무시 + 매칭 0 명 시 throw. T23 정식 resolver 가 부서장 핀 + drag_order + fallback 통합 시 deletion target.
- `DesignatedWorkerNotFoundError` — capability 매칭 직원 0 명 시. orchestrator 가 catch 후 `abortReason='designated_task_failed'` 매핑.
- `DesignatedTaskFailedError` — 1 회 재요청 + 2 회 실패 (빈 opinions 또는 turn-skipped 분기). cause 필드 (`'empty-opinions'` / `'turn-skipped'`) + taskKind + meetingOrdinal 보존.
- `DesignedTaskKind` re-export — caller (orchestrator / turn-executor) 가 design-workflow 단일 import 으로 type 받을 수 있도록.

### 2. meeting-turn-executor.ts 확장 (+39 라인)

- `runPhaseTurn` 의 phase union: `'gather' | 'quick_vote' | 'free_discussion'` → `+ 'assigning_designated_task'`.
- `requestAssigningDesignatedTask(speaker, ctx)` 메서드 신규 — schema = `PHASE_RESPONSE_SCHEMAS.assigning_designated_task` (T16a 에 이미 매핑된 Step6 = Step1 alias) + `buildPromptBody = buildDesignedTaskPromptBody(ctx)` (design-workflow.ts).
- `callProviderOnce` phase 인자 union 동일 확장.
- turn-executor 자체 retry (1차 + 1회 = 2 attempt) 는 *schema 부합 여부* 만 적용. *빈 opinions* 응답 (직원 거부) 은 schema 통과로 ok 반환 → caller (orchestrator) 가 명시적 retry.

### 3. orchestrator 4 신규 메서드 (`src/main/meetings/engine/meeting-orchestrator.ts`, +418 라인)

- **`collectDesignedWorkerCandidates()`** — session.aiParticipants 의 providerId 를 ProviderRegistry.get 으로 lookup → roles 추출 → `DesignatedWorkerCandidate[]`. registry miss 인 직원은 silent skip.
- **`runAssigningDesignatedTaskPhase(kind, ordinal, priorContent)`** — design-workflow 의 핵심 single-turn dispatch:
  1. `transitionToPhase('assigning_designated_task')`
  2. `resolveDesignatedWorker(candidates, capabilityForKind(kind))` — throw 시 caller propagate
  3. `emitDesignedTaskAssigned` (taskKind / meetingOrdinal / assignedProviderId / assignedAuthorLabel)
  4. attempt 2 회 loop:
     - `turnExecutor.requestAssigningDesignatedTask(speaker, ctx)` 호출
     - `kind='ok'` + opinions ≥ 1 → 성공 path: `OpinionService.gather` (single response) → root opinion uuid 반환
     - `kind='ok'` + opinions = 0 → `lastCause='empty-opinions'`, 다음 attempt
     - `kind='skipped'` (provider-error / invalid-schema / aborted) → `lastCause='turn-skipped'`, 다음 attempt
     - 2 attempt 모두 실패 → throw `DesignatedTaskFailedError(kind, ordinal, lastCause, msg)`
- **`runGeneratingSnapshotPhase(uuid)`** — `transitionToPhase('generating_snapshot')` + 의도된 throw `'not implemented yet — T16c land 시 playwright-snapshot.ts wire'`. T16c 가 본 메서드를 PNG 생성 + emit 으로 교체.
- **`runDesignWorkflow()`** — 7-step 통합 메서드:
  - step 1: `runAssigningDesignatedTaskPhase('wireframe_drafting', 1, channel.purpose ?? topic)` — UX 직원 와이어프레임
  - step 2-4: `runQuickVotePhase` + (조건부 `runFreeDiscussionPhase`) + `runComposeMinutesPhase({ordinal:1})` — 회의 #1
  - 회의 #1 종결 후 `session.resetRound()` (label counter 는 reset X)
  - step 5: `runAssigningDesignatedTaskPhase('wireframe_revision', 1, minutes1Body)` — UI 직원 합의 반영. priorContent = `meetingMinutesService.readMinutesBody({meetingId, ordinal:1})` 의 결과.
  - step 6: `runAssigningDesignatedTaskPhase('design_implementation', 2, step5.content)` — UI 직원 HTML/CSS (회의 #2 시드)
  - step 7a: `runQuickVotePhase` + `runFreeDiscussionPhase` + `runComposeMinutesPhase({ordinal:2})` — 회의 #2
  - step 7b: `runGeneratingSnapshotPhase(latestRootUuid)` — placeholder throw → catch → abortReason='snapshot_failed'
  - step 7c (T16c land 후): `runHandoffPhase()` 재사용
  - 통합 catch 분기: `DesignatedWorkerNotFoundError` / `DesignatedTaskFailedError` / 그 외 throw → 각각 `designated_task_failed` / `snapshot_failed` abortReason 매핑.

### 4. orchestrator.run() 분기 — design 부서 우회

`run()` 안 phase 1 gather 진입 *전* 채널 role 검사. `isDesignDepartmentRole(channel.role)` 이 true 면 `runDesignWorkflow()` 호출 → outcome 별 finalize:
- `outcome='committed'` → finalize('accepted')
- `outcome='aborted'` → finalize('aborted')

→ 풀세트의 gather → tally → quick_vote → free → compose → handoff 흐름은 design 분기에서 *통째 우회* (design-workflow 가 자체 안에서 quick_vote / free / compose 를 두 번 호출). idea 분기는 기존 위치 그대로 (gather 후 tally 시점 분기).

### 5. orchestrator deps 확장 — providerRegistry

`MeetingOrchestratorDeps` 에 `providerRegistry: ProviderRegistry` 신규. `src/main/index.ts` 의 `new MeetingOrchestrator({...})` 호출 시점에 기존 turn-executor 와 동일한 registry instance 주입 (의존 graph 단일화). 풀세트 / idea 흐름은 본 deps 미사용 — design 분기에서만 capability lookup.

### 6. MeetingMinutesService 확장 — ordinal 분리 + readMinutesBody

- `MeetingMinutesComposeInput` 에 `ordinal?: 1 | 2` 옵션. undefined → 기존 단일 `minutes.md`, 1 → `minutes-1.md` (와이어프레임 회의), 2 → `minutes-2.md` (디자인 회의). 다른 부서 영향 없음.
- `compose(input)` 가 `input.ordinal` 받아 `writeMinutes(meetingId, body, ordinal)` 호출. 파일 이름 분기 helper `minutesFilenameForOrdinal`.
- `readMinutesBody({meetingId, ordinal})` 신규 — design-workflow step 5 가 회의록 #1 본문을 priorContent 로 읽기. PathGuard 봉인 동일 (consensusBase startsWith). 미존재 시 fs.readFile 자체 throw → caller 가 abortReason 매핑.

### 7. shared/channel-role-types.ts — isDesignDepartmentRole helper

`isDesignDepartmentRole(role)` — `'design.ui' | 'design.ux'` true. spec §3 line 86 "디자인 부서 = [design.ui, design.ux] 두 능력 묶음". `design.character` / `design.background` 는 별도 부서로 분류 — 본 분기 포함 X.

### 8. design-workflow.test.ts — +11 신규

T16a baseline 10 (buildDesignedTaskPromptBody + extractDesignedTaskOpinion) 위에:
- `capabilityForKind` 3 sub-kind (wireframe_drafting/revision/implementation) → 매핑 검증
- `resolveDesignatedWorker` 8 (design.ux match / design.ui match / 동일 capability 둘 — 입력 순서 첫 건 / design.ux no-match → throw / design.ui no-match → throw / 빈 후보 → throw / error.capability 필드 = 입력 / 다른 능력도 보유 직원 — 매칭 통과)

→ 단일 파일 21 tests (T16a 10 + T16b 11).

### 9. meeting-orchestrator.test.ts — +2 신규 design-workflow 통합

- "design 채널 + capability 매칭 직원 0 명 → designed_task_failed 분기 → finalize aborted": 디자인 부서 채널 (role='design.ux') 인데 모든 직원이 design 능력 미보유. resolveDesignatedWorker throw → outcome='aborted' / abortReason='designated_task_failed' → finalize('aborted'). gather phase 자체 우회 (`requestOpinionGather` 호출 X) 검증.
- "design 채널 + 풀세트 흐름 우회 — runQuickVotePhase 호출 안 됨": role='design.ui' + 직원 design 능력 X. step 1 진입 전 abort. 풀세트 surface (quick_vote / free / compose) 미진입 검증 + finalize aborted.

→ 단일 파일 11 tests (기존 9 + T16b 2).

## 검증 (T16a baseline 비교)

| 항목 | T16a baseline | T16b |
|------|---------------|------|
| typecheck:node | 0 | 0 |
| typecheck:web | 0 | 0 |
| vitest PASS | 3379 | 3392 (+13: design-workflow 11 + orchestrator 2) |
| vitest skip | 13 | 13 |
| vitest fail | 0 | 0 |
| inspect:safety total hits | 95 | 95 (T16b 추가 위반 0) |

## 핵심 결정 (T16b 한정 — spec 명시 X 인 항목)

1. **회의록 분리 = `minutes-1.md` + `minutes-2.md`** — 단일 회의 lifetime 안 두 파일. spec §11.18.9d 가 회의 #2 합의 직후 generating_snapshot 표현 → 두 minutes 분리 함의. 단일 파일 합치기 (두 섹션) 보다 audit / dogfood 시 분기 명확.

2. **회의 라운드 카운터 = 회의 ordinal 별 reset (`session.resetRound()`)** — 회의 #1 round 1~N, 회의 #2 도 round 1~M 부터 재카운트. 발화 ID label counter 는 reset X (직원 식별 일관성).

3. **단일 meetingId 모델** — 디자인 부서 회의는 한 회의 record + 두 개의 phase loop (회의 #1 + 회의 #2). opinion 트리 안 root 3 개 누적 (step 1 drafting + step 5 revision + step 6 implementation). `findLatestDesignImplementationOpinion()` 가 마지막 root (created_at 기준) 를 step 6 implementation 으로 가정.

4. **resolver fallback = abort** — capability 매칭 직원 0 명 시 `DesignatedWorkerNotFoundError` throw. fallback (예: 임의 직원 호명) 은 거짓 산출 위험 — 차라리 명확히 실패 + 사용자 알림.

5. **빈 opinions retry = 1 회 (총 2 attempt)** — spec §11.18.9c 명시. turn-executor 자체 retry 는 schema mismatch 만 적용 (빈 opinions 는 schema 통과로 ok). orchestrator 가 명시적 attempt 2 회 loop. 두 번째도 빈/skip → DesignatedTaskFailedError 즉시 throw.

6. **step 7b placeholder = 의도된 throw** — T16c 가 wire 하기 전까지 design 부서 회의는 항상 step 7b 에서 abort (snapshot_failed). 회의록 #1 + #2 는 작성됨 — PNG 만 미생성. T16c land 시 placeholder 메서드 본체 교체로 해소.

7. **work-log mirror 미발행** — T16 = T16a/b/c 누적 sub-task. T16c 종결 시 단일 mirror 1 회 권장 (T14/T15 처럼 sub-task 별 mirror 반복 X).

## 다음 진입 (T16c 권장)

T16c — `playwright-snapshot.ts` + `DesignPreview` UI:
- `src/main/snapshot/playwright-snapshot.ts` 신규 — Electron BrowserWindow off-screen render (puppeteer/playwright 의존성 추가 X). `renderHtmlCssToPng(html, css, viewport, outputPath)` 메서드. PathGuard 봉인 (junction realpath 비교) — outputPath 가 ArenaRoot 안에 있어야. desktop 1280x720 + mobile 375x812 두 viewport 순차 render (concurrent X — race 회피).
- `runGeneratingSnapshotPhase` 본체 교체 — 현재 placeholder throw 를 `playwright-snapshot.renderHtmlCssToPng` 호출로 교체. 성공 시 `emitDesignSnapshotReady` push + `DesignSnapshotPaths` 반환. 실패 시 (Electron 호출 throw) abortReason='snapshot_failed'.
- `src/renderer/features/messenger/DesignPreview/` 신규 — desktop / mobile 탭 + PNG `<img src="file://...">` (sandbox 허용 X — Electron contextBridge 통한 데이터 URL 변환 또는 file:// 직접 사용).
- step 7c handoff 추가 — `runDesignWorkflow` 안 snapshot 직후 `runHandoffPhase()` 호출 (현재는 placeholder throw 로 unreachable).
- vitest + e2e: snapshot 생성 통합 + UI 탭 전환 + 7-step 정상 흐름 (drafting → 회의 #1 → revision → implementation → 회의 #2 → snapshot → handoff committed).

## 준수해야 할 invariant

- **MeetingPhase 11 종 union 모든 부서 흐름 표현** — design-only phase 2 종 (`assigning_designated_task` + `generating_snapshot`) 도 enum 안에 존재. ordinal 만 차지 — 다른 부서 (planning / review / audit) orchestrator 분기에서는 design-only phase 진입 X.
- **assigning_designated_task 직원 응답 schema = Step1 = Step6** — alias 결정 (T16a) 으로 turn-executor 가 같은 OpinionGather pipeline 으로 처리. 향후 schema 분기 필요 시 alias 만 교체.
- **prompt body 안 JSON literal escape 필수** — displayName / suggestedLabel 사용자 입력 가능 → `"` 를 escape 안 하면 직원 응답 JSON parse 실패 (T16a 결정 + buildDesignedTaskPromptBody 의 escapeForPrompt).
- **빈 opinions 응답 = 직원 거부 = abort** — designated-task 는 회의 진입 자체가 막히므로 idea/full-set 의 의견-없음 분기 (회의 자체는 계속) 와 다름. orchestrator (T16b) 의 attempt 2 회 loop + DesignatedTaskFailedError 가 핵심.
- **임시 designated-worker resolver = T23 land 시 정식 resolver 로 교체 target** — `resolveDesignatedWorker(candidates, capability)` 시그니처 호환만 유지하면 single import 변경 + helper 함수 통째 삭제로 swap.
- **회의록 ordinal 분리 = design 부서 한정** — 풀세트 / idea 부서는 ordinal 미지정 → 기존 단일 `minutes.md` 그대로. 다른 부서 영향 없음.
- **session.resetRound() = 회의 ordinal 전환 시점에만** — 자유 토론 phase 안 의견 1 건 합의 시 호출하던 기존 use case 와 별도 — design-workflow 가 회의 #1 종결 후 1 회 호출. label counter reset X.
