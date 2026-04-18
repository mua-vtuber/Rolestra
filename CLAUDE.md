# AI Chat Arena v2

Electron + TypeScript + React 기반 멀티 AI 대화/합의 플랫폼.
기존 Python/FastAPI/Svelte 프로젝트(AI_Chat)를 재작성.

## 핵심 문서 (반드시 읽을 것)

| 문서 | 역할 |
|------|------|
| `docs/기능-정의서.md` | 기능 정의서 (무엇을 만드는가) |
| `docs/설계-문서.md` | 설계 문서 (어떻게 만드는가) |
| `docs/코딩-규칙.md` | 코딩 규칙 (어떤 규칙을 지키는가) |
| `docs/완료-기준.md` | 완료 기준 (언제 끝난 것인가) |
| `docs/아키텍처-결정-기록/` | 아키텍처 결정 기록 (왜 이렇게 했는가) |
| `docs/구현-현황.md` | 현행 기능 및 구현 현황 (무엇이 완료/미완료인가) |

## 기술 스택

- **Framework**: Electron + TypeScript
- **Frontend**: React + react-i18next (기본 언어: ko)
- **State**: Zustand (권장)
- **DB**: SQLite + FTS5
- **Test**: Vitest (권장)
- **Lint**: ESLint (strict, eslint-plugin-i18next 포함)

## 프로젝트 구조

```
src/
  main/          # Electron Main Process (백엔드)
    ipc/         # Typed IPC (IpcChannelMap + IpcMeta + typedInvoke)
    providers/   # AI Provider (API/CLI/Local, capability 기반)
    engine/      # 대화 엔진 (턴 매니저, ConsensusStateMachine)
    execution/   # ExecutionService (화이트리스트, atomic apply, 감사 로그)
    files/       # 파일 권한 시스템
    memory/      # 메모리 시스템 (FTS5 → 임베딩 단계적)
    database/    # SQLite 연결, 마이그레이션
    config/      # 설정 3계층 (settings/secrets/runtime)
    log/         # 구조화 로깅, MD 내보내기
  renderer/      # Electron Renderer (React)
    i18n/        # react-i18next (ko.json)
    components/  # React 컴포넌트
    hooks/       # React hooks (useIPC, useChat 등)
    stores/      # Zustand 스토어
  shared/        # Main + Renderer 공유 타입/상수
  preload/       # contextBridge 화이트리스트 노출
```

## 절대 위반 금지 규칙

1. **Renderer에서 Node API 직접 접근 금지** — 반드시 IPC 경유
2. **문자열 IPC 직접 호출 금지** — typedInvoke 래퍼만 사용
3. **승인 없는 파일 반영 금지** — ExecutionService 경유 필수 (dry-run → 승인 → apply → rollback)
4. **셸 문자열 실행 금지** — 구조화된 CommandRequest만 허용 (execFile, shell: false)
5. **하드코딩 UI 문자열 금지** — 모든 사용자 노출 문자열은 t() 함수 경유
6. **API 키 평문 노출 금지** — secrets 계층(safeStorage)으로만 관리
7. **마이그레이션 파일 수정 금지** — forward-only, idempotent, 실패 시 앱 시작 차단

## Import 규칙

- `renderer` → `main` 금지 (IPC 경유)
- `main` → `renderer` 금지
- `main`/`renderer` → `shared` 허용
- `preload` → `shared`만 허용

## 네이밍 컨벤션

- 파일: kebab-case (`consensus-machine.ts`)
- 클래스/인터페이스/타입: PascalCase (`ConsensusStateMachine`)
- 함수/변수: camelCase (`getNextSpeaker`)
- 상수/enum 값: UPPER_SNAKE_CASE (`DISCUSSING`)
- React 컴포넌트 파일: PascalCase (`ChatView.tsx`)
- 번역 키: dot-separated lowercase (`chat.send`)

## 핵심 아키텍처 결정 (ADR 요약)

1. **합의 엔진 → ConsensusStateMachine**: 7개 상태, 이벤트/가드/타임아웃/maxRetries/aggregatorStrategy, 스냅샷 저장
2. **Provider → Capability + Registry**: ProviderConfig(discriminated union) + ProviderCapability(런타임 분기) + CliProvider 공통 베이스
3. **ExecutionService 경계 강제**: CommandRequest(구조화) + CommandPolicy(allowlist/blockedPatterns) + AuditEntry(감사 로그)
4. **IPC 타입 안전**: IpcChannelMap + IpcMeta(requestId/schemaVersion/sequence/timestamp) + zod 검증(개발 모드만)
5. **메모리 단계적**: Phase 3-a(FTS5+핀+Regex) → Phase 3-b(임베딩+하이브리드+반성+진화)
6. **i18n 초기 적용**: react-i18next, 기본 ko, CI 가드(eslint-plugin-i18next + i18next-parser)

## 현재 진행 상황

Phase 0~6 대부분 구현 완료. 상세 현황은 `docs/구현-현황.md` 참조.

## 참고 프로젝트 (같은 git 폴더 내)

- `/mnt/f/hayoung/git/AI_Chat/` — 기존 v1 (Python/FastAPI/Svelte). 멀티파티 메시지 변환, 팩토리 패턴 provider, anti-sycophancy 참고
- `/mnt/f/hayoung/git/bara_system/` — 메모리 시스템 참고 (hybrid search, Stanford 3-factor scoring, SQLite+FTS5+embeddings)
