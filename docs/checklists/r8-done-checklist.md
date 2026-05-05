# Rolestra Phase R8 — Done Checklist

> Closes the implementation work for **Phase R8 — 멤버 프로필 + 출근 상태**.
> Plan: `docs/plans/2026-04-23-rolestra-phase-r8.md`.
> Branch: `rolestra-phase-r8` (13 commits, ready to fast-forward into `main`).

## Task → 산출물 맵 (14/14 ✓)

| # | 산출물 (커밋) |
|---|---------------|
| 0 | docs(rolestra): R8 plan + tasks.json + spec §10 R8 체크리스트 확장 (`1b5075d`) — plan 824 lines + 14-slot tasks.json + Decision Log D1~D8 + spec §10 R8 expansion |
| 1 | feat: `member:upload-avatar` IPC channel + AvatarUploadRequest/Response + zod (`e001990`) — `src/shared/{member-profile-types,ipc-types,ipc-schemas}.ts` + 5 schema tests |
| 2 | feat: Avatar + WorkStatusDot + ProfileAvatar delegation (`d7d25a8`) — `src/renderer/components/members/{Avatar,WorkStatusDot}.tsx` + `src/shared/default-avatars.ts` move + `ProfileAvatar` MemberView delegation |
| 3 | feat: AvatarPicker + use-avatar-picker + `member:pick-avatar-file` IPC (`967f09f`) |
| 4 | feat: MemberProfileEditModal + use-member-profile hooks (`17f06b2`) |
| 5 | feat: AvatarStore + `member:upload-avatar` / `member:pick-avatar-file` handlers + ArenaRoot.avatarsPath (`87dfd66`) — 16 fs-backed tests |
| 6 | feat: MemberProfilePopover with 4 actions + Radix Popover dep (`962e207`) |
| 7 | feat: MemberProfileTrigger + 3 surface 아바타 클릭 wire (`d82506f`) — Message / MemberRow / PeopleWidget |
| 8 | feat: production MemberProfileService boot + MemberWarmupService + AvatarStore wire (`a0fba88`) — fixes "service not initialized" 부채 |
| 9 | feat: MeetingTurnExecutor work-status gate + meeting-turn-skipped event (`a7ae0c4`) — spec §7.2 turn skipping + SystemMessage i18n branch |
| 10 | feat: MeetingTurnExecutor v3 PersonaBuilder swap (`5b8ba33`) — Identity 즉시 반영 (캐시 0) |
| 11 | feat: i18n populate member.* / profile.* / meeting.turnSkipped (`7de4e10`) — ko/en + 6 keepRemoved anchors |
| 12 | feat: E2E member-profile-flow.spec.ts (`7d3c7ba`) — popover + edit + 외근/연락해보기 (WSL DONE_WITH_CONCERNS) |
| 13 | (this commit) chore: R8 closeout — done-checklist + spec §10 R8 ✓ + tasks 14/14 |

## 정식 게이트 (Task 13)

| 게이트 | 결과 | 비고 |
|--------|------|------|
| `npm run typecheck` (node + web) | exit 0 | R7 baseline 유지 — legacy 회귀 0 |
| `npm run lint` | 0 errors / 22 warnings | 22 warnings 모두 R8 무관 (theme-provider test literal strings 등 pre-existing). R8 신규 errors (3건) 모두 commit 13 에서 수정 |
| `npm run test -- members renderer/features/members renderer/components/members meetings ipc-schemas-v3` | 238/238 green | R8 신규 19 test files |
| `npm run i18n:check` | exit 0 | parser idempotent — 두 번째 실행 0 diff |
| `npm run theme:check` | exit 0 | clean |
| `npm run build` | exit 0 | main + preload + renderer (1.18 MB chunk — R7 동일 baseline) |
| Playwright `member-profile-flow.spec.ts` | DONE_WITH_CONCERNS | WSL 제약, R10 OS matrix 에서 실 런 (R4/R5/R6/R7 동일 정책) |
| 레거시 v2 도메인 13 files (database-branch / conversation / memory / recovery / remote) | 기존 failing 유지 | R8 무관, R11 legacy cleanup 예정 |

