# Rolestra Post-R11 — Mock/Fallback + Hardcoding 전수조사 결과 + Cleanup Plan

**Date:** 2026-04-27
**Audit baseline:** main tip `65b2f48` (R11 Closeout — 17/17 + v0.1.0 tag push 완료)
**Prev plan:** `docs/superpowers/plans/2026-04-26-rolestra-phase-r11.md`
**Spec:** `docs/superpowers/specs/2026-04-18-rolestra-design.md`
**Trigger:** R11 main merge + v0.1.0 tag push 후 dev 빌드 동작 검증 중 멤버 패널 빈 상태 발견 → STAFF_CANDIDATES 하드코딩 fixture 추적 → mock/fallback 채무 광범위 확인 → 전역 CLAUDE.md 에 ABSOLUTE PROHIBITIONS 추가 (`# Work Principles` 하부) → 전수조사 진행

**Goal:** R11 closeout 시점의 코드 트리 전체를 7 카테고리 기준으로 전수조사하고 발견된 위반을 6 phase (F1~F6) 로 분리해 제거한다. 본 plan 종료 시 (i) onboarding wizard 가 `STAFF_CANDIDATES` 등 하드코딩 fixture 없이 `provider:detect` 결과만 사용하도록 교체되고, (ii) silent fallback 으로 사용자에게 데이터/서비스/설정 부재를 숨기던 경로가 명시 에러 throw 로 전환되며, (iii) Dashboard placeholder 표면 (InsightStrip / DashboardPage noop / HeroQuickActions / TypingIndicator / use-channel-messages 'user' 리터럴) 이 실 데이터 IPC 또는 surface hide 로 정리되고, (iv) 환경 의존 하드코딩 (Ollama endpoint / CORS host / remote bind address / Windows 절대경로 / 'Documents' 리터럴) 이 settings 계층 + Electron API + env var 우선순위로 통일되며, (v) i18n 우회 (aria-label / OBSummaryStrip 한글 / remote-web-client HTML 템플릿 / meeting-minutes-composer DEFAULT_LABELS) 가 t() 또는 NotificationDictionary 패턴으로 정리되고, (vi) 매직넘버 산재 (5000ms × 9곳 / 3000ms × 3곳 / `MAX_SNAPSHOTS=100` 중복) 가 `src/shared/timeouts.ts` 또는 settings 신설로 단일 진실원화되며, (vii) red-flag deferral 주석 (R6 / R12+ / "until then" / smoke-wire) 이 현재 상태 반영하도록 정리된다. F1~F2 (P0) 가 사용자 ABSOLUTE PROHIBITIONS 직접 위반 영역, F3~F4 (P1) 가 사용자 환경 호환성 영역, F5~F6 (P2) 가 코드 품질 + 기술부채 영역.

**Overview (자연어, 비코더용):**

