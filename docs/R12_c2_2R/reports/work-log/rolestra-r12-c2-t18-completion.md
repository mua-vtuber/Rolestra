---
name: R12-C2 T18 종결 — SsmBox 부서별 5 variant 통합 + channel.role 분기 (P3 진입 5 호, 2026-05-06)
description: R12-C2 Round 2 P3 진입 5 호 완료. SsmBox.tsx 단일 파일 → SsmBox/ 폴더 7 파일 분리. 5 variant (idea / planning|review|audit / design / implement / general) + LegacyVariant fallback. 다음 T19 (RunStep step_kind 집계 hook) 진입 가이드.
type: project
originSessionId: 9772764e-7059-4a42-8661-fa024f4270c1
---
# R12-C2 T18 종결 (2026-05-06)

worktree `feat/r12-c2-redesign-r2`, base `e91f64d` (= T17 work-log mirror, T17 production `0101667` 위). 15 파일 / +1266 / -160 lines (8 신규 + 2 변경 + i18n 2 + test 2 + tasks.json 1).

production commit `81e3a94`.

**Why:** spec §11.13 line 874~898 — 회의 진행 본체가 부서마다 흐름이 다른 만큼 우측 SsmBox 도 부서별 variant 5 종으로 분기. 모든 variant 는 같은 backend (`OpinionService` + `MeetingMinutesService`) 데이터 (`opinion` + `opinion_vote`) 를 읽되 표현 layer 만 다름. spec line 886: "props 는 channelId 1 개만 받고, 내부에서 channel.role 보고 variant 결정. 부서별 컴포넌트는 같은 폴더 (`renderer/features/messenger/SsmBox/`) 안에 5 개 파일 분리". P3 진입 5 호 = T14 (MessageRenderer 카드) + T15 (idea-workflow) + T16 (design-workflow) + T17 (review/audit workflow) 다음 자리. backend 본체는 T15~T17 에서 마무리됐고 본 sub-task 는 frontend 표현 layer 분기 + skeleton.

**How to apply:** 새 세션 진입 시 T19 (P3 진입 6 호 — 부서별 RunStep step_kind 집계 hook = H1 데이터 source) 진입. T18 의 placeholder slot 들 (`ssm-box-idea-list` / `ssm-box-opinion-tree` / `ssm-box-design-sequence` / `ssm-box-progress-slot` / `ssm-box-minutes-preview` / `ssm-box-general-cards`) 이 T19 의 `dashboard:progress-snapshot` IPC 응답 + `dashboard:progress-changed` stream 의 hookup 지점. 모든 variant 가 layout-only — 실 데이터 hookup 은 R12-C2 P3 잔여 sub-task + R12-W phase 에서 진행.

## 핵심 결정 + 산출

### Public API (spec §11.13 부합)
- 본체 진입점 = `src/renderer/features/messenger/SsmBox/index.tsx` (SsmBox.tsx 단일 파일은 통째 삭제, 폴더 진입).
- props = `{ channelId: string | null, className?: string }` 만 노출. spec 부합.
- 테스트 우회 props 추가 — `channelOverride?: Channel | null` + `meetingOverride?: ActiveMeetingSummary | null`. **production callsite 는 사용 X** — IPC stub 없이 5 variant 분기를 단언할 때만 사용. `undefined` 와 `null` 구분으로 "override 미지정" vs "override 명시적 null" 가 안전 분리.

### 5 variant 라우팅 (spec §11.13 매트릭스)
```
role                                | variant
------------------------------------|------------------
'idea'                              | IdeaVariant
'planning' / 'review' / 'audit'     | PlanningVariant (공유)
'design.ui' / 'design.ux'           | DesignVariant (UI/UX 통합)
'implement'                         | ImplementVariant
'general'                           | GeneralVariant
null / 'design.character' / 'design.background' | LegacyVariant fallback
```

`'design.character'` / `'design.background'` = R12-D 보류 부서 (spec line 142). 채널 자체가 grayed out 이지만 안전 fallback 위해 LegacyVariant 가 받음. R12-W 진입 시 자연스럽게 dead branch 가 됨.

### shared.tsx (SsmBoxFrame)
2-way clip-path (`tactical` polygon(5px) 양 모서리) + panelRadius 토큰 (warm=12, retro=0) + retro mono 폰트 분기를 한 곳에서 관리. data attribute 4 종으로 routing 테스트 / e2e 선택자 제공:
- `data-ssm-variant` — `'idea' | 'planning' | 'design' | 'implement' | 'general' | 'legacy'`
- `data-channel-role` — `RoleId` 또는 `''` (null)
- `data-has-meeting` — `'true' | 'false'`
- `data-state-index` / `data-state-name` — meeting 활성 시

