# Rolestra Phase R5 — 채널 + 메신저 본체 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** R4까지 대시보드 + 프로젝트 생성 UX가 동작하는 상태 위에 **메신저 본체**를 올린다. 즉 (a) 좌측 ChannelRail(프로젝트 채널 + DM 섹션), (b) Thread(채널 헤더 + 메시지 스크롤 + Composer), (c) MemberPanel(참여자 + 합의 상태), (d) 채널 생성/rename/delete + DM 시작 + 시스템 채널 자동 생성 wire-up, (e) 채널 상단 "회의 시작" 버튼으로 Meeting 레코드 생성 + 진행 배너 노출. R5 종료 시 앱에서 프로젝트 선택 → 채널 클릭 → 메시지 교환(사용자 발화) → 회의 시작까지 6 테마 전부에서 정상 동작하고, Playwright Electron E2E로 "채널 생성 → 메시지 전송 → 렌더링" 시나리오를 증빙한다.

**Overview (자연어, 비코더용):**

- R4까지 앱을 실행하면 대시보드가 첫 화면으로 뜨고, ProjectRail에서 프로젝트를 고를 수 있다. 하지만 "메시지" 탭으로 들어가면 **아직 비어 있다** — R5가 그 자리에 실제 메신저 화면을 채운다.
- 좌측에는 프로젝트 시스템 채널(`#일반` / `#승인-대기` / `#회의록`) + 사용자 채널 + DM 섹션이 순서대로 나오고, 채널을 클릭하면 중앙에 그 채널의 **메시지 스레드**가 열린다. 맨 아래엔 메시지 입력창(Composer).
- 시스템 채널 3개는 프로젝트를 새로 만들 때 **자동으로 같이 만들어진다**. R2에 이미 만들어둔 `ChannelService.createSystemChannels()`를 `ProjectService.create()`에서 호출하도록 **연결만** 하면 된다. 외부/가져오기 프로젝트도 동일 — 프로젝트 레코드가 생기면 그 순간 시스템 채널도 생긴다.
- 메시지는 "사용자가 입력 → Enter → DB에 저장 → 화면에 추가" 흐름이다. AI 발화는 R6(SSM 연동) 이후라 R5에서는 **사용자 메시지 + 시스템 메시지**만 렌더링한다. 실시간 스트림 구독(다른 세션에서 보낸 메시지가 즉시 뜨는 것)도 R6 — R5에서는 화면 진입·메시지 전송 직후 refetch로 대체.
- 메신저는 R4 회고("토큰 스왑만으론 부족")에 직접 대응한다. 15개 신규 컴포넌트 중 **9개는 `themeKey` 3-way 분기**(warm/tactical/retro)를 컴포넌트 내부 switch로 수행한다 — ProgressGauge 패턴. 나머지는 토큰 또는 기존 discriminator 재활용. prep 문서(`r5-prep-messenger-theme-analysis.md`) §4 인벤토리를 그대로 따른다.
- 채널 생성/rename/delete는 R4의 `ProjectCreateModal`과 동일하게 **Radix Dialog**로 구현한다. 시스템 채널은 `SystemChannelProtectedError`가 이미 서비스 레벨에서 막고 있으므로 렌더러는 **UI에서 버튼을 비활성화**하는 것으로 defence-in-depth.
- 채널 상단 `[회의 시작]` 버튼은 `channel:start-meeting` IPC를 호출해 Meeting 레코드만 만든다(R5 범위). 생성된 Meeting의 실제 SSM 이벤트 처리(참여자 턴, 합의 진행, 결과 포스팅)는 R6. R5는 **배너 UI + 진행 중 표시만** 보여주고, "회의 종료" 버튼도 일단 abort 용(= meeting:abort). 성공 종료는 R6.
- `spec §7.4 / §10 R5 체크박스`는 Task 0에서 먼저 점검한다. 구현 중 발견되는 모호함은 반드시 spec을 먼저 갱신한 뒤 코드를 고친다(R2~R4 규약).
- R5는 여전히 **legacy IPC 경고를 유지**한다(제거는 R11). 새 Renderer 코드는 `legacy-channel-isolation.test.ts` 경계를 계속 지킨다.

**Architecture:**

- Layering: `renderer → shared → preload(contextBridge) → main`. R3 구조 그대로.
- Main 신규: **없음**(R2에서 ChannelService / MessageService / 7 channel:* IPC / 4 message:* IPC / 2 meeting:* IPC 전부 구축 완료). R5는 딱 1곳 wire-up: `ProjectService.create` / `linkExternal` / `importFolder` 성공 콜백 후 `ChannelService.createSystemChannels(project.id)` 호출(같은 트랜잭션 또는 직후 공백 없이).
- Renderer 신규:
  - `src/renderer/features/messenger/` 하위 **14개 컴포넌트** + 테스트 (prep §4 인벤토리)
  - `src/renderer/hooks/` — `use-channels` / `use-channel-messages` / `use-active-channel` / `use-channel-members` 4 신규 훅
  - `src/renderer/stores/active-channel-store.ts` (zustand persist, key `rolestra.activeChannel.v1`, project-scoped)
  - `src/renderer/features/channels/` — `ChannelCreateModal` / `ChannelRenameDialog` / `ChannelDeleteConfirm` (Radix Dialog 재사용, R4 `ProjectCreateModal` 패턴 복제)
  - `src/renderer/features/meetings/` — `StartMeetingModal` (주제 입력)
  - App.tsx에 **view router** 도입: `view: 'dashboard' | 'messenger'` 간단 분기(R4의 `<DashboardPage>` placeholder → `<Shell view=... />`로 lift). NavRail 클릭 시 view 전환.
- Styling: R3 tailwind token 체계 유지. 메신저 3-way 분기 컴포넌트는 ProgressGauge 패턴(내부 switch + `data-theme-variant={themeKey}` attribute + hex literal 금지). 신규 토큰 2개(`messengerHeaderPolicy` / `badgeRadius`)는 Task 1에서 theme-tokens.jsx + 6 object + typed shape + tokens.css 일관 업데이트.
- State flow:
  - Channel rail: active project 변경 → `use-channels(projectId)` refetch → DM 섹션은 `use-dms()` (project-independent)
  - Channel click → `use-active-channel().set(channelId)` → Thread가 `use-channel-messages(channelId)` 구독 → `message:list-by-channel` 호출
  - Composer submit → `message:append` → 성공 시 local refetch (`use-channel-messages` invalidate)
  - Meeting 시작 → `channel:start-meeting` → `MeetingBanner` 노출 + `use-active-meetings(channelId)` refetch
- Testing: Vitest jsdom (컴포넌트 + 훅 + modal), Playwright `_electron` 모드 E2E 1 시나리오.

**Tech Stack (R5 추가):**

