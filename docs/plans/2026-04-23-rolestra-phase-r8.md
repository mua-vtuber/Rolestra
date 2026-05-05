# Rolestra Phase R8 — 멤버 프로필 + 출근 상태 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** R7 까지 승인 시스템이 회의·CLI·모드 변경의 의사결정 게이트로 자리 잡은 상태 위에, **AI 직원의 인격과 출근 상태**를 사용자가 실제로 만지고 운영할 수 있는 UX 레이어를 올린다. R8 종료 시 앱에서 (a) 메시지 버블 또는 우측 MemberPanel / 대시보드 PeopleWidget 의 아바타를 누르면 `MemberProfilePopover` 가 떠서 직원의 이름·역할·전문분야·출근 상태를 한 화면에서 확인하고, (b) 거기서 "편집" 을 누르면 `MemberProfileEditModal` 이 열려 `role`/`personality`/`expertise`/`avatar`(default 8종 또는 custom 업로드) 4 필드를 수정 후 `member:update-profile` IPC 로 즉시 반영, (c) "외근" 토글이 `member:set-status('offline-manual')` 을 호출해 다음 회의 턴부터 그 직원이 자동 skip 되며 사용자 노출 라벨은 "외근 (자리 비움)" 으로 표시, (d) 토글을 다시 누르거나 "연락해보기" 버튼을 누르면 `member:reconnect` IPC 로 warmup 재실행 + 결과를 popover 인디케이터에 즉시 반영, (e) 앱 부팅 시 모든 provider 에 대해 `MemberWarmupService` 가 `Promise.allSettled` 로 5초 timeout warmup 을 병렬 실행해 4-state 출근 상태(`online`/`connecting`/`offline-connection`/`offline-manual`)가 사용자가 첫 화면을 보는 순간부터 정확하게 표시되고, (f) `MeetingTurnExecutor` 는 턴마다 발화자가 `online` 인지 `MemberProfileService.getWorkStatus` 로 게이팅 — `offline-manual`/`offline-connection`/`connecting` 이면 그 턴만 skip + `meeting:turn-skipped` 이벤트로 상황을 시스템 메시지로 시각화, (g) `MeetingTurnExecutor` 의 system prompt 합성 경로가 v2 `engine/persona-builder` 의 `provider.persona` 자유텍스트 의존을 떼고 v3 `MemberProfileService.buildPersona(providerId)` (Identity 섹션: `Name`/`Role`/`Personality`/`Expertise` + Legacy Persona 호환 블록) + permission rules append shim 으로 갈아끼워져 다음 턴부터 새 페르소나가 즉시 적용, (h) 사용자가 업로드한 custom 아바타는 `<ArenaRoot>/avatars/<providerId>.<ext>` 로 복사 저장되어 DB 엔 상대 경로만 (image binary blob 금지), (i) Production `main/index.ts` 가 `MemberProfileService` 를 boot 하고 `setMemberProfileServiceAccessor` 를 호출 — R2~R7 까지 테스트에서만 wire 되어 있던 6개 `member:*` IPC 가 비로소 production 에서 동작.

**Overview (자연어, 비코더용):**

- R2 시점에 데이터 모델(`member_profiles` 테이블 + `MemberProfileService` + `MemberProfileRepository`), R3 시점에 `ProfileAvatar` shell 컴포넌트, R5 시점에 `MemberRow`/`MemberPanel`/`PeopleWidget` 의 정적 표시, R7 시점에 6개 `member:*` IPC 채널과 핸들러까지 — **창고는 다 지어놨지만 진열대와 점원이 비어 있다**. R8 이 그 창고를 손님이 만질 수 있는 매장으로 바꾼다.
- 가장 큰 부채는 **Production wiring 0**. `setMemberProfileServiceAccessor` 가 `src/main/ipc/__tests__/handlers-v3.test.ts` 에서만 호출되고 production `main/index.ts` 에서는 한 번도 호출되지 않아, 현재 renderer 가 `member:list` 를 호출하면 `'member handler: service not initialized'` 가 뜬다. R8 Task 8 이 이 끊어진 회로를 잇는다 — `MemberProfileRepository` 를 DB 핸들에서 만들고, `ProviderRegistry` 를 `MemberProviderLookup` 어댑터로 감싸 `MemberProfileService` 를 인스턴스화하고, accessor 를 등록하고, 앱 부팅 직후 모든 provider 에 대해 warmup 을 병렬 실행한다.
- 두 번째 부채는 **PersonaBuilder 의 v2/v3 분기**. `src/main/members/persona-builder.ts` 는 v3 구조화 페르소나(Name/Role/Personality/Expertise)를 만들지만, 정작 회의 턴이 도는 `src/main/meetings/engine/meeting-turn-executor.ts:189` 는 v2 `src/main/engine/persona-builder.ts` 의 `buildEffectivePersona(provider, {...})` — 즉 `provider.persona` 자유텍스트 — 를 그대로 호출한다. R8 Task 10 이 이 호출을 `memberProfileService.buildPersona(providerId)` (v3 구조화 + Legacy Persona 블록으로 호환) + permission rules append shim 으로 교체한다. 결과적으로 사용자가 편집한 role/personality/expertise 가 **다음 턴부터 즉시** AI 의 system prompt 에 반영된다 (spec §7.1 "편집은 즉시 반영"). v2 `engine/persona-builder.ts` 는 R6 deprecation 마킹은 되어 있지만 호출자가 사라지므로 R11 legacy 일괄 삭제 때 v2 engine 5파일과 함께 제거된다.
- 세 번째 축은 **편집 UX 의 2 단계 패턴**. 메시지 버블 또는 사이드바 아바타 클릭은 가벼운 1차 확인이므로 `MemberProfilePopover` (Radix Popover, 작은 카드) 로 띄우고, 편집은 명시적 의도(편집 버튼 클릭)에서만 `MemberProfileEditModal` (Radix Dialog, 풀스크린) 을 연다. 이렇게 분리하지 않으면 (i) 빠른 확인이 매번 모달 풀스크린이 되어 무겁고, (ii) 편집 의도 없는 클릭이 우발적 수정으로 이어진다. spec §7.1 의 "프로필 팝업 → 편집 버튼 → 프로필 모달" 흐름을 충실히 따른다.
- 네 번째 축은 **8 default + custom 아바타**. R3 시점에 `src/main/members/default-avatars.ts` 가 8종 (color hex + emoji) 을 `as const` 로 선언해 두었지만, 실제 렌더는 어디서도 emoji/color 를 쓰지 않고 `ProfileAvatar` 가 initials 만 표시하고 있다. R8 Task 2 가 (i) `Avatar` (또는 `MemberAvatar`) 컴포넌트를 새로 만들거나 기존 `ProfileAvatar` 를 확장해 `avatarKind='default'` 일 때 `DEFAULT_AVATARS` 의 color+emoji 를 렌더하고 `avatarKind='custom'` 일 때는 `<ArenaRoot>/avatars/<providerId>.<ext>` 의 file:// URL 또는 IPC 로 fetch 한 base64 를 렌더한다. Custom 업로드는 Task 5 가 Main 단에서 `member:upload-avatar` IPC 로 받아 `ArenaRootService.getAvatarsDir()` 아래로 복사 + DB 엔 상대 경로 (`avatars/<providerId>.<ext>`) 저장. base64 직접 저장은 금지(spec §7.1: DB 는 상대 경로).
- 다섯 번째 축은 **출근 상태의 1급 시각화**. R5 시점에 `MemberRow` 가 4-state 도트(green/yellow/gray) 만 표시하지만, 사용자가 **상태를 바꿀 수단** 과 **상태 의미 라벨** 이 없다. R8 Task 6 의 Popover 가 4 액션 버튼을 두는데 — "편집" / "외근 토글(↔ 출근)" / "연락해보기" / "DM 시작" — 그 중 외근 토글은 `member:set-status('offline-manual'|'online')` IPC 를 호출하고, "연락해보기" 는 `member:reconnect` 를 호출해 popover 안의 status indicator 를 connecting → online/offline-connection 으로 갱신한다. 사용자 노출 라벨은 spec §7.2 의 4 라벨("출근"/"재연결 중"/"점검 필요"/"외근") 를 i18n 키 (`member.status.online` 등) 로 통일.
- 여섯 번째 축은 **턴매니저의 online-only 게이트**. spec §7.2 마지막 줄: "턴매니저는 `online` 상태 멤버만 선발. 다른 상태는 스킵". 현재 `MeetingTurnExecutor` 는 work-status 를 전혀 보지 않고 무조건 모든 participant 를 발화자로 돌린다. R8 Task 9 가 `MeetingTurnExecutor.executeTurn` 시작점에서 `memberProfileService.getWorkStatus(participantId)` 를 호출 — `online` 이 아니면 (`offline-manual`/`offline-connection`/`connecting`) 그 턴만 skip + 이벤트 `meeting:turn-skipped` 발사 + system message append ("⚠ {name} 가 외근 중이라 이 턴을 건너뜁니다"). 모든 participant 가 offline 이면 회의는 진행 불가하므로 1 cycle 동안 skip 만 누적되다가 SSM 의 기존 timeout 흐름이 abort 처리. 새 SSM 상태는 R8 에서 도입하지 않는다(D4) — autonomy 와 함께 R10 에서 재검토.
- 일곱 번째 축은 **앱 부팅 warmup 의 UI 블락 금지**. spec §7.2: "앱 시작 시 모든 provider 에 대해 warmup 병렬 실행". 만약 이걸 직렬로 하거나 await 로 부팅 블락하면 첫 화면이 5~30초 동안 안 뜬다. R8 Task 8 의 `MemberWarmupService.warmAll(providerIds)` 는 `Promise.allSettled` 로 모든 warmup 을 시작만 하고 `await` 하지 않는다 — 부팅은 즉시 진행되고, warmup 결과가 떨어질 때마다 `MemberProfileService` 의 runtime status map 이 갱신되며 각 status indicator 가 자연스럽게 connecting → online/offline-connection 으로 transition 한다. 이는 R7 의 stream-bridge 패턴(이벤트 기반 자연 transition) 과 일관.
- 여덟 번째 축은 **i18n 의 1차 시민화**. R5/R6/R7 까지 `messenger.*` / `meeting.*` / `approval.*` 네임스페이스가 채워졌지만 `member.*` / `profile.*` 는 거의 비어 있다. R8 Task 11 이 `member.status.*` (4 라벨) / `profile.editor.{title,fields,save,cancel,delete}` / `profile.popover.{actions.*,fields.*}` / `member.avatarPicker.{title,default,custom,upload,remove}` / `member.warmup.{starting,success,failure}` 등을 ko/en 양쪽에 populate. main-process 알림 라벨은 R7 D 흐름과 동일하게 R10 renderer migration 시 deferred(`notification.warmupFailed.*` 등).
- 아홉 번째 축은 **Playwright 시나리오** spec §11 "멤버 수동 퇴근 → 턴 스킵 → 출근 복귀". R8 Task 12 의 `e2e/member-profile-flow.spec.ts` 가 (i) 메시지 버블 아바타 클릭 → popover open, (ii) 편집 모달 열고 role/personality 수정 후 저장 → DB 반영 검증, (iii) 외근 토글 → status='offline-manual' DB 반영 + 다음 회의 턴이 skip 되는 것을 mock CLI 와 함께 검증, (iv) "연락해보기" 클릭 → status='online' 복귀. WSL 런타임 제약 시 R4~R7 와 동일한 DONE_WITH_CONCERNS 정책.
- **SSM 은 건드리지 않는다**. `session-state-machine.ts` 의 12 상태 / 가드 / 이벤트는 R8 범위 밖. 턴 skip 은 SSM 외부 (`MeetingTurnExecutor`) 에서 게이팅으로 처리.
- **Approval 은 건드리지 않는다**. `mode_transition` / `consensus_decision` / `cli_permission` 은 R7 에서 닫혔다. R8 의 외근 토글 / 프로필 편집은 사용자 본인 의사 표시이므로 approval 게이트가 없다.
- **데이터 모델은 컬럼 추가 없음**. `member_profiles` 테이블의 7 컬럼(`provider_id`/`role`/`personality`/`expertise`/`avatar_kind`/`avatar_data`/`status_override`/`updated_at`) 그대로. 신규 마이그레이션 0건. 신규 인덱스 0건.
- **보안 invariant (spec §7.6.1)**: custom avatar 업로드는 path-guard 가 ArenaRoot 밖 접근을 차단하는 일반 규칙의 자연스러운 적용 — `member:upload-avatar` 가 받은 source 경로는 사용자 본인이 선택한 외부 파일이므로 path-guard 면제(읽기), 저장 경로(`<ArenaRoot>/avatars/`)는 내부이므로 문제 없음. EXIF 등 메타데이터는 읽지 않는다(D7).
- **`spec §10 R8 체크박스` 확장과 Decision Log 는 Task 0 에서 먼저 한다**. 구현 중 모호함은 **반드시 spec 을 먼저 갱신** 한 뒤 코드를 고친다(R2~R7 규약).

