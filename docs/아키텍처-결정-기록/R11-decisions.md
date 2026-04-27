# R11 결정 기록

R11 (레거시 청소 + 첫 사용자 출시) 단계의 D1~D9. R10 까지 "쓸 수 있는 v3" 위에서 (i) v2 레거시 청소 (ii) Onboarding wizard 정식 (iii) Approvals 상세 패널 (iv) Windows/macOS/Linux 패키징 (v) 사용자 문서 v3 전면 재작성 — 6 축을 완성하여 첫 사용자 출시 phase 종료.

---

## D1. `_legacy/` 일괄 삭제 vs v2 engine 분리 = 두 단계로 분리

**결정:**
- Task 1 = `_legacy/` 단일 commit (752 KB 완전 삭제, 110 파일)
- Task 2 = v2 engine 6 파일 + 7 `@ts-nocheck` 파일 + 27 LEGACY_V2_CHANNELS — import grep 후 단계 삭제, 별도 commit

**왜:**
1. `_legacy/` 는 src/ import 0 (R10 까지 검증) — 위험 0
2. v2 engine 은 src/main/engine 안에 있어서 기존 import 끊겼는지 grep 검증 필수
3. 두 단계 분리 시 회귀 발생 시 bisect 용이 (Task 1 → Task 2 step 별 회귀 추적)

**대안:** 한 commit 으로 묶기 — 각하 (회귀 추적 어려움).

**산출:** Task 1 commit `7970b40` (_legacy/ 일괄 삭제) + Task 2 commit `332955a` (engine + nocheck + 27 v2 IPC 청소).

---

## D2. 패키징 = `electron-builder` 채택 (electron-forge 미채택)

**결정:** `electron-builder` 단일 채택. Windows NSIS / macOS dmg unsigned / Linux AppImage 모두 한 도구로.

