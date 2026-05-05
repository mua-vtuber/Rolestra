# R4~R6 결정 기록

R4 (대시보드 + 프로젝트 관리) / R5 (채널 + 메신저 본체) / R6 (회의 엔진 v3 재작성) 단계의 phase 별 결정.

---

## R4 — 대시보드 + 프로젝트 관리

### R4-D1. KPI 갱신 = 진입 + 활성 전환 + 모달 close 3 시점만 (스트림 X)

**결정:** 대시보드 KPI (`useDashboardKpis`) 는 R4 에서 stream 구독 없음. 진입 / 활성 프로젝트 전환 / 모달 close 3 시점에 refresh. 실시간 스트림은 R10 Task 11 (KPI stream-driven) 에서 land.

**왜:** R4 시점에는 stream-bridge IPC wiring 자체가 R6 이후라서 의존성 미충족. 3 시점 refetch 가 사용자 체감 충분.

**대안:** A — 30초 polling — 각하 (불필요 IPC 트래픽). C — 즉시 stream — 각하 (R6+ 의존).

### R4-D2. Dashboard KPI `projectId` scope = 타입만 optional, 구현은 global

**결정:** R4 타입은 `projectId?: ProjectId` 선언만, 구현은 모든 프로젝트 합산. `projectId` scope 실제 처리는 R6 이후.

**왜:** R4 의 4 위젯 + Hero 가 모두 global view — projectId 필터를 우선 land 할 시점이 없음. 타입만 미리 열어두면 R6+ 구현이 마이그레이션 0.

### R4-D3. `+ 새 프로젝트` 모달 = ProjectRail + Hero 빠른 액션 둘 다 (단일 store)

**결정:** ProjectRail 첫 row + Hero 의 `+ 새 프로젝트` 빠른 액션 두 곳에서 동일 모달 트리거. zustand store + Radix Dialog 단일 인스턴스.

**왜:** UX 양쪽에서 자연 — ProjectRail 은 list 컨텍스트, Hero 는 빠른 액션 컨텍스트. 단일 모달 인스턴스로 중복 0.

### R4-D4. Junction TOCTOU 검증 = `os.tmpdir()` 내부 외부 폴더 시뮬

**결정:** Playwright E2E "외부 프로젝트 연결 → 대시보드" 시나리오의 외부 경로는 `os.tmpdir()` 안. 사용자 home 의 실제 외부 경로 X.

**왜:** 정리 용이 + realpath 차이 문제 없음 + CI 실행 시 사용자 home 오염 0.

### R4-D5. Playwright 는 R4 에서 로컬 pass 만, CI matrix 는 R10

**결정:** R4 는 Playwright 로컬 pass + 스크린샷 증빙만. GitHub Actions OS matrix 통합은 R10 Task 13 으로 이연.

**왜:** R4 시점에는 .github/workflows/ 가 단순 typecheck/test 만 — playwright 컨테이너 셋업 + Electron headless 가 R10 의 별도 task 로 분리하는 게 회귀 추적 용이.

---

## R5 — 채널 + 메신저 본체

### R5-D1. 실시간 메시지 스트림은 R6

**결정:** R5 는 refetch-on-send 폴링. `MessageService.emit` 은 Task 11 integration test 에서만 검증. stream-bridge wiring 은 R6.

**왜:** R5 의 본 목표는 메신저 UI 6 테마 fidelity — stream 구독까지 land 하면 surface 가 너무 큼.

### R5-D2. 시스템 채널 자동 생성 오너십 = `ProjectService` 단독

**결정:** `ChannelService.createSystemChannels` 는 `ProjectService.create` / `linkExternal` / `importFolder` 안에서만 호출. IPC 레벨에서 직접 호출 금지.