**Architecture:**

- Layering: `renderer → shared → preload(contextBridge) → main`. R3~R7 구조 그대로.
- Main 재사용 (R2~R7 land 완료):
  - `src/main/members/member-profile-service.ts` — `getProfile`/`getView`/`updateProfile`/`setStatus`/`reconnect`/`forget`/`buildPersona` (구현 완.  R8 변경 0)
  - `src/main/members/member-profile-repository.ts` — `member_profiles` CRUD (R8 변경 0)
  - `src/main/members/persona-builder.ts` — v3 `buildEffectivePersona` (R8 변경 0, 단 호출자가 Task 10 에서 추가됨)
  - `src/main/members/default-avatars.ts` — 8종 catalogue (R8 변경 0)
  - `src/main/ipc/handlers/member-handler.ts` — 6 IPC 핸들러 (R8 변경: `member:upload-avatar` 추가)
  - `src/main/arena/arena-root-service.ts` — ArenaRoot 경로 (R8 추가: `getAvatarsDir()` 메서드)
  - `src/main/providers/registry.ts` — provider 목록 (R8 변경 0)
- Main 신규 파일:
  - `src/main/members/member-warmup-service.ts` — 부팅 시 모든 provider warmup `Promise.allSettled` + per-provider 5초 timeout (Task 8)
  - `src/main/members/avatar-store.ts` — custom avatar 파일 복사 + 경로 검증 + ext 화이트리스트 (Task 5)
- Main 수정:
  - `src/main/index.ts` — `MemberProfileRepository` + `MemberProfileService` boot, `setMemberProfileServiceAccessor`, `MemberWarmupService.warmAll`, `MemberProviderLookup` 어댑터 (Task 8)
  - `src/main/meetings/engine/meeting-turn-executor.ts` — `buildEffectivePersona(provider, opts)` 호출을 `memberProfileService.buildPersona(participantId)` + permission rules append shim 으로 교체 (Task 10), `executeTurn` 시작점에 work-status 게이팅 (Task 9)
  - `src/main/ipc/handlers/member-handler.ts` — `handleMemberUploadAvatar` 추가 (Task 5)
  - `src/main/ipc/router.ts` — `member:upload-avatar` 등록 (Task 5)
- Shared:
  - `src/shared/member-profile-types.ts` — `AvatarUploadRequest` / `AvatarUploadResponse` 타입 추가 (Task 1)
  - `src/shared/ipc-types.ts` — `member:upload-avatar` 채널 + zod (Task 1)
  - `src/shared/ipc-schemas.ts` — zod (Task 1)
  - `src/shared/meeting-stream-types.ts` — `meeting:turn-skipped` 이벤트 타입 추가 (Task 9)
- Preload:
  - `src/preload/index.ts` — `member:upload-avatar` 화이트리스트 + `meeting:turn-skipped` 구독 화이트리스트 추가
- Renderer 신규:
  - `src/renderer/components/members/Avatar.tsx` — DEFAULT_AVATARS 8종 emoji+color 렌더 + custom 분기 (Task 2)
  - `src/renderer/components/members/WorkStatusDot.tsx` — 4-state 도트 + i18n 라벨 + tooltip (Task 2)
  - `src/renderer/components/members/AvatarPicker.tsx` — 8 default + custom upload (Task 3)
  - `src/renderer/features/members/MemberProfileEditModal.tsx` — 4 필드 편집 모달 (Task 4)
  - `src/renderer/features/members/MemberProfilePopover.tsx` — 프로필 카드 + 4 액션 버튼 (Task 6)
  - `src/renderer/hooks/use-member-profile.ts` — 단건 fetch + update wrapper (Task 4)
  - `src/renderer/hooks/use-avatar-picker.ts` — DEFAULT_AVATARS 캐시 + custom upload mutation (Task 3)
- Renderer 수정:
  - `src/renderer/components/shell/ProfileAvatar.tsx` — `MemberView` props 받아 `Avatar` 컴포넌트 위임 (Task 2)
  - `src/renderer/features/messenger/MemberRow.tsx` — `onClick` → Popover trigger (Task 7)
  - `src/renderer/features/dashboard/widgets/PeopleWidget.tsx` — 동일 (Task 7)
  - `src/renderer/features/messenger/Message.tsx` — 메시지 버블 아바타 `onClick` → Popover trigger (Task 7)
  - `src/renderer/features/messenger/Thread.tsx` — `meeting:turn-skipped` 시스템 메시지 분기 추가 (Task 9)
  - `src/renderer/i18n/locales/{ko,en}.json` — `member.*` / `profile.*` populate (Task 11)