- 본 cleanup 은 R11 closeout 이후 발견된 mock/fallback 채무 + 환경 의존 하드코딩 + i18n 누락 + 매직넘버 산재 등 4 가지 큰 부류의 위반을 제거하는 후속 plan 이다. R11 까지 17/17 task + v0.1.0 tag push 가 closeout 으로 표기됐지만, **실제로는 functional release 가 아닌 packaging 만 완료된 상태**다. wizard 의 staff 선택 흐름이 `STAFF_CANDIDATES` 위에서 동작해서 메신저 멤버 패널 / 대시보드 팀원 / 설정 멤버 모두 빈 상태로 ship 됐고, dashboard insight strip 은 R6 약속이 완료됐는데도 em-dash placeholder 로 렌더링되며, 회의 시작 버튼은 noop 핸들러에 연결되어 있다.
- 가장 큰 부채는 **Onboarding wizard mock 흐름** (Critical 7건, F1 phase). `src/renderer/features/onboarding/onboarding-data.ts:50` 의 `STAFF_CANDIDATES` 6 provider 하드코딩 fixture 가 OnboardingPage Step2 staff-grid 에 직접 노출되고, `OnboardingPage.tsx:114,116` 가 staff undefined 시 같은 fixture 로 silent fallback 한다. wizard 의 staff 선택은 `onboarding_state.selections.staff` 만 저장하고 `provider:add` 흐름과 단절되어 있어 `providerRegistry.listAll()` 이 빈 배열을 반환한다. 메모리 `rolestra-r11-mock-fallback-debt.md` 에 사용자 결정한 옵션 2 (wizard 진짜 detection 흐름) 가 본 plan F1 phase 에 정식 통합된다.
- 두 번째 부채는 **silent fallback 으로 사용자에게 데이터/서비스/설정 부재를 숨기는 경로** (Critical 3건 + High 5건, F2 phase). `src/main/providers/model-registry.ts:123,177-181,240-252` 의 3 spot 에서 API 인증 실패 (401/403) + 네트워크 실패 + JSON 파싱 실패가 모두 빈 배열로 swallow 되어, 사용자가 API 키를 잘못 입력했는지 / 서비스가 다운됐는지 / 설정이 누락됐는지 구분할 수 없다. 사용자 원문: *"폴백 넣느니 오류 띄우라"*. F2 는 이 경로들을 모두 명시 specific Error throw 로 전환한다.
- 세 번째 부채는 **Dashboard placeholder 표면** (Critical 3건, F3 phase). `InsightStrip.tsx:6` 가 R6 stream aggregate 를 약속했는데 R11 까지도 4-cell 전체가 em-dash placeholder 다. `DashboardPage.tsx:53` 의 회의 시작 핸들러는 `noop()` 으로, 사용자 클릭이 무반응이다. `HeroQuickActions.tsx:9` 와 `TypingIndicator.tsx:2-7` 도 같은 패턴. 사용자 ABSOLUTE PROHIBITIONS 의 "feature 가 real 이 아니면 surface 자체를 ship 하지 않는다" 원칙에 따라 F3 는 (a) 실 데이터 IPC 신설 또는 (b) surface hide 둘 중 하나로 결정한다.
- 네 번째 부채는 **환경 의존 하드코딩** (Critical 3건 + High 3건, F4 phase). 본 프로젝트는 공개용 데스크톱 앱으로 사용자 환경이 다양하다 (Windows 다국어 / macOS / Linux / Tailscale 원격 / Docker Ollama / 자체호스팅 API / 다른 포트). `remote-server.ts:399` 의 CORS 헤더가 `127.0.0.1` 고정이라 Tailscale CGNAT(100.64.0.0/10) 환경에서 차단되고, `model-registry.ts:223,255` 의 `'http://localhost:11434'` 2곳 하드코딩이 Docker / 다른 포트 Ollama 를 미지원하며, `workspace-service.ts:23-26` 의 `'C:\\Windows'` / `'C:\\Program Files'` 절대경로 리터럴이 비영어 Windows 미고려다.
- 다섯 번째 부채는 **i18n 우회** (High 2건 + Medium 14건, F5 phase 일부). `NavRail.tsx:24` / `ProjectRail.tsx:50` 의 aria-label 하드코딩이 eslint-plugin-i18next 가 잡지 못하는 영역이고 (규칙 강화 필요), `OBSummaryStrip.tsx:58-64` 의 한글 레이블 3개 + `meeting-minutes-composer.ts:76-88` 의 `DEFAULT_LABELS` 한글 13개 + `remote-web-client.ts` 의 HTML 템플릿 리터럴 한글 11개가 t() / NotificationDictionary 우회다. F5 는 main-process i18n 사전 패턴 + eslint-plugin-i18next 규칙 강화로 처리한다.
- 여섯 번째 부채는 **매직넘버 산재 + 코드스멜** (High 5건 + Medium 7건, F5 phase 일부). `5000ms` 타임아웃이 `model-registry.ts:99,149,173` (3곳) + `connection.ts:103` + `cli-detect-handler.ts:80,120,140` (3곳) + `local-provider.ts:62,68` (2곳) 총 9 spot 에 산재하고, `3000ms` 가 `cli-spawn.ts:48,112` + `cli-process.ts:229` (3곳) 에 중복이며, `MAX_SNAPSHOTS=100` 이 `consensus-machine.ts:104` + `session-state-machine.ts:106` 에 중복이다. F5 는 `src/shared/timeouts.ts` 신설로 단일 진실원화한다.
- 일곱 번째 부채는 **red-flag deferral 주석 + 기술부채** (Critical 2건 + High 2건 + Medium 3+건, F6 phase). `onboarding-data.ts:10-12` 의 "Real provider detection wires up in R12+" 주석은 F1 처리로 모듈 자체가 사라지므로 자동 정리되고, `InsightStrip.tsx:6` "Real stream aggregates land in R6" 와 `meeting-minutes-composer.ts:64-65` "R6-Task11 populates" 는 F3/F5 처리로 약속 이행된다. `permission-revocation-listener.ts` 의 `@ts-expect-error R2-Task21` 7건은 별도 결정 — Task 21 실행 또는 모듈 자체 삭제. `approval-service.ts:9` + `autonomy-gate.ts:42` outdated 주석은 F6 에서 제거. F6 는 stream-bridge.ts:294 smoke-wire R2 legacy 경로 제거 + ApprovalInboxView count IPC 신설 (R12+ defer 해제) 까지 처리한다.
- **신규 도메인 모델 0 원칙 유지** — 본 cleanup 은 R11 처럼 신규 도메인 모델 0 이 원칙. 단 (i) F1 onboarding 진짜 흐름 신설 시 `provider:detect` IPC 응답 형식 확장 + ProviderRegistry 의 capability 추론 로직 강화, (ii) F4 환경 settings 신설 시 `settings.ollama.endpoint` + `settings.remote.bindAddress` + `settings.remote.directAccessPort` + `settings.remote.maxBodySize` 4 개 신규 setting key — 마이그레이션 신설 없이 기존 settings 테이블에 추가, (iii) F5 timeouts.ts 는 `src/shared/` 위치 신규 파일 1개. 마이그레이션 신설 0건.
- **SSM 은 건드리지 않는다**. spec §8 의 12 상태 / 가드 / 이벤트는 본 cleanup 범위 밖. F1~F6 의 어떤 task 도 `consensus-machine.ts` 의 transition table 을 수정하지 않는다.
- **R11 closeout 인식 정정** — 본 plan 은 R11 17/17 + v0.1.0 tag push 가 *packaging* closeout 임을 인정하는 동시에, *functional* closeout 으로 v0.1.0 의 의미를 재해석한다. 본 cleanup 종료 후에야 v0.1.x bump (또는 v0.1.0 재태그) 로 사용자 ship 가능 상태가 된다. 본 plan 은 사용자가 "다음 세션부터 차례대로 진행" 결정한 만큼 phase 별 단일 commit + 단일 main merge 로 진행 (R11 의 "session 묶음 + main 1회 merge" 패턴 따름).

**Architecture:**

