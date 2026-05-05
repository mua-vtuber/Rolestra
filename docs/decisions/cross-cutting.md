# Cross-Cutting Decisions

Phase 무관 핵심 invariant 7건. 한 phase 안에서만 살아 있는 결정이 아니라 R1~R11 내내 코드 전체를 지배하는 규칙이다. 위반 시 review 단계에서 차단.

---

## C1. 합의 엔진은 명시적 상태머신으로 구현한다

`src/main/meetings/engine/consensus-machine.ts` 의 `ConsensusStateMachine` (12 state) 가 단일 권위. 작업 모드의 합의 흐름(토론/취합/동의/승인/실행) 은 암묵적 if/else 분기 금지.

- 12 상태: `IDLE` → `DISCUSSING` → `SYNTHESIZING` → `VOTING` → `AWAITING_USER` → `APPLYING` → `DONE` / `FAILED` / `EXPIRED` / `ABORTED` 등
- 이벤트 + 가드 + 타임아웃 + `maxRetries` 명시
- `aggregatorStrategy`: `strongest`(default) / `last-speaker` / `designated` / `round-robin`
- 상태 스냅샷 저장 (전이 시점 + 주기 체크포인트 + 종료 시 flush) — `meetings.state_snapshot_json`
- R8 D4 — 새 SSM 상태 추가는 R10+ 까지 보류 (예: `WAITING_PARTICIPANTS`). offline 멤버는 turn skip 으로 처리, SSM 자체 transition table 은 변경 안 함.
- R11 신규 도메인 모델 0 원칙 유지 — SSM 은 R11 의 어떤 task 도 수정하지 않음.

**왜:** 복잡한 흐름이 코드로 드러나야 재개·복구·디버깅이 가능. SSM 10,000 LOC 테스트 자산 (R6 D1) 이 R7~R11 에서 회귀 0 보장의 근간.

**위반 시:** consensus 흐름에 if/else 추가 → review 단계에서 SSM 전이로 옮기도록 차단.

---

## C2. Provider 는 Capability + Registry 기반으로 설계한다

`src/main/providers/registry.ts` 의 `ProviderConfig` discriminated union + 런타임 `ProviderCapability` 분기.

- 컴파일 타임: `ProviderConfig` (`api` / `cli` / `local` 3 kind)
- 런타임: capability 기반 분기 — `streaming` / `resume` / `tools` / `web-search` / `summarize` (R11)
- provider/model 카탈로그는 registry 데이터로 관리 (코드에 모델 ID 하드코딩 금지)
- R10 D7 — LLM 회의록 요약은 capability `summarize` fallback chain. R11 Task 9 가 `'streaming'` 임시 우회 제거 + 6 provider config (Claude / Codex / Gemini / Anthropic API / OpenAI API / Local Ollama) 정식 명시.
- R7+ — provider 추가 시 capability 명시 누락은 typecheck error (union 강제)

**왜:** provider/모델 하드코딩은 신규 provider 추가, 모델 변경 시 재배포 강제. capability 기반 분기는 런타임 확장성 + 타입 안전성 동시 확보.

**위반 시:** 신규 provider 코드에 `if (provider.id === 'claude-code')` → registry config + capability 로 옮기도록 차단.

---

## C3. 파일/명령 실행은 ExecutionService 경계로 강제한다

`src/main/execution/execution-service.ts` 가 단일 진입점. AI 가 파일/명령에 접근하는 모든 경로는 이 서비스 경유.

- 반영 순서 고정: `dryRun → 사용자 승인 → atomic apply → rollback`
- 명령 실행은 구조화 `CommandRequest` 만 허용 (`command`, `args`, `cwd`) — 셸 문자열 금지, `execFile` + `shell: false`
- 정책 검증 필수: `CommandPolicy` (`allowedCommands` / `blockedPatterns` / `maxExecutionTimeMs` / `maxOutputBytes`)
- 감사 로그 (`AuditEntry`) — 모든 dry-run/apply/rollback 영구 기록
- R11 Task 7 — `dryRunPreview(approvalId)` API 추가는 read-only path. atomic apply 와 분리해서 mutation 0 보장.

**왜:** 실행 경계가 없으면 보안/감사/복구가 취약. 권한 경계를 코드로 강제 + 실패 복구 + 감사 로그 일관 구현.

**위반 시:** Renderer 또는 Main 의 다른 서비스가 직접 `child_process.spawn` / `fs.writeFile` 호출 → ExecutionService 경유로 차단.

---

## C4. IPC 는 TypedInvoke + zod 검증

`src/preload/index.ts` 의 `typedInvoke<K extends keyof IpcChannelMap>` generic + `src/shared/ipc-types.ts` IpcChannelMap + `ipc-schemas.ts` zod validation (개발 모드만).

- 문자열 채널 직접 호출 금지 — `typedInvoke('foo:bar', payload)` 만 허용
- IpcMeta — `requestId` / `schemaVersion` / `sequence` / `timestamp` 자동 부여
- preload contextBridge 화이트리스트 — IpcChannelMap 위에서 generic 이라 신규 채널 자동 화이트리스트 (R11 Task 5 검증)
- 개발 모드: zod runtime validation, production: 타입만 (성능)
- Renderer → Node API 직접 접근 절대 금지 — 반드시 IPC 경유