- State flow:
  - **Profile edit:**
    1. 사용자가 메시지 버블 / MemberRow / PeopleWidget 의 아바타 클릭 → `MemberProfilePopover` open (anchor = 클릭한 아바타).
    2. Popover 의 "편집" 버튼 클릭 → `MemberProfileEditModal` open (Radix Dialog).
    3. 사용자가 role/personality/expertise 수정 + AvatarPicker 에서 8 default 중 1 선택 또는 custom 업로드.
    4. 저장 클릭 → `invoke('member:update-profile', { providerId, patch })` → `MemberProfileService.updateProfile` 가 `member_profiles` row UPSERT + `updatedAt` bump.
    5. (custom 업로드 분기) 저장 직전 `invoke('member:upload-avatar', { providerId, sourcePath, ext })` → `AvatarStore.copy` 가 `<ArenaRoot>/avatars/<providerId>.<ext>` 로 복사 → 응답 `{ relativePath: 'avatars/<providerId>.<ext>' }` → `member:update-profile` patch 에 `avatarKind='custom', avatarData=relativePath`.
    6. Renderer hook 이 react query / SWR-style invalidation 으로 갱신 (또는 단순 setState — R8 은 SWR 미도입 정책).
  - **Work status toggle:**
    1. Popover 의 "외근" 또는 "출근" 토글 클릭 → `invoke('member:set-status', { providerId, status: 'offline-manual'|'online' })`.
    2. `MemberProfileService.setStatus` 가 `member_profiles.status_override` UPDATE.
    3. `member:list` 또는 `member:get-profile` 재 fetch — R8 은 stream 없이 단순 invalidation (R10 에서 stream:member-status-changed 도입 가능).
  - **Reconnect:**
    1. Popover "연락해보기" 클릭 → `invoke('member:reconnect', { providerId })`.
    2. `MemberProfileService.reconnect` 가 runtime status `connecting` 으로 set + `provider.warmup()` 호출 + 결과로 `online` 또는 `offline-connection` set.
    3. 응답 `{ status: WorkStatus }` → popover 가 즉시 갱신.
    4. R8 은 다른 surface (MemberRow 등) 의 갱신은 다음 `member:list` invalidation 에 위임 — 실시간 stream 은 R10.
  - **App-start warmup:**
    1. `main/index.ts` 가 DB/Provider/Service boot 직후 `memberWarmupService.warmAll(providerIds)` 를 fire-and-forget.
    2. 각 provider 별 `Promise.race([provider.warmup(), timeout(5000)])` 를 `Promise.allSettled` 로 병렬 실행.
    3. Resolve → `runtime status='online'`, Reject (timeout 포함) → `'offline-connection'`.
    4. 부팅 자체는 await 하지 않으므로 첫 화면 즉시 렌더 (모든 멤버는 처음에 `connecting` 으로 보였다가 결과에 따라 transition).
  - **Turn skip:**
    1. `MeetingTurnExecutor.executeTurn(participantId)` 시작점에서 `memberProfileService.getWorkStatus(participantId)` 호출.
    2. `'online'` 이 아니면 (a) `meeting:turn-skipped` 이벤트 emit (`{ meetingId, participantId, participantName, reason: WorkStatus }`), (b) `messageService.append({channelId, kind:'system', content: t('meeting.turnSkipped', {name, reason})})`, (c) `executeTurn` 즉시 return — 다음 발화자로 turn rotate.
    3. SSM 의 `TURN_DONE` / `TURN_FAIL` 이벤트는 발사하지 않음 — skip 은 turn 실패가 아니라 "이 턴 비어 있음".
  - **Persona refresh:**
    1. R8 Task 10 이후 `MeetingTurnExecutor.composeSystemPrompt(participantId)` 가 `memberProfileService.buildPersona(participantId)` 호출.
    2. `MemberProfileService.buildPersona` 는 매번 `repo.get(providerId)` 로 최신 `member_profiles` row 를 읽으므로 캐시 없음 → 사용자가 편집한 직후 다음 턴에서 자동 반영.
    3. Permission rules (cwd / permission-mode) 는 v2 `engine/persona-builder` 의 `buildPermissionRules` shim 을 별도 함수로 분리해 v3 persona 뒤에 append. v2 builder 자체는 호출자 0 → R11 legacy cleanup.
- Testing: Vitest (avatar-store / member-warmup-service / member-handler upload / meeting-turn-executor work-status gate / persona shim swap), jsdom (Avatar / WorkStatusDot / AvatarPicker / MemberProfileEditModal / MemberProfilePopover / MemberRow click → popover open / Message click → popover open / PeopleWidget click → popover open / Thread meeting:turn-skipped 분기), Playwright `_electron` E2E 1 시나리오 (프로필 편집 → 외근 → 출근 → 턴 skip 검증).

**Tech Stack (R8 추가):**

- 기존 (R7 까지): TypeScript strict / React 19 / Electron 40 / Vite / Vitest (jsdom) / i18next / zod / zustand / Tailwind / Radix (Dialog/Popover/Tooltip) / framer-motion / cva / clsx / @playwright/test / better-sqlite3
- 신규: **없음**. Radix Popover 는 R3 primitive 5종에 포함되어 있고 Dialog 는 R5/R7 에서 사용. 파일 업로드는 Electron 의 `dialog.showOpenDialog` 재사용 (R4 ProjectCreateModal 의 `project:pick-folder` 패턴).

**참조:**

- Spec:
  - `docs/specs/2026-04-18-rolestra-design.md`
    - §3 용어집: 출근 상태 (Work Status)
    - §5.2 migration 001_core: `member_profiles` 컬럼 정의
    - §6 IPC: `member:list`/`get-profile`/`update-profile`/`set-status`/`reconnect`/`list-avatars` (+ R8 신규 `upload-avatar`)
    - §7.1 멤버 프로필 시스템 (구조화 4 필드 + PersonaBuilder + 8 default avatar + custom 업로드 경로)
    - §7.2 출근 상태 시스템 (4 상태 + 라벨 + 토글 UX + 턴매니저 online-only 게이팅)
    - §7.5 PeopleWidget (👥 직원 위젯 — 프로필 팝업 진입점)
    - §10 Phase R8 (Task 0 에서 R3~R7 템플릿으로 확장)
    - §11 E2E "멤버 수동 퇴근 → 턴 스킵 → 출근 복귀"
    - §부록 A v2→v3 델타 (멤버 프로필 / 출근 상태 행)
  - `docs/checklists/r7-done-checklist.md` (R8 인수인계 7건 — R8 직접 영향 0, 단 D2 24h timer rehydrate 는 R9 와 함께)
- R7 plan/done-checklist: `docs/plans/2026-04-22-rolestra-phase-r7.md`, `docs/checklists/r7-done-checklist.md`
- Main 재사용 모듈:
  - `src/main/members/{member-profile-service,member-profile-repository,persona-builder,default-avatars}.ts`
  - `src/main/ipc/handlers/member-handler.ts`
  - `src/main/arena/arena-root-service.ts`
  - `src/main/providers/registry.ts`
  - `src/main/streams/stream-bridge.ts`
  - `src/main/meetings/engine/meeting-turn-executor.ts`
  - `src/main/engine/persona-builder.ts` (R8 Task 10 이후 호출자 0 — R11 삭제)
- Renderer 재사용:
  - `src/renderer/components/shell/ProfileAvatar.tsx` (Task 2 에서 위임 layer)
  - `src/renderer/features/messenger/{MemberRow,MemberPanel,Message,Thread}.tsx`
  - `src/renderer/features/dashboard/widgets/PeopleWidget.tsx`
  - `src/renderer/components/primitives/{Button,Card,Tooltip,Separator,Badge}.tsx`
  - Radix Dialog (R5/R7 패턴) + Radix Popover (R3 primitive)
- R8 신규 디렉토리:
  - `src/renderer/components/members/` (Avatar / WorkStatusDot / AvatarPicker)
  - `src/renderer/features/members/` (MemberProfileEditModal / MemberProfilePopover) — 기존 `StartDmButton.tsx` 와 같은 디렉토리

---

## Prereqs

- [x] R7 전체 완료 (14/14) + main ff-merge (2026-04-23) — 114576d tip
- [x] R7 done-checklist 작성 및 Known Concerns 7건 문서화
- [x] `MemberProfileService` + `MemberProfileRepository` + `member_profiles` migration 001 + 6 IPC 핸들러 + `DEFAULT_AVATARS` 8종 catalogue (R2)
- [x] `ProfileAvatar` shell 컴포넌트 + `MemberRow`/`MemberPanel` 정적 표시 (R3/R5)
- [x] `PeopleWidget` 대시보드 위젯 (R4)
- [x] Radix Dialog 패턴 (R5 ChannelCreateModal / R7 RejectDialog) + Radix Popover primitive (R3)
- [x] `ArenaRootService` 부팅 + 디렉토리 보장 (R2)
- [ ] `rolestra-phase-r8` 브랜치 `main`(`114576d`)에서 생성 (Task 0 첫 step)
- [ ] spec §10 R8 블록 R3~R7 템플릿으로 확장 (Task 0)

