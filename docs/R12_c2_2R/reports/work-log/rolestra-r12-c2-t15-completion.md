---
name: R12-C2 T15 종결 — idea-workflow (D-B-Light + USER_PICK) backend + IPC (2026-05-05)
description: R12-C2 Round 2 P3 진입 2 호 완료. awaiting_user_pick phase + IdeaUserPickPending suspend + OpinionService.finalizeIdeaSelection + IPC meeting:idea-finalize-selection. 다음 T16 (design-workflow) 진입 가이드.
type: project
---
# R12-C2 T15 종결 (2026-05-05)

worktree `feat/r12-c2-redesign-r2`, base `daace55` = T14 mirror (commit `9724f61` 위). 14 파일 / +900 라인 안팎 (production +500, test +280, spec +60, ipc-types +60).

**Why:** spec §5.1 — 아이디어 부서 D-B-Light + USER_PICK. 풀세트 부서 (planning / design / review / audit) 가 직원 발화 → 일괄 동의 투표 → 자유 토론 → 모더레이터 회의록을 거치는 반면, 아이디어 부서는 *직원 발화 step 1+2 까지만 + 사용자가 카드 선택 + 자유 코멘트 → 기획 인계*. 본 sub-task = P3 backend 본체 1 호 (T14 채팅창 카드 land 후 첫 부서별 workflow 분기). T16 (design-workflow) / T17 (review/audit) 가 본 패턴 위에서 다른 부서 workflow 추가 land 예정.

**How to apply:** 새 세션 진입 시 T16 (P3-3 design-workflow) 또는 T17 (P3-4 review/audit) 진입. T15 의 `IdeaUserPickPending` suspend 패턴 (single-use Promise holder + abort wire) 을 **재사용 권장** — design 부서의 와이어프레임 5 + 디자인 2 단계 안 사용자 승인 게이트 (Playwright PNG preview 후 [디자인 부서로 보내기] 클릭 대기) 같은 곳에 그대로 적용.

## 산출 요약

### 1. spec 갱신 (`docs/specs/2026-05-01-rolestra-channel-roles-design.md`)

- §5.1 신규 단락 — 아이디어 부서 D-B-Light + USER_PICK 흐름 (gather → tally → awaiting_user_pick → compose_minutes → handoff). 사용자 commit 시 동작 (선택 → agreed / 미선택 → excluded / 코멘트 → user-raised opinion) 명시.
- §11.18.7 fallback 단락에 awaiting_user_pick 직원 응답 X / 사용자 IPC 입력만 명시.

### 2. shared 타입 확장

- `src/shared/meeting-flow-types.ts` — `MeetingPhase` union 8 → 9 종 (`awaiting_user_pick` 추가, idea-workflow 만 사용). `isMeetingPhase` / `ACTIVE_MEETING_PHASES` / `MEETING_PHASE_ORDER` 갱신.
- `src/shared/constants.ts` — SESSION_STATE_ORDER 도큐멘트만 갱신 (값은 MEETING_PHASE_ORDER 위임 그대로).
- `src/shared/opinion-types.ts` — `IdeaFinalizeSelectionInput` / `IdeaFinalizeSelectionResult` / `IdeaPickCard` 타입 신규.
- `src/shared/stream-events.ts` — `StreamIdeaPickSnapshotPayload` 신규 + `StreamEvent` discriminated union 에 추가.
- `src/shared/ipc-types.ts` — `meeting:idea-finalize-selection` channel 신규 (4 reason discriminated response: `idea_pick_validation` / `wrong_phase` / `meeting_not_found` / `unknown_screen_id`).
- `src/shared/ipc-schemas.ts` — `meetingIdeaFinalizeSelectionSchema` (zod) 등록.

### 3. OpinionService 확장 (`src/main/meetings/opinion-service.ts`)

- `finalizeIdeaSelection(input)` 메서드 신규 — 4 단계 작업 단일 호출:
  1. 화면 ID list → UUID 매핑 (UnknownScreenIdError on miss)
  2. 선택된 root → `status='agreed'`
  3. 미선택 root → `status='excluded'` + `exclusionReason='user_not_picked'`
  4. 자유 코멘트 ≥ 1 char → 새 opinion (`kind='user-raised'`, `authorProviderId=null`, `authorLabel='user_1'`, `status='agreed'`) insert
- `IdeaPickValidationError` 신규 — 0 pick + 0 comment (whitespace-only 포함) throw.
- `IDEA_USER_NOT_PICKED_REASON = 'user_not_picked'` / `IDEA_USER_OPINION_AUTHOR_LABEL = 'user_1'` 상수.
- `deriveUserCommentTitle` private — 첫 줄 또는 80 자 ellipsis cut (spec §11.18.2 권장 ≤ 80 글자 정합).

### 4. workflows 폴더 신규 (`src/main/meetings/workflows/`)

- `idea-workflow.ts` 신규 — `IdeaUserPickPending` (single-use Promise holder + abort 분기) + `IdeaPickSnapshot` / `IdeaWorkflowResult` / `IdeaUserPickAbortReason` 타입.
- `__tests__/idea-workflow.test.ts` 신규 — Pending lifecycle 10 테스트 (pristine / wait → commit / wait → cancel / settled 후 wait throw / 중복 commit throw / 호출 안 한 cancel no-op / replaced reason carry).

### 5. orchestrator wire (`src/main/meetings/engine/meeting-orchestrator.ts`)