**왜:** 시스템 채널 (#회의록 / #공지 / #일반) 은 프로젝트 생성의 일부 — 별도 호출은 race + orphan project 위험. IPC 단일 진입점 + service 책임 일원화.

### R5-D3. MeetingBanner retro 는 별도 JSX (themeKey 분기)

**결정:** `MeetingBanner.tsx` 안에서 `themeKey === 'retro'` 분기로 별도 JSX 렌더. 같은 컴포넌트 안 if/else.

- retro: `[LIVE]` ASCII + 한국어 터미널 스타일
- warm/tactical: 그래픽 헤더 + 회의 메타

**왜:** retro 의 DOM 구조 자체가 다른데 (avatar 생략 / mono-prefix) prop 분기로는 양쪽 만족 불가. 컴포넌트 안 분기 + `data-theme-variant` 부여로 테스트 가능.

### R5-D4. 섹션 타이틀 i18n = 3개 별도 키 (warm / tactical / retro)

**결정:** `messenger.channelRail.sectionTitle.warm` / `.tactical` / `.retro` 3 키로 분리. warm/tactical 은 같은 한국어 "채널", retro 만 "$ 채널" 같은 한국어 터미널 스타일.

- 향후 영어 복귀 (D8 후보) 시 값만 수정, 키 구조 변경 없음

**왜:** 키 구조가 미래 변경 안전판 — 영어 복귀 / tactical 차별화 어느 쪽이든 키 자체는 stable.

### R5-D5. Composer radius = `panelRadius` 재활용 (신규 토큰 없음)

**결정:** Composer 의 border-radius 는 기존 `panelRadius` 재활용. warm=12 / tactical=0 / retro=0. 시안의 warm composer 가 10px 이지만 옆 Card·Panel 곡률 통일이 우선.

**왜:** 신규 토큰 추가 = single source of truth 깨짐. 사용자 premise ("warm 은 둥근 박스, 그 값 재활용") 반영.

### R5-D6. 채널 멤버 IPC = 기존 API 만 (`channel:list-members` 신규 X)

**결정:** `useChannelMembers` 는 `useMembers()` + 프로젝트/채널 membership filter 로 대체. 신규 IPC 추가 없음.

**왜:** 기존 `channel:list` / `channel:add-members` / `channel:remove-members` 조합이면 충분. 신규 API 는 surface 증가만.

### R5-D7. 시안 미선언 prop (`theme.sidebarBg` 등) 금지

**결정:** 2026-04-19 alignment-checklist §1 준수. 공식 `theme-tokens.jsx` 토큰만 사용. 시안 jsx 에 선언되지 않은 prop 사용 금지.

**왜:** theme:check 가 토큰 자동 생성 — 미선언 prop 사용 시 typecheck error.

### R5-D8. (후보) Retro 영어 복귀 결정

**상태:** R5 시점은 후보로 기록. R5 Task 13 시각 sign-off 후 사용자 결정. R11 D9 에서 최종 결론 — "한국어 유지 + locale 분기 옵션" default. R11 Task 11 이 dictionary 이전 + en parity 작성.

---

## R6 — 회의 엔진 v3 재작성 (옵션 E 공격적)

### R6-D1. 옵션 E 공격적 재작성 — v2 engine 1,900 LOC v3 신규

**결정:** v2 engine 5,362 LOC 중 SSM/consensus/persona-builder/mode-judgment/turn-manager/message-formatter/patch/diff/history/app-tool-provider/v3-side-effects 약 2,800 LOC 는 재사용 자산. orchestrator/turn-executor/conversation/execution-coordinator/memory-coordinator 약 1,900 LOC 는 v2 IPC + singleton 부채 → `src/main/meetings/engine/` 로 v3 재작성.

- 결과: SSM 10,000 LOC 테스트 자산 보존 + v2 잔재 완전 제거 (R11 일괄)

**왜:** v2 의 IPC + singleton 패턴이 v3 단방향 의존성과 호환 불가. 재사용보다 신규 작성이 회귀 적음.

**대안:** A 옵션 — v2 가벼운 패치 — 각하 (장기 부채). B 옵션 — 부분 재작성 — 각하 (혼합 코드 비용).

### R6-D2. v2 IPC naming 폐기 — `meeting:*` 접두사로 전수 교체

**결정:** `stream:token` / `stream:message-start` / `stream:message-done` / `stream:state` / `stream:error` → `meeting:turn-token` / `meeting:turn-start` / `meeting:turn-done` / `meeting:state-changed` / `meeting:error` 전수 교체.

**왜:** v3 스트림은 항상 meeting 컨텍스트에서만 발생. DM/1:1 은 R10 의 `DmSession` 설계에서 별도 이름 (`dm:*`).

### R6-D3. 회의록 포맷 = 메타 헤더 + 합의본 원문 (LLM 요약 R10 이연)

**결정:** R6 회의록 = 메타 헤더 (참여자/주제/SSM/경과/투표) + 합의본 원문. LLM 요약 호출은 R10 Task 11 의 `meeting-summary-service` 에서.

**왜:** R6 의 본 목표는 회의 흐름 동작 — LLM 요약은 capability fallback (R11 Task 9 까지 정식) + 비용 가시화 (R11 Task 8) 까지 확장 필요해서 별도 phase.

### R6-D4. legacy typecheck 해소 = `tsconfig.node.json` exclude

**결정:** archived `src/main/{memory,recovery,remote}/__tests__` 가 R3 archived migration 경로 import 하던 dead code → tsconfig exclude 로 170건 해소. R11 에서 파일 자체 삭제 예약.

**왜:** typecheck error 0 회복이 R6 게이트 — 파일 삭제는 R11 의 legacy cleanup 묶음과 일관 처리.

### R6-D5. v2 deprecated 5 파일 = `@deprecated` 주석 + 호출자 0 + R11 일괄 삭제

**결정:** v2 orchestrator/turn-executor/conversation/execution-coordinator/memory-coordinator 5 파일은 `@deprecated` 주석 + 호출자 0 상태로 유지. 기존 테스트 보존 (regression 방어). R11 Task 2 에서 6 파일 (5 + persona-builder) + 동명 `__tests__` + `@ts-nocheck` 7 파일 일괄 삭제.

**왜:** R6 시점에 삭제하면 다른 phase task 와 변경 섞임 — bisect 어려움. R11 D1 단계 분리 commit (Task 1 = `_legacy/`, Task 2 = engine + nocheck).

### R6-D6. Thread 본문 구조 = DateSeparator + compact mode + live turn replace

**결정:**
- DateSeparator grouping = `toLocaleDateString(i18n.language)` 날짜 키
- 같은 날 연속 같은 author → compact mode (avatar/header 생략, content 만)
- live turn 은 스크롤 끝 임시 Message — messageId 매칭 DB 메시지 도착 시 replace

**왜:** chat UI 의 표준 패턴. compact mode 가 시각 noise 감소.

### R6-D7. 1:1 DM 분기 제거 — MeetingSession 은 participants ≥ 2 보장

**결정:** `MeetingSession` 은 반드시 participants ≥ 2. 1:1 DM 은 MeetingSession 사용 안 함. R10 에서 별도 `DmSession` 설계 예정 → R10 Task 3 에서 `channels.kind='dm'` 재사용 + Thread `kind='dm'` 분기.

**왜:** participants 1 인 회의는 의미 없음 + SSM 의 voting/aggregator 흐름이 1 인에서 무의미. DM 은 별도 도메인.

### R6-D8. CLI permission 경로 = R6 는 v2 흐름 보존, R7 에서 v3 통합

**결정:** R6 Task 3 MeetingTurnExecutor 는 v2 `registerPendingCliPermission` 그대로 호출 (흐름 보존). v3 PermissionService 완전 통합은 R7 승인 시스템에서 `ApprovalService` 와 같이 처리.

**왜:** R6 은 회의 엔진 재작성에 집중 — permission service v3 화는 ApprovalService land 와 묶음 처리가 자연.

---

## R4~R6 통합 영향

- R4 의 single dashboard service (`dashboard-service.ts`) 가 R5+ 의 채널 / 메시지 / 회의 / 승인 위젯 모두에 단일 진입점 (N+1 방지)
- R5 의 themeKey 3-way DOM 분기 패턴이 R7 (ApprovalBlock) / R8 (MemberPanel) / R10 (DM 글리프) 에서 재사용
- R6 의 v3 engine + meeting:* IPC 가 R7 (Approval ↔ Meeting 결합) / R9 (Autonomy + Queue) / R10 (LLM 요약) 의 기반