---

## File Structure (R8 종료 시)

```
src/
├── main/
│   ├── members/
│   │   ├── member-profile-service.ts       # (변경 없음) R2
│   │   ├── member-profile-repository.ts    # (변경 없음) R2
│   │   ├── persona-builder.ts              # (변경 없음) R2 — Task 10 에서 호출자가 추가됨
│   │   ├── default-avatars.ts              # (변경 없음) R2
│   │   ├── member-warmup-service.ts        # NEW (Task 8) Promise.allSettled boot warmup
│   │   ├── avatar-store.ts                 # NEW (Task 5) custom avatar 파일 복사
│   │   └── __tests__/*.test.ts
│   ├── ipc/
│   │   ├── handlers/
│   │   │   └── member-handler.ts           # + handleMemberUploadAvatar (Task 5)
│   │   └── router.ts                       # + member:upload-avatar 등록 (Task 5)
│   ├── arena/
│   │   └── arena-root-service.ts           # + getAvatarsDir() (Task 5)
│   ├── meetings/engine/
│   │   └── meeting-turn-executor.ts        # work-status 게이트 (Task 9) + v3 persona swap (Task 10)
│   └── index.ts                            # MemberProfileService boot + warmAll fire-and-forget (Task 8)
├── renderer/
│   ├── components/
│   │   ├── members/                        # NEW 디렉토리 (Task 2/3)
│   │   │   ├── Avatar.tsx                  # NEW 8 default emoji+color + custom 분기
│   │   │   ├── WorkStatusDot.tsx           # NEW 4-state 도트 + i18n 라벨
│   │   │   ├── AvatarPicker.tsx            # NEW 8 default + custom upload
│   │   │   └── __tests__/*.test.tsx
│   │   └── shell/
│   │       └── ProfileAvatar.tsx           # MemberView 받아 Avatar 위임 (Task 2)
│   ├── features/
│   │   ├── members/
│   │   │   ├── StartDmButton.tsx           # (변경 없음) R5
│   │   │   ├── MemberProfileEditModal.tsx  # NEW (Task 4)
│   │   │   ├── MemberProfilePopover.tsx    # NEW (Task 6)
│   │   │   └── __tests__/*.test.tsx
│   │   ├── messenger/
│   │   │   ├── Message.tsx                 # 아바타 클릭 → Popover (Task 7)
│   │   │   ├── MemberRow.tsx               # 행 클릭 → Popover (Task 7)
│   │   │   └── Thread.tsx                  # meeting:turn-skipped 시스템 메시지 분기 (Task 9)
│   │   └── dashboard/widgets/
│   │       └── PeopleWidget.tsx            # 행 클릭 → Popover (Task 7)
│   ├── hooks/
│   │   ├── use-member-profile.ts           # NEW (Task 4)
│   │   ├── use-avatar-picker.ts            # NEW (Task 3)
│   │   └── use-meeting-stream.ts           # + meeting:turn-skipped reducer (Task 9)
│   ├── ipc/invoke.ts                       # + member:upload-avatar 래퍼 (Task 1)
│   └── i18n/locales/{ko,en}.json           # + member.* / profile.* populate (Task 11)
├── shared/
│   ├── member-profile-types.ts             # + AvatarUploadRequest/Response (Task 1)
│   ├── ipc-types.ts                        # + member:upload-avatar 채널 (Task 1)
│   ├── ipc-schemas.ts                      # + zod (Task 1)
│   └── meeting-stream-types.ts             # + meeting:turn-skipped 이벤트 (Task 9)
├── preload/
│   └── index.ts                            # + member:upload-avatar / meeting:turn-skipped 화이트리스트
├── docs/superpowers/
│   ├── plans/
│   │   ├── 2026-04-23-rolestra-phase-r8.md       # (this file)
│   │   └── 2026-04-23-rolestra-phase-r8.md.tasks.json
│   └── specs/
│       ├── 2026-04-18-rolestra-design.md         # §10 R8 체크박스 확장 (Task 0)
│       └── r8-done-checklist.md                  # NEW (Task 13)
├── e2e/
│   └── member-profile-flow.spec.ts               # NEW (Task 12)
└── i18next-parser.config.js                      # + member.* / profile.* dynamic 키 keepRemoved
```

**파일 요약:**
- 신규 main: 2 (member-warmup-service, avatar-store) + 각 테스트
- 신규 renderer: 5 (Avatar, WorkStatusDot, AvatarPicker, MemberProfileEditModal, MemberProfilePopover) + 2 hooks + 테스트
- 수정 main: meeting-turn-executor, member-handler, router, arena-root-service, index.ts
- 수정 renderer: ProfileAvatar, Message, MemberRow, Thread, PeopleWidget, use-meeting-stream, invoke, i18n ko/en
- 수정 shared: member-profile-types, ipc-types, ipc-schemas, meeting-stream-types
- 수정 preload: + 2 화이트리스트
- 신규 spec/plan: r8-done-checklist + this plan + tasks.json

---

## Tasks

### Task 0 — Branch + spec §10 R8 확장 + plan + tasks.json + Decision Log

**목표**: R8 브랜치를 main tip(`114576d`)에서 파고, spec §10 R8 블록을 R3/R4/R5/R6/R7 템플릿(체크박스 + 산출물 링크)으로 확장, Decision Log 8건 기록.

- [x] `git checkout -b rolestra-phase-r8` from main tip (`114576d`)
- [ ] spec §10 R8 블록 확장:
  - `- [ ]` 항목 13~14개 (Task 1~13 산출물과 1:1)
  - **scope 경계** 하단 블록: R9 (autonomy + warmup auto-retry policy + stream:member-status-changed), R10 (DM read-receipt / typing indicator / settings UI 멤버 관리 풀버전 / Playwright CI matrix), R11 (legacy v2 engine 5파일 + v2 `engine/persona-builder.ts` 일괄 삭제 + retro 영어 복귀 D8)
  - plan/done-checklist 링크 placeholder
- [ ] `docs/plans/2026-04-23-rolestra-phase-r8.md.tasks.json` 생성 (14 task slot)
- [ ] Decision Log (본 plan 끝에 Decision Log 섹션 추가):
  - **D1 v3 PersonaBuilder swap 범위**: R8 은 `meeting-turn-executor` 만 v3 로 swap. v2 `engine/turn-executor.ts` 와 `engine/persona-builder.ts` 는 R6 deprecation 마킹 그대로 유지하다 R11 legacy 일괄 삭제. 이유: v2 engine 5파일 (orchestrator/turn-executor/conversation/execution-coordinator/memory-coordinator) 은 R6 시점 호출자 0 + tsconfig exclude 처리됨. R8 에서 따로 삭제할 가치 0
  - **D2 Custom avatar 저장 위치**: `<ArenaRoot>/avatars/<providerId>.<ext>` (spec §7.1 그대로). DB 컬럼 `avatar_data` 에는 ArenaRoot 상대 경로 (`avatars/<providerId>.<ext>`) 만 저장. 절대 경로 / base64 / file:// URL 저장 금지
  - **D3 부팅 warmup 전략**: `Promise.allSettled` 병렬 + per-provider 5초 timeout (`Promise.race([warmup, timeout])`). 부팅은 await 하지 않고 fire-and-forget. 이유: (i) 직렬은 첫 화면 30초 블락, (ii) await 는 빠른 provider 가 느린 provider 에 묶임, (iii) 5초 timeout 은 spec §7.2 의 connecting 라벨 의미와 자연스럽게 일치
  - **D4 TurnManager skip 정책**: `online` 이 아닌 멤버는 그 턴만 skip + `meeting:turn-skipped` 이벤트 + 시스템 메시지. 회의 자체는 진행. 모든 participant 가 offline 인 edge case 는 SSM 의 기존 timeout 흐름이 abort 처리. 새 SSM 상태 (`WAITING_PARTICIPANTS` 등) 는 R8 에서 도입하지 않음 — autonomy 와 함께 R10 에서 재검토
  - **D5 클릭 트리거 통일**: 메시지 버블 / MemberRow / PeopleWidget 의 아바타 클릭은 모두 동일한 `MemberProfilePopover` 를 연다. anchor 만 클릭한 element. 이유: (i) UX 일관성, (ii) 컴포넌트 재사용
  - **D6 Popover vs Modal 2단계**: 프로필 보기 = Popover (Radix Popover, 가벼움), "편집" 클릭 = Modal (Radix Dialog, 풀스크린). 이유: spec §7.1 명시. 매번 모달은 무겁고 우발적 수정 위험
  - **D7 Custom avatar 업로드 검증**: ext 화이트리스트 (`png` / `jpg` / `jpeg` / `webp` / `gif`), 파일 크기 5MB 제한, EXIF 안 읽음, base64 변환 안 함. ArenaRoot path-guard 적용 (저장 경로). 이유: 이미지 처리 라이브러리 의존성 0 + 보안 invariant 유지
  - **D8 Stream vs Invalidation**: R8 은 `member:set-status` / `member:reconnect` / `member:update-profile` 결과를 단순 IPC 응답으로 받고 호출 측에서 mount-fetch 다시. `stream:member-status-changed` 등 실시간 이벤트는 R10. 이유: (i) Popover 자체에서만 사용하는 mutation 이라 실시간 broadcast 가 과대, (ii) R7 stream 패턴은 ApprovalService 의 다중 surface broadcast 가 필요해서 도입한 것