**왜:** Renderer ↔ Main 경계가 타입으로 봉인되지 않으면 schema drift 시 런타임 에러로만 발견. zod 가 dev 단계 에서 오타·shape 변경 즉시 차단.

**위반 시:** `window.electron.ipcRenderer.invoke('foo:bar', ...)` → `typedInvoke` 로 차단.

---

## C5. Secrets 는 safeStorage (평문 저장 금지)

API 키, 토큰 등 민감 데이터는 Electron `safeStorage.encryptString` 으로 암호화 후 SQLite `provider_credentials` 컬럼 저장.

- 평문 노출 금지 — Renderer 에 절대 평문 키를 주지 않음 (Renderer 는 "있음/없음" boolean 만 알 수 있음)
- 설정 3계층: `settings` (사용자 가시) / `secrets` (safeStorage) / `runtime` (메모리만)
- macOS Keychain / Windows DPAPI / Linux libsecret 자동 위임
- safeStorage 사용 불가 환경 (Linux 일부) 은 명시적 경고 + plain 저장 금지 (입력 거부)

**왜:** API 키 평문 디스크 저장은 보안 1순위 위반. safeStorage 가 OS-level 키체인 위임을 통해 표준 보호 제공.

**위반 시:** 신규 credential 컬럼에 평문 저장 → safeStorage encrypt 경유로 차단.

---

## C6. Path-guard — ArenaRoot 외부 쓰기 금지

`src/main/files/path-guard.ts` 가 모든 파일 쓰기 경로 (CLI permission / ExecutionService changes / avatar upload 등) 의 sentinel.

- 모든 쓰기 경로는 `<ArenaRoot>/` 또는 `<ArenaRoot>/avatars/` 안 (R8 D2 — avatar 저장 위치)
- `external` project 는 `<ArenaRoot>/projects/<slug>/link` Windows junction / macOS+Linux symlink — junction 너머는 path-guard 가 realpath 비교 (CA-3 TOCTOU)
- 권한 모드 3 종류: `auto` / `hybrid` / `approval` × CLI 3 종류 (Claude / Codex / Gemini) × project kind 3 (`new` / `external` / `imported`) — 모든 조합은 R10 Task 5 `permission-flag-builder.ts` 매트릭스 검증
- avatar 저장은 `avatars/<providerId>.<ext>` 상대 경로만 DB 저장 (절대 경로 / base64 / file:// URL 금지)

**왜:** AI 가 파일에 접근하는 환경에서 path 경계가 없으면 사용자 home / OS 영역에 의도치 않은 쓰기 발생. ArenaRoot 안으로 봉인 + junction TOCTOU 까지 막아야 안전.

**위반 시:** 새 file write 경로에 path-guard 미적용 → 차단.

---

## C7. i18n — main-process 도 dictionary 경유 (i18next direct import 금지)

Renderer 는 `react-i18next` + `t()`, main-process 는 `src/main/notifications/notification-labels.ts` 의 dictionary resolver.

- 모든 사용자 노출 문자열은 `t()` 또는 dictionary 경유 — UI 하드코딩 금지
- main-process 는 i18next 직접 import 금지 (번들 크기 + SSR 패턴 흉내 회피) — 대신 simple dictionary map (`{ ko: '...', en: '...' }`)
- R9 D8 — `notification-labels.ts` dictionary 패턴 land
- R11 D9 — locale 분기 default. main-process trace 라인 (`approval-notification-bridge` / `autonomy-gate`) 도 dictionary 이전, ko 유지 + en 번역 — 사용자가 LanguageTab 에서 locale 변경 시 즉시 반영 (`notification:set-locale` IPC 3-step: i18n.changeLanguage + config:update-settings + notification:set-locale)
- CI 가드: `eslint-plugin-i18next` (renderer) + `i18next-parser` (idempotent ko/en parity) + `npm run i18n:check` exit 0
- keepRemoved 패턴 — 동적 키 (`onboarding.steps.${step.key}` 등) 보존

**왜:** 1) UX 일관성 + 다국어 확장성, 2) main-process 가 i18next 를 init 하지 않으면 의존성 방향 깨끗 (renderer → shared → preload → main 단방향 유지), 3) trace 라인까지 dictionary 면 로그 분석 시 영문 grep 가능.

**위반 시:** UI 한국어/영어 리터럴 직접 작성 → t() 로 차단. main-process 가 `import i18next from 'i18next'` → notification-labels.ts dictionary 로 차단.

---

## 각하된 패턴 (참고 — 다시 제안 시 cross-cutting 위반)

- **개별 ADR-NNN 파일** — R11 D8 에서 phase 묶음 채택 (R1~R11 80+ Decision 누적, 개별 파일은 탐색성 최악)
- **main → renderer import** — 단방향 의존성 위반
- **Renderer 에서 `child_process` / `fs` / `electron` 직접 import** — IPC 경유로 차단
- **셸 문자열 실행** (`exec` / `spawn(cmd, { shell: true })`) — 구조화 CommandRequest 로 차단
- **Storybook** — R3 에서 채택 안 함 (dev-only theme-switcher 가 최소 플레이그라운드 역할)
- **스트림 라이브러리** (`@dnd-kit/core` 등) — R8/R9 가 native HTML5 + React state 로 처리, dep 최소화 기조