- `private ideaPending: IdeaUserPickPending | null` 필드 추가.
- `run()` phase loop 안 channel.role==='idea' 분기 → `runAwaitingUserPickPhase()` 호출 → outcome=committed 면 quick_vote / free_discussion skip → compose_minutes 진입.
- `runAwaitingUserPickPhase()` 메서드 본체 — phase 전환 + tally → IdeaPickSnapshot (root 카드만) → `streamBridge.emitIdeaPickSnapshot` → IdeaUserPickPending suspend → wait() → commit / abort 분기.
- `submitIdeaPick(input)` 외부 surface — 동기 호출 안에서 `OpinionService.finalizeIdeaSelection` 실행 + `pending.commit(input)` (wait promise resolve). 결과 동봉 반환 — IPC 핸들러가 IPC 응답에 매핑.
- `stop()` 안 abort wire — `ideaPending.cancel({ kind: 'aborted' })` 호출로 wait() reject + finalize aborted 진입.
- StreamBridge `emitIdeaPickSnapshot(payload)` helper 추가.
- `KNOWN_EVENT_TYPES` 안 `'stream:idea-pick-snapshot'` 등록.

### 6. IPC handler (`src/main/ipc/handlers/meeting-handler.ts`)

- `handleMeetingIdeaFinalizeSelection` 신규 — orchestrator lookup + `submitIdeaPick` 호출 + Error → reason 매핑:
  - `IdeaPickValidationError` → `reason: 'idea_pick_validation'`
  - `UnknownScreenIdError` → `reason: 'unknown_screen_id'`
  - submitIdeaPick wrong-phase / not-running message → `reason: 'wrong_phase'`
  - 그 외 Error → propagate (silent fallback 금지 invariant 준수)
- `getOrchestrator` 결과 null → `reason: 'meeting_not_found'`.
- `src/main/ipc/router.ts` — 채널 `'meeting:idea-finalize-selection'` 등록.

### 7. 단위 테스트

- `src/main/meetings/__tests__/opinion-service.test.ts` — `finalizeIdeaSelection` describe 신규 (8 테스트):
  - selected → agreed / unselected → excluded with user_not_picked reason
  - userComment alone (zero picks) inserts user-raised opinion + excludes all root cards
  - combination — selected cards + user comment work together
  - throws IdeaPickValidationError on 0 + 0 (or whitespace) comment
  - throws UnknownScreenIdError on alien screen id
  - long user comment derives 80-char title with ellipsis (본문 truncate 없음)
  - multiline comment derives first line as title
  - empty meeting (no gather) + comment-only → throws (channelId derive 불가)
- `src/main/meetings/workflows/__tests__/idea-workflow.test.ts` — `IdeaUserPickPending` 10 테스트.

### 8. 회귀 fix

- `src/main/meetings/__tests__/meeting-service.test.ts:329` — quick_vote ordinal 2 → 3 (awaiting_user_pick 끼워 넣은 결과). 코멘트 갱신 + ordinal 정정.

## 검증

- `pnpm typecheck:node` — 0 error
- `pnpm typecheck:web` — 0 error
- `pnpm vitest run` — **3369 PASS / 13 skip / 0 fail** (T14 baseline 3351 + 18 신규 = `finalizeIdeaSelection` 8 + `IdeaUserPickPending` 10).
- `pnpm inspect:safety` — total hits **95** (T14 baseline 동일 — T15 추가 위반 0).

## 핵심 결정

- **awaiting_user_pick 을 phase 로 명시** (idea-workflow 만 진입) vs tally 안 suspend — phase 명시 채택. UI 측 stream:meeting-phase-changed 신호로 SsmBox idea variant 활성화 trigger 가 명확.
- **0 pick + 0 comment 거부** (사용자 결정 2026-05-05) — UI 측 [기획 부서로 보내기] 버튼 비활성화 + backend `IdeaPickValidationError` throw 이중 방어.
- **submitIdeaPick 안 동기 finalize + commit** — handler 가 IPC 응답에 finalize 결과 (agreedIds / excludedIds / userOpinionId) 동봉 가능. orchestrator phase loop 는 wait() 풀린 시점엔 이미 DB 갱신된 상태 → 다음 phase (compose_minutes) 진입 시 추가 read 만.
- **IdeaUserPickPending = single-use Promise holder** — settled 후 wait() / commit() 모두 throw, cancel() 만 no-op (idempotent abort). T16 design-workflow 의 사용자 승인 게이트 같은 패턴에서 재사용 가능.
- **사용자 자유 코멘트 = `kind='user-raised'` opinion** (별도 handoff payload 필드 X) — DB 진실원천 invariant 유지 + 회의록 [합의] 섹션에 자연 통합 (compose_minutes 가 status='agreed' opinion 만 [합의] 에 포함하므로).
- **회의록 [합의]+[제외] 양식 그대로** — idea variant 도 compose_minutes 진입. spec §4 line 388 정합.

## 다음 단계 — T16 또는 T17 진입

- **T16 (P3-3 design-workflow)** — 디자인 부서 7 단계 (와이어프레임 5 + 디자인 2) + Playwright PNG snapshot. T15 의 `IdeaUserPickPending` 패턴을 wireframe → design 사이 사용자 승인 게이트에 적용 권장.
- **T17 (P3-4 review/audit)** — 리뷰 부서 (chain 외) + 검토 부서 (chain 끝). 풀세트 흐름 그대로 + handoff 분기만 추가.
- **T18 (SsmBox 부서별 5 variant 통합)** — T15 의 `stream:idea-pick-snapshot` 구독 + 카드 list + 선택 체크 + 코멘트 textarea + [기획 부서로 보내기] 버튼 wire. T16 / T17 land 후 진입.

T16 진입 시 reference 권장:
- 본 work-log 의 `IdeaUserPickPending` 패턴 (single-use Promise holder)
- `runAwaitingUserPickPhase` 의 phase 전환 + emitSnapshot + suspend 흐름
- handler 안 Error → reason 매핑 패턴 (IdeaPickValidationError / UnknownScreenIdError 자리에 design 도메인 에러 자체 정의 추가)
