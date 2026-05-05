# Phase R4 — Done Checklist

**Phase**: R4 — 대시보드 + 프로젝트 관리
**Plan**: `docs/plans/2026-04-20-rolestra-phase-r4.md`
**Branch**: `rolestra-phase-r4` (14 task commits + 1 plan commit + 2 spec-sync commits = 17 commits since `main`)
**Closeout date**: 2026-04-21 (local time)

## 구현 체크리스트 (모두 완료)

| Task | Title | Commit |
|------|-------|--------|
| 0 | 브랜치 분기 + spec §7.3/§7.5/§10 R4 점검 | `9567da1` |
| 1 | Shared types + IpcChannelMap 확장 (`dashboard:*`) | `142ca2e` |
| 2 | Main — DashboardService + IPC 핸들러 | `b384652` / spec sync `4292e3d` |
| 3 | Main — 프로젝트 생성 flow 테스트 보강 | `123b2f3` |
| 4 | Renderer IPC wrapper + 3 hooks + active-project store | `6dff88a` |
| 5 | ProgressGauge — 테마별 3 variant | `973e331` |
| 6 | Dashboard Hero — 4 KPI 타일 + 빠른 액션 | `beef074` |
| 7 | 비대칭 2x2 위젯 4종 + `meeting:list-active` / `message:list-recent` 채널 | `176c8a0` |
| 8 | Insight 띠 (하단 4 셀) | `d5eaa43` |
| 9 | ProjectCreateModal — Radix Dialog 3 kinds + external+auto 방어 | `95c7136` |
| 10 | App-level 활성 프로젝트 wiring (ProjectRail + ShellTopBar + DashboardPage 통합) | `8340f73` |
| 11 | i18n parser `keepRemoved` + dashboard/project 키 채움 | `652482b` |
| 12 | Playwright Electron E2E (spec + config, 로컬 실행은 WSL 제약으로 DONE_WITH_CONCERNS) | `f2b270e` |
| 13 | 본 closeout 문서 + spec §10 R4 체크박스 ✓ + tasks.json completed | (본 커밋) |

## 정식 게이트 통과

| 게이트 | 결과 |
|--------|------|
| `npm run typecheck:web` | exit 0 |
| `npm run lint` | 0 errors, 12 pre-existing warnings (R3 baseline, 전부 테스트 파일의 literal string — R4 무관) |
| `npm run i18n:check` | 클린 (idempotent write, ko/en 키셋 완전 일치) |
| `npm run theme:check` | R3 deterministic 생성물 미변경 |
| `npm run build` | 통과 |
| `npx vitest run` 전체 | 2319 passed / 64 pre-existing failed / 6 skipped — **R3 tip 대비 +180 새 테스트 green, 실패 수는 변동 없음** |

## 신규 산출물 요약

- **Main 레이어**: `src/main/dashboard/` (신규 서비스 1개), `project-handler.ts`에 `project:pick-folder` 추가, `meeting-service`/`message-service` listActive/listRecent 확장
- **Shared**: `dashboard-types.ts`, `ActiveMeetingSummary`, `RecentMessage`, `SESSION_STATE_ORDER` 상수, 5개 신규 IPC 채널(`dashboard:get-kpis`, `meeting:list-active`, `message:list-recent`, `project:pick-folder`, + zod schemas)
- **Renderer features**: `dashboard/` (DashboardPage + Hero + 4 위젯 + InsightStrip + ProgressGauge), `projects/` (ProjectCreateModal + 4 sub-컴포넌트)
- **Renderer infra**: `ipc/invoke.ts`, `hooks/` (6 hooks: useDashboardKpis, useProjects, useActiveProject, useActiveMeetings, useRecentMessages, useMembers, usePendingApprovals), `stores/active-project-store.ts`
- **App 통합**: `App.tsx`에서 R3 placeholder 제거 → 실제 DashboardPage 마운트 + 전역 ProjectCreateModal host + useProjects/useActiveProject 와이어
- **E2E**: `e2e/` (Playwright config + electron-launch 헬퍼 + external-project-flow spec)
- **테스트**: 신규 테스트 180+ (shared schema, main dashboard/project/meeting/message, renderer ipc/hooks/stores/features, shell Active, App 전체)

## R4 판단 기록 (plan D1-D5)

- **D1 (KPI 갱신 주기)**: B — 진입 + 활성 전환 + 모달 close 3 시점만. 스트림 구독은 R6.
- **D2 (projectId scope)**: B — R4는 global만, 타입은 optional로 reserved.
- **D3 (+ 새 프로젝트 진입점)**: C — Hero 빠른액션 + ProjectRail `+` 둘 다, 단일 모달 인스턴스를 `App.tsx`가 host.
- **D4 (E2E tmp 위치)**: B — `os.tmpdir()` 내부.
- **D5 (Playwright CI 통합)**: B — R10의 OS matrix로 이연.

## 추가로 내려진 판단 (Task 수행 중)