- `electron-builder.yml` (appId io.rolestra.app + 3 OS target + asar + npmRebuild + asarUnpack:**/*.node)
- `package.json` scripts 4: `package`, `package:win`, `package:mac`, `package:linux`
- `assets/icon.{png,ico,icns}` placeholder + `tools/assets/build-icons.mjs` (procedural draw + png2icons)
- `.github/workflows/release.yml` — push tag `v*` + workflow_dispatch, 3 OS matrix
- macOS dmg = unsigned (R12+ 코드 사인 + 공증 명시), Gatekeeper 우회 안내 docs (`docs/디자인/패키징.md`)

**왜:**
1. TS/React 친화 + 광범위 OS 지원
2. electron-forge 는 plugin 생태계 의존성 큼 + makers/publishers 명시 필요
3. AutoUpdate (R12+) 도 electron-updater 와 자연 연동
4. R10 design polish 라운드 2 결과 single source 패턴이 builder 와 자연 일치

**대안:** electron-forge — 각하 (단순 패키징에 무거움). Tauri / Neutralino — 각하 (Electron native 모듈 호환성).

**산출:** Task 12 commit `e00febb`. `npm run package:linux` 로컬 검증 — `dist/electron/Rolestra-0.1.0-linux-x86_64.AppImage` (117 MB).

---

## D3. Onboarding step 영구화 = 신규 마이그레이션 013 (settings 합치기 안 함)

**결정:** 신규 테이블 `onboarding_state` 단일 row (`CHECK id=1` + `current_step BETWEEN 1 AND 5` + `completed IN (0,1)` + `selections_json TEXT DEFAULT '{}'` + `updated_at INTEGER`). settings 테이블에 합치지 않음.

- `IF NOT EXISTS` defence-in-depth 로 idempotent
- single-row prepared statements + `OnboardingStateCorruptError` 로 깨진 JSON blob 명시 감지

**왜:**
1. Onboarding 은 진행 중 종료 시 step 복귀 필요 — 기록 단위가 settings 과 다름
2. 향후 onboarding 변경 (step 추가/제거) 시 마이그레이션 가능
3. 단일 row + CHECK (id=1) 로 schema 단순

**대안:** settings json 컬럼 — 각하 (스키마 검증 어려움).

**산출:** Task 6 commit `a5aff8c`. `src/main/database/migrations/013-onboarding-state.ts` + OnboardingService + OnboardingStateRepository + 4 IPC handler + 5-step wizard.

---

## D4. LLM 비용 audit log = append-only 014 마이그레이션 (R11 두 번째 forward-only)

**결정:** 신규 테이블 `llm_cost_audit_log` append-only — `id AUTOINCREMENT` / `meeting_id` nullable / `provider_id NOT NULL` / `token_in token_out CHECK >= 0` / `created_at` + 2 인덱스 (provider + meeting). R10 의 `circuit_breaker_state` (D10) 와 같은 forward-only 패턴.

- LlmCostRepository — `append → entry 반환` + `summarize byProvider 토큰 sum 정렬` + `recent bounded 1..500` + `DEFAULT_PERIOD_DAYS=30`
- meeting-summary-service 가 `provider.consumeLastTokenUsage()` 호출 후 sink 주입 (best-effort warn)

**왜:**
1. audit 의 자연스러운 모델
2. summary 는 SUM query 로 충분
3. provider_id / meeting_id 인덱스로 group by 빠름

**대안:** in-memory 만 — 각하 (재시작 시 손실 — 사용자 비용 가시화 불가).

**산출:** Task 8 commit `fa9399b`. `014-llm-cost-audit-log.ts` + LlmCostService + `llm:cost-summary` IPC + AutonomyDefaultsTab LlmCostSection.

---

## D5. LLM 비용 추정 USD = 사용자 입력 단가 (자동 fetch X)

**결정:** AutonomyDefaultsTab 의 LLM 사용량 섹션은 토큰 정확 + USD = 사용자 입력 단가 × 토큰. R11 default 0 (사용자가 입력해야 USD 표시).

- `SettingsConfig.llmCostUsdPerMillionTokens` (default `{}`, deepMerge forward-compat)
- `getPriceMap` 매번 호출 — price 0/non-finite/missing 시 `estimatedUsd null`

**왜:**
1. provider 별 가격 자주 변경 — fetch 시 stale
2. Anthropic / OpenAI / Google 가격 API 표준 부재
3. 사용자가 자기 계약 단가 입력이 정확

**대안:** hardcoded 단가 — 각하 (stale risk).

---

## D6. Onboarding stream broadcast = 미도입 (단일 윈도우 가정)

**결정:** `stream:onboarding-state-changed` 미도입. Rolestra 는 단일 윈도우 (multi-window 향후 추가 시 재검토).

**왜:**
1. 단일 윈도우에서는 IPC sync 만으로 충분
2. zustand store 는 IPC 결과로 갱신
3. stream 추가는 over-engineering

**대안:** stream 추가 — 각하 (사용 시점 없음).

---

## D7. `pendingAdvisory` slot = in-memory only (DB 영속화 X)

**결정:** ProjectService.pendingAdvisory 는 in-memory state. 다음 회의까지만 유효, 앱 재시작 시 초기화.

- `Map<projectId, string>` slot
- `setPendingAdvisory(trim 후 빈 문자열 slot 삭제)` + `consumePendingAdvisory(read+delete 1회용)`
- ApprovalDecisionRouter ModeTransitionApplier 가 conditional + projectId + non-empty trim comment 시 setPendingAdvisory 호출
- ApprovalSystemMessageInjector filter — mode_transition explicit skip (Router/advisory slot 으로 라우팅)
- MeetingOrchestrator.run() 의 session.start() 직후 consumePendingAdvisory → non-null 시 messageService.append (system role)

**왜:**
1. advisory 의 lifetime 은 짧음 (다음 회의 1번)
2. 영속화하면 stale 위험
3. 사용자가 conditional 클릭 후 앱 재시작 시 재입력 자연

**대안:** DB 영속화 — 각하 (over-engineering + stale risk).

**산출:** Task 10 commit `7743f26`. R10 Known Concern #4 종결.

---

## D8. ADR 디렉토리 구조 = phase 별 묶음 (개별 ADR 파일 미채택)

**결정:** `docs/아키텍처-결정-기록/` 안에 phase 별 묶음 파일 6 개:
- `R1-R3-decisions.md`
- `R4-R6-decisions.md`
- `R7-R9-decisions.md`
- `R10-decisions.md`
- `R11-decisions.md` (본 문서)
- `cross-cutting.md`

개별 ADR 파일 (`ADR-001-IPC-typedInvoke.md` 등) 미채택. 기존 ADR-001/002/003 은 cross-cutting.md 의 C1/C2/C3 으로 흡수.

**왜:**
1. R1~R11 동안 80+ Decision 누적 — 개별 파일이면 80+ 파일, 탐색성 떨어짐
2. phase 별 묶음은 시기 컨텍스트 보존
3. cross-cutting (IPC / safeStorage / path-guard) 는 별도 1 파일로 phase 무관 invariant 명시

**대안:** 개별 ADR 파일 — 각하 (관리 비용 큼).

**산출:** Task 13 (본 문서). 6 묶음 ADR 파일 + README.md 인덱스.

---

## D9. Retro 영어 복귀 결정 (R10 Known Concern #5) = 한국어 유지 + locale 분기 옵션

**결정:** main-process 잔여 한국어 trace 라인은 dictionary 로 이전하되, default ko = 기존 한국어 / en = 영어 번역 (locale 분기). 사용자가 LanguageTab 에서 en 선택 시 영어로 표시.

- NotificationDictionary 23 신규 leaf — `approvalNotificationBridge.<6kind>.{title,body}` + `autonomyGate.label.<5kind>` + `autonomyGate.trace.{autoAccepted,downgraded}` + `autonomyGate.notify.{autoAcceptTitle,autoAcceptBody,errorTitle,errorBody}`
- ApprovalNotificationBridge — `KIND_LABELS Object.freeze` (한국어 fixed) 제거 → `KIND_BODY_BUILDERS` (payload-derived summary 만 합성, 빈 결과 null) + bridgeKey() helper 로 dictionary 해석
- AutonomyGate — `GateDecision.label` 을 `string` (한국어 literal) → `GateLabelKind | 'unknown'` + `rawKind: string`, locale-aware resolveLabel

**왜:**
1. R9 D8 결정 ("trace 라인은 한국어 고정") 의 보수성 유지
2. en locale 사용자 경험 개선
3. dictionary 패턴이 R10 에서 이미 land — 추가 노이즈 0

**대안:** 영어로 전면 복귀 — 각하 (R9 D8 번복은 사용자 결정 필요). 한국어 고정 — 각하 (en locale 사용자 곤란).

**사용자 sign-off:** 본 결정이 R11 Task 11 의 default 가정. 사용자가 다른 결정 시 D9 재기록 + Task 11 재실행.

**산출:** Task 11 commit `d02afdf`.

---

## R11 통합 영향 + 첫 사용자 출시 의미

R1~R11 은 "v2 (Python/FastAPI/Svelte) → v3 (Electron/TS/React/Rolestra) 재작성" 의 11 phase. R11 은 그 마지막 phase 이자 첫 사용자 출시 phase.

- D1 (legacy 청소 분리 commit) → bisect 안전한 회귀 추적
- D2 (electron-builder) → Windows installer + macOS dmg + Linux AppImage 단일 도구
- D3 + D4 (마이그레이션 013/014) → onboarding 영구화 + LLM 비용 audit (R10 D7 종결)
- D5 (USD 사용자 입력) → 가격 stale 회피
- D6 (onboarding stream X) → 단일 윈도우 가정 명시
- D7 (advisory in-memory) → R10 Known Concern #4 종결
- D8 (ADR 묶음) → 80+ Decision 의 탐색성 확보
- D9 (locale 분기) → R10 Known Concern #5 종결, en locale 사용자 정식 지원

R11 종료 후 V4 (사용자 출시 후 차기 메이저) — DM 풍부화 / 음성 메모 / 플러그인 / ComfyUI / Hero strip / Onboarding 시안 풍부화 등.

R12+ (출시 후 인프라/보안) — macOS 코드 사인 + 공증 / Windows 코드 사인 / AutoUpdate / Remote Access v3 재설계 / Memory Phase 3-b (임베딩 + 하이브리드).