- [ ] 커밋: `docs(rolestra): R8 plan + tasks.json + spec §10 R8 체크리스트 확장 (R8-Task0)`

**AC**:
- `rolestra-phase-r8` 브랜치 존재
- spec §10 R8 블록 체크박스 + scope 경계 + 링크 placeholder
- tasks.json 14-slot skeleton
- Decision Log 8건 기록

**Testing**: N/A (docs-only commit)

---

### Task 1 — Shared `AvatarUploadRequest`/`Response` + `member:upload-avatar` IPC 채널 + zod

**목표**: custom avatar 업로드용 IPC 채널과 타입을 추가. 기존 6 채널은 그대로.

- [ ] `src/shared/member-profile-types.ts` 확장:
  - `interface AvatarUploadRequest { providerId: string; sourcePath: string; }`
  - `interface AvatarUploadResponse { relativePath: string; absolutePath: string; }` (renderer 미리보기용으로 absolutePath 함께 반환)
- [ ] `src/shared/ipc-types.ts`:
  - `'member:upload-avatar': { request: AvatarUploadRequest; response: AvatarUploadResponse; }` 추가
- [ ] `src/shared/ipc-schemas.ts`:
  - `memberUploadAvatarRequestSchema` (zod) — providerId 비어있지 않음, sourcePath 절대 경로
  - `memberUploadAvatarResponseSchema`
- [ ] `src/preload/index.ts`: `member:upload-avatar` 화이트리스트 (`invoke` 가능 채널)
- [ ] `src/renderer/ipc/invoke.ts`: 별도 래퍼 함수 불필요 — 일반 `invoke` 가 처리. 단 typed wrapper 가 있다면 추가
- [ ] `__tests__/member-profile-types.test.ts` 또는 ipc-schemas 테스트에 round-trip 케이스 4건 추가
- [ ] 커밋: `feat(rolestra): member:upload-avatar IPC channel + zod (R8-Task1)`

**AC**:
- `member:upload-avatar` 채널이 ipc-types / ipc-schemas / preload 3 곳에 일관되게 선언
- typecheck exit 0
- zod round-trip 4 케이스 green
- 기존 6 채널 회귀 0

**Testing**: Vitest schema round-trip.

---

### Task 2 — `Avatar` + `WorkStatusDot` 컴포넌트 (DEFAULT_AVATARS 8종 렌더 + 4-state 도트)

**목표**: `DEFAULT_AVATARS` 의 color+emoji 를 실제로 렌더하는 Avatar 컴포넌트. 4-state work-status 를 시각화하는 WorkStatusDot. 기존 `ProfileAvatar` 는 Avatar 위임.