- Layering: `renderer → shared → preload(contextBridge) → main`. R11 구조 그대로.
- Main 재사용 (R11 land 완료):
  - `src/main/providers/model-registry.ts` — F2 변경: 401/403/네트워크/JSON 파싱 catch 모두 specific Error throw + F4 변경: Ollama endpoint settings 우선순위 (settings → env → fallback)
  - `src/main/providers/registry.ts` — F1 변경: capability 추론 로직 강화 (CLI_DEFAULT_CAPABILITIES 하드코딩 흡수)
  - `src/main/onboarding/onboarding-service.ts` — F1 변경: detection 결과 → provider:add 자동 호출 흐름
  - `src/main/ipc/handlers/onboarding-handler.ts` — F1 변경: CLI_TO_PROVIDER_ID 맵 + CLI_DEFAULT_CAPABILITIES 삭제 → ProviderRegistry 위임
  - `src/main/remote/remote-server.ts` — F4 변경: CORS 헤더 동적 host + bind default settings 우선순위
  - `src/main/remote/remote-manager.ts` — F4 변경: bindAddress fallback settings 위임
  - `src/main/files/workspace-service.ts` — F4 변경: Windows 절대경로 → process.env.SystemRoot / %ProgramFiles% 동적 조회
  - `src/main/arena/arena-root-service.ts` — F4 변경: 'Documents' 리터럴 → app.getPath('documents')
  - `src/main/config/settings-store.ts` — F2 변경: 손상 케이스 사용자 경고 surface (백업 + recover prompt)
  - `src/main/remote/remote-handlers.ts` — F2 변경: FTS DB catch → IPC 응답 `{ ok: false, code: 'FTS_DB_ERROR' }`
  - `src/main/meetings/engine/meeting-minutes-composer.ts` — F5 변경: DEFAULT_LABELS 한글 13개 → NotificationDictionary 패턴
  - `src/main/streams/stream-bridge.ts` — F6 변경: smoke-wire R2 legacy 경로 제거
  - `src/main/approvals/approval-service.ts` — F6 변경: outdated 주석 제거 + R12+ count IPC 신설
  - `src/main/autonomy/autonomy-gate.ts` — F6 변경: outdated i18n 주석 제거
  - `src/main/database/connection.ts` — F5 변경: busy_timeout 5000 → DB_BUSY_TIMEOUT_MS 명명 상수
  - `src/main/ipc/handlers/cli-detect-handler.ts` — F5 변경: 5000ms 3곳 → CLI_DETECTION_TIMEOUT_MS
  - `src/main/providers/local/local-provider.ts` — F5 변경: 5000ms 2곳 → LOCAL_PROVIDER_TIMEOUT_MS
  - `src/main/providers/cli/cli-spawn.ts` + `cli-process.ts` — F5 변경: 3000ms KILL_GRACE 3곳 → KILL_GRACE_PERIOD_MS
  - `src/main/engine/consensus-machine.ts` + `session-state-machine.ts` — F5 변경: MAX_SNAPSHOTS 중복 제거
- Renderer 재사용:
  - `src/renderer/features/onboarding/OnboardingPage.tsx` — F1 변경: STAFF_CANDIDATES fallback 제거 + provider:detect 직접 표시
  - `src/renderer/features/onboarding/use-onboarding-state.ts` — F1 변경: refreshDetection 자동 mount + FALLBACK_STATE 삭제
  - `src/renderer/features/dashboard/InsightStrip.tsx` — F3 변경: stream aggregate IPC 또는 surface hide
  - `src/renderer/features/dashboard/DashboardPage.tsx` — F3 변경: noop → MeetingOrchestrator IPC
  - `src/renderer/features/dashboard/HeroQuickActions.tsx` — F3 변경: 동일 IPC
  - `src/renderer/features/messenger/TypingIndicator.tsx` — F3 변경: stream:typing-status IPC 또는 hide
  - `src/renderer/hooks/use-channel-messages.ts` — F3 변경: 'user' 리터럴 → 실 user identity
  - `src/renderer/hooks/use-channel-members.ts` — F2 변경: 채널 미발견 → throw 또는 명시 null
  - `src/renderer/features/settings/tabs/AutonomyDefaultsTab.tsx` — F2 변경: summary undefined 시 error UI 일원화
  - `src/renderer/features/approvals/ApprovalInboxView.tsx` — F6 변경: count IPC wiring (R12+ defer 해제)
  - `src/renderer/components/shell/NavRail.tsx` + `ProjectRail.tsx` — F5 변경: aria-label t() 적용
  - `src/renderer/features/onboarding/OBSummaryStrip.tsx` — F5 변경: 한글 3개 t() 적용
- Renderer 신규 파일:
  - `src/renderer/features/dashboard/use-dashboard-insights.ts` — F3 stream aggregate hook (또는 surface hide 결정 시 미생성)
  - `src/renderer/features/onboarding/use-detection-snapshot.ts` — F1 detection 자동 mount + 빈 결과 차단
- Main 신규 파일:
  - `src/main/ipc/handlers/dashboard-handler.ts` — F3 stream aggregate IPC (또는 surface hide 결정 시 미생성)
  - `src/main/ipc/handlers/approval-count-handler.ts` — F6 service-level count query
- Shared 신규 파일:
  - `src/shared/timeouts.ts` — F5 모든 ms 리터럴 명명 상수 단일 진실원
  - `src/shared/dashboard-types.ts` — F3 insight payload 타입 (생성 결정 시)
- Removed:
  - `src/renderer/features/onboarding/onboarding-data.ts` — F1 STAFF_CANDIDATES 모듈 자체 삭제 (또는 빈 default export 만 유지하고 deprecated 표기)
  - `src/main/files/permission-revocation-listener.ts` 의 `@ts-expect-error R2-Task21` 7건 — F6 결정에 따라 모듈 삭제 또는 R2-Task21 실행

---

## Audit Findings (전수조사 결과 — 2026-04-27)

### 종합 등급 요약