- 기존(R4까지): TypeScript strict / React 19 / Electron 40 / Vite / Vitest (jsdom) / i18next / zod / zustand / Tailwind / Radix(dialog/radio-group/slot/tooltip/separator) / framer-motion / cva / clsx / @playwright/test
- 신규: **없음**. Radix Dialog + RadioGroup은 R4 Task 9에서 이미 도입, 채널 CRUD 모달에 재활용.

**참조:**

- Spec:
  - `docs/specs/2026-04-18-rolestra-design.md` §5.1, §5.2(channels / channel_members / messages / messages_fts), §6(channel:* + message:* + meeting:*), §7.4(채널 시스템), §7.10(디자인 시스템), §10 Phase R5
- Prep:
  - `docs/reports/analysis/r5-prep-messenger-theme-analysis.md` — 본 plan은 이 문서 §4 인벤토리 + §5 토큰 결정 + §6 필수 AC 항목을 **그대로** 반영한다. 보류 결정 4건(§8)은 Task 0에서 사용자 confirm 후 확정.
- R4 plan: `docs/plans/2026-04-20-rolestra-phase-r4.md` — Radix Dialog 모달 패턴, renderer hook 패턴, IPC wrapper 확장 패턴 답습.
- 시안 정본:
  - `docs/Rolestra_sample/02-Messenger.html` / `02-msg-variants.jsx` — 메신저 6 테마 변형 (구조 정본)
  - `docs/Rolestra_sample/theme-tokens.jsx` — 토큰 정본 (Task 1에서 확장)
  - `docs/Rolestra_sample/2026-04-19-theme-alignment-checklist.md` §"02 Messenger" 금지 규칙
- Main 재사용 모듈(R5에서 신규 구현 없음):
  - `src/main/channels/channel-service.ts` — create/createDm/createSystemChannels/rename/delete + 오류 계층
  - `src/main/channels/message-service.ts` — append/listByChannel/search/listRecent + typed EventEmitter
  - `src/main/meetings/meeting-service.ts` — start/abort/listActive
  - `src/main/ipc/handlers/{channel,message,meeting}-handler.ts` — 이미 9개 R5 관련 채널 전부 핸들링 중
  - `src/main/projects/project-service.ts` — R5에서 **wire-up 1군데 추가** (createSystemChannels 호출)
- IPC 타입: `src/shared/ipc-types.ts` (IpcChannelMap 기존), `src/shared/ipc-schemas.ts` (zod)
- R4 shell 컴포넌트(wiring 대상): `src/renderer/App.tsx`, `src/renderer/components/shell/{NavRail,ProjectRail,ShellTopBar,Shell}.tsx`

---

## Prereqs

- [x] R4 전체 완료(14/14) + main ff-merge (2026-04-21)
- [x] R5 prep 문서 작성 + main merge (`r5-prep-messenger-theme-analysis.md`)
- [x] spec §5.1 / §5.2 / §6 / §7.4 / §7.10 / §10 R4 정본 상태 확인
- [x] Main 레이어 ChannelService / MessageService / MeetingService + 9개 IPC 핸들러 실사용 가능(R2 Task 10~11 + R4 Task 7)
- [ ] `rolestra-phase-r5` 브랜치 `main`에서 생성 (Task 0 첫 step)
- [ ] prep §8 보류 결정 4건 사용자 confirm (Task 0 두 번째 step)

---

## File Structure (R5 종료 시)

```
src/
├── main/
│   └── projects/
│       └── project-service.ts                     # +wire createSystemChannels() into create/linkExternal/importFolder
├── renderer/
│   ├── App.tsx                                    # +view router (dashboard | messenger), NavRail click
│   ├── features/
│   │   ├── messenger/                             # NEW — 14 components
│   │   │   ├── MessengerPage.tsx
│   │   │   ├── ChannelRail.tsx                    # themeKey 3-way
│   │   │   ├── ChannelRow.tsx                     # themeKey 3-way (내부)
│   │   │   ├── Thread.tsx
│   │   │   ├── ChannelHeader.tsx
│   │   │   ├── Message.tsx                        # themeKey 3-way
│   │   │   ├── SystemMessage.tsx                  # themeKey 3-way
│   │   │   ├── MeetingBanner.tsx                  # themeKey 3-way (retro 별도)
│   │   │   ├── ApprovalBlock.tsx                  # themeKey 3-way + miniBtnStyle
│   │   │   ├── Composer.tsx                       # themeKey 분기 (glyph + radius)
│   │   │   ├── MemberPanel.tsx                    # DashCard 재사용
│   │   │   ├── MemberRow.tsx                      # themeKey 3-way (avatar vs dot)
│   │   │   ├── SsmBox.tsx                         # 2-way (tactical clip)
│   │   │   ├── TypingIndicator.tsx                # token-only (placeholder — SSM 연동은 R6)
│   │   │   ├── DateSeparator.tsx                  # token-only
│   │   │   ├── VoteTally.tsx                      # token-only
│   │   │   └── __tests__/*.test.tsx               # 각 컴포넌트 매칭
│   │   ├── channels/                              # NEW — CRUD 모달
│   │   │   ├── ChannelCreateModal.tsx
│   │   │   ├── ChannelRenameDialog.tsx
│   │   │   ├── ChannelDeleteConfirm.tsx
│   │   │   └── __tests__/*.test.tsx
│   │   └── meetings/                              # NEW — 회의 시작 모달
│   │       ├── StartMeetingModal.tsx
│   │       └── __tests__/StartMeetingModal.test.tsx
│   ├── hooks/
│   │   ├── use-channels.ts                        # NEW (project scope)
│   │   ├── use-dms.ts                             # NEW
│   │   ├── use-channel-messages.ts                # NEW (channel scope, listByChannel + append refetch)
│   │   ├── use-active-channel.ts                  # NEW
│   │   ├── use-channel-members.ts                 # NEW
│   │   └── __tests__/*.test.tsx
│   ├── stores/
│   │   └── active-channel-store.ts                # NEW (zustand persist, project-scoped)
│   └── theme/
│       └── theme-tokens.ts                        # +messengerHeaderPolicy + badgeRadius (auto-generated)
├── shared/
│   └── ipc-types.ts                               # 기존, 변경 없음(이미 9 channel/message/meeting 채널 완비)
├── docs/
│   ├── Rolestra_sample/
│   │   └── theme-tokens.jsx                       # +messengerHeaderPolicy + badgeRadius (6 objects)
│   └── superpowers/
│       ├── plans/
│       │   ├── 2026-04-21-rolestra-phase-r5.md    # (this file)
│       │   └── 2026-04-21-rolestra-phase-r5.md.tasks.json
│       └── specs/
│           ├── 2026-04-18-rolestra-design.md      # +§10 R5 체크리스트 확장 (Task 0)
│           └── r5-done-checklist.md               # NEW (Task 13)
├── e2e/
│   ├── messenger-flow.spec.ts                     # NEW (채널 생성 → 메시지 전송 → 렌더)
│   └── fixtures/ …                                # 기존 재사용
└── i18next-parser.config.js                       # +messenger.* dynamic 키 보호 regex
```