- **spec §7.5 KPI 표 스키마 sync (`4292e3d`)**: spec은 `meetings.state='done'` / `completed_at`을 썼지만 migration 004 실체는 `outcome`(accepted/rejected/aborted) + `ended_at`. 구현과 어긋나 spec을 실체에 맞춰 갱신. `진행 회의 = ended_at IS NULL`, `오늘 완료 = outcome='accepted' AND ended_at >= startOfLocalToday()`.
- **Task 2 DST 처리**: `startOfLocalDay()` 헬퍼를 `new Date(y,m,d,0,0,0,0)` 기반으로 순수 함수화. `setHours(0,0,0,0)`는 spring-forward 갭에서 V8이 normalise forward해서 경계가 1시간 밀림. 테스트로 2026-03-08 spring-forward 일 고정.
- **Task 9 project-pick-folder**: 원래 `workspace:pick-folder` 재사용을 검토했지만 R3-Task11의 legacy-channel-isolation 테스트가 v3 renderer에서 legacy 채널 호출을 막고 있어, 새 v3 채널 `project:pick-folder`를 추가(`dialog.showOpenDialog` 래퍼). legacy 채널의 제거는 R11.
- **Task 10 modal 위치**: Task 9는 DashboardPage 내부에 modal을 두는 옵션과 App 상위로 올리는 옵션을 남겼는데, Task 10에서 App 상위로 정식 lift. Hero 빠른액션과 ProjectRail `+` 버튼이 하나의 modal 인스턴스를 공유.
- **Task 11 i18n-parser `keepRemoved`**: `project.create.permissionMode.*`, `project.create.sourcePath.*`, `project.create.externalPath.*`, `project.create.kind.*`, `project.errors.*`, `dashboard.approvals.kind.*`, `shell.topbar.subtitle`, `app.*` — 전부 dynamic 키 접근(`t(\`...${var}\`)` or config 객체의 키 참조)이라 parser가 정적 감지 못함. anchored regex로 보호 + 각 패턴 주석으로 이유 명시.
- **Task 12 WSL 런타임 제약 (DONE_WITH_CONCERNS)**: `node_modules/electron/dist/`가 Windows 네이티브 빌드(`electron.exe`)로 커밋되어 있어(이전 `be1fbf7` "sync package-lock.json with Windows-native install" 결정) WSL에서 Electron 프로세스 부팅 실패. spec + config + helper + spec 파일은 모두 repo에 체결됨. Windows 네이티브 또는 Linux 재빌드(`npm rebuild electron && npm rebuild better-sqlite3`) 후 실행. 스크린샷 증빙은 R10 OS matrix CI로 이연 (R4 plan D5와 일치).

## 스크린샷 증빙 (수동 캡처 대기)

Electron 로컬 부팅 완료 시 다음을 `docs/specs/appendix/r4-evidence/`에 배치:

- `dashboard-warm-light.png`
- `dashboard-tactical-dark.png`
- `dashboard-retro-light.png`
- `external-link-flow.png` (Playwright test-results/ 출력을 move)

현 시점(2026-04-21)엔 WSL 환경 한계로 미캡처. Windows 네이티브 환경에서 개발자가 다음 명령으로 수동 캡처:

```powershell
npm run dev     # Electron 부팅
# DevThemeSwitcher로 6 테마 스위치하며 스크린샷 6장 캡처
npm run e2e     # Playwright 실행 → e2e/test-results/external-link-flow.png
```

## R5 진입 체크리스트 (채널 + 메신저 본체)

R5 착수 전 확인 항목:

- [ ] 현재 R4 브랜치를 `main`으로 fast-forward merge + 원격 push
- [ ] 6 테마 대시보드 스크린샷 증빙 완료 (Windows/native)
- [ ] Playwright E2E 로컬 1회 성공 증빙 (Windows/native)
- [ ] spec §7.4(채널 시스템) 재확인 — 시스템 채널 자동 생성 규칙(`#일반`/`#승인-대기`/`#회의록`), DM 제약(AI 1명만, AI끼리 DM 금지)
- [ ] MessageBubble 디자인 시안 확인 (`docs/Rolestra_sample/02-Messenger.html`)
- [ ] `channel:list` / `channel:create` / `message:append` / `message:list-by-channel` 채널은 이미 v3로 구현됨 — 재사용
- [ ] 좌측 네비(프로젝트 → 채널 → DM) 정보구조 확인

## R4 범위 밖으로 확실히 둔 것 (R5+에서 처리)

- 채널/DM UI (메시지 버블, Composer, TypingIndicator) → R5
- `#일반`/`#승인-대기`/`#회의록` 시스템 채널 자동 생성 → R5
- 회의(SSM) 개시 → R6
- 승인 시스템 UI (ApprovalInbox 개별 화면) → R7 (R4 ApprovalsWidget은 요약만)
- 멤버 프로필 편집 모달 → R8 (R4 PeopleWidget은 리스트만)
- 자율 모드(auto_toggle/queue) 실행 로직 → R9
- DM, FTS5 검색, 설정 UI 재구성 → R10
- Legacy IPC 채널 제거, `_legacy/` 삭제, Windows 인스톨러 → R11