| 카테고리 | Critical | High | Medium | Low | 비고 |
|---|---:|---:|---:|---:|---|
| 1. Mock/fixture/stub/placeholder/demo | 7 | 2 | 1 | 0 | 메모리 1차 조사 확인 + [NEW] CLI_DEFAULT_CAPABILITIES |
| 2. Silent fallback masking missing data | 3 | 5 | 2 | 0 | model-registry.ts 3 spot 가장 위험 |
| 3. Red-flag deferral comments | 2 | 2 | 3+ | 0 | R6/R12+ 약속 미이행 표면 |
| 4. 환경 의존 하드코딩 | 3 | 3 | 2 | 1 | Ollama/CORS/원격 바인드 |
| 5. UI 문자열 i18n 우회 | 0 | 2 | 14 | 0 | aria-label + remote-web-client 11건 |
| 6. 아키텍처 경계 위반 | 0 | 0 | 0 | 0 | **PASS** — 7개 규칙 전부 준수 |
| 7. 매직넘버 + 코드스멜 | 0 | 5 | 7 | 2 | 타임아웃 5s/3s 산재 |
| **합계** | **15** | **19** | **29+** | **3** | |

---

### Cat 1 — Mock/fixture/stub/placeholder/demo (Critical 7, High 2, Medium 1)

**Critical:**

| # | 파일:라인 | 내용 |
|---|---|---|
| C1-01 | `src/renderer/features/onboarding/onboarding-data.ts:50–117` | `STAFF_CANDIDATES` 6 provider 하드코딩 fixture (Claude/Gemini/Codex/Copilot/Ollama/Grok) — Step2 staff-grid 직접 노출 |
| C1-02 | `src/renderer/features/onboarding/OnboardingPage.tsx:106,108,114,116,136` | staff undefined 시 `STAFF_CANDIDATES` 로 silent fallback (`if (!staff) return STAFF_CANDIDATES;`) |
| C1-03 | `src/renderer/features/onboarding/use-onboarding-state.ts:45–50` | `FALLBACK_STATE` (completed=false, currentStep=1) — IPC 실패 시 무음 fallback |
| C1-04 | `src/main/ipc/handlers/onboarding-handler.ts:101,106–119` | `CLI_TO_PROVIDER_ID` 맵 + `CLI_DEFAULT_CAPABILITIES = ['streaming','summarize']` 하드코딩 [NEW] — registry 미경유 |
| C1-05 | `src/renderer/features/dashboard/InsightStrip.tsx:6–15` | 4-cell insight strip 전체 em-dash placeholder. R6 약속 완료 후에도 stream aggregate 미연결 |
| C1-06 | `src/renderer/features/dashboard/DashboardPage.tsx:25,53–59` | 회의 시작 핸들러 = `noop()`. 사용자 클릭 무반응 |
| C1-07 | `src/renderer/hooks/use-channel-messages.ts:170–221` | optimistic message `authorId: 'user'` 리터럴. 실 사용자 식별자 미사용 |

**High:**

| # | 파일:라인 | 내용 |
|---|---|---|
| C1-08 | `src/main/meetings/engine/meeting-minutes-composer.ts:64,76–88` | `DEFAULT_LABELS` 한글 13개 하드코딩 (회의/참여자/주제/투표 등) — i18n 우회 |
| C1-09 | `src/renderer/features/dashboard/HeroQuickActions.tsx:9` + `src/renderer/features/messenger/TypingIndicator.tsx:2–7` | "R4 contract" / "R6 wires" placeholder — 실 데이터 미연결 |

**Medium:**

| # | 파일:라인 | 내용 |
|---|---|---|
| C1-10 | `src/main/streams/stream-bridge.ts:293–295` | smoke-wire R2 legacy `stream:queue-progress` 경로 production 잔류 |

---

### Cat 2 — Silent fallback (Critical 3, High 5, Medium 2)

**Critical:**

| # | 파일:라인 | 내용 |
|---|---|---|
| C2-01 | `src/main/providers/model-registry.ts:123` | `if (res.status === 401 || res.status === 403) return [];` — API 인증 실패가 빈 모델 목록으로 위장 |
| C2-02 | `src/main/providers/model-registry.ts:155,177–181` | `if (!res.ok) return []` + JSON parse 실패 swallow → 서비스 부재가 설정 누락처럼 보임 |
| C2-03 | `src/main/providers/model-registry.ts:240–252` | API 키 존재해도 fetch 실패 시 빈 배열 — 사용자가 키 입력했는데 무음 실패 |

**High:**

| # | 파일:라인 | 내용 |
|---|---|---|
| C2-04 | `src/main/config/settings-store.ts:115,121,127` | 파일 없음/JSON 손상/non-object → `{}` (default 병합 의도이나 손상 케이스 무음) |
| C2-05 | `src/main/remote/remote-handlers.ts:134–157` | FTS 검색 빈 쿼리/escape 실패/DB catch → `[]` — DB 오류가 검색 결과 없음으로 위장 |
| C2-06 | `src/renderer/hooks/use-channel-members.ts:44` | 채널 미발견 → `[]` (D6 주석 있으나 IPC 계층 구분 불가) |
| C2-07 | `src/renderer/features/settings/tabs/AutonomyDefaultsTab.tsx:173` | summary 없으면 `[]` — error UI 별도 존재하나 데이터 0과 로드실패 혼동 가능 |
| C2-08 | `src/main/remote/remote-web-client.ts:212,252,275` | API 응답 필드 `|| []` — Zod 스키마 검증 부재 |

**Medium (정당한 swallow — 유지 권고):**

| # | 파일:라인 | 내용 |
|---|---|---|
| C2-09 | `src/main/approvals/approval-service.ts:236,252` | retire race swallow — 주석으로 의도 명시. 유지 |
| C2-10 | `src/main/providers/cli/shell-env.ts:74` | shell-env 패키지 로드 실패 → `{}` + console.warn — 유지 |

---

### Cat 3 — Red-flag deferral comments (Critical 2, High 2, Medium 3+)

**Critical:**

| # | 파일:라인 | 내용 |
|---|---|---|
| C3-01 | `src/renderer/features/onboarding/onboarding-data.ts:10–12` | "Real provider detection wires up in R12+" — R11 closeout 후에도 미이행 |
| C3-02 | `src/renderer/features/dashboard/InsightStrip.tsx:6–7` | "Real stream aggregates land in R6" — R6 완료 후에도 stream 미연결 (C1-05 와 동일) |