`_UPDATABLE` 파일 요약:
- 신규: 34 (컴포넌트 14 + 훅 5 + store 1 + 모달 4 + 테스트 ~14)
- 수정: 5 (`App.tsx`, `theme-tokens.jsx`, `theme-tokens.ts`(자동), `tokens.css`(자동), `project-service.ts`, `spec §10`)
- 삭제: 없음

---

## Tasks

### Task 0 — Branch + prep confirm + spec §10 R5 체크리스트 확장

**목표**: R5 브랜치를 main에서 파고, prep §8 보류 결정 4건을 사용자와 확정하고, spec §10 R5 블록을 R3/R4 템플릿(체크박스 + 산출물 링크)으로 확장한다.

- [ ] `git checkout -b rolestra-phase-r5` from main tip (`68251d5`)
- [x] prep §8 보류 결정 4건 사용자 confirm 완료 (2026-04-21):
  1. **Composer radius** → **D5: `panelRadius` 재활용**(warm=12/tactical=0/retro=0). 신규 토큰 없음. warm 2px 차이 허용.
  2. **섹션 타이틀 i18n** → **D4: 3개 별도 키**(warm/tactical/retro). warm·tactical 값 "채널" 동일 + retro "$ 채널" 한국어 터미널 스타일. tactical "CHANNELS"/"MEETING ACTIVE" 등 **영문 라벨 전체 한국어화**. 영어 복귀 판단은 Task 13 시각 sign-off 후 (D8).
  3. **`DashMiniBtn` v3 이식 상태** — Task 0 코드 점검 항목(아래 step으로 수행).
  4. **시안 `theme.sidebarBg` 안티패턴 금지** → **D7 확정**. 공식 token만 사용.
- [x] Task 0 코드 점검 완료 (2026-04-21) — `src/renderer/components/primitives/button.tsx`가 `shape='auto'` + `miniBtnStyle` 토큰 매핑(`MINI_BTN_TO_SHAPE`)으로 **3 variant(pill/notched/text) 전부 지원**. Task 7 ApprovalBlock에서 `<Button shape="auto">`로 바로 재활용 가능, 보강 불필요.
- [ ] spec §10 R4 블록이 R4 계획에서 쓴 체크박스 템플릿을 따르듯(§10:1129), §10 R5 블록을 같은 템플릿으로 확장:
  - `- [ ]` 항목 8~10개(각 주요 산출물별) + **scope 경계** 하단 블록 + plan/done-checklist 링크 placeholder
  - 체크박스 항목은 Task 1~13 산출물과 1:1 매칭되도록 설계
- [ ] `docs/plans/2026-04-21-rolestra-phase-r5.md.tasks.json` 생성(R4 포맷 답습, 14 task slot, 본 Task부터 `completed=true` 체크)
- [ ] 커밋: `docs(rolestra): R5 plan + tasks.json + spec §10 R5 체크리스트 확장 (R5-Task0)`

**AC**:
- `rolestra-phase-r5` 브랜치 생성됨
- spec §10 R5 블록이 `- [ ]` 체크박스 + 산출물 링크 placeholder + scope 경계 포함
- tasks.json 14-slot skeleton 존재
- prep §8 보류 결정 4건 중 #1/#2 사용자 confirm 완료 (subsequent task에서 참조)

**Testing**: N/A (docs-only commit)

---

### Task 1 — 신규 theme token 2개 추가 (`messengerHeaderPolicy`, `badgeRadius`)

**목표**: prep §5 결정대로 메신저 전용 discriminator 2개를 `theme-tokens.jsx`에 추가하고 6 object 전부에 값을 채운다. `npm run theme:build`로 TS + CSS variable 자동 생성.

- [ ] `docs/Rolestra_sample/theme-tokens.jsx` schema comment에 두 key 추가:
  - `messengerHeaderPolicy: 'stacked' | 'mono-prefix'` — warm/tactical = 'stacked', retro = 'mono-prefix'
  - `badgeRadius: 'pill' | 'square'` — warm = 'pill', tactical/retro = 'square'
- [ ] 6 object 전부에 위 값 채움 (warm-light/dark, tactical-light/dark, retro-light/dark)
- [ ] `npm run theme:build` 실행 → `src/renderer/theme/theme-tokens.ts` + `src/renderer/styles/tokens.css` 자동 갱신 확인
- [ ] `src/renderer/theme/__tests__/theme-tokens.test.ts` 확장: 각 테마에서 두 field 정확한 값 단언 (warm→stacked/pill, tactical→stacked/square, retro→mono-prefix/square)
- [ ] `ThemeToken` 인터페이스에 두 field 타입 추가됐는지 자동 확인 (typecheck:web)
- [ ] 커밋: `feat(rolestra): theme tokens — messengerHeaderPolicy + badgeRadius (R5-Task1)`

**AC**:
- schema comment + 6 object 동일 key 존재
- `npm run theme:build` exit 0, tokens.ts에 두 field 타입 추가
- 6 object × 2 field = 12 단언 테스트 모두 green
- typecheck:web exit 0

**Testing**: Vitest `theme-tokens.test.ts` 확장.

---

### Task 2 — Renderer hooks (5종) + active-channel-store

**목표**: 메신저 UI가 사용할 IPC-backed 훅과 활성 채널 영속 스토어를 만든다. R4 `use-dashboard-kpis`/`use-projects` 패턴 답습 — silent fallback 금지, strict-mode single-fetch guard, error surface 투명.

- [ ] `src/renderer/hooks/use-channels.ts`:
  - signature: `useChannels(projectId: string | null)` — projectId가 null이면 no-op. `channel:list` 호출, 결과 `Channel[]` 반환.
  - refresh trigger: `projectId` 변경 / `refresh()` manual / 채널 생성/rename/delete 성공 콜백.
- [ ] `src/renderer/hooks/use-dms.ts`:
  - signature: `useDms()` — project-independent. `channel:list` with `projectId: null`.
- [ ] `src/renderer/hooks/use-channel-messages.ts`:
  - signature: `useChannelMessages(channelId: string | null, opts?: { limit?: number; before?: number })`
  - `message:list-by-channel` 호출. `send(content: string): Promise<Message>` 액션 노출 — 성공 시 local state에 append + refetch.
  - strict mode 이중 호출 가드, channelId null이면 idle.
- [ ] `src/renderer/hooks/use-active-channel.ts`:
  - active-channel-store에서 `channelId` / `set(channelId)` / `clear()` 노출.
  - active project 변경 시 current channel 검증(`use-channels` 결과에 해당 id가 없으면 clear) — race-safe.
