# Rolestra v3

Electron + TypeScript + React 기반 멀티 AI 직원 / 합의 / 자율 작업 데스크톱 애플리케이션.
기존 Python/FastAPI/Svelte 프로젝트 (`AI_Chat`, AI Chat Arena v2) 의 11-phase v3 재작성.

R11 종료 시점에 v0.1.0 첫 사용자 출시 — Windows installer + macOS dmg + Linux AppImage 배포.

## 핵심 문서 (반드시 읽을 것)

| 문서 | 역할 |
|------|------|
| `docs/README.md` | 문서 폴더 정책 — 폴더별 용도 + 명명 규칙 (어디에 무엇을 두는가) |
| `docs/기능-정의서.md` | 기능 정의서 — Rolestra v3 메타포 + 11 phase 누적 기능 (무엇을 만드는가) |
| `docs/설계-문서.md` | 설계 문서 — 4 layer 아키텍처 + 핵심 모듈 + 6 테마 + 패키징 (어떻게 만드는가) |
| `docs/코딩-규칙.md` | 코딩 규칙 (어떤 규칙을 지키는가) |
| `docs/완료-기준.md` | 완료 기준 (언제 끝난 것인가) |
| `docs/decisions/` | ADR — phase 별 묶음 + cross-cutting + R12 도메인별 (왜 이렇게 했는가) |
| `docs/구현-현황.md` | R1~R11 task 별 status + commit + V4/R12+ 이연 (무엇이 완료/미완료인가) |
| `docs/design/README.md` | 디자인 폴더 정식 — 6 테마 시안 + 형태 토큰 + 패키징 + 12 스크린샷 sign-off |
| `docs/specs/2026-04-18-rolestra-design.md` | 단일 권위 spec (134 KB, 11 phase 누적) |
| `docs/plans/2026-04-26-rolestra-phase-r11.md` | R11 진행 plan (1140 lines) |

## 기술 스택

- **Runtime**: Electron 40 (Chromium + Node 통합)
- **Language**: TypeScript strict (`noImplicitAny` 전체)
- **Frontend**: React 19 (Concurrent + Suspense) + Tailwind + Radix UI + framer-motion + react-i18next (ko default)
- **State**: Zustand (persist + project-scoped)
- **DB**: better-sqlite3 + FTS5 + WAL journal (014 마이그레이션 chain)
- **Build**: electron-vite (main + preload + renderer 3 entry)
- **Test**: Vitest (unit/integration) + Playwright Electron (E2E OS matrix 33 cell)
- **Lint**: ESLint strict + eslint-plugin-i18next
- **Package**: electron-builder (NSIS + dmg unsigned + AppImage)
- **Provider SDK**: @anthropic-ai/sdk + openai + cli spawn (api 4 + cli 3 + local 1 = 7)

## 프로젝트 구조

```
src/
  main/                    # Electron Main Process (백엔드)
    arena/                 # ArenaRootService (단일 디렉토리 + project resolution)
    projects/              # ProjectService (3 kind: new/external/imported + pendingAdvisory R11)
    channels/              # ChannelService (system/user/dm 통합)
    meetings/engine/       # MeetingOrchestrator + TurnManager + ConsensusStateMachine 12 state
    approvals/             # ApprovalService + 5 kind discriminated union + AutonomyGate 훅
    autonomy/              # AutonomyGate + CircuitBreaker (4 tripwire, persist R10)
    queue/                 # QueueService (drag-and-drop + meetingStarter)
    members/               # MemberProfileService + Warmup + PersonaBuilder
    execution/             # ExecutionService (dryRun → 승인 → atomic apply → rollback + dryRunPreview)
    files/                 # PathGuard + PermissionFlagBuilder (3 mode × 3 CLI × 3 kind)
    providers/             # registry + 7 provider class (api/cli/local)
    llm/                   # MeetingSummaryService + LlmCostRepository (R11)
    onboarding/            # OnboardingService 5-step wizard (R11)
    notifications/         # NotificationService + notification-labels.ts dictionary
    memory/                # FTS5 검색 (Phase 3-a, 3-b R12+)
    database/              # SQLite + 014 마이그레이션 chain
    config/                # settings/secrets/runtime 3 계층
    ipc/                   # router + handlers + typed invoke + zod
  renderer/                # Electron Renderer (React)
    features/              # 도메인별 (dashboard / messenger / approvals / queue / settings / onboarding / members)
    components/            # shell + primitives 5종 + Block
    hooks/                 # use-* (IPC 라운드트립 + zustand)
    stores/                # zustand store (project-scoped persist)
    theme/                 # 6 테마 (3 family × 2 mode) + tokens.ts 자동 생성
    styles/                # tokens.css 자동 생성 + Tailwind base
    i18n/                  # ko/en JSON + 15 namespace
  shared/                  # Main + Renderer + Preload 공유
    *-types.ts, ipc-types.ts, ipc-schemas.ts, stream-events.ts
  preload/                 # contextBridge 화이트리스트 (typedInvoke generic + ROLESTRA_E2E dev hooks)
```