**High:**

| # | 파일:라인 | 내용 |
|---|---|---|
| C3-03 | `src/renderer/features/approvals/ApprovalInboxView.tsx:176` | "R12+ work" — approved/rejected count 항상 0 |
| C3-04 | `src/main/streams/stream-bridge.ts:294` | smoke-wire R2 legacy (C1-10 과 동일) |

**Medium:**

| # | 파일:라인 | 내용 |
|---|---|---|
| C3-05 | `src/main/approvals/approval-service.ts:9` | "stream-bridge; until then EventEmitter is authoritative" — outdated |
| C3-06 | `src/main/autonomy/autonomy-gate.ts:42` | "i18n dictionary lookups; until then strings are stable" — outdated |
| C3-07 | `src/main/files/permission-revocation-listener.ts:10,56,66,76,84,93,104` | `@ts-expect-error R2-Task21` 7건 — Task21 미실행 |

---

### Cat 4 — 환경 의존 하드코딩 (Critical 3, High 3, Medium 2, Low 1)

**Critical:**

| # | 파일:라인 | 내용 |
|---|---|---|
| C4-01 | `src/main/remote/remote-server.ts:399` | `Access-Control-Allow-Origin: https://127.0.0.1:${port}` 고정 — Tailscale CGNAT 환경 차단 |
| C4-02 | `src/main/providers/model-registry.ts:223,255` | `'http://localhost:11434'` 2곳 — Docker/원격/다른 포트 Ollama 미지원 |
| C4-03 | `src/main/remote/remote-server.ts:165` | URL 폴백 `'localhost'` — 원격 호스트 헤더 누락 시 라우팅 실패 |

**High:**

| # | 파일:라인 | 내용 |
|---|---|---|
| C4-04 | `src/main/remote/remote-server.ts:64` | bind host default `'127.0.0.1'` — config 우회 |
| C4-05 | `src/main/remote/remote-manager.ts:167` | policy fallback `'127.0.0.1'` 동일 패턴 |
| C4-06 | `src/main/files/workspace-service.ts:23–26` | `'C:\\Windows'`, `'C:\\Program Files'` 등 절대경로 리터럴 — 비영어 Windows/리눅스 미고려 |

**Medium:**

| # | 파일:라인 | 내용 |
|---|---|---|
| C4-07 | `src/shared/remote-types.ts:38` | `directAccessPort: 8443` 고정 — 포트 충돌 시 시작 실패 |
| C4-08 | `src/main/providers/model-registry.ts:43–49` | API endpoint URL 3개 (`api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com`) 고정 — 자체호스팅/프록시 미지원 |
| C4-09 | `src/main/arena/arena-root-service.ts:71` | `'Documents'` 리터럴 — 다국어 Windows (`내 문서`, `ドキュメント`) 미지원 → `app.getPath('documents')` 사용 권장 |

**Low:**

| # | 파일:라인 | 내용 |
|---|---|---|
| C4-10 | `src/main/remote/remote-server.ts:409` | `MAX_BODY_SIZE = 1_048_576` 1MB 고정 — 보안 정책으로 의도적일 수 있으나 settings 권장 |

---

### Cat 5 — UI 문자열 i18n 우회 (High 2, Medium 14)

**High:**

| # | 파일:라인 | 내용 |
|---|---|---|
| C5-01 | `src/renderer/components/shell/NavRail.tsx:24` | `aria-label="primary navigation"` 하드코딩 — eslint-plugin-i18next 미감지 |
| C5-02 | `src/renderer/components/shell/ProjectRail.tsx:50` | `aria-label="project rail"` 하드코딩 |

**Medium:**

| # | 파일:라인 | 내용 |
|---|---|---|
| C5-03 | `src/renderer/features/onboarding/OBSummaryStrip.tsx:58–64` | 한글 레이블 3개 (`선택`, `감지`, `대안`) |
| C5-04~14 | `src/main/remote/remote-web-client.ts:139,141,155,157,170,171,173,174,177,186,190,191` | HTML 템플릿 리터럴 한글 11개 (`토큰 입력...`, `연결`, `불러오는 중...`, `대화가 없습니다.`, `검색어 입력...`, `검색`, `검색 중...`, `검색 결과가 없습니다.`, `관련도:`, `로그아웃`, `대화`, `메모리`) — main-process i18n 사전 부재 |

---

### Cat 6 — 아키텍처 경계 (PASS)

7개 규칙 전부 준수: typedInvoke 제네릭 + ipcMain.handle router 중앙화 + execFile shell:false + secret-store safeStorage + maskSecrets 로그 마스킹 + 014 forward-only 마이그레이션 + preload→shared만. 회귀 방지에 집중.

---

### Cat 7 — 매직넘버 + 코드스멜 (High 5, Medium 7, Low 2)

**High:**

| # | 파일:라인 | 내용 |
|---|---|---|
| C7-01 | `src/main/providers/model-registry.ts:99,149,173` | `setTimeout 5000` 3곳 + `3000` 1곳 산재 |
| C7-02 | `src/main/database/connection.ts:103` | `busy_timeout = 5000` 리터럴 |
| C7-03 | `src/main/ipc/handlers/cli-detect-handler.ts:80,120,140` | `{ timeout: 5000 }` 3곳 반복 |
| C7-04 | `src/main/providers/local/local-provider.ts:62,68` | `AbortSignal.timeout(5000)` 2곳 |
| C7-05 | `src/main/config/config-service.ts:114` | `as unknown as SettingsConfig[K]` 의도 불명확 |

**Medium:**