## 핵심 산출물 / 주요 변경

### 신규 main
- `src/main/members/avatar-store.ts` — custom 아바타 파일 복사 + ext 화이트리스트 + 5MB 검증 + sibling 청소
- `src/main/members/member-warmup-service.ts` — `Promise.allSettled` + 5초 timeout (D3) fire-and-forget
- `src/main/members/__tests__/{avatar-store,member-warmup-service}.test.ts`

### 신규 renderer
- `src/renderer/components/members/{Avatar,WorkStatusDot,AvatarPicker}.tsx` + `__tests__`
- `src/renderer/features/members/{MemberProfileEditModal,MemberProfilePopover,MemberProfileTrigger}.tsx` + `__tests__`
- `src/renderer/hooks/{use-avatar-picker,use-member-profile}.ts`

### 신규 shared
- `src/shared/default-avatars.ts` — main → shared 이동 (renderer 도 emoji+color 직접 렌더)
- `src/shared/member-profile-types.ts` 확장: `AvatarUploadRequest/Response` + `ALLOWED_AVATAR_EXTENSIONS` + `AVATAR_MAX_BYTES`
- `src/shared/stream-events.ts`: `StreamMeetingTurnSkippedPayload` + `stream:meeting-turn-skipped`

### 신규 IPC 채널 (2)
- `member:upload-avatar` — request `{providerId, sourcePath}` → `{relativePath, absolutePath}` (zod 등록)
- `member:pick-avatar-file` — request `undefined` → `{sourcePath: string|null}` (project:pick-folder 패턴)

### 주요 수정 파일
- `src/main/index.ts` — R8 production boot block (MemberProfileRepository + MemberProfileService + MemberProviderLookup adapter + AvatarStore + MemberWarmupService.warmAll 발사)
- `src/main/meetings/engine/meeting-turn-executor.ts` — work-status gate (Task 9) + v3 PersonaBuilder swap (Task 10)
- `src/main/engine/persona-builder.ts` — `buildPermissionRules` named export 승격 (R8 v3 path 가 reuse, v2 builder 는 R11 까지 호환 유지)
- `src/main/streams/stream-bridge.ts` — `emitMeetingTurnSkipped`
- `src/main/ipc/handlers/member-handler.ts` — 2 신규 핸들러 + `setAvatarStoreAccessor`
- `src/main/ipc/router.ts` — 2 채널 등록
- `src/main/arena/arena-root-service.ts` — `avatarsPath()` + ARENA_ROOT_SUBDIRS 에 `avatars` 추가
- `src/renderer/components/shell/ProfileAvatar.tsx` — optional `profile?: MemberView` 위임 layer
- `src/renderer/features/messenger/{MemberRow,Message}.tsx` + `src/renderer/features/dashboard/widgets/PeopleWidget.tsx` — 아바타 클릭 → MemberProfileTrigger
- `src/renderer/features/messenger/SystemMessage.tsx` — `meta.turnSkipped` → i18n key `meeting.turnSkipped` 분기
- `src/renderer/i18n/locales/{ko,en}.json` + `i18next-parser.config.js` — 6 신규 keepRemoved anchors

### 신규 의존성
- `@radix-ui/react-popover ^1.1.15` — pure JS, native binding 0, WSL rebuild 무관

### 신규 테스트 (19 파일 / 238 cases — R8 직접 + 회귀)
- shared: `ipc-schemas-v3.test.ts` 신규 5 + `member:upload-avatar` map 노출 1
- main: `avatar-store.test.ts` (16) + `member-warmup-service.test.ts` (7) + `meeting-turn-executor.test.ts` work-status gate 매트릭스 (5)
- renderer/components: `Avatar.test.tsx` (14) + `WorkStatusDot.test.tsx` (8) + `AvatarPicker.test.tsx` (8)
- renderer/features/members: `MemberProfileEditModal.test.tsx` (6) + `MemberProfilePopover.test.tsx` (8) + `MemberProfileTrigger.test.tsx` (2)
- 회귀 수정: `MemberRow.test.tsx` (R5 → R8 Avatar delegation), `ProfileAvatar.test.tsx` (R3 + R8 delegation)

