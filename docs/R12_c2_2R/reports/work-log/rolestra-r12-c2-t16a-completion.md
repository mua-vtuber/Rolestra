---
name: R12-C2 T16a 종결 — design-workflow types + phase + stream skeleton (P3 진입 3 호 split, 2026-05-06)
description: T16 (디자인 부서 7 단계 + Playwright snapshot) 의 *foundational types* + skeleton 분리 land. T15 대비 3-5x 큰 변경이라 T10 split 선례 따라 T16a/b/c 분할. T16a = types + skeleton. T16b (orchestrator wire) / T16c (Playwright snapshot + UI) 잔여.
type: project
originSessionId: 27476ce8-c6b4-48a2-9503-3319107541b0
---
# R12-C2 T16a 종결 (2026-05-06)

worktree `feat/r12-c2-redesign-r2`, base `15bced5` = T15 mirror. T16a production commit `84518a6`.
7 파일 / +666 라인 / -21 라인 (work-log mirror 미발행 — T16 = T16a/b/c 누적 후 T16c 종결 시 미러 권장).

**Why:** T16 (P3-3 디자인 부서 워크플로우 + Playwright snapshot) 가 풀세트 회의 두 번 + 시스템→직원 dispatch 3 회 + Playwright PNG 통합으로 T15 (idea-workflow, +500 안팎) 대비 3-5x 큰 변경 예측 — 단일 commit 시 review 부담 큼. T10 split (T10a/T10b/T10c) 선례 따라 사전 분할:
- T16a (본 sub-task): types + phase + stream skeleton — orchestrator runtime wire X
- T16b: orchestrator design 분기 + 7-step state machine + capability-first-match 임시 designated-worker resolver
- T16c: playwright-snapshot.ts (Electron BrowserWindow off-screen) + DesignPreview UI

**How to apply:** 새 세션 진입 시 (a) T16b (orchestrator wire — orchestrator-side runtime + 임시 resolver) 우선 권장 / (b) T16c (snapshot + UI — orchestrator 와 독립 가능) 도 가능. T16b 가 더 길고 위험 — T16c 먼저 land 시 T16b 진입 시점에 wire 받는 측 표면이 이미 준비됨. **권장 순서: T16b → T16c** (T16b 가 stream emit 호출 → T16c 가 그 stream 받는 UI). 단, T16b 안 capability-first-match resolver 는 T23 (E. designated-worker-resolver) land 시점에 정식 resolver 로 교체 — T16b 안 인라인 helper 는 추후 deletion target.

## 산출 7 항목

### 1. spec 갱신 (`docs/specs/2026-05-01-rolestra-channel-roles-design.md`)