| # | 파일:라인 | 내용 |
|---|---|---|
| C7-06 | `src/main/meetings/engine/meeting-orchestrator.ts:70,78` | `INTER_TURN_DELAY_MS=2000` + `CONSENSUS_DECISION_TIMEOUT_MS=24h` — approval-service.ts:163 과 중복 |
| C7-07 | `src/main/providers/cli/cli-spawn.ts:48,112` + `cli-process.ts:229` | `KILL_GRACE 3000` 3곳 중복 |
| C7-08 | `src/main/engine/consensus-machine.ts:104` + `session-state-machine.ts:106` | `MAX_SNAPSHOTS=100` 중복 |
| C7-09 | `src/main/config/settings-store.ts:83–100` | `as unknown as` 체인 |
| C7-10 | `src/main/approvals/approval-service.ts:327,440 등 20+곳` | `// TODO R2-log: swap console.warn for structured logger` |
| C7-11 | `src/main/files/permission-revocation-listener.ts:10,56,66,76,84,93,104` | `@ts-expect-error` 7건 (C3-07 와 동일) |
| C7-12 | `src/main/ipc/router.ts:282,485` | `registeredChannels.length = 0` 2곳 중복 |

**Low:**

| # | 파일:라인 | 내용 |
|---|---|---|
| C7-13 | `src/main/providers/model-registry.ts:5–40` | `CLI_MODELS` vs `API_MODELS_FALLBACK` 명명 일관성 |

---

## Cleanup Phases (F1~F6)

> **For agentic workers:** F1 → F2 → F4 → F3 → F5 → F6 순서 권장 (의존 + 위험도). 각 phase 단일 commit + 게이트 (typecheck + lint + test + i18n:check + theme:check) + 메모리 갱신.

### F1 — Onboarding 진짜 등록 흐름 (P0, Critical 7건)

**Goal:** STAFF_CANDIDATES + 모든 fixture fallback 제거, wizard 가 `provider:detect` 결과만 사용해 staff-grid 렌더, finish 시 `provider:add` 자동 호출.

**Tasks:**

- [ ] **F1-Task1** — `STAFF_CANDIDATES` (`onboarding-data.ts:50`) + `mergeStaffSelection` fixture fallback 전부 삭제. 컴파일 에러를 신호로 호출 경로 전수 정리. `OnboardingPage.tsx:106,108,114,116,136` 의 모든 fallback 라인 삭제.
- [ ] **F1-Task2** — `useOnboardingState.refreshDetection` 자동 mount 호출 추가. Step2 진입 시 `provider:detect` 결과로 카드 직접 렌더.
- [ ] **F1-Task3** — detection 빈 결과 시 Step2 진행 차단 + 명시 메시지: *"감지된 CLI 가 없습니다. Settings → CLI 탭에서 직접 추가하세요."* + Settings 로 보내는 버튼.
- [ ] **F1-Task4** — Step5 finish 훅 (`App.tsx:189` 인근) 이 selected detection 결과에 대해 `provider:add` 자동 호출. CLI provider = detection 의 binary path, Local = wizard 입력 endpoint, API provider = ApiKeysTab 위임 (별도 step 추가 또는 wizard 외 처리).
- [ ] **F1-Task5** — `CLI_TO_PROVIDER_ID` (`onboarding-handler.ts:106`) + `CLI_DEFAULT_CAPABILITIES` (`onboarding-handler.ts:119`) 삭제 → `ProviderRegistry` 가 단일 진실원. capability 추론 로직을 registry 로 이전.
- [ ] **F1-Task6** — `FALLBACK_STATE` (`use-onboarding-state.ts:45`) 삭제. IPC 실패 시 명시 에러 + ErrorBoundary.
- [ ] **F1-Task7** — Test 갱신: onboarding-handler.test, use-onboarding-state.test, OnboardingPage.test, e2e onboarding flow.

**Acceptance:** typecheck exit 0, test green, i18n:check idempotent, dev 빌드에서 wizard 진입 시 실 detection 결과 표시 확인 + finish 후 메신저 멤버 패널이 detected provider 들로 채워짐 확인.

---

### F2 — Silent fallback throw 전환 (P0, Critical 3 + High 5)

**Goal:** missing data/service/config 를 사용자에게 숨기던 8 spot 을 모두 명시 specific Error throw 로 전환.

**Tasks:**

- [ ] **F2-Task1** — `model-registry.ts:123,155,177–181,240–252` 의 3 spot 에서 specific Error throw (각각 `ModelRegistryAuthError` / `ModelRegistryNetworkError` / `ModelRegistryParseError`) + 호출자에서 사용자 노출 (Settings.ApiKeysTab error UI / ProviderTab error 배너).
- [ ] **F2-Task2** — `settings-store.ts:115,121,127` 손상 케이스 사용자 경고 surface (백업 파일 생성 + recover prompt). 빈 객체 default 병합은 파일 부재 시에만 유지.
- [ ] **F2-Task3** — `remote-handlers.ts:134–157` FTS DB catch → IPC 응답 `{ ok: false, code: 'FTS_DB_ERROR' }` 로 전환. renderer 가 에러 코드 보고 error UI 표시.
- [ ] **F2-Task4** — `use-channel-members.ts:44` 채널 미발견 → throw + 호출자 hook 이 ErrorBoundary 로 처리. D6 주석 갱신.
- [ ] **F2-Task5** — `AutonomyDefaultsTab.tsx:173` summary undefined 시 error UI 일원화. 빈 배열 fallback 제거.
- [ ] **F2-Task6** — `remote-web-client.ts:212,252,275` API 응답 Zod 스키마 추가 + 검증 실패 시 명시 에러.
- [ ] **F2-Task7** — Test 갱신: model-registry.test (인증 실패 / 네트워크 / 파싱), remote-handlers.test, use-channel-members.test.

