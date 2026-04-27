# R1~R3 결정 기록

R1 (폴더 접근 격리 스모크) / R2 (v3 DB + Main + IPC) / R3 (레거시 이동 + 디자인 시스템 초기) 단계의 phase 별 결정. R1·R2 는 별도 plan Decision Log 미작성 — 본 문서는 plan / spec §10 / 회고 메모리 기준 정리.

---

## R1 — 폴더 접근 근본 해결 (격리 스모크 — CA-6)

### R1-D1. ArenaRoot 단일 진입 — `tools/cli-smoke/` 격리 검증

**결정:** v2 앱과 분리된 `tools/cli-smoke/` 환경에서 ArenaRoot 초기화 + 3 CLI (Claude Code / Codex / Gemini) spawn 래퍼 + 자동승인 플래그 매트릭스를 스크립트로 자동 검증. v2 UI/IPC/Main 무수정.

- 검증 시나리오: `<ArenaRoot>/projects/smoke-1/README.md 쓰기` + `<ArenaRoot>/projects/smoke-ext/link (external junction) TOCTOU 재검증`
- 결과는 `docs/superpowers/specs/appendix-cli-matrix.md` 영구 기록 — 이후 phase 의 플래그 변경 근거
- `resolveProjectPaths()` 단일 함수로 경로 결정 검증 (CD-1)

**왜:** v2 앱과 동시 검증하면 v2 회귀 위험 + 매트릭스 노이즈. 격리 환경이 1 단계 검증의 신뢰도 확보.

**대안:** v2 앱 안에서 직접 검증 — 각하 (회귀 위험 + 매트릭스 오염).

### R1-D2. 매트릭스 = 3 CLI × 3 모드 × Windows/(macOS)

**결정:** Windows 우선 검증, macOS 는 best-effort (R12+ 코드 사인 시 정식 검증).

**왜:** 사용자 출시 1 차 타깃이 Windows. macOS 는 출시 후.

---

## R2 — v3 DB 스키마 + Main 레이어 + IPC

### R2-D1. v3 마이그레이션 011 까지 신규 작성, v2 마이그레이션 보존

**결정:** 기존 v2 마이그레이션 → `_legacy/migrations-v2/` 이동 (R3 에서 git mv). v3 마이그레이션은 011 까지 forward-only chain 으로 신규 작성 — 005 (members) / 006 (workspace) / 007 (members extended) / 008 (channels) / 009 (meetings) / 010 (approvals) / 011 (queue + autonomy + notification prefs).

- forward-only, idempotent (`IF NOT EXISTS` defence-in-depth), 실패 시 앱 시작 차단
- R10 마이그레이션 012 (circuit_breaker_state, D10) + R11 마이그레이션 013/014 (onboarding_state + llm_cost_audit_log) 가 같은 chain 위에 추가
- `_legacy/migrations-v2/` 8 파일은 R11 Task 1 에서 일괄 물리 삭제

**왜:** 기존 v2 데이터를 마이그레이션하지 않고 신규 schema 로 진입 — v2 모델 (conversations/messages 단일 흐름) 과 v3 모델 (projects/channels/meetings/messages 4 단계 분리) 의 임피던스가 너무 커서 자동 변환 보장 불가능. 사용자가 v2 → v3 데이터 이전을 의도하는 시점은 V4+ 로 미룸.

### R2-D2. v3 신규 서비스 9종 일괄 land (Main 레이어 리팩토링)

**결정:** `ArenaRootService` / `ProjectService` / `ChannelService` / `MeetingService` / `MessageService` / `ApprovalService` / `QueueService` / `MemberProfileService` / `NotificationService` 9 종 R2 에서 land. R1 매트릭스를 실제 Main 에 이식.

**왜:** R3 부터 Renderer 를 신규로 짜야 하는데, 그 전에 Main 레이어가 v3 모델로 안정화되어 있어야 R3 가 IPC 응답에 의존 가능.

### R2-D3. Renderer 는 R2 에서 변경 안 함 (v2 UI 정상 동작 유지)

**결정:** R2 는 Main + IPC 만. Renderer 는 R3 에서 `_legacy/renderer-v1/` 로 이동 후 신규 작성. v2 UI 가 새 Main 서비스와 호환 안 되는 경우 임시 비활성 (스크립트 기반 통합 테스트로 검증).

**왜:** Main + Renderer 동시 신규 작성은 단일 phase 부담 초과. Main 안정화 후 Renderer 진입.

---

## R3 — 레거시 이동 + 디자인 시스템 초기

### R3-D1. R2 origin push + main fast-forward + 브랜치 삭제

**결정 (2026-04-20 사용자 승인):** `rolestra-phase-r2` 브랜치를 origin push → main 병합 (fast-forward) → 브랜치 삭제 (로컬 + 원격). R3 는 `rolestra-phase-r3` 브랜치에서 main 위로 쌓는다.

**왜:** Phase 별 단일 브랜치 + ff merge 패턴 확립. R3~R11 동일 운영.

### R3-D2. `theme:build` 스크립트는 Node import 후 객체 직렬화