## 절대 위반 금지 규칙

1. **Renderer 에서 Node API 직접 접근 금지** — 반드시 IPC 경유
2. **문자열 IPC 직접 호출 금지** — typedInvoke 래퍼만 사용
3. **승인 없는 파일 반영 금지** — ExecutionService 경유 필수 (dry-run → 승인 → apply → rollback)
4. **셸 문자열 실행 금지** — 구조화된 CommandRequest 만 허용 (execFile, shell: false)
5. **하드코딩 UI 문자열 금지** — 모든 사용자 노출 문자열은 t() 함수 경유
6. **API 키 평문 노출 금지** — secrets 계층 (safeStorage) 으로만 관리
7. **마이그레이션 파일 수정 금지** — forward-only, idempotent, 실패 시 앱 시작 차단

## Import 규칙

- `renderer` → `main` 금지 (IPC 경유)
- `main` → `renderer` 금지
- `main` / `renderer` → `shared` 허용
- `preload` → `shared` 만 허용

## 네이밍 컨벤션

- 파일: kebab-case (`consensus-machine.ts`)
- 클래스/인터페이스/타입: PascalCase (`ConsensusStateMachine`)
- 함수/변수: camelCase (`getNextSpeaker`)
- 상수/enum 값: UPPER_SNAKE_CASE (`DISCUSSING`)
- React 컴포넌트 파일: PascalCase (`ChatView.tsx`)
- 번역 키: dot-separated lowercase (`messenger.channelRail.sectionTitle.warm`)

## 핵심 아키텍처 결정 (ADR 요약 — 상세는 `docs/decisions/`)

1. **ConsensusStateMachine**: 12 상태, aggregatorStrategy 4종, snapshot 저장 (cross-cutting C1)
2. **Provider Capability + Registry**: discriminated union + 5 capability (`streaming`/`resume`/`tools`/`web-search`/`summarize`) (C2)
3. **ExecutionService 경계**: dryRun → 승인 → atomic apply → rollback + AuditEntry (C3)
4. **IPC TypedInvoke + zod**: IpcChannelMap generic + dev runtime validation (C4)
5. **secrets safeStorage**: macOS Keychain / Windows DPAPI / Linux libsecret 자동 위임 (C5)
6. **path-guard ArenaRoot 봉인**: 모든 쓰기는 ArenaRoot 안 + junction realpath 비교 (CA-3 TOCTOU) (C6)
7. **i18n dictionary 경유**: main-process 도 i18next direct import 금지, locale 분기 R11 D9 (C7)
8. **6 테마 형태 토큰**: themeKey 3-way DOM 분기 + 5 형태 토큰 (R5 D3 / R10 D4)
9. **마이그레이션 chain forward-only**: 014 land (R10 D10 + R11 D3+D4 — phase 당 1~2 건 한정)
10. **Optimistic UI 5 hook**: send / autonomy / queue.add (R10 D8) + ApprovalBlock.decide / MemberProfile.edit (R11 Task 15)

## 현재 진행 상황

R1~R10 main merge 완료 (tip `dc4a763`). R11 진행 중 — 15/17 task 완료, S9 (Task 13 + 16) 진행 중.

상세 현황: `docs/구현-현황.md` 참조.

## 참고 프로젝트 (같은 git 폴더 내)

- `/mnt/f/hayoung/git/AI_Chat/` — 기존 v1 (Python/FastAPI/Svelte). 멀티파티 메시지 변환, 팩토리 패턴 provider, anti-sycophancy 참고
- `/mnt/f/hayoung/git/bara_system/` — 메모리 시스템 참고 (hybrid search, Stanford 3-factor scoring, SQLite+FTS5+embeddings) — Memory Phase 3-b (R12+) 의존

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