**Acceptance:** typecheck/test green, dev 빌드에서 잘못된 API 키 입력 시 명시 에러 메시지 노출 확인 + 네트워크 차단 시 사용자에게 명시 에러 노출 확인.

---

### F3 — Dashboard 표면 진짜 데이터 (P1, Critical 3)

**Goal:** Dashboard placeholder 4 표면 모두 실 데이터 IPC 또는 surface hide 결정 + 'user' 리터럴 제거.

**Tasks:**

- [ ] **F3-Task1** — `InsightStrip.tsx` stream aggregate IPC (`dashboard:insights`) 신설 — meeting count / member status / queue depth / pending approval count 4 cell 계산. **또는 surface hide** (사용자 결정 의존). 권장: 신설 — R6 약속 이행.
- [ ] **F3-Task2** — `DashboardPage.tsx:53` 회의 시작 핸들러 `MeetingOrchestrator.start` IPC 연결. noop 제거.
- [ ] **F3-Task3** — `HeroQuickActions.tsx` 동일 IPC 적용.
- [ ] **F3-Task4** — `TypingIndicator.tsx` `stream:typing-status` IPC 연결 또는 surface hide. 권장: hide (V4 풍부화 항목과 정합).
- [ ] **F3-Task5** — `use-channel-messages.ts:170–221` `'user'` 리터럴 제거 → ProjectMember 또는 auth context 에서 실 ID 조회.
- [ ] **F3-Task6** — Test 갱신: dashboard.test, hero-quick-actions.test, use-channel-messages.test.

**Acceptance:** typecheck/test green, dev 빌드에서 dashboard 4-cell 이 실 값 (또는 hide), 회의 시작 버튼 클릭 시 실제 회의 생성 확인.

---

### F4 — 환경 하드코딩 settings 화 (P1, Critical 3 + High 3)

**Goal:** Ollama endpoint / CORS host / remote bind / Windows 절대경로 / 'Documents' 리터럴 모두 settings + Electron API + env var 우선순위 통일.

**Tasks:**

- [ ] **F4-Task1** — `settings.ollama.endpoint` 신규 setting key + onboarding wizard 입력 폼 추가 + `OLLAMA_HOST` env var 우선순위 (settings → env → fallback).
- [ ] **F4-Task2** — `model-registry.ts:223,255` 2곳 모두 settings 우선순위 적용.
- [ ] **F4-Task3** — `remote-server.ts:399` CORS 헤더가 `this.host` 사용. default 는 `DEFAULT_REMOTE_POLICY.bindAddress`.
- [ ] **F4-Task4** — `remote-server.ts:64` + `remote-manager.ts:167` bindAddress fallback `DEFAULT_REMOTE_POLICY.bindAddress` 위임.
- [ ] **F4-Task5** — `remote-server.ts:165` URL 폴백 `this.host` 사용.
- [ ] **F4-Task6** — `arena-root-service.ts:71` `'Documents'` 리터럴 → `app.getPath('documents')` 전환.
- [ ] **F4-Task7** — `workspace-service.ts:23–26` Windows 시스템 경로 → `process.env.SystemRoot` / `process.env.ProgramFiles` / `process.env['ProgramFiles(x86)']` 동적 조회. Linux 환경에서는 / 시스템 경로 검증 추가.
- [ ] **F4-Task8** — `remote-types.ts:38` `directAccessPort 8443`, `remote-server.ts:409` `MAX_BODY_SIZE 1MB`, `model-registry.ts:43–49` API endpoint URL 3개 모두 settings 또는 dynamic 으로 이동.
- [ ] **F4-Task9** — Test 갱신: model-registry.test, remote-server.test, arena-root-service.test, workspace-service.test (다국어 Windows 시뮬레이션 + Tailscale 시뮬레이션).

**Acceptance:** typecheck/test green, dev 빌드에서 Ollama 다른 포트 설정 시 정상 동작 + Tailscale 환경 시뮬레이션 (mock host) 시 CORS 통과 확인.

---

### F5 — i18n + 매직넘버 정리 (P2, High 7 + Medium 18)

**Goal:** aria-label / OBSummaryStrip / remote-web-client / meeting-minutes-composer 의 i18n 우회 모두 t() 또는 NotificationDictionary 패턴 적용 + 매직넘버 산재 단일 진실원화.

**Tasks:**

- [ ] **F5-Task1** — `NavRail.tsx:24` + `ProjectRail.tsx:50` `aria-label` `t()` 적용 + `shell.nav.ariaLabel` / `shell.rail.ariaLabel` 키 ko/en JSON 동시 갱신.
- [ ] **F5-Task2** — eslint-plugin-i18next 규칙 강화 — aria-label / placeholder / title / alt 도 감지하도록.
- [ ] **F5-Task3** — `OBSummaryStrip.tsx:58–64` 한글 3개 → `onboarding.summary.{selected,detected,alternative}` 키.
- [ ] **F5-Task4** — `remote-web-client.ts` HTML 템플릿 리터럴 11개 → main-process i18n 사전 (locale 인자 받아 dictionary lookup) 또는 렌더러 사전 직렬화 주입.
- [ ] **F5-Task5** — `meeting-minutes-composer.ts:76–88` `DEFAULT_LABELS` → NotificationDictionary 패턴 적용. R6 약속 이행.
- [ ] **F5-Task6** — `src/shared/timeouts.ts` 신설 — 모든 명명 상수 단일 진실원:
  - `MODEL_REGISTRY_FETCH_TIMEOUT_MS = 5000`
  - `DB_BUSY_TIMEOUT_MS = 5000`
  - `CLI_DETECTION_TIMEOUT_MS = 5000`
  - `LOCAL_PROVIDER_TIMEOUT_MS = 5000`
  - `KILL_GRACE_PERIOD_MS = 3000`
  - `INTER_TURN_DELAY_MS = 2000` (orchestrator 와 통합)
  - `CONSENSUS_DECISION_TTL_MS = 24 * 60 * 60 * 1000` (orchestrator + approval-service 통합)