## Decision Log 요약 (D1~D8)

| # | 결정 | 한 줄 요약 |
|---|------|-----------|
| D1 | v3 PersonaBuilder swap 범위 | `meeting-turn-executor` 만. v2 `engine/turn-executor` + `engine/persona-builder` 는 R11 일괄 삭제 |
| D2 | Custom avatar 저장 위치 | `<ArenaRoot>/avatars/<providerId>.<ext>` 상대 경로만 DB 저장. 절대/base64/file:// 금지 |
| D3 | 부팅 warmup 전략 | `Promise.allSettled` + per-provider 5s timeout, fire-and-forget |
| D4 | TurnManager skip 정책 | 그 턴만 skip + 회의 진행 유지. 새 SSM 상태 미도입 |
| D5 | 클릭 트리거 통일 | 3 surface (메시지 버블 / MemberRow / PeopleWidget) → 동일 Popover (anchor 만 다름) |
| D6 | Popover (보기) vs Modal (편집) 2단계 | spec §7.1 명시 |
| D7 | Custom avatar 검증 | ext 화이트리스트 + 5MB + EXIF 무시 + base64 변환 0 |
| D8 | Stream vs Invalidation | R8 은 mutation 후 단순 invalidation. `stream:member-status-changed` 등 broadcast 는 R10 |

## Known Concerns (R9 인수인계 — 6건)

1. **`stream:member-status-changed` 실시간 broadcast 부재** (D8) — R8 은 popover/EditModal mutation 후 다른 surface 의 status 갱신을 다음 mount fetch 에 위임. R10 에서 다중 클라이언트 / autonomy 도입 시 stream 으로 승격 필요.

2. **외근 자동 timeout 없음** — 사용자가 외근 토글한 뒤 수동 출근 토글까지 자동 복귀 없음. R9 autonomy 정책 (예: 1시간 후 자동 출근 복귀) 도입 시 정책 결정 필요.

3. **Warmup 자동 retry 부재** — 부팅 5s timeout 후 background 에서 reconnect 가 settle 하면 runtime status 는 갱신되지만, 그 이후의 backoff 재시도는 없음. `member:reconnect` 수동 호출만 가능. R9 에서 autonomy + warmup retry policy 통합.

4. **MemberWarmupService timeout 후 cancellation 미구현** — 5s timeout 이 결과 기록 시 background `provider.warmup` 은 그대로 진행. Electron `provider.warmup` 자체에 abort signal 미지원. R9 에서 provider interface 확장 검토.

5. **PeopleWidget E2E test.skip()** — 테스트 환경에 provider seed 없을 때 자동 우회. R10 OS matrix 에서 fixture seed 정비 시 자동 활성화.

6. **`notification.warmupFailed.*` / 부팅 warmup 결과 main-process 알림 미구현** (R7 D 흐름과 동일) — main-process 측 OS notification 라벨은 R10 renderer i18n migration 시 deferred.

## R10 / R11 Forward Pointers

- R10 — DM read-receipt + typing indicator 실 이벤트, 설정 화면 "멤버 관리" 풀버전 (전체 일괄 편집/추가/삭제), Provider 추가/삭제 UX, 6 테마 시각 sign-off (Windows/native), Playwright CI matrix
- R11 — v2 `engine/persona-builder.ts` + `engine/turn-executor.ts` 등 v2 engine 5파일 물리 삭제 (D1 종속), retro 영어 복귀 결정 D8

## Spec §10 R8 체크박스 ✓ 전환 (Task 13)

`docs/specs/2026-04-18-rolestra-design.md` §10 Phase R8 블록의 13 `[ ]` 항목 → `[x]` 전환 완료. 산출물 링크는 위 Task → 산출물 맵과 1:1.

## tasks.json

`docs/plans/2026-04-23-rolestra-phase-r8.md.tasks.json` — 14/14 status='completed'.