- [ ] `src/renderer/hooks/use-channel-members.ts`:
  - signature: `useChannelMembers(channelId: string | null)` — `channel:list-members` IPC가 없다면 Task 0에서 추가 여부 확인. **현재 IPC 없음** — R5 scope 밖이면 `useMembers()` + filter로 대체 가능. (Task 0 확인 항목으로 추가.)
- [ ] `src/renderer/stores/active-channel-store.ts`:
  - zustand persist, key `rolestra.activeChannel.v1`, shape `{ channelIdByProject: Record<string, string> }` — project별 마지막 활성 채널 기억.
  - active project 전환 시 해당 project의 기억된 channel로 복원 (없으면 null).
- [ ] 각 훅·스토어 `__tests__/*.test.tsx`:
  - happy-path (IPC mock → 데이터 반환)
  - IPC rejection → error surface
  - active project null → idle
  - send 성공 → refetch invoked
  - strict mode 이중 호출 가드 동작
- [ ] 커밋: `feat(rolestra): renderer hooks — channels + messages + active-channel store (R5-Task2)`

**AC**:
- 5 hooks + 1 store 구현, 각각 `__tests__` 존재, 최소 3 케이스(happy/error/null-scope)
- strict-mode single-fetch: mount 시 효과가 한 번만 IPC invoke
- `useChannelMessages.send` 호출 후 refetch가 새 메시지를 반영
- typecheck / eslint / i18n:check 모두 exit 0

**Testing**: Vitest jsdom, `testing-library/react` 훅 테스트 패턴, IPC wrapper는 `vi.mock`.

---

### Task 3 — App.tsx view router + MessengerPage skeleton

**목표**: 현재 App이 `<DashboardPage />`만 마운트하는 상태를 "현재 view에 맞는 페이지를 마운트"하는 view-router 구조로 바꾼다. NavRail 클릭 → view 상태 전환. MessengerPage는 일단 layout skeleton만(rail + thread + memberPanel 빈 껍데기).

- [ ] `src/renderer/stores/view-store.ts` (또는 App 내 `useState`로 충분 — 판단): `view: 'dashboard' | 'messenger'`. NavRail 클릭이 set.
  - zustand persist 필요 없음(세션 scoped) — `useState` + `useCallback` 단순 조합으로 충분.
- [ ] NavRail에 `activeView` prop + `onSelect(view)` 콜백 추가 (기존 R3 NavRail 수정). `items` 배열의 `id`와 `activeView` 매칭.
- [ ] App.tsx:
  - `<Shell>` 내부에 `view === 'dashboard' ? <DashboardPage> : view === 'messenger' ? <MessengerPage> : null`
  - 기존 `<DashboardPage />` 마운트 코드 router 분기로 감쌈
  - 기존 App.test의 "dashboard 페이지가 기본으로 뜬다" 단언 유지
- [ ] `src/renderer/features/messenger/MessengerPage.tsx`:
  - 3-pane layout: left=ChannelRail(placeholder), center=Thread(placeholder), right=MemberPanel(placeholder)
  - token-only 스타일, `data-testid="messenger-page"`
  - active project 없으면 empty state 문구(`messenger.emptyState.noActiveProject`)
- [ ] `__tests__/MessengerPage.test.tsx`: 렌더 시 3-pane 존재, empty state 조건 분기.
- [ ] `__tests__/App.test.tsx` 보강: NavRail `messenger` 클릭 → MessengerPage 렌더, 다시 `dashboard` 클릭 → DashboardPage 렌더.
- [ ] i18n: `messenger.emptyState.noActiveProject` 등 Task 12에서 일괄 populate. Task 3에서는 `t()` 호출 자체만 사용.
- [ ] 커밋: `feat(rolestra): App view router + MessengerPage skeleton (R5-Task3)`

**AC**:
- NavRail 클릭으로 dashboard ↔ messenger 토글
- MessengerPage가 token-only로 3-pane layout 렌더, hex literal 0
- App.test + MessengerPage.test 모두 green
- typecheck / eslint exit 0

**Testing**: Vitest jsdom, App.test 확장 + 신규 MessengerPage.test.

---

### Task 4 — ChannelRail (themeKey 3-way) + ChannelRow

**목표**: 좌측 채널 레일 구현. prep §2.1 테마별 구조 차이 전부 반영. 프로젝트 시스템 채널(고정 3개) + 사용자 채널 + DM 섹션 순서.

- [ ] `src/renderer/features/messenger/ChannelRail.tsx`:
  - `use-channels(activeProjectId)` + `use-dms()` 구독
  - 3개 섹션 렌더: 시스템 채널(system_general/approval/minutes) / 사용자 채널(user) / DM
  - 섹션 타이틀 테마별 (D4 결정 — 한국어 기본, retro 터미널 스타일):
    - warm → `messenger.channelRail.sectionTitle.warm` ("채널" / "DM")
    - tactical → `.tactical` ("채널" / "DM" — warm과 동일 값으로 시작, 시각 차이는 mono font + letterSpacing으로)
    - retro → `.retro` ("$ 채널" / "$ DM" — 한국어 터미널 프롬프트 스타일)
  - 각 row는 `<ChannelRow>` 내부 컴포넌트
  - `data-theme-variant={themeKey}` 부여
  - 하단 `+ 새 채널` 버튼(Task 10 modal 트리거)
- [ ] `src/renderer/features/messenger/ChannelRow.tsx` (내부):
  - `themeKey` 3-way switch:
    - warm: `#` glyph + radius 6 + `itemActiveBg`
    - tactical: `#` glyph + radius 0 + clip-path polygon(4px) + `${brand}12~16` alpha
    - retro: `▶`(active)/`·`(idle) + radius 0 + border 투명, mono font
  - unread badge: `badgeRadius` 토큰(pill/square)
  - hover 상태: theme-aware (warm 살짝 brown tint, tactical border glow, retro underline)
- [ ] 테스트 `__tests__/ChannelRail.test.tsx` + `ChannelRow.test.tsx`:
  - 3 테마 각각에서 glyph/radius/clip 단언 (`useTheme` mock)
  - system 채널 먼저, user 채널 뒤, DM 별도 섹션
  - active state 시각 단언
  - `use-channels` null → empty state 렌더
  - hex literal 0 (AST-level regex check or snapshot으로 확인 — tokens.css 변수 참조만 OK)
- [ ] 커밋: `feat(rolestra): ChannelRail — themeKey 3-way channel list (R5-Task4)`

**AC**:
- warm/tactical/retro 3 테마 DOM 차이 명시적 단언
- 섹션 순서: system → user → DM
- Active channel 클릭 시 `use-active-channel.set()` 호출
- hex literal 금지 가드 통과(ProgressGauge 규약)
- typecheck / eslint / test exit 0