- [ ] **F5-Task7** — `consensus-machine.ts:104` + `session-state-machine.ts:106` `MAX_SNAPSHOTS` 공통 상수 추출 → `src/main/engine/state-machine-config.ts` 또는 `src/shared/`.
- [ ] **F5-Task8** — `approval-service.ts` `TODO R2-log` 20+건 일괄 structured logger 마이그레이션.
- [ ] **F5-Task9** — `config-service.ts:114` + `settings-store.ts:83–100` `as unknown as` 체인 — generic signature 개선 또는 zod validation 추가.
- [ ] **F5-Task10** — Test 갱신: i18n parity (`npm run i18n:check`), shell.test, OBSummaryStrip.test, remote-web-client.test, meeting-minutes-composer.test.

**Acceptance:** typecheck/test green, i18n:check idempotent, eslint regression 0, theme:check 0 hit.

---

### F6 — Red-flag 주석 + 기술부채 청소 (P2, Medium 5+)

**Goal:** outdated 주석 제거 + R12+ defer 해제 + smoke-wire legacy 제거 + @ts-expect-error 정리.

**Tasks:**

- [ ] **F6-Task1** — `ApprovalInboxView.tsx:176` count IPC 신설 (`approval:count` service-level query) + approved/rejected 탭 count wiring. R12+ defer 해제.
- [ ] **F6-Task2** — `stream-bridge.ts:294` smoke-wire R2 legacy `stream:queue-progress` 경로 제거. smoke 픽스처 (r2-integration-smoke) 새 경로로 마이그레이션.
- [ ] **F6-Task3** — `approval-service.ts:9` outdated 주석 제거 (또는 현재 상태 반영).
- [ ] **F6-Task4** — `autonomy-gate.ts:42` outdated 주석 제거 (F5 에서 i18n 적용 완료 후).
- [ ] **F6-Task5** — `onboarding-data.ts:10–12` 주석 — F1 에서 모듈 자체 삭제로 자동 처리.
- [ ] **F6-Task6** — `permission-revocation-listener.ts` `@ts-expect-error R2-Task21` 7건 — Task21 실행 (포팅) 또는 모듈 자체 삭제 결정. 모듈이 SSM permission action 과 연결되어 있는지 grep 으로 검증 후 결정.
- [ ] **F6-Task7** — `router.ts:282,485` `registeredChannels.length = 0` 2곳 → `clearChannelRegistry()` 헬퍼 추출.
- [ ] **F6-Task8** — Test 갱신: approval-inbox.test, stream-bridge.test, permission-revocation.test (또는 삭제).

**Acceptance:** typecheck/test green, lint 0 baseline 유지, dev 빌드에서 approval 탭 count 정확성 확인.

---

## Decision Log (예약 — phase 진행 시 갱신)

- **D1** — F3-Task1: InsightStrip 신설 vs hide → 신설 권장 (R6 약속 이행). 사용자 sign-off 시 결정.
- **D2** — F3-Task4: TypingIndicator hide vs stream:typing-status 신설 → hide 권장 (V4 풍부화 항목과 정합).
- **D3** — F4-Task7: Linux 환경 시스템 경로 검증 추가 여부 → 추가 권장 (공개용).
- **D4** — F4-Task8: API endpoint URL 3개를 settings 신설 vs 동적 → settings 권장 (자체호스팅 사용자 지원).
- **D5** — F5-Task4: remote-web-client i18n 패턴 → 렌더러 사전 직렬화 주입 vs main-process 사전. 후자 권장 (NotificationDictionary 와 정합).
- **D6** — F6-Task6: permission-revocation-listener Task21 실행 vs 모듈 삭제 → SSM 연결 확인 후 결정.

---

## Cross-References

- 메모리: `~/.claude/projects/-mnt-d-Taniar-Documents-Git-AI-Chat-Arena/memory/rolestra-r11-mock-fallback-debt.md` (본 plan 의 트리거 + 옵션 2 청사진)
- 메모리: `~/.claude/projects/-mnt-d-Taniar-Documents-Git-AI-Chat-Arena/memory/rolestra-audit-2026-04-27.md` (본 plan 의 보고서 형식 정리)
- 전역 CLAUDE.md: `~/.claude/CLAUDE.md` § ABSOLUTE PROHIBITIONS — Mock data and fallbacks
- 프로젝트 CLAUDE.md: `/mnt/d/Taniar/Documents/Git/AI_Chat_Arena/CLAUDE.md` § 절대 위반 금지 규칙
- 코딩 규칙: `docs/코딩-규칙.md` § 7 i18n/UI + § 5 실행/권한 + § 8 에러/로그 + § 10 금지 사항
- ADR: `docs/아키텍처-결정-기록/cross-cutting.md` (C3 ExecutionService + C4 IPC + C5 secrets + C6 path-guard 와 정합)

---

## Out of Scope (V4 / R12+ 이연)

- DM read receipt / typing indicator / 파일 첨부 / 음성 메모 / 플러그인 시스템 / ComfyUI/SD 연동 — V4
- macOS 코드 사인 / Windows 코드 사인 / AutoUpdate / Sentry / Localization 추가 (ja/zh-CN) / Memory Phase 3-b — R12+
- design polish 라운드 3+ (Hero strip 통합 / InsightStrip footer / Queue 6-column / Onboarding step 3-5 시안 풍부화) — V4 (단, F3 InsightStrip 신설은 본 cleanup 범위)
- Playwright OS matrix 33 cell sign-off / 12 native 스크린샷 / brand identity — R11 sign-off 의 packaging 영역 (별도 진행)