### variant 별 spec §11.13 부합 surface
- IdeaVariant: 의견 list slot + step 2 까지만 (D-B-Light) — `<ul data-testid="ssm-box-idea-list">`.
- PlanningVariant (planning/review/audit 공유): 의견 트리 + 회의록 [합의]+[제외] 미리보기 footer — `<ol data-testid="ssm-box-opinion-tree">` + `<footer data-testid="ssm-box-minutes-preview">`. 헤더 라벨만 부서별 (`기획 / 리뷰 / 검토`).
- DesignVariant (design.ui + design.ux 통합): 디자인 7 단계 + Playwright 미리보기 slot — `<ol data-testid="ssm-box-design-sequence">` + `<div data-testid="ssm-box-design-preview-slot">`. T16c land 된 `<DesignPreview>` 와 future hookup.
- ImplementVariant: designated AI / 진행도 / 작업 중 파일 list slot — `data-testid="ssm-box-designated-slot|progress-slot|file-list-slot"`. **회의 X surface — opinion 트리 / 투표 자체 없음** (spec 부합).
- GeneralVariant: 카드 누적 list — `<ul data-testid="ssm-box-general-cards">`. **잡담 정체성 — 합의 / 회의록 / 인계 surface 모두 X**. T20 ([##본문] 파서) → T21 (final) 가 본격 surface 로 land.
- LegacyVariant: 옛 SSM N/TOTAL 표시 + ProgressGauge 보존 (R5-Task9 ↔ T10b phase 모델 호환). role=null 일 때 표시.

### MemberPanel callsite 단순화
- useActiveMeetings + activeMeeting 계산을 SsmBox 내부로 위임.
- 일반 채널 (#일반) 분기는 `!isGeneralChannel` gate 가 카드 자체를 hide 하므로 P1.5 의 "잔존 active meeting row 무시" 가드는 SsmBox 호출 진입 자체가 안 되어 자연스럽게 만족.

### 테스트 (28 항목)
- SsmBox.test.tsx 갱신 (12 테스트):
  - 3 형태 토큰 (warm / tactical / retro 클립 + 라디우스 + 폰트)
  - 3 LegacyVariant meeting wire (라벨 / 게이지 ratio / topic)
  - 2 빈 상태 (meeting=null / channelId=null fallback)
  - 1 hex literal guard (8 파일 모두)
- SsmBoxRouting.test.tsx 신규 (16 테스트):
  - 11 RoleId 매핑 (idea / planning / review / audit / design.ui / design.ux / implement / general / null / design.character / design.background)
  - 7 빈 상태 parametrized + 1 general 잡담 정체성 단언

### 검증
- typecheck:web 0 / typecheck:node 0
- vitest 3452 PASS / 13 skip (T17 baseline 3432 → +20 = 새 28 - 기존 8)
- inspect:safety 95 (T17 동일, 신규 코드 위반 0)

### 신중하게 처리한 부분
1. **IPC stub** — SsmBox 가 useDms / useGlobalGeneralChannel / useActiveMeetings 를 mount 시 호출하므로 jsdom 에 `installArenaStub` 으로 `channel:list` / `channel:get-global-general` / `meeting:list-active` 응답 stub + `onStream` 빈 listener 깔아 IPC throw 차단. variant 분기는 `channelOverride` / `meetingOverride` 로 결정되지만 stub 자체는 필요 (mount path).
2. **`pausedAt` 필수** — `ActiveMeetingSummary.pausedAt: number | null` 이 non-optional 이라 makeMeeting helper 에서 명시 필요.
3. **`channelOverride === undefined` 판정** — `useMemo` 가 `null` (override 명시적 null) 과 `undefined` (override 미지정) 을 구분해야 production callsite 에서 우회가 안 일어남.

## 다음 진입 (T19)

**T19 — P3 진입 6 호 — 부서별 RunStep step_kind 집계 hook (H1 데이터 source)**

산출 (plan 기준):
- `src/main/meetings/run-step/run-step-aggregator.ts` 신규 — 부서별 step_kind 분포 + 진행도 (idle/in-meeting/handoff-pending/done) 산출.
- IPC `dashboard:progress-snapshot` (fetch entry).
- IPC stream `dashboard:progress-changed` (RunStep 새 row 시 push).

Verify: vitest unit + integration. spec §11.21 H1 데이터 source 부합. [후보 A → H 데이터 source]

T19 의존 = T13 (NextStep classifier) + T18 (SsmBox 5 variant) — 두 개 모두 land. T18 의 placeholder slot 들이 T19 의 응답 + stream 의 첫 hookup 대상. dashboard 위젯 (T40, R12-W) 의 데이터 source 도 같은 IPC 재사용.

T19 진입 전 `git worktree list` + `git status` 로 `feat/r12-c2-redesign-r2` 위 작업 중인지 확인. 새 base = `81e3a94` (T18 production) + work-log mirror commit.

## tasks.json 상태
- T0~T18 = `completed`
- T19~T35 = `pending`