- [ ] `src/renderer/components/members/Avatar.tsx` 신규:
  - props: `{ providerId: string; avatarKind: 'default'|'custom'; avatarData: string|null; size?: number; shape?: 'circle'|'diamond'; className?: string }`
  - `avatarKind='default'` → `DEFAULT_AVATARS.find(a => a.key === avatarData)` → color+emoji 렌더 (배경색 + 가운데 emoji)
  - `avatarKind='default'` + `avatarData` 가 없거나 unknown key → fallback: providerId 첫 글자 initials + brand color
  - `avatarKind='custom'` → `<img src={resolveAvatarPath(avatarData)} alt="">` (resolveAvatarPath 는 `<ArenaRoot>/avatars/<providerId>.<ext>` 의 file:// URL 또는 별도 IPC fetch — Task 5 확정)
  - DEFAULT_AVATARS 카탈로그는 renderer 에서도 import (shared 가 아니므로 `src/renderer/components/members/default-avatars-catalogue.ts` 로 mirror 또는 main 에서 IPC 로 한 번만 fetch — Task 3 와 함께 결정)
- [ ] `src/renderer/components/members/WorkStatusDot.tsx` 신규:
  - props: `{ status: WorkStatus; size?: number; showLabel?: boolean; className?: string }`
  - 4 상태 → tailwind class (`bg-success` / `bg-warning` / `bg-fg-muted` / `bg-fg-muted`) + i18n 라벨 (`member.status.online` / `connecting` / `offlineConnection` / `offlineManual`)
  - `connecting` 은 pulse 애니메이션 (Tailwind `animate-pulse`)
  - `aria-label` 에 라벨 텍스트 부여 (스크린리더)
- [ ] `src/renderer/components/shell/ProfileAvatar.tsx` 수정:
  - 기존 `MemberLike` interface 유지하되, 신규 prop `member?: MemberView` 추가 (선택적)
  - `member` 가 주어지면 `<Avatar providerId={member.providerId} avatarKind={member.avatarKind} ...>` 위임
  - 그 외 (R5 호출자 호환) 는 기존 initials 경로 유지
- [ ] `__tests__/Avatar.test.tsx`: 8 default 각각 렌더 + custom 렌더 + fallback 경로 + size/shape props
- [ ] `__tests__/WorkStatusDot.test.tsx`: 4 상태 × class/label 매트릭스 + aria-label
- [ ] `__tests__/ProfileAvatar.test.tsx`: 기존 initials 경로 회귀 + member prop 받았을 때 Avatar 위임
- [ ] 커밋: `feat(rolestra): Avatar component + WorkStatusDot + ProfileAvatar delegation (R8-Task2)`

**AC**:
- DEFAULT_AVATARS 8 key 모두 렌더 케이스 green
- 4 work-status 도트 + i18n 라벨 정확
- ProfileAvatar 회귀 0 (R5 MemberRow 가 정상 렌더)
- a11y aria-label 부여

**Testing**: React Testing Library + jsdom.

---

### Task 3 — `AvatarPicker` 컴포넌트 (8 default 갤러리 + custom upload 트리거)

**목표**: 편집 모달에서 사용할 아바타 선택 UI. 8 default 그리드 + "사진 업로드" 버튼.

- [ ] `src/renderer/hooks/use-avatar-picker.ts` 신규:
  - `useAvatarPicker()` → `{ avatars, isLoading, error, uploadCustom(providerId, sourcePath), removeCustom() }`
  - `avatars` 는 `member:list-avatars` 결과 캐시 (R2 IPC 재사용 — `{ key, label }[]`)
  - `uploadCustom` 은 (i) Electron `dialog.showOpenDialog` 로 파일 선택 (Main 측 별도 IPC 또는 기존 `project:pick-folder` 패턴 재사용 → R8 신규 IPC `member:pick-avatar-file` 도입 권장 — 단 spec 변경 최소화 위해 Task 5 가 sourcePath 를 받도록 설계), (ii) 선택된 경로를 `member:upload-avatar` invoke
- [ ] `src/renderer/components/members/AvatarPicker.tsx` 신규:
  - props: `{ providerId: string; currentKind: AvatarKind; currentData: string|null; onChange(patch: { avatarKind: AvatarKind; avatarData: string|null }): void; }`
  - 8 default 그리드 (4 × 2 또는 8 × 1) — 각 셀은 `<Avatar avatarKind='default' avatarData={key}>` + 클릭 시 `onChange({avatarKind:'default', avatarData:key})`
  - "사진 업로드" 버튼 — 클릭 시 `useAvatarPicker.uploadCustom(providerId, ...)` → 응답 상대 경로로 `onChange({avatarKind:'custom', avatarData:relativePath})`
  - 선택된 항목은 `data-selected="true"` + 시각 강조 (border-brand)
  - "기본으로 되돌리기" 버튼 (custom → default 첫 항목으로 되돌림)
- [ ] `__tests__/AvatarPicker.test.tsx`: 8 default 클릭 → onChange / 업로드 mock → onChange / 되돌리기
- [ ] 커밋: `feat(rolestra): AvatarPicker (8 default + custom upload) (R8-Task3)`

**AC**:
- 8 default 모두 클릭 가능 + onChange 정확
- 업로드 mock → custom kind 로 onChange
- "되돌리기" → default 첫 항목
- avatars fetch 실패 시 fallback (default 8종은 mirror 또는 mount-skip)

**Testing**: React Testing Library + mock invoke.

---

### Task 4 — `MemberProfileEditModal` (Radix Dialog: 4 필드 + AvatarPicker)

**목표**: 메시지 버블 / MemberRow / PeopleWidget 의 "편집" 진입점에서 열리는 풀모달. 4 필드 편집 + 즉시 저장.

- [ ] `src/renderer/hooks/use-member-profile.ts` 신규:
  - `useMemberProfile(providerId)` → `{ profile, view, isLoading, error, refetch }` (mount-fetch + invalidation)
  - `useUpdateMemberProfile()` → `{ mutate(providerId, patch), isPending, error }` — 단순 useState 기반
- [ ] `src/renderer/features/members/MemberProfileEditModal.tsx` 신규:
  - props: `{ open: boolean; providerId: string; onClose(): void; }`
  - Radix Dialog content:
    - Header: `t('profile.editor.title', { name })`
    - Body: 4 필드 (role / personality / expertise — text input/textarea, avatar — AvatarPicker)
    - Footer: 저장 / 취소 버튼
  - 저장 클릭 → `updateMemberProfile.mutate(providerId, patch)` → 성공 시 `onClose()`
  - 변경된 필드만 patch 에 포함
  - i18n: `profile.editor.{title,fields.role,fields.personality,fields.expertise,fields.avatar,save,cancel,saveError}`
- [ ] `__tests__/MemberProfileEditModal.test.tsx`: 4 필드 입력 → patch 인자 / 취소 → invoke 0 / 저장 후 close / 에러 표시
- [ ] 커밋: `feat(rolestra): MemberProfileEditModal + use-member-profile hooks (R8-Task4)`

**AC**:
- 4 필드 입력 → save 시 invoke('member:update-profile', {providerId, patch}) 정확
- AvatarPicker onChange → patch.avatarKind/avatarData 반영
- 취소 시 patch 미반영 + onClose
- 저장 실패 시 에러 메시지 + 모달 유지

**Testing**: React Testing Library + mock hooks.

---

### Task 5 — Custom avatar upload Main + `AvatarStore` + `member:upload-avatar` handler

**목표**: 사용자가 선택한 외부 이미지 파일을 ArenaRoot 안으로 복사하고 상대 경로를 반환.

- [ ] `src/main/arena/arena-root-service.ts` 확장:
  - `getAvatarsDir(): string` — `path.join(arenaRoot, 'avatars')`. 부재 시 `mkdirSync({recursive:true})` 보장
- [ ] `src/main/members/avatar-store.ts` 신규:
  - `class AvatarStore { constructor(private arenaRoot: ArenaRootService); copy(providerId: string, sourcePath: string): { relativePath: string; absolutePath: string; }; remove(providerId: string): void; }`
  - `copy` 동작:
    1. ext 추출 + 화이트리스트 (`png`/`jpg`/`jpeg`/`webp`/`gif`) 검증 — 위반 시 throw `AvatarValidationError`
    2. 파일 크기 5MB 제한 검증 — 위반 시 throw
    3. `<arenaRoot>/avatars/<providerId>.<ext>` 로 `fs.copyFileSync` (덮어쓰기 OK — 같은 providerId 의 이전 avatar 교체)
    4. 같은 providerId 의 다른 ext 파일이 있으면 정리 (예: png → jpg 로 바꿀 때 png 삭제)
    5. return `{ relativePath: path.posix.join('avatars', '<providerId>.<ext>'), absolutePath }`
  - `AvatarValidationError extends Error` 클래스
- [ ] `src/main/ipc/handlers/member-handler.ts`:
  - `handleMemberUploadAvatar(data: IpcRequest<'member:upload-avatar'>): IpcResponse<'member:upload-avatar'>`
  - `getAvatarStore()` accessor 추가 + `setAvatarStoreAccessor(fn)` (Task 8 에서 wire)
  - 검증 실패 시 typed error 반환
- [ ] `src/main/ipc/router.ts`: `member:upload-avatar` 등록
- [ ] `__tests__/avatar-store.test.ts`: 5~7 케이스 (happy ext / 잘못된 ext 거절 / 5MB 초과 거절 / 같은 providerId 덮어쓰기 / 다른 ext 정리 / 파일 부재)
- [ ] `__tests__/member-handler.test.ts` 또는 `handlers-v3.test.ts` 확장: upload-avatar 케이스 추가
- [ ] 커밋: `feat(rolestra): AvatarStore + member:upload-avatar handler (R8-Task5)`

**AC**:
- 화이트리스트 ext 만 허용
- 5MB 초과 거절
- 덮어쓰기 + ext 변경 시 이전 파일 정리
- 응답에 상대 경로 + 절대 경로 모두 포함

**Testing**: Vitest + 임시 디렉토리 (`os.tmpdir()`).

---

### Task 6 — `MemberProfilePopover` (프로필 카드 + 4 액션 버튼)

**목표**: 메시지 버블 / MemberRow / PeopleWidget 의 아바타 클릭에서 열리는 가벼운 카드. 보기 + 4 액션 (편집 / 외근↔출근 토글 / 연락해보기 / DM 시작).

- [ ] `src/renderer/features/members/MemberProfilePopover.tsx` 신규:
  - props: `{ open: boolean; anchorRef: React.RefObject<HTMLElement>; providerId: string; onClose(): void; onEdit(): void; }`
  - Radix Popover content:
    - Header: `<Avatar size=48>` + 이름 + role (1줄)
    - Body: personality + expertise (있는 것만 표시) + WorkStatusDot + 라벨
    - Footer: 4 버튼
      - "편집" → `onEdit()` (parent 가 EditModal 열기)
      - 외근↔출근 토글 → `member:set-status` invoke (현재 status 에 따라 target 결정: online → offline-manual, 아니면 online)
      - "연락해보기" → `member:reconnect` invoke + status indicator 갱신
      - "DM 시작" → `StartDmButton` 로직 위임 (R5 컴포넌트 재사용 또는 그 안의 IPC 호출 직접 수행)
    - 외근 토글은 `aria-pressed` 로 상태 표시
  - 액션 진행 중 disabled state (스피너)
  - 액션 후 popover 안의 status 즉시 반영 (다른 surface 는 D8 — invalidation 패턴)
- [ ] `__tests__/MemberProfilePopover.test.tsx`: 4 액션 각각 invoke 정확 + 외근↔출근 토글 분기 + reconnect 후 indicator 갱신 + DM 시작 라우팅
- [ ] 커밋: `feat(rolestra): MemberProfilePopover with 4 actions (R8-Task6)`

**AC**:
- 편집 → onEdit() 호출
- 외근 토글 → invoke('member:set-status', target 정확)
- 연락해보기 → invoke('member:reconnect') + indicator 즉시 갱신
- DM 시작 → 적절한 IPC 또는 store 호출
- a11y: 4 버튼 aria-label / aria-pressed

**Testing**: React Testing Library + mock invoke.

---

### Task 7 — 아바타 클릭 wire (Message / MemberRow / PeopleWidget) + Edit 진입

**목표**: 3개 surface 의 아바타에 onClick 추가 → Popover open → Popover 의 "편집" → EditModal open.

- [ ] `src/renderer/features/messenger/MemberRow.tsx`:
  - `<li>` 또는 `<Avatar>` 에 `onClick` 추가 → 부모로 hoist 또는 내부 state (`useState<{open: boolean; anchor: HTMLElement|null}>`)
  - Popover 와 EditModal 을 같은 컴포넌트 안에서 관리 (open=true 시 popover, popover 내 edit 클릭 시 modal)
- [ ] `src/renderer/features/messenger/Message.tsx`:
  - 메시지 버블의 ProfileAvatar 에 onClick → 동일 패턴
- [ ] `src/renderer/features/dashboard/widgets/PeopleWidget.tsx`:
  - 직원 행 클릭 → 동일 패턴 (대시보드 컨텍스트에서도 popover open)
- [ ] 공통 컨테이너 `MemberProfileTrigger.tsx` (선택 — R8 에서는 inline) — 3 surface 의 중복을 줄이기 위해 작은 wrapper 컴포넌트 도입 가능
- [ ] `__tests__` — 3 surface 각각 클릭 → popover open
- [ ] 커밋: `feat(rolestra): wire avatar click → popover/edit on Message/MemberRow/PeopleWidget (R8-Task7)`

**AC**:
- 3 surface 모두 클릭 → Popover open
- Popover "편집" → EditModal open
- ESC / 외부 클릭 → 모두 close

**Testing**: React Testing Library + jsdom.

---

### Task 8 — Production main/index.ts MemberProfileService boot + `MemberWarmupService.warmAll`

**목표**: 현재 production 에서 wire 0 인 MemberProfileService 를 부팅. 부팅 직후 모든 provider warmup 병렬 실행.

- [ ] `src/main/members/member-warmup-service.ts` 신규:
  - `class MemberWarmupService { constructor(private svc: MemberProfileService); warmAll(providerIds: string[], opts?: { timeoutMs?: number }): Promise<void>; }`
  - `warmAll`:
    1. 각 providerId 에 대해 `Promise.race([svc.reconnect(providerId), timeout(opts?.timeoutMs ?? 5000)])` 를 만듦
    2. `Promise.allSettled` 로 모두 await — settled 순간 자연스럽게 runtime status 가 갱신됨
    3. timeout 시 svc.reconnect 는 background 에서 계속 진행 (cancellation 안 함 — D3)
- [ ] `src/main/index.ts`:
  - DB 부팅 직후:
    ```ts
    const memberProfileRepo = new MemberProfileRepository(db);
    const memberProfileService = new MemberProfileService(memberProfileRepo, {
      get: (id) => providerRegistry.get(id),         // adapter
      warmup: (id) => providerRegistry.warmup(id),   // adapter
    });
    setMemberProfileServiceAccessor(() => memberProfileService);

    const avatarStore = new AvatarStore(arenaRootService);
    setAvatarStoreAccessor(() => avatarStore);

    const warmup = new MemberWarmupService(memberProfileService);
    void warmup.warmAll(providerRegistry.listAll().map(p => p.id)); // fire-and-forget
    ```
  - app shutdown 시 cleanup (필요 시)
- [ ] `src/main/providers/registry.ts` 검토: `warmup(id)` / `get(id)` 가 `MemberProviderLookup` 시그니처와 호환되는지 확인. 다르면 어댑터 inline 으로 작성
- [ ] `__tests__/member-warmup-service.test.ts`: 5 케이스 (모두 성공 / 모두 timeout / 일부 성공 일부 timeout / 빈 리스트 / 부팅 await 없이 즉시 return)
- [ ] `__tests__/r2-integration-smoke.test.ts` 확장 또는 신규 `member-boot.test.ts`: production wire 후 `member:list` IPC 가 정상 응답하는지
- [ ] 커밋: `feat(rolestra): production boot MemberProfileService + warmAll fire-and-forget (R8-Task8)`

**AC**:
- `member:list` 가 production 에서 throw 안 함
- `member:list-avatars` 가 8 default 반환
- `MemberWarmupService.warmAll` 호출 후 부팅 await 없음 (테스트 timing 검증)
- 5초 timeout 동작

**Testing**: Vitest + mock provider registry.

---

### Task 9 — `MeetingTurnExecutor` work-status 게이트 + `meeting:turn-skipped` 이벤트

**목표**: 회의 턴마다 발화자가 `online` 인지 확인. 아니면 skip + 이벤트 + 시스템 메시지.

- [ ] `src/shared/meeting-stream-types.ts`: `meeting:turn-skipped` 이벤트 타입 추가
  - `{ type: 'meeting:turn-skipped', meetingId: string, channelId: string, participantId: string, participantName: string, reason: WorkStatus }`
  - zod schema
- [ ] `src/main/streams/stream-bridge.ts`: `emitMeetingTurnSkipped(payload)` 메서드 추가
- [ ] `src/main/meetings/engine/meeting-turn-executor.ts`:
  - 생성자 DI 에 `memberProfileService: MemberProfileService` 추가
  - `executeTurn(participantId)` 시작점에 work-status 게이트:
    ```ts
    const status = this.memberProfileService.getWorkStatus(participantId);
    if (status !== 'online') {
      this.streamBridge.emitMeetingTurnSkipped({...});
      this.messageService.append({channelId, kind:'system', content: t('meeting.turnSkipped', {name, reason: status})});
      return; // SSM TURN_DONE/TURN_FAIL 발사 X — turn 자체가 비어 있음
    }
    ```
  - SSM 의 정상 turn 흐름은 그 외 경로에서만 실행
- [ ] `src/main/index.ts`: MeetingTurnExecutor 팩토리에 memberProfileService 주입
- [ ] `src/preload/index.ts`: `meeting:turn-skipped` 구독 화이트리스트
- [ ] `src/renderer/hooks/use-meeting-stream.ts`: `meeting:turn-skipped` 리듀서 — Thread 가 시스템 메시지로 자연 표시
- [ ] `src/renderer/features/messenger/Thread.tsx`: 시스템 메시지 분기에 turn-skipped 의 i18n 키 적용 (별도 컴포넌트 분리 X — 일반 system message 와 동일 렌더 + content 만 다름)
- [ ] `__tests__/meeting-turn-executor.work-status-gate.test.ts`: 4 케이스 (online → 정상 / offline-manual → skip + 이벤트 + 시스템 메시지 / connecting → skip / offline-connection → skip)
- [ ] 커밋: `feat(rolestra): MeetingTurnExecutor online-only gate + meeting:turn-skipped event (R8-Task9)`

**AC**:
- online 멤버 → 정상 turn 진행 (회귀 0)
- 비-online 멤버 → skip + 이벤트 + 시스템 메시지 정확
- SSM TURN_DONE/FAIL 발사 0 (skip 은 turn 실패 아님)

**Testing**: Vitest mock MemberProfileService + StreamBridge + MessageService.

---

### Task 10 — `MeetingTurnExecutor` v2 → v3 PersonaBuilder swap

**목표**: 회의 턴의 system prompt 합성 경로를 v3 `MemberProfileService.buildPersona` 로 교체. 사용자 편집 즉시 반영.

- [ ] `src/main/meetings/engine/meeting-turn-executor.ts`:
  - 기존 line 189 부근 `buildEffectivePersona(provider, { permission, projectFolder, arenaFolder })` 호출을:
    ```ts
    const v3Persona = this.memberProfileService.buildPersona(participantId);
    const permissionRules = buildPermissionRules({ permission, projectFolder, arenaFolder }); // v2 helper 분리
    const systemPrompt = `${v3Persona}\n\n${permissionRules}`;
    ```
  - import 정리: `buildEffectivePersona` from v2 제거, v2 `buildPermissionRules` 만 별도 export 받아 사용
- [ ] `src/main/engine/persona-builder.ts`:
  - `buildPermissionRules` 함수가 이미 module-private 이면 named export 로 승격 (R11 삭제 전까지 호환)
- [ ] `src/main/meetings/engine/__tests__/meeting-turn-executor.test.ts`:
  - 기존 v2 persona mock 케이스를 v3 persona mock 으로 교체
  - 사용자 편집 → 다음 턴에서 새 persona 가 system prompt 에 포함되는 시나리오 추가
- [ ] `src/main/__tests__/r2-integration-smoke.test.ts` 또는 별도: persona 교체 후 v2 `buildEffectivePersona` 호출자 0 grep 검증
- [ ] 커밋: `feat(rolestra): MeetingTurnExecutor v3 persona swap (R8-Task10)`

**AC**:
- meeting-turn-executor.ts 의 v2 `buildEffectivePersona` import 0
- v3 `buildPersona` 호출 시 system prompt 에 Identity 섹션 포함
- 사용자 편집 → 다음 턴에서 즉시 반영 (캐시 0 검증)
- v2 `engine/persona-builder` 는 호출자 0 (R11 삭제 후보 등록)

**Testing**: Vitest mock MemberProfileService.buildPersona.

---

### Task 11 — i18n populate `member.*` / `profile.*` / `meeting.turnSkipped`

**목표**: R8 신규 문자열 i18n 완비.

- [ ] `src/renderer/i18n/locales/{ko,en}.json`:
  - `member.status.online` / `connecting` / `offlineConnection` / `offlineManual` (4 라벨)
  - `member.avatarPicker.{title,defaultGroup,custom,upload,remove,uploadError,sizeLimit,extReject}`
  - `member.warmup.{starting,success,failure}` (UI 표시용 — main-process 알림 라벨은 R10)
  - `profile.editor.{title,fields.role,fields.personality,fields.expertise,fields.avatar,save,cancel,saveError,saving}`
  - `profile.popover.{actions.edit,actions.toggleOffline,actions.toggleOnline,actions.reconnect,actions.startDm,reconnecting}`
  - `meeting.turnSkipped` (시스템 메시지 본문 — `{name}` `{reason}` interpolation)
- [ ] `i18next-parser.config.js`: `member.status.*` / `profile.editor.fields.*` / `profile.popover.actions.*` / `member.avatarPicker.*` 등 dynamic 키 keepRemoved regex 확장
- [ ] `npm run i18n:check` idempotent clean
- [ ] 커밋: `feat(rolestra): i18n populate member.* / profile.* / meeting.turnSkipped (R8-Task11)`

**AC**:
- ko/en 신규 키 전체 populate (parser 런 idempotent)
- `npm run i18n:check` exit 0
- typecheck:web exit 0

**Testing**: i18n:check.

---

### Task 12 — Playwright E2E `member-profile-flow.spec.ts`

**목표**: spec §11 "멤버 수동 퇴근 → 턴 스킵 → 출근 복귀" Playwright 시나리오 1종.

- [ ] `e2e/member-profile-flow.spec.ts` 신규 (Playwright `_electron`):
  - 시나리오:
    1. 앱 부팅 → 대시보드 PeopleWidget 의 멤버 행 보임 + status='online' (mock provider warmup 성공)
    2. 메신저 진입 → 채널 메시지 버블 아바타 클릭 → Popover open
    3. Popover "편집" → Modal open → role 변경 → 저장 → DB 반영 검증
    4. Popover "외근" 토글 → status='offline-manual' DB 반영
    5. 채널에서 회의 시작 → mock CLI turn → 외근 멤버는 skip 시스템 메시지 등장
    6. Popover 다시 열기 → "출근" 토글 또는 "연락해보기" → status='online' 복귀
    7. 다음 턴 정상 진행
  - WSL 런타임 제약 시 R4~R7 와 동일 DONE_WITH_CONCERNS 정책
- [ ] mock provider 는 R6 `e2e/helpers/mock-provider.ts` 재사용
- [ ] 커밋: `feat(rolestra): E2E member-profile-flow.spec.ts (R8-Task12)`

**AC**:
- e2e/member-profile-flow.spec.ts 존재 + 로컬 실행 또는 DONE_WITH_CONCERNS
- 시나리오 7 step 명시
- typecheck/lint exit 0

**Testing**: Playwright Electron 1 시나리오.

---

### Task 13 — R8 Closeout — typecheck/lint/test/i18n:check/theme:check/build + done-checklist

**목표**: R8 전체 합격선 확인 + `docs/checklists/r8-done-checklist.md` 작성 + tasks.json 14/14 처리.

- [ ] `npm run typecheck` 전체 exit 0 (R7 baseline 유지 — legacy 회귀 0)
- [ ] `npm run typecheck:web` exit 0
- [ ] `npm run lint` 0 errors (R7 pre-existing warnings 수준 유지)
- [ ] `npm run test -- members renderer/features/members renderer/components/members meetings` R8 신규 테스트 green
- [ ] `npm run i18n:check` idempotent clean
- [ ] `npm run theme:check` exit 0
- [ ] `npm run build` exit 0
- [ ] `docs/checklists/r8-done-checklist.md` 작성:
  - 14 Task 산출물 링크
  - Known Concerns (R9 인수인계) — `stream:member-status-changed` 도입, autonomy warmup 자동 재시도 정책, 외근 timeout (자동 출근 복귀) 정책
  - spec §10 R8 블록 모든 `- [ ]` → `- [x]` 전환
- [ ] `tasks.json` 14/14 completed
- [ ] 커밋: `chore(rolestra): R8 closeout — done-checklist + tasks 14/14 (R8-Task13)`

**AC**:
- 모든 정식 게이트 녹색
- done-checklist 작성 완료
- spec §10 R8 체크박스 전체 ✓
- tasks.json 14/14 completed

**Testing**: 전체 합격선 run.

---

## Decision Log (R8)

**D1 — v3 PersonaBuilder swap 범위 (meeting-turn-executor 만)**
R8 은 `src/main/meetings/engine/meeting-turn-executor.ts` 의 v2 `buildEffectivePersona(provider, opts)` 호출만 v3 `MemberProfileService.buildPersona(providerId)` + permission rules append shim 으로 교체한다. v2 `src/main/engine/turn-executor.ts` 와 `src/main/engine/persona-builder.ts` 는 R6 시점 deprecation 마킹 + tsconfig exclude 처리되어 호출자가 사실상 0 — R11 의 v2 engine 5파일 일괄 삭제 때 함께 제거. R8 에서 따로 삭제할 가치 0 (legacy cleanup 묶음의 일관성).

**D2 — Custom avatar 저장 위치**
spec §7.1 그대로 `<ArenaRoot>/avatars/<providerId>.<ext>` 로 복사. DB 컬럼 `member_profiles.avatar_data` 에는 ArenaRoot 상대 경로 (`avatars/<providerId>.<ext>`) 만 저장. 절대 경로 / base64 / file:// URL 저장은 (i) 사용자가 ArenaRoot 를 이동하면 깨지고, (ii) 이미지 binary 가 DB 를 비대화시키며, (iii) Renderer 가 file:// 직접 다루면 보안 invariant (path-guard) 와 충돌 — 모두 금지.

**D3 — 부팅 warmup 전략 (Promise.allSettled + 5초 timeout, fire-and-forget)**
부팅 시 `MemberWarmupService.warmAll(ids)` 를 await 하지 않는다. 각 provider 에 대해 `Promise.race([svc.reconnect(id), timeout(5000)])` 를 만들고 `Promise.allSettled` 로 한 번에 시작만 한다. 이유: (i) 직렬은 첫 화면을 30초+ 블락, (ii) await 는 빠른 provider 가 느린 provider 에 묶임, (iii) 5초 timeout 은 spec §7.2 의 `connecting` 라벨 의미와 자연스럽게 일치. timeout 후에도 `svc.reconnect` 는 background 에서 계속 진행 (cancellation 미구현 — Electron `provider.warmup` 자체에 abort signal 없음).

**D4 — TurnManager skip 정책 (turn 단위, 회의 진행 유지)**
`online` 이 아닌 멤버는 그 턴만 skip 하고 회의는 진행한다. 새 SSM 상태 (`WAITING_PARTICIPANTS` 등) 는 R8 에서 도입하지 않는다. 이유: (i) SSM 12 상태 + 가드는 R2 에서 land 된 안정 자산이라 추가 상태 도입은 리뷰 비용 큼, (ii) 모든 participant 가 offline 인 edge case 는 SSM 의 기존 timeout 흐름이 abort 처리 — 사용자 입장에선 회의가 그냥 종료, (iii) autonomy 와 함께 R10 에서 재검토 (자동 retry / queue 보류 등).

**D5 — 클릭 트리거 통일 (3 surface → 동일 Popover)**
메시지 버블 아바타 / MemberRow / PeopleWidget 의 아바타 클릭은 모두 같은 `MemberProfilePopover` 를 연다. anchor 만 클릭한 element. 이유: (i) UX 일관성 — 어디서 눌러도 같은 카드, (ii) 컴포넌트 재사용 — 3 surface 별 별도 카드 만들면 중복 관리 비용. surface 별 차이는 anchor 위치 뿐 (Radix Popover 가 자동 처리).

**D6 — Popover (보기) vs Modal (편집) 2단계**
프로필 보기는 Radix Popover (가벼움, hover-like), 편집은 Radix Dialog (풀스크린, 의도적 진입). 이유: spec §7.1 명시 ("프로필 팝업 → 편집 버튼 → 프로필 모달"). 매번 모달 풀스크린은 (i) 빠른 확인이 무겁고 (ii) 우발적 수정 위험. Popover 의 "편집" 버튼이 명시적 의도 표시.

**D7 — Custom avatar 업로드 검증 (ext 화이트리스트 + 5MB + EXIF 무시)**
ext 화이트리스트 (`png` / `jpg` / `jpeg` / `webp` / `gif`), 파일 크기 5MB 제한, EXIF 등 메타데이터는 읽지 않음, base64 변환 없음 (항상 파일 복사). 이유: (i) 이미지 처리 라이브러리 의존성 0 (sharp 등 도입 회피), (ii) 보안 invariant 유지 (path-guard 적용 — 저장 경로는 ArenaRoot 안), (iii) 5MB 는 일반 프로필 사진 충분, (iv) EXIF 위치 정보 등 의도치 않은 노출 차단.

**D8 — Stream vs Invalidation (R8 은 invalidation 만)**
`member:set-status` / `member:reconnect` / `member:update-profile` 결과는 단순 IPC 응답으로 받고 호출 측 (popover) 에서 mount-fetch 다시 한다. `stream:member-status-changed` 등 실시간 broadcast 이벤트는 R10 으로 이연. 이유: (i) Popover 자체에서만 사용하는 mutation 이라 다중 surface 실시간 broadcast 가 과대, (ii) R7 stream 패턴은 ApprovalService 의 다중 surface broadcast (대시보드 위젯 + Inbox + Thread) 가 필요해서 도입한 것 — 멤버 프로필은 그 정도 broadcast 수요 없음, (iii) R10 에서 autonomy / 다중 클라이언트 도입 시 자연스럽게 추가.
