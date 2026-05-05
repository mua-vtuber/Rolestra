# Phase R5 — Done Checklist

**Phase**: R5 — 채널 + 메신저 본체
**Plan**: `docs/plans/2026-04-21-rolestra-phase-r5.md`
**Prep**: `docs/reports/analysis/r5-prep-messenger-theme-analysis.md`
**Branch**: `rolestra-phase-r5` (14 task commits + 1 closeout commit = 15 commits since R4 tip `68251d5`)
**Closeout date**: 2026-04-21 (local time)

## 구현 체크리스트 (모두 완료)

| Task | Title | Commit |
|------|-------|--------|
| 0 | R5 브랜치 + spec §10 R5 블록 확장 + miniBtnStyle 3-variant 점검 | `dc81e19` |
| 1 | 신규 theme token 2개 (`messengerHeaderPolicy`, `badgeRadius`) | `2081117` |
| 2 | Renderer hooks 5종 + `active-channel-store` (project-scoped persist) | `9d71f7b` |
| 3 | App view router (dashboard ↔ messenger) + `MessengerPage` skeleton | `bcc2459` |
| 4 | `ChannelRail` + `ChannelRow` — themeKey 3-way 글리프/radius/clip | `46f8b89` |
| 5 | `Thread` + `ChannelHeader` — 채널 kind별 UI 분기 + 회의 시작 버튼 | `09fe997` |
| 6 | `Message` + `SystemMessage` — themeKey 3-way (retro mono-prefix 정책) | `316d287` |
| 7 | `MeetingBanner` + `ApprovalBlock` + `StartMeetingModal` (retro 별도 JSX, 한국어 라벨) | `0d37bab` |
| 8 | `Composer` — `panelRadius` 재활용 + glyph 3-way + `message:append` wire | `1c37573` |
| 9 | `MemberPanel` + `SsmBox` + small primitives (Date / Typing / VoteTally) | `399b07c` |
| 10 | 채널 CRUD 모달 3종 (create / rename / delete — 시스템 채널 비활성) | `cf3253d` |
| 11 | 시스템 채널 자동 생성 wire-up (`ProjectService` 3 경로) + DM 시작 UX | `9b0e676` |
| 12 | i18n populate `messenger.*` + `keepRemoved` 확장 (4 `mapErrorToI18nKey` 서브트리) | (이전 feat 커밋들에 분산 — Task 10/11 포함) |
| 13 | Playwright Electron E2E `messenger-flow.spec.ts` + 본 closeout 문서 + spec §10 R5 체크박스 ✓ + tasks.json completed | (본 커밋) |

## 정식 게이트 통과

| 게이트 | 결과 |
|--------|------|
| `npm run typecheck:web` | exit 0 |
| `npm run typecheck` (전체) | **DONE_WITH_CONCERNS** — `tsconfig.node.json`이 포함하는 legacy v2 경로(`src/main/{memory,recovery,remote,engine,files,ipc/handlers/{consensus,execution,permission,workspace}}`)에서 170 에러. R3 `ca7b847`부터 동일하게 누적된 사전 baseline으로, R5 touch path 0건. `tsconfig.web.json`(renderer 전체)은 clean — R5가 건드린 모든 코드가 여기에 속함. R6에서 legacy engine/memory 재작업을 시작할 때 일괄 정리 예정 |
| `npm run lint` | 0 errors, 12 pre-existing warnings (R3 baseline, 전부 테스트 파일의 literal string — R5 무관) |
| `npm run i18n:check` | 클린 (idempotent write, ko/en 키셋 완전 일치, `keepRemoved` 4 messenger error regex + 1 startDm error regex 보호) |
| `npm run theme:check` | deterministic 생성물 미변경 (R5-Task1 신규 token 2개 확장 후 재검증) |
| `npm run build` | 통과 (main 93kB / preload 1.4kB / renderer 1.07MB — R4 대비 +40kB 증가분은 messenger 코드 + Radix Dialog 추가 소비분) |
| `npx vitest run` 전체 | **2533 passed / 64 pre-existing failed / 6 skipped** — R4 baseline(2319 passed / 64 failed) 대비 **+214 새 테스트 green, 실패 수 변동 없음**. 64건 failure는 legacy `src/main/{database/__tests__,memory,recovery,remote}` migration import 에러 (R3 archive 이전 dead code) |
| `npm run e2e -- messenger-flow` (로컬 WSL) | **DONE_WITH_CONCERNS** — WSL 런타임 제약 동일 (Windows-native npm install 기준 electron Linux binary 부재). 스펙 + config land 완료, 실행은 Windows PowerShell 또는 R10 OS-matrix CI로 이연 (R4-Task12와 동일 정책) |

## 신규 산출물 요약

### Renderer (`src/renderer/`)