**Testing**: Vitest jsdom + `useTheme` mock 3 variant.

---

### Task 5 — Thread shell + ChannelHeader

**목표**: 중앙 pane 껍데기. 상단 채널 헤더(#채널명 + 참여자 수 + "회의 시작" 버튼), 중앙 스크롤 영역(메시지 리스트 placeholder), 하단 composer area placeholder.

- [ ] `src/renderer/features/messenger/Thread.tsx`:
  - `activeChannelId` 구독, `use-channel-messages(channelId)` 결과 렌더
  - 스크롤 영역: 메시지 DOM을 `Message` / `SystemMessage` / `ApprovalBlock`으로 분기 렌더(kind별)
  - 진행 중 Meeting 있으면 상단 `<MeetingBanner>` 렌더(Task 7)
  - 맨 아래 `<Composer>` (Task 8)
  - scroll-to-bottom on new message (기본 UX)
- [ ] `src/renderer/features/messenger/ChannelHeader.tsx`:
  - `#` glyph + 채널명 + 참여자 수(right-aligned)
  - 채널 kind별 추가 UI:
    - `user` kind → `[회의 시작]` 버튼 (진행 중 meeting 없을 때만 활성)
    - `system_approval` → 읽기 전용 배지 + 핀/설정 아이콘 숨김
    - `system_minutes` → 읽기 전용 배지
  - rename/delete 액션은 ⋯ 오버플로 메뉴 (system 채널은 비활성)
- [ ] 테스트 `__tests__/Thread.test.tsx` + `ChannelHeader.test.tsx`:
  - active channel null → empty state
  - user channel → 회의 시작 버튼 렌더 + enabled
  - active meeting 있음 → 버튼 disabled + tooltip "이미 회의 중"
  - system 채널 → rename/delete 버튼 비활성
- [ ] 커밋: `feat(rolestra): Thread + ChannelHeader (R5-Task5)`

**AC**:
- channel kind 분기 동작 (user vs system_approval vs system_minutes vs dm)
- meeting 상태별 버튼 활성/비활성
- typecheck / eslint / test exit 0

**Testing**: Vitest jsdom.

---

### Task 6 — Message + SystemMessage (themeKey 3-way)

**목표**: 메시지 버블 2종. prep §2.3 테마별 구조 차이 반영.

- [ ] `src/renderer/features/messenger/Message.tsx`:
  - input: `{ message: Message; member: ProjectMember | null; compact?: boolean }`
  - `themeKey` 3-way switch:
    - warm/tactical: `<ProfileAvatar shape={avatarShape}>` + header(name + time + role baseline) + content
    - retro (`messengerHeaderPolicy === 'mono-prefix'`): avatar 없음, mono name prefix 고정폭 64px minWidth, header 없음, content mono
  - `data-theme-variant={themeKey}`
  - `compact=true` → avatar/header 생략(연속 메시지)
- [ ] `src/renderer/features/messenger/SystemMessage.tsx`:
  - input: `{ message: Message }` (author_kind='system')
  - `themeKey` 3-way switch:
    - warm: pill(radius 999) + 중앙 정렬 + `fgMuted`
    - tactical: `${brand}10` 배경 + `${brand}44` border + 중앙 정렬
    - retro: `— {content.replace(/^[📌🗳✅]\s*/, '')} —` mono dash
- [ ] 테스트 `__tests__/Message.test.tsx` + `SystemMessage.test.tsx`:
  - 3 테마 각각 DOM 구조 단언 (avatar 유무, header 유무, 형태)
  - compact 모드 검증
  - i18n 키 참조(`messenger.message.role.*` 등 Task 12에서)
  - hex literal 0
- [ ] 커밋: `feat(rolestra): Message + SystemMessage — themeKey 3-way bubbles (R5-Task6)`

**AC**:
- warm/tactical: ProfileAvatar + full header 렌더
- retro: no avatar, mono-prefix 64px minWidth
- SystemMessage 3 shape 전부 렌더
- hex literal 금지 통과
- typecheck / eslint / test exit 0

**Testing**: Vitest jsdom + `useTheme` 3 variant.

---

### Task 7 — MeetingBanner + ApprovalBlock (themeKey 3-way) + 회의 시작 wire-up

**목표**: 회의 진행중 배너(채널 상단)와 메시지 스레드 내 승인 요청 블록. retro는 별도 JSX, warm/tactical은 공통 shell.

- [ ] `src/renderer/features/messenger/MeetingBanner.tsx`:
  - input: `{ meeting: Meeting }` (active meeting in this channel)
  - `themeKey` 3-way (D4 결정 — 영문 라벨 한국어화):
    - warm: heroBg 그라데이션 + 원형 pulse dot(8px, `dashPulse` 1.6s infinite) + "회의 진행중" pill(radius 999, `${success}12`) + 제목 + crew·경과·SSM meta
    - tactical: `panelHeaderBg` + `<LineIcon name="spark">` + "회의 진행중" mono label(letterSpacing + uppercase 시각 효과 CSS로 처리 못 함 — 한글은 대소문자 없으므로 letterSpacing + mono font만 적용) + clip-path + meta
    - retro: 별도 JSX — `[진행중] 제목 · 참여 3 · 경과 10분 · SSM 9/12` 1-line mono strip (원래 시안 `[LIVE]` → 한국어 `[진행중]`)
  - "회의 종료" 버튼 (MVP는 abort만, 성공 종료는 R6) → `meeting:abort` IPC
- [ ] `src/renderer/features/messenger/ApprovalBlock.tsx`:
  - input: `{ message: Message }` (kind='approval_request')
  - `themeKey` 3-way container (D4 결정 — 영문 라벨 한국어화):
    - warm: radius 8 + `${warning}10` bg + `warning` 1.5px border + "⚠ 승인 요청" label
    - tactical: radius 0 + clip-path polygon(6px) + 동일 bg/border + "⚠ 승인 요청"
    - retro: radius 0 + `[승인 요청]` label (mono bracket 스타일) + `approvalBodyStyle='quote'` quote block
  - 내부 버튼: `<Button miniBtnStyle={...}>` 기존 prop 재활용 (Y/C/N — 허가/조건부/거절)
  - 버튼 클릭은 approval IPC 호출(`permission:approve` 등 R4 기존 채널) — wire-up 존재 시 연결, 없으면 R7에서 완성(이 경우 Task 7에서는 onClick placeholder)
- [ ] "회의 시작" wire-up: Task 5의 ChannelHeader 버튼 → `<StartMeetingModal>` 오픈 → submit 시 `channel:start-meeting` → 성공 시 `use-active-meetings(channelId)` refetch
- [ ] `src/renderer/features/meetings/StartMeetingModal.tsx`:
  - Radix Dialog (R4 `ProjectCreateModal` 패턴 복제)
  - 입력: 주제(`topic` string, 3~200자), 선택 멤버(chip list, defaults = channel members)
  - submit 시 `channel:start-meeting({channelId, topic})`, 성공 시 close + refetch
- [ ] 테스트 `__tests__/MeetingBanner.test.tsx` + `ApprovalBlock.test.tsx` + `StartMeetingModal.test.tsx`:
  - 3 테마 DOM 단언
  - retro MeetingBanner 별도 JSX 단언 (`[진행중]` 문자열 존재 확인 등 — D4 한국어화 반영)
  - StartMeetingModal submit → IPC mock이 정확한 payload로 호출됨
- [ ] 커밋: `feat(rolestra): MeetingBanner + ApprovalBlock + StartMeetingModal (R5-Task7)`

**AC**:
- MeetingBanner 3 테마 DOM 구조 단언 + retro 별도 JSX
- ApprovalBlock approvalBodyStyle='quote' retro 경로 단언
- StartMeetingModal submit IPC payload 검증
- typecheck / eslint / test exit 0

**Testing**: Vitest jsdom + `useTheme` 3 variant.

---

### Task 8 — Composer (themeKey 분기 + message:append wire-up)

**목표**: 메시지 입력창. 프리픽스 glyph + radius + placeholder 분기 + Enter로 전송 + Shift+Enter 줄바꿈 + `@`/`⌘` 힌트 행.

- [ ] `src/renderer/features/messenger/Composer.tsx`:
  - input: `{ channelId: string; readOnly?: boolean; onSendSuccess?: () => void }`
  - `readOnly=true`(시스템 `system_approval`/`system_minutes`) → 읽기 전용 배지 + 입력 비활성
  - `themeKey` 분기 (D5 결정 — `panelRadius` 재활용):
    - warm: `panelRadius` (=12) + `✎` prefix glyph + sans placeholder
    - tactical: `panelRadius` (=0) + `✎` prefix + sans placeholder
    - retro: `panelRadius` (=0) + `>` prefix + mono placeholder
  - Enter → `use-channel-messages().send(content)` → 성공 시 입력 클리어 + `onSendSuccess`
  - Shift+Enter → 개행(기본 textarea 동작)
  - `@` mention 힌트 행 + `⌘` 명령 힌트 행 (R7 completion은 range 밖 — MVP는 라벨만)
- [ ] 테스트 `__tests__/Composer.test.tsx`:
  - 3 테마 DOM 단언 (glyph / radius / font)
  - readOnly 배지 렌더 + 입력 비활성
  - Enter → IPC mock 호출, Shift+Enter → 개행
  - send 실패 시 에러 toast(UI minimum: 입력 복구 + 에러 메시지 inline)
- [ ] 커밋: `feat(rolestra): Composer — themeKey glyph/radius branching + message:append wire (R5-Task8)`

**AC**:
- warm/tactical/retro 3 glyph 단언
- readOnly prop 동작
- Enter 전송 + Shift+Enter 개행
- 전송 실패 시 입력 유지 + 에러 표면
- hex literal 금지 통과

**Testing**: Vitest + `user-event`.

---

### Task 9 — MemberPanel + MemberRow + SsmBox + TypingIndicator + DateSeparator + VoteTally

**목표**: 우측 참여자 + 합의 상태 pane. DashCard 재사용. Row는 themeKey 3-way(avatar vs dot). 합의 상태 박스는 2-way(tactical clip). 공통 small primitive 3종.

- [ ] `src/renderer/features/messenger/MemberPanel.tsx`:
  - 외곽: 2 DashCard(참여자 / 합의 상태)
  - 참여자 섹션: `use-channel-members(channelId)` (또는 `useMembers` + filter) → `MemberRow` 리스트
  - 합의 상태 섹션: Meeting active 시 crew 찬반 현황(mock R5 / 실 SSM data R6) + `SsmBox` (진행도 + 문구)
- [ ] `src/renderer/features/messenger/MemberRow.tsx`:
  - `themeKey` 3-way:
    - warm: `<ProfileAvatar shape='circle' size=28>` + name + cli
    - tactical: `<ProfileAvatar shape='diamond' size=28>` + name + cli
    - retro: 8px status-dot only + mono name + mono cli
- [ ] `src/renderer/features/messenger/SsmBox.tsx`:
  - 2-way: tactical clip-path polygon(5px), 나머지(warm radius 8, retro radius 0)
  - content: "SSM 9/12" + 설명문(`messenger.ssmBox.description.*`)
  - ProgressGauge 재사용(themeKey에 따라 3 variant)
- [ ] `TypingIndicator.tsx` (token-only): dot 3개 + "XX — 작성 중" 라벨 (R5는 SSM 미연동, placeholder — R6에서 실 이벤트)
- [ ] `DateSeparator.tsx` (token-only): `— 오늘, 2026년 4월 21일 —` 가로줄
- [ ] `VoteTally.tsx` (token-only): mono `✓ 2  ✗ 0  · 1` 형태
- [ ] 테스트:
  - MemberPanel / MemberRow: 3 테마 avatar 유무 단언
  - SsmBox: tactical clip 존재 / 나머지 없음 단언
  - Typing/Date/Vote: 기본 렌더 단언
- [ ] 커밋: `feat(rolestra): MemberPanel + SsmBox + small primitives (R5-Task9)`

**AC**:
- MemberRow 3-way DOM 차이 단언
- SsmBox tactical clip 단언
- ProgressGauge value/total 정확히 전달
- typecheck / eslint / test exit 0

**Testing**: Vitest.

---

### Task 10 — Channel CRUD 모달 3종 (create / rename / delete)

**목표**: 채널 생성·이름변경·삭제 UX. Radix Dialog 재사용(R4 `ProjectCreateModal` 패턴). 시스템 채널은 rename/delete 버튼 비활성(defence-in-depth — 서비스 레벨 `SystemChannelProtectedError`도 있음).

- [ ] `src/renderer/features/channels/ChannelCreateModal.tsx`:
  - 입력: 이름(3~50자 중복 허용 안 함 — `DuplicateChannelNameError` surface), 참여 멤버 선택(chip list, prefill = 모든 프로젝트 멤버)
  - submit: `channel:create({ kind: 'user', projectId, name, memberProviderIds })`
  - 성공 → use-channels refetch + 새 채널로 active 전환 + close
  - 에러 표면: 중복 이름 friendly message
- [ ] `src/renderer/features/channels/ChannelRenameDialog.tsx`:
  - 입력: 새 이름
  - submit: `channel:rename({ id, name })`
  - 성공 → refetch + close; 시스템 채널이면 진입 자체가 막힘(버튼 비활성)
- [ ] `src/renderer/features/channels/ChannelDeleteConfirm.tsx`:
  - 확인 dialog ("진짜 삭제? 메시지는 영구 소실")
  - submit: `channel:delete({ id })`
  - 성공 → refetch + active 채널이면 clear + close
- [ ] 테스트 `__tests__/*`:
  - 각 모달 submit → IPC payload 정확
  - 중복 이름 에러 메시지 표면
  - 시스템 채널에서 rename/delete 버튼 비활성
  - keyboard: ESC 닫힘, Enter 제출
- [ ] 커밋: `feat(rolestra): Channel CRUD modals — create/rename/delete (R5-Task10)`

**AC**:
- 3 모달 기본 동작 + 에러 표면
- 시스템 채널 rename/delete 차단
- Radix Dialog accessibility role=dialog / aria-labelledby

**Testing**: Vitest + `user-event` + `findByRole`.

---

### Task 11 — 시스템 채널 자동 생성 wire-up + DM 시작 UX

**목표**: 프로젝트 생성 시 `ChannelService.createSystemChannels`가 자동 호출되도록 `ProjectService`를 수정(R2에서 Service만 만들고 wire-up 안됨). DM 시작 버튼은 멤버 프로필에서(R8 PersonaBuilder 전체 UX는 R8, R5 MVP는 최소 버튼만).

- [ ] `src/main/projects/project-service.ts`:
  - `create()` / `linkExternal()` / `importFolder()` 3 경로 전부에서 프로젝트 row insert 성공 직후 `this.channelService.createSystemChannels(project.id)` 호출
  - **동일 트랜잭션 여부**: better-sqlite3 `transaction()`이 이미 project + project_members를 묶고 있다면 그 안으로 포함. 서비스 레벨 transaction 결합 불가능하면 2-step commit + rollback 보상(project row 이미 commit → error 시 delete) — **2026-04-21 결정**: 동일 트랜잭션 선호, 불가 시 즉시 후행 호출 + 에러 시 project row 삭제로 보상.
  - Constructor에 `channelService: ChannelService` 추가 (DI 주입)
  - 기존 `ProjectService` 생성 테스트 수정 — mock `channelService` 주입
- [ ] `src/main/ipc/handlers/project-handler.ts` / `arena-root-handler.ts` (필요 시): DI 배선 보강
- [ ] `src/main/__tests__/r2-integration-smoke.test.ts` 조정: 기존에 외부에서 `createSystemChannels` 호출하던 부분 제거(이제 자동 생성됨). 단언 변경: create 직후 `listByProject(project.id)`가 3개 system channel을 반환해야 함.
- [ ] `src/renderer/features/members/StartDmButton.tsx` (신규 최소 파일, 또는 Dashboard PeopleWidget에 추가):
  - 프로필 카드 "연락해보기" 버튼 — 클릭 시 `channel:create({ kind: 'dm', memberProviderIds: [providerId] })` → 성공 시 DM 채널로 active 전환 + messenger view로 이동 + close
  - 이미 DM 존재 시(`DuplicateDmError`) → 기존 DM으로 이동
- [ ] 테스트:
  - ProjectService.create → 3 system channel 자동 생성 단언
  - linkExternal → 동일
  - importFolder → 동일
  - DM 버튼: 신규 DM 생성 경로 + 기존 DM 이동 경로
- [ ] 커밋: `feat(rolestra): auto-provision system channels + DM start UX (R5-Task11)`

**AC**:
- 3 프로젝트 생성 경로 모두에서 `system_general`/`system_approval`/`system_minutes` 3 row 자동 생성
- 실패 시 보상(rollback 또는 delete)으로 orphan row 없음
- DM 버튼: 신규/기존 2 경로 동작
- 통합 smoke test green

**Testing**: Vitest (project-service 테스트 확장 + 신규 DM 컴포넌트 테스트).

---

### Task 12 — i18n populate (`messenger.*`) + parser keepRemoved 확장

**목표**: R5에서 추가된 모든 `t()` 키를 ko.json + en.json에 채운다. 테마별 다른 문구(prep §8 결정 #2 per Task 0)는 별도 키로. parser `keepRemoved` regex 확장으로 dynamic 키 보호.

- [ ] R4에서 설정한 `i18next-parser.config.js` `keepRemoved` 패턴 검토 후 `messenger.*` 추가 패턴:
  - `^messenger:channelRail\.sectionTitle\.(warm|tactical|retro)(\..+)?$`
  - `^messenger:message\.role(\..+)?$`
  - `^messenger:systemMessage(\..+)?$`
  - `^messenger:banner(\..+)?$`
  - `^messenger:approval(\..+)?$`
  - `^messenger:composer(\..+)?$`
  - `^messenger:ssmBox(\..+)?$`
  - `^messenger:emptyState(\..+)?$`
  - `^messenger:channelHeader(\..+)?$`
  - (필요 시 추가)
- [ ] `npm run i18n:extract` → ko.json / en.json에 placeholder populate
- [ ] `src/renderer/i18n/locales/ko.json` + `en.json` 수동 번역 (ko 기본 문구 + en 영문)
- [ ] `npm run i18n:check` idempotent clean 확인
- [ ] 커밋: `feat(rolestra): i18n populate — messenger.* + parser keepRemoved (R5-Task12)`

**AC**:
- 모든 R5 `t()` 호출이 ko/en에 대응 키 존재
- `npm run i18n:check` exit 0
- keepRemoved regex로 3-way 분기 dynamic 키 보호

**Testing**: `i18n:check` script run.

---

### Task 13 — Playwright Electron E2E "채널 생성 → 메시지 전송 → 렌더"

**목표**: R4 외부 프로젝트 플로우 E2E에 이어, 메신저 기본 시나리오 1건 추가. WSL 런타임 제약은 동일(R4 Task 12 DONE_WITH_CONCERNS와 같은 원리) — 로컬 부팅 실패는 non-blocking, Windows/native 또는 R10 CI matrix에서 실제 런.

- [ ] `e2e/messenger-flow.spec.ts`:
  1. 앱 부팅 → ArenaRoot 초기화 → 프로젝트 생성(신규 kind) → messenger view 이동
  2. 시스템 채널 3개 + 사용자 채널 0개 확인
  3. `+ 새 채널` 클릭 → 이름 "기획" 입력 → 생성
  4. "기획" 채널로 자동 전환 확인
  5. Composer에 "안녕하세요" 입력 → Enter
  6. 메시지가 Thread에 렌더됨 확인 (author=user, content match)
  7. ChannelRow에서 채널 클릭 전환 동작 확인
- [ ] `e2e/fixtures/` 재활용 (R4 external-sample 참고, 본 시나리오는 신규 프로젝트라 external fixture 불필요)
- [ ] `e2e/playwright.config.ts`: 기존 config에 새 spec 추가
- [ ] 로컬 WSL pass 불가 시 DONE_WITH_CONCERNS — done-checklist에 "Windows/native 수동 런 대기" 표기
- [ ] 커밋: `test(rolestra): Playwright Electron E2E — channel create + message send (R5-Task13)`

**AC**:
- spec 파일 + config 업데이트 + fixture 준비
- 로컬 pass 또는 DONE_WITH_CONCERNS(WSL 제약) 명시
- typecheck 통과

**Testing**: Playwright Electron mode.

---

### Task 14 — Done-checklist + spec §10 R5 체크박스 ✓ + tasks.json completed

**목표**: R5 종료 closeout.

- [ ] `docs/checklists/r5-done-checklist.md` 작성(R4 템플릿 복제):
  - 14 태스크별 커밋 해시 + 산출물 링크 + "pass / DONE_WITH_CONCERNS / pending" 표기
  - 테스트 요약: pre/post vitest green + R4 대비 신규 테스트 수
  - 잔여 항목(시각 sign-off 스크린샷 / Playwright 실제 런)
- [ ] spec §10 R5 체크리스트 항목 전부 `- [x]`로 갱신 + 산출물 링크 실제 경로로 대체
- [ ] `docs/plans/2026-04-21-rolestra-phase-r5.md.tasks.json` 모든 태스크 `completed: true`
- [ ] 최종 `typecheck:web` / `lint` / `test` / `i18n:check` / `theme:check` / `build` 전부 exit 0 재확인
- [ ] 커밋: `docs(rolestra): R5 done-checklist + spec §10 체크박스 + tasks.json completed (R5-Task14)`

**AC**:
- done-checklist 작성 + 모든 산출물 링크 실제 파일
- spec §10 R5 `- [x]` 전부 체크
- tasks.json 14/14 completed
- 최종 6 green script 전부 exit 0

**Testing**: 스크립트 실행 확인.

---

## Decision Log

| 결정 ID | 내용 | 확정 시점 | 영향 |
|---|---|---|---|
| D1 | 실시간 메시지 스트림은 R6 | Task 0 (2026-04-21) | R5는 refetch-on-send 폴링. `MessageService.emit`는 Task 11 integration test에서만 검증. |
| D2 | 시스템 채널 자동 생성 오너십 = `ProjectService` | Task 0 (2026-04-21) | ChannelService.createSystemChannels는 ProjectService 안에서만 호출. IPC 레벨에서 직접 호출 금지. |
| D3 | MeetingBanner retro는 별도 JSX | prep §2.2 | retro switch branch 전체 다른 DOM. 테스트에서 `[LIVE]` 리터럴 존재 단언. |
| D4 | 섹션 타이틀 i18n = **3개 별도 키** (warm/tactical/retro) | Task 0 (2026-04-21, §8 #2) | warm/tactical 값은 한국어 "채널"로 동일 시작(tactical 영어 "CHANNELS"/"MEETING ACTIVE" 등 모두 한국어화), retro만 "$ 채널" 같은 **한국어 터미널 스타일**. 나중에 사용자 검토 후 영어 복귀 판단(D8 후보). 키 3-way 구조 유지 이유: 나중에 영어 복귀 or tactical 차별화 시 값만 수정, 키 구조 변경 없음. |
| D5 | Composer radius = **`panelRadius` 재활용** (신규 토큰 없음, override 없음) | Task 0 (2026-04-21, §8 #1) | warm=12 / tactical=0 / retro=0. warm composer가 시안 10px보다 2px 더 둥글지만 옆의 Card·Panel과 곡률 통일. 사용자 premise("warm은 대체로 둥근 박스, 그 값 재활용") 반영. |
| D6 | 채널 members IPC = 기존 API만 사용 | Task 0 (2026-04-21) | 기존 `channel:list`/`channel:add-members`/`channel:remove-members` 조합만 사용. `channel:list-members` 신규 채널 추가하지 않음. `useChannelMembers`는 `useMembers()` + 프로젝트/채널 membership filter로 대체. |
| D7 | 시안 미선언 prop(`theme.sidebarBg` 등) 금지 | Task 0 (2026-04-21, §8 #4) | 2026-04-19 alignment-checklist §1 준수. 공식 `theme-tokens.jsx` 토큰만 사용. |
| D8 | (후보) retro 영어 복귀 결정 | R5 Task 13 시각 sign-off 후 | 사용자가 실제 6 테마 스크린샷 확인 후 "retro는 영어가 낫다" 판단 시, D4 값만 교체(키 구조 보존). |

---

## Scope 경계 (R5에서 하지 않는 것, R6+ 이연)

- AI 발화 렌더링(SSM 턴 → 메시지) — R6
- 실시간 메시지 스트림 구독(stream-bridge IPC wiring) — R6
- Meeting 진행/합의/결과 포스팅 — R6 (R5는 start/abort 만)
- Approval 버튼 클릭 → 실제 승인/거절 → AI 재시도 — R7
- Member 프로필 편집(role/personality/expertise/avatar 편집 UX) — R8
- 출근 상태 머신 + 프로필 카드 "연락해보기" 확장 — R8
- autonomyMode auto_toggle/queue — R9
- FTS5 검색 UI — R10
- DM 기능 완성(readReceipt/typing/etc) — R10
- 메시지 에러 retry UX / 낙관적 업데이트 / Error Boundary — R10
- Playwright CI integration + OS matrix — R10
- E2E 시각 sign-off 스크린샷 — R11 before release

---

## Success Criteria (R5 종료 시)

1. **기능**: 앱 기동 → 프로젝트 생성 → 시스템 채널 3개 자동 생성 + 사용자 채널 추가 + 메시지 전송·표시 + 회의 시작 배너 노출 — 6 테마 전부.
2. **테마 차별화**: ChannelRail / MeetingBanner / Message / SystemMessage / ApprovalBlock / Composer / MemberRow 모두 `data-theme-variant={themeKey}` 부여 + 테스트에서 3-way DOM diff 단언.
3. **테스트**: R4 대비 신규 테스트 +200 green 이상 예상 (훅 5 + 컴포넌트 14 + 모달 4 + integration 몇 건). Pre-existing fail 64 유지(증감 0).
4. **i18n**: `messenger.*` + `messenger.channelRail.sectionTitle.{warm,tactical,retro}` 전부 ko/en populate, check idempotent clean.
5. **빌드**: typecheck:web / lint / i18n:check / theme:check / build / vitest 모두 exit 0.
6. **DB 무결성**: 프로젝트 생성 → system channel 3 row 자동 생성, 실패 시 orphan project row 없음(rollback 또는 보상 delete).
7. **문서**: spec §10 R5 체크박스 전부 ✓, done-checklist 작성, tasks.json 14/14 completed.
8. **브랜치**: `rolestra-phase-r5` main ff-merge 가능 상태(R4 패턴과 동일, 사용자 결정 후 실행).