**결정 (2026-04-20):** `tsx` 로 `docs/Rolestra_sample/theme-tokens.jsx` 를 import 해 순수 상수 객체를 읽고 deterministic 하게 `src/renderer/theme/theme-tokens.ts` + `src/renderer/styles/tokens.css` 자동 생성.

- 시안 jsx export 구조 (`export { themeWarmLight, ... }`) 는 Task 5 첫 step 에서 확인·준수
- 6 테마 × 2 모드 = 12 토큰 셋이 single source of truth
- `npm run theme:build` 는 `npm run theme:check` 도 같은 함수 (idempotent diff 검증)

**왜:** 시안 (`docs/Rolestra_sample/`) 과 코드 사이에 색·반경·그림자 drift 가 절대 발생 안 하도록. 손으로 옮기면 폰트 weight 하나만 빠져도 fidelity 깨짐.

**대안:** A안 — 직접 텍스트 파싱 — 각하 (jsx parser 직접 작성 비용). C안 — 손 관리 — 각하 (drift 위험).

### R3-D3. ShellTopBar 개발용 theme-switcher 는 `import.meta.env.DEV` 가드

**결정 (2026-04-20):** `if (import.meta.env.DEV)` 가드로 프로덕션 번들에서 컴파일 타임 제거. Vitest 는 provider override 또는 env 강제로 force-mount. 사용자 대면 테마 전환은 R10 설정 탭이 정식 경로 (`ThemeTab`).

**왜:** 개발 중에는 6 테마 빠른 전환이 필수, 프로덕션에는 무관 — Vite 의 dead code elimination 으로 번들 크기 0 영향.

**대안:** 항상 노출 — 각하 (사용자 경험 오염). 별도 dev-tool 윈도우 — 각하 (Electron secondary window 비용).

### R3-D4. 제품 특화 Blocks 는 R3 범위 외 (R4+ 이연)

**결정:** `MessageBubble` / `MemberCard` / `ChannelItem` / `ApprovalCard` / `DashboardWidget` / `ProjectSwitcher` 등 도메인 IPC + 상호작용 훅업과 얽힌 Block 은 각 phase (R4 대시보드 / R5 메신저 / R7 승인) 에서. R3 는 Shell + Primitive 5종 (Button/Card/Badge/Separator/Tooltip) 만.

**왜:** R3 에서 Block 까지 만들면 IPC 응답 구조와 동시 변경 — R4+ 의 도메인 작업이 Block 인터페이스 redesign 강제.

### R3-D5. Storybook 미채택 — dev-only theme-switcher 로 대체

**결정:** Storybook 추가 안 함. ShellTopBar 의 theme-switcher 가 6 테마 × 2 모드 라이브 렌더 — 최소 플레이그라운드 역할.

**왜:** Storybook 의존성 + 별도 빌드 + 별도 lint 경로 — Rolestra 규모에 과대. 6 테마 토큰 변경 시 dev-switcher 가 즉시 시각 검증.

### R3-D6. Legacy IPC 채널 (chat:* / workspace:* / consensus-folder:* / consensus:* / session:*) 은 warn 유지, 제거는 R11

**결정:** R3 는 격리 테스트 (`legacy-channel-isolation.test.ts`) + warning 만. 27 v2 IPC 채널 일괄 제거는 R11 Task 2.

**왜:** R3 는 신규 Renderer 진입 phase — 동시 v2 채널 제거는 두 가지 변경이 섞여 회귀 추적 불가능. R11 의 legacy cleanup 묶음에서 일괄 처리가 안전.

### R3-D7. i18n 도메인 네임스페이스 15종 + 실 사용부터 populate

**결정:** `I18N_NAMESPACES` 15 종 (`shell` / `dashboard` / `messenger` / `meeting` / `approval` / `member` / `notification` / `settings` / `onboarding` / `project` / `error` / `validation` / `common` / `provider` / `cli`) 정의. 각 phase 가 자기 도메인 키만 populate.

- 키 컨벤션: dot-separated lowercase (`messenger.channelRail.sectionTitle.warm`)
- 동적 키 (`messenger.channelRail.sectionTitle.${themeKey}`) 는 `i18next-parser.config.js` keepRemoved regex 로 보존
- ko/en 양쪽 populate 가 R5+ 의 게이트 — `npm run i18n:check` orphan 0

**왜:** namespace 분리는 키 충돌 방지 + 사용처 명확화. 동적 키 보호는 parser 의 자동 prune 으로부터 동적 lookup 보존.

---

## R1~R3 통합 영향

- R1 의 매트릭스 검증은 R10 Task 5 PermissionFlagBuilder 의 39 cases (3 모드 × 3 CLI × 3 project kind + extras) 정식 fixture 의 근거
- R2 의 9 신규 서비스 + IPC 채널은 R3~R11 모든 Renderer 코드의 단일 진입점 — 직접 `child_process` / `fs` 호출 절대 금지 (cross-cutting C3/C6)
- R3 의 디자인 시스템은 R5 (메신저) / R7 (승인) / R10 (DM/Search) 의 fidelity 기준