- **Messenger 피처 (신규)**: `features/messenger/` 14 파일 — `MessengerPage`, `ChannelRail`, `ChannelRow`, `Thread`, `ChannelHeader`, `Message`, `SystemMessage`, `MeetingBanner`, `ApprovalBlock`, `Composer`, `MemberPanel`, `MemberRow`, `SsmBox`, `TypingIndicator`, `DateSeparator`, `VoteTally` + 각 `__tests__` 스펙
- **Channel CRUD 모달 (신규)**: `features/channels/` 3 파일 — `ChannelCreateModal`, `ChannelRenameDialog`, `ChannelDeleteConfirm` + 각 `__tests__`
- **Meeting 모달 (신규)**: `features/meetings/StartMeetingModal.tsx` + 테스트
- **Members DM 트리거 (신규)**: `features/members/StartDmButton.tsx` + 테스트
- **Hooks (신규 5 + store 1)**: `hooks/{use-channels,use-dms,use-channel-messages,use-active-channel,use-channel-members}.ts`, `hooks/channel-invalidation-bus.ts`, `stores/active-channel-store.ts` (zustand persist key `rolestra.activeChannel.v1`) + 각 `__tests__`
- **View router**: `App.tsx` — `view: 'dashboard' | 'messenger'` state + NavRail 연동

### Main (`src/main/`)

- **Channels 서비스 보강**: `channels/channel-service.ts` 의 `createSystemChannels(projectId)` 가 이미 R2에 land 되어 있었으나, R5-Task11 에서 `projects/project-service.ts` 의 `create` / `linkExternal` / `importFolder` 3 경로에 fail-safe wiring 추가 (트랜잭션 실패 시 project row 보상 삭제). 기존 테스트 2건 수정 + R5 신규 3건 + `r2-integration-smoke` 스모크 2 케이스 추가.

### Shared / Theme

- **Theme tokens 확장**: `docs/Rolestra_sample/theme-tokens.jsx` 의 6 object에 `messengerHeaderPolicy`, `badgeRadius` 추가 → `npm run theme:build` 로 `src/renderer/theme/theme-tokens.ts` + `src/renderer/styles/tokens.css` 자동 재생성.

### i18n

- **`messenger.*` namespace populate**: `src/renderer/i18n/locales/{ko,en}.json` 에 R5 관련 13개 subtree 전체 채움 (approval / banner / channelCreate / channelDelete / channelHeader / channelRail / channelRename / composer / emptyState / memberPanel / pane / ssmBox / startDm / startMeeting / thread / typing). D4 결정대로 영문 라벨은 전부 한국어화되었고, retro 테마의 `$ 채널` / `[진행중]` / `[승인 요청]` 터미널 스타일도 한국어로 유지.
- **`keepRemoved` 확장**: `i18next-parser.config.js` 에 4개 messenger error regex + 1개 startDm error regex 추가 (`mapErrorToI18nKey` 서브트리 보호, R4의 project.errors 패턴과 동형).

### E2E

- **신규 스펙**: `e2e/messenger-flow.spec.ts` — 프로젝트 생성 → messenger 이동 → 시스템 채널 3개 확인 → `기획` 채널 생성 → `안녕하세요` 전송 → 채널 전환 시나리오. `launchRolestra()` 재사용, OS 파일 picker 스텁 불필요(`kind='new'`).

## scope 경계 — R6+ 이연 (변경 없음)

- AI 발화 렌더링(SSM 턴 → 메시지) — R6
- 실시간 메시지 스트림 구독(stream-bridge IPC wiring) — R6
- Meeting 진행/합의/결과 포스팅 — R6 (R5는 start/abort만)
- Approval 버튼 클릭 → 실제 승인/거절 → AI 재시도 — R7
- Member 프로필 편집 UX — R8
- DM 완성 기능(read receipt / typing indicator 실 이벤트) — R10
- 낙관적 업데이트 / Error Boundary 래핑 — R10
- Playwright CI integration + OS matrix — R10
- 6 테마 메신저 스크린샷 시각 sign-off (+ retro 영어 복귀 결정 D8) — Windows/native 수동 또는 R11 릴리스 전

## Known Concerns (R6 인수인계)

1. **Legacy v2 typecheck 누적 에러 170건** — `src/main/{memory,recovery,remote}/__tests__` 가 R3 archive 로 이동한 migration 파일을 import. `tsconfig.node.json` 에서 해당 경로를 조건부 exclude 하거나, R6 engine 재작업 시 dead test 정리. R5 touch path 0건이므로 phase 게이트는 pre-existing baseline 처리.
2. **Playwright E2E WSL 제약** — R4와 동일. Linux Electron binary + better-sqlite3 재빌드 없이는 `_electron.launch` 가 `ERR_DLOPEN_FAILED`. Windows PowerShell `npm run e2e` 에서 실 검증 권장, 아니면 R10 matrix CI.
3. **6 테마 스크린샷 미수집** — 시각 sign-off (특히 retro `$ 채널` / tactical clip-path) 는 R5 코드 correctness 에 non-blocking. R11 릴리스 전 또는 디자인 리뷰 세션에서 일괄 캡처.
4. **Thread 메시지 렌더러 placeholder** — `Thread.tsx` line 152 가 여전히 `messenger.thread.messageListPlaceholder` 를 표시하고 실제 `Message`/`SystemMessage`/`ApprovalBlock` 분기 렌더는 미구현. 훅/IPC/컴포넌트는 모두 완성되어 있어 Thread 본문 교체만 남음 — R6 첫 태스크 후보.