- §5.2 신규 단락 — 디자인 부서 7 단계 (R12-C2 P3 정식, T16):
  - 와이어프레임 단계 5 sub-step (assigning_designated_task wireframe_drafting → 회의 #1 → assigning_designated_task wireframe_revision)
  - 디자인 단계 2 sub-step (assigning_designated_task design_implementation → 회의 #2 → generating_snapshot → handoff)
  - phase loop 안 phase 진입 순서 + designated worker resolver T23 의존 표시 + snapshot 위치
- §11.18.9 신규 — step 6 assigning_designated_task 직원 응답:
  - §11.18.9a sub-kind 3 종 매트릭스 (kind / step / capability / content 형태)
  - §11.18.9b sub-kind 별 prompt 분기 (헤더 + 미션 + priorContent + JSON skeleton)
  - §11.18.9c 빈 opinions 응답 처리 (1 회 재요청 + 2 회 실패 시 abort + outcome='aborted' / abortReason='designated_task_failed')
  - §11.18.9d generating_snapshot phase 정의 + stream `stream:design-snapshot-ready` contract (desktopPath / mobilePath / generatedAt / sourceOpinionUuid)

(§11.18.8 은 T13 NextStep 카드 분류가 이미 차지 — design-task schema 는 §11.18.9 로 분리.)

### 2. shared 타입 확장

- `src/shared/meeting-flow-types.ts` — `MeetingPhase` 9 → 11 종 (`assigning_designated_task` / `generating_snapshot` 추가). `isMeetingPhase` / `ACTIVE_MEETING_PHASES` / `MEETING_PHASE_ORDER` 갱신.
- `Step6DesignedTaskSchema` 신규 = `Step1OpinionGatherSchema` alias (single root opinion 권장) + `Step6DesignedTaskSchemaType` export.
- `DesignedTaskKind` union (`'wireframe_drafting' | 'wireframe_revision' | 'design_implementation'`) + `DESIGNED_TASK_KINDS` ReadonlyArray + `isDesignedTaskKind` type guard.
- `PHASE_RESPONSE_SCHEMAS` 에 `assigning_designated_task: Step6DesignedTaskSchema` 매핑 추가.

### 3. stream-events / stream-bridge 확장

- `src/shared/stream-events.ts` —
  - `StreamDesignedTaskAssignedPayload` 신규 (assigning_designated_task phase 진입 시 push: `taskKind` / `meetingOrdinal` 1|2 / `assignedProviderId` / `assignedAuthorLabel`)
  - `StreamDesignSnapshotReadyPayload` 신규 (generating_snapshot 완료 시 push: `desktopPath` / `mobilePath` / `generatedAt` / `sourceOpinionUuid`)
  - `StreamEvent` discriminated union 에 두 type 추가
- `src/main/streams/stream-bridge.ts` — `KNOWN_EVENT_TYPES` 에 `stream:designed-task-assigned` / `stream:design-snapshot-ready` 등록 + `emitDesignedTaskAssigned` / `emitDesignSnapshotReady` helper 추가.

### 4. design-workflow.ts 신규 (`src/main/meetings/workflows/design-workflow.ts` ~180 lines)

- 결과 타입 — `DesignWorkflowResult` (committed | aborted) / `DesignSnapshotPaths` (desktop + mobile + sourceOpinionUuid + generatedAt) / `DesignWorkflowAbortReason` discriminated union (`aborted` / `designated_task_failed` / `snapshot_failed` / `replaced`)
- 컨텍스트 — `DesignedTaskContext` (kind + meetingOrdinal + priorContent + speakerDisplayName + suggestedLabel)
- prompt builder — `buildDesignedTaskPromptBody(ctx)` sub-kind 별 한국어 prompt:
  - 헤더: `[현재 단계: 디자인 부서 — step N — <description>]`
  - 미션: sub-kind 별 본문 (와이어프레임 작성 / 합의 반영 / HTML/CSS 작성 — Playwright 1280x720 + 375x812 안내)
  - 참고 자료: `priorContent` (없으면 `(없음 — 회의 진입 발화만 참고)`)
  - JSON skeleton: §11.18.2 Step1 양식 그대로 (single opinion 권장) + JSON-safe `escapeForPrompt` (\\ + ")
- opinion 추출 — `extractDesignedTaskOpinion(payload)` 빈 → null / 1+ → 첫 번째 (다수 시 silent drop)
- helper — `headerForKind` / `missionForKind` / `titleHintForKind` / `contentHintForKind` / `escapeForPrompt` 순수 함수

### 5. design-workflow.test.ts 신규 (10 tests)

- 3 sub-kind 별 prompt body 헤더/미션 검증 (`step 1 — UX 와이어프레임 작성` / `step 5 — 와이어프레임 수정` / `step 6 — UI 디자인 (HTML/CSS) 작성`)
- viewport 명시 (1280x720 + 375x812) `design_implementation` prompt 안 포함
- priorContent 빈 문자열 허용 (`(없음` 표기)
- JSON skeleton 양식 (`name` + `label` + `opinions`) 3 sub-kind 동일
- displayName 안 `"` + `\\` JSON-safe escape (`"name": "A \\"B\\" \\\\ C"` 형태)
- label 안 `"` 도 동일 escape
- `extractDesignedTaskOpinion` 빈 → null / 1 → 그대로 / N → 첫 1 만 (silent drop)

### 6. 회귀 fix

- `src/main/meetings/__tests__/meeting-service.test.ts:320` — `stateIndex` 코멘트 9 종 → 11 종 갱신 (T16 design phase 2 종 추가 명시). `quick_vote` ordinal 자체는 3 으로 불변 — assertion 통과.

### 7. 검증 (T15 baseline 비교)

| 항목 | T15 baseline | T16a |
|------|--------------|------|
| typecheck:node | 0 | 0 |
| typecheck:web | 0 | 0 |
| vitest PASS | 3369 | 3379 (+10 design-workflow.test.ts) |
| vitest skip | 13 | 13 |
| vitest fail | 0 | 0 |
| inspect:safety total hits | 95 | 95 (T16a 추가 위반 0) |

## 핵심 결정 (T16a 한정)

1. **MeetingPhase enum 11 종으로 확장** — 풀세트 회의 phase 위에 design-only 2 종 추가. orchestrator (T16b) 가 channel.role==='design' 분기에서 진입. ordinal 5 (`assigning_designated_task`) 와 ordinal 7 (`generating_snapshot`) 자리 차지하지만 다른 부서 흐름에는 영향 X.
2. **Step6DesignedTaskSchema = Step1OpinionGatherSchema alias** — 두 schema 본체 동일 (single root opinion 권장 + opinions 배열). spec 참조 명확화 + 향후 분기 필요 시 (예: 와이어프레임 전용 `wireframe_text` 필드 추가) alias 만 교체. 빈 opinions 허용 (직원 거부 시 outcome='aborted' / abortReason='designated_task_failed').
3. **Step6 = Step1 = single root opinion 권장** — designated-task 응답이 multiple opinions 보낼 가능성 거의 X (prompt 가 강하게 "= 1" 요구). `extractDesignedTaskOpinion` 가 첫 1 만 반환 + 나머지 silent drop — caller 에러 X.
4. **prompt template 한국어 + sub-kind 분기** — 한국어 prompt (디자인 부서 — UX 직원 한국 회사 메타포). sub-kind 별 미션 본문 다름:
   - wireframe_drafting: "기획 인계서를 읽고 *와이어프레임* (구조도 + 사용자 흐름) 텍스트로 작성"
   - wireframe_revision: "와이어프레임 회의 *합의 회의록* 을 읽고 *수정된 와이어프레임* 작성"
   - design_implementation: "수정된 와이어프레임 을 읽고 *HTML+CSS* 작성 (1280x720 + 375x812 모두 동작 권장)"
5. **stream 이벤트 2 신규** — assigning_designated_task 진입 시 `stream:designed-task-assigned` (UI 가 inline progress 표시) / generating_snapshot 완료 시 `stream:design-snapshot-ready` (DesignPreview T16c land 시 desktop/mobile 탭 surface).
6. **JSON-safe escape** — `escapeForPrompt(value)` `\\` → `\\\\` + `"` → `\\"` 변환 (JSON literal 안 안전). prompt body 안 displayName / suggestedLabel JSON literal 형태로 들어가므로 필수 — 안 그러면 직원 응답 JSON parse 실패.
7. **work-log mirror 미발행** — T16 = T16a/b/c 누적 sub-task 라 mirror 는 T16c 종결 시 한 번 (T14/T15 처럼 단일 mirror) 권장. 또는 T16b 진입 시점에 본 메모리 본문 기반 mirror 1 회 + T16c 종결 시 추가 1 회.

## 다음 진입 (T16b 권장)

T16b — orchestrator design 분기 + 7-step state machine + designated-worker temp resolver:
- `src/main/meetings/engine/meeting-orchestrator.ts` —
  - `channel.role === 'design'` 분기 (run() 안 phase loop)
  - `runAssigningDesignatedTaskPhase(kind, meetingOrdinal)` 메서드 (단일 turn dispatch + emitDesignedTaskAssigned + opinion #N root insert)
  - `runGeneratingSnapshotPhase()` 메서드 (T16c playwright-snapshot.ts 호출 + emitDesignSnapshotReady) — T16c 종결 전 throw 'not implemented' placeholder
  - 7 단계 흐름 통합 (step 1 → step 2-4 회의 #1 → step 5 → step 6 → step 7a 회의 #2 → step 7b → step 7c handoff)
- 임시 designated-worker resolver — `resolveDesignatedWorker(channel, capability, drag_order)`:
  - capability-first-match (skill='design.ux' 또는 'design.ui' 첫 직원)
  - drag_order 무시 (T23 정식 resolver 가 부서장 핀 + drag_order + fallback 통합 시 교체)
  - 직원 없음 시 throw `DesignatedWorkerNotFoundError` → orchestrator 가 abort
- vitest: 7 sub-step 통합 + temp resolver 분기 + abort 분기 (designated_task_failed 4 패턴) — 30+ 신규 권장

T16c — playwright-snapshot.ts + DesignPreview UI:
- `src/main/snapshot/playwright-snapshot.ts` 신규 — Electron BrowserWindow off-screen render (puppeteer/playwright 의존성 추가 X — Electron 자체 사용)
  - `renderHtmlCssToPng(html, css, viewport, outputPath)` 메서드
  - PathGuard 봉인 (junction realpath 비교) — outputPath 가 ArenaRoot 안에 있어야
  - desktop 1280x720 + mobile 375x812 두 viewport 순차 render (concurrent X — race 회피)
- `src/renderer/features/messenger/DesignPreview/` 신규 — desktop / mobile 탭 + PNG `<img src="file://...">` (sandbox 허용 X — Electron contextBridge 통한 데이터 URL 변환 또는 file:// 직접 사용)
- vitest + e2e: snapshot 생성 통합 + UI 탭 전환

## 준수해야 할 invariant

- **MeetingPhase 11 종은 모든 부서 흐름의 union** — 부서별로 진입 안 하는 phase 도 enum 안에 존재. ordinal 만 차지. 다른 부서 (planning / review / audit) orchestrator 분기에서는 design-only phase 들어갈 수 X.
- **assigning_designated_task 직원 응답 schema = Step1 = Step6** — 본 alias 결정으로 turn-executor 가 같은 OpinionGather pipeline 으로 처리. 향후 schema 분기 필요 시 alias 만 교체.
- **prompt body 안 JSON literal escape 필수** — displayName / suggestedLabel 사용자 입력 가능 → `"` 를 escape 안 하면 직원 응답 JSON parse 실패.
- **빈 opinions 응답 = 직원 거부 = abort** — designated-task 는 회의 진입 자체가 막히므로 idea/full-set 의 의견-없음 분기 (회의 자체는 계속) 와 다름. caller (orchestrator T16b) 가 1 회 재요청 + 2 회 실패 시 abort 필수.
- **임시 designated-worker resolver 는 T23 land 시 정식 resolver 로 교체 target** — T16b 안 인라인 함수 deletion 예정. 함수 시그니처 호환만 유지하면 T23 wire 시점에 import 한 줄 변경 + helper 함수 통째 삭제.
