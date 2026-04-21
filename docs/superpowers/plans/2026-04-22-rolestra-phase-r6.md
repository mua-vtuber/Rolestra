# Rolestra Phase R6 — 회의(SSM) 연동 + v2 engine 잔재 완전 청산 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** R5까지 채널/메신저 UI와 사용자 메시지 전송이 동작하는 상태 위에 **회의(SSM) 본체**를 올리고, 동시에 **v2 engine 잔재(orchestrator / turn-executor / conversation)를 v3 도메인 모델로 재작성**한다. R6 종료 시 앱에서 (a) 채널의 `[회의 시작]` 버튼 → Meeting 레코드 생성 + MeetingOrchestrator 기동 → SSM 전이 → 스트림 이벤트가 실제 AI 참여자의 토큰을 메신저 Thread에 실시간 append, (b) 합의(SSM=DONE) 시 `#회의록` 시스템 채널에 메타 헤더 + 합의본 원문이 자동 포스팅, (c) MeetingBanner가 SSM state/경과시간/참여자 수를 실시간 반영, (d) 메신저 Thread 본문이 placeholder가 아닌 실제 Message/SystemMessage/ApprovalBlock 분기로 렌더, (e) `permissionService`/`workspaceService`/`consensusFolderService` 전역 singleton 참조가 v3 `PermissionService`/`ArenaRootService` DI로 완전 대체, (f) v2 IPC 이벤트 이름(`stream:token`/`chat:send` 등)이 v3 명명(`meeting:turn-token`/`meeting:state-changed` 등)으로 재명명, (g) `tsconfig.node.json`이 legacy archived 경로를 배제해 `npm run typecheck` 전체 exit 0.

**Overview (자연어, 비코더용):**

- R5까지 앱은 "사용자가 메신저에서 메시지를 보내는" 수준까지 완성됐다. 하지만 **AI 참여자가 말을 하진 못한다.** R6가 그 "AI 발화 + 합의 + 회의록" 흐름을 실제로 살려낸다.
- 채널 헤더의 `[회의 시작]` 버튼을 누르면 이미 R5에서 Meeting 레코드는 생성되고 배너도 뜬다. 그러나 그 Meeting 뒤에서 **SSM(12상태 머신)이 도는** 루프가 아직 연결 안 됨. R6가 MeetingOrchestrator를 만들어서 그 루프를 기동한다. 즉 Meeting 생성 → Orchestrator 시작 → 참여자가 순서대로 말하고(턴) → 합의(투표) → 합의본 작성 → #회의록 포스팅 → DONE.
- AI가 말하는 토큰은 **실시간 스트림**으로 Thread에 쌓인다. 한 문장이 끝나면 "메시지 완료" 이벤트가 발사되고, 그 순간 DB에도 저장된다. 이 연결이 v3-side-effects.ts에 이미 R2 Task 20에서 작성되어 있는데, 지금까지 호출되지 않았을 뿐 — R6는 MeetingOrchestrator가 실행될 때 그 배선을 "켜는" 일을 한다.
- v2 엔진은 부분적으로 유용하지만 **orchestrator/turn-executor/conversation 3 파일은 v2 IPC 이름(`stream:token`, `chat:send`)과 전역 singleton(`permissionService`, `workspaceService`, `consensusFolderService`) 에 강하게 결합**되어 있다. R6는 이 3 파일을 v3 이름(`MeetingOrchestrator`, `MeetingTurnExecutor`, `MeetingSession`)으로 다시 쓰면서 v3 `PermissionService`/`ArenaRootService`를 주입 방식(DI)으로 받는다. 기존 파일은 삭제하지 않고 남겨둔 채 새 v3 파일로 호출자를 전환하며, 검증 후 legacy 파일을 R11에서 삭제한다.
- **SSM 자체는 재작성하지 않는다.** `session-state-machine.ts`(599줄)는 12상태 transition table이 이미 v3 context를 수용하도록 작성됐고 테스트 커버리지가 강해서 재작성이 순수 비용이다. 마찬가지로 `consensus-machine`, `persona-builder`, `mode-judgment-collector`, `turn-manager`, `message-formatter`, `patch-extractor`, `diff-generator`, `history`, `app-tool-provider`, `v3-side-effects` 는 **전부 재사용**한다. 약 2,800줄 + 6,000줄 테스트가 자산으로 유지된다.
- R6 종료 시 Thread 본문의 152줄 placeholder(`messenger.thread.messageListPlaceholder`)가 사라지고, DateSeparator + Message(user/member) + SystemMessage + ApprovalBlock 이 실제로 스크롤된다. `useChannelMessages`로 DB에서 읽은 기록 + `useMeetingStream`으로 실시간 토큰 구독이 합쳐져서 완전한 메시지 리스트를 만든다.
- **legacy typecheck 170건**은 R5 closeout에서 R6로 인수인계된 known concern. `tsconfig.node.json`이 포함하는 `src/main/{memory,recovery,remote}/__tests__` 경로가 R3 archive로 이동한 migration 파일을 import하는 dead code다. exclude 조정 + 필요 시 해당 test 파일 삭제로 `npm run typecheck` 전체 exit 0 달성.
- 회의록 포맷은 **메타 헤더 + 합의본 원문** — LLM 요약 호출 없음(R10 이연). 헤더 템플릿: `## 회의 #<meetingId>` + `참여자: <names>` + `SSM 최종: <state>` + `경과: <minutes>분` + `투표: <yes/no/pending>` + 구분선 + 합의본 텍스트.
- `spec §10 R6 체크박스` 확장을 Task 0에서 먼저 한다. 구현 중 모호함은 **반드시 spec을 먼저 갱신**한 뒤 코드를 고친다(R2~R5 규약).
- R6는 여전히 **legacy IPC 경고를 유지**한다(제거는 R11). 새 Renderer 코드는 `legacy-channel-isolation.test.ts` 경계를 계속 지킨다.

**Architecture:**

- Layering: `renderer → shared → preload(contextBridge) → main`. R3/R4/R5 구조 그대로.
- Main 재작성 위치: `src/main/meetings/engine/` (신규 디렉토리) — v3 도메인 모델 기반 orchestrator 코드. 기존 `src/main/engine/`은 자산 모듈(SSM, consensus-*, persona-builder, mode-judgment, turn-manager, message-formatter, patch/diff, history, app-tool-provider, v3-side-effects)만 보존. orchestrator/turn-executor/conversation 3파일은 남겨두되 호출자 0 — Task 13 closeout 전에 경고 주석 추가, 삭제는 R11.
- Main 신규:
  - `src/main/meetings/engine/meeting-session.ts` — v3 MeetingSession (meetingId/channelId/projectId 1급). 기존 ConversationSession 대체.
  - `src/main/meetings/engine/meeting-turn-executor.ts` — v3 MeetingTurnExecutor. PermissionService/ArenaRootService 생성자 DI. singleton 제거.
  - `src/main/meetings/engine/meeting-orchestrator.ts` — v3 MeetingOrchestrator. StreamBridge/MessageService/MeetingService DI, v3 IPC 이벤트만 사용.
  - `src/main/meetings/engine/meeting-minutes-composer.ts` — #회의록 포스팅 포맷 조립기 (메타 헤더 + 합의본 원문).
  - `src/main/ipc/handlers/meeting-handler.ts` 확장 — `meeting:start-orchestrator` / `meeting:abort-orchestrator` 추가(internal, 외부 직접 호출 안 함; MeetingService가 경유).
  - `src/main/streams/stream-bridge.ts` 확장 — v3 meeting 이벤트 타입 추가.
- Renderer 신규:
  - `src/renderer/hooks/use-meeting-stream.ts` — stream-bridge 구독 훅 (`meeting:state-changed`, `meeting:turn-start/token/done`). React 18 concurrent-safe.
  - `src/renderer/features/messenger/Thread.tsx` 본문 재작성 — placeholder 제거, DateSeparator + Message + SystemMessage + ApprovalBlock 분기 렌더. useChannelMessages + useMeetingStream 조합.
  - `src/renderer/features/messenger/MeetingBanner.tsx` — 실 데이터(elapsed/ssmState/crewCount) 바인딩. R5에서 placeholder였던 부분.
- Renderer 재작성:
  - stream-bridge subscriber (기존 v2 `stream:token` 구독 지점 전체 폐기, v3 `meeting:*` 로 이전)
- Shared:
  - `src/shared/meeting-stream-types.ts` (신규) — meeting stream 이벤트 discriminated union.
  - `src/shared/stream-types.ts` 변경 — v2 stream:* 이름 deprecated 주석, v3 meeting:* 추가.
- Styling: 신규 토큰 없음. 기존 메신저 3-way 분기 + R3/R5 token 재활용.
- State flow:
  - Meeting 시작: renderer `StartMeetingModal.submit` → `channel:start-meeting` IPC → main `MeetingService.start()` → **(신규)** `MeetingOrchestrator.run(meetingId)` 기동 → v3-side-effects `wireV3SideEffects()` 호출 → SSM 전이 시작.
  - 턴 진행: SSM state=WORK_DISCUSSING → `MeetingTurnExecutor.executeTurn(speaker)` → provider streamCompletion → token chunk → **StreamBridge.emit(`meeting:turn-token`)** → renderer `useMeetingStream` → Thread append.
  - 턴 완료: TurnExecutor → MessageService.append (DB persist) → StreamBridge.emit(`meeting:turn-done`) → renderer refetch `useChannelMessages`.
  - 합의(SSM=DONE): v3-side-effects 리스너 호출 → **(신규)** MinutesComposer.compose(meeting, snapshot) → MessageService.append(channel: `#회의록`, content: minutes). Notification 발사.
  - 배너 갱신: SSM.onStateChange → v3-side-effects → StreamBridge.emit(`meeting:state-changed`) → renderer `useMeetingStream` → MeetingBanner re-render.
- Testing: Vitest (engine 유닛, SSM 통합, MinutesComposer), jsdom (Thread/Banner 렌더), Playwright `_electron` E2E 1 시나리오(프로젝트 → 채널 → 회의 시작 → mock turn → #회의록 포스팅 확인).

**Tech Stack (R6 추가):**

- 기존(R5까지): TypeScript strict / React 19 / Electron 40 / Vite / Vitest (jsdom) / i18next / zod / zustand / Tailwind / Radix / framer-motion / cva / clsx / @playwright/test
- 신규: **없음**. 기존 IPC/zod/zustand 패턴 재활용.

**참조:**

- Spec:
  - `docs/superpowers/specs/2026-04-18-rolestra-design.md` §5.2(005_session_state_sessions / 006_session_snapshots / 008_execution_audit), §6(meeting:* + stream:*), §7.5(회의 시스템 상세), §10 Phase R6(Task 0에서 R3~R5 템플릿으로 확장), 부록 A v2→v3 델타
  - `docs/superpowers/specs/r5-done-checklist.md` "Known Concerns (R6 인수인계)" 4항
- R5 plan/done-checklist: `docs/superpowers/plans/2026-04-21-rolestra-phase-r5.md`, `docs/superpowers/specs/r5-done-checklist.md`
- v2 engine 자산 (재사용):
  - `src/main/engine/session-state-machine.ts` — SSM 12상태 (599 LOC)
  - `src/main/engine/consensus-{machine,driver,evaluator}.ts` — 합의/투표/프로포절
  - `src/main/engine/mode-judgment-collector.ts` — 대화→업무 전환 판정
  - `src/main/engine/persona-builder.ts`, `message-formatter.ts`, `history.ts`
  - `src/main/engine/turn-manager.ts` — 턴 오더링
  - `src/main/engine/patch-extractor.ts`, `diff-generator.ts`, `context-mode-resolver.ts`, `app-tool-provider.ts`
  - `src/main/engine/v3-side-effects.ts` — SSM → Meeting/Stream/Message/Notification 배선 (R2 Task 20 완)
- v2 engine 부채 (재작성):
  - `src/main/engine/orchestrator.ts` (636 LOC) → `src/main/meetings/engine/meeting-orchestrator.ts`
  - `src/main/engine/turn-executor.ts` (577 LOC) → `src/main/meetings/engine/meeting-turn-executor.ts`
  - `src/main/engine/conversation.ts` (430 LOC) → `src/main/meetings/engine/meeting-session.ts`
  - `src/main/engine/execution-coordinator.ts` (127 LOC) / `memory-coordinator.ts` (142 LOC) → meeting-orchestrator 내부 method 또는 인접 helper
- Main 재사용 모듈:
  - `src/main/meetings/meeting-service.ts` (R2)
  - `src/main/channels/{channel,message}-service.ts` (R2)
  - `src/main/streams/stream-bridge.ts` (R2)
  - `src/main/projects/project-service.ts` (R4)
  - `src/main/permissions/permission-service.ts` (R3 v3 재작성 버전, NOT the v2 singleton)
  - `src/main/arena-root/arena-root-service.ts` (R2 v3)
- IPC 타입: `src/shared/ipc-types.ts` (IpcChannelMap — Task 6에서 meeting:turn-* 추가), `src/shared/ipc-schemas.ts` (zod — 동일)
- Renderer:
  - `src/renderer/features/messenger/Thread.tsx` — 본문 재작성 대상
  - `src/renderer/features/messenger/MeetingBanner.tsx` — 실 데이터 wire
  - `src/renderer/hooks/` — `use-meeting-stream.ts` 신규

---

## Prereqs

- [x] R5 전체 완료(14/14) + main ff-merge (2026-04-22)
- [x] R5 done-checklist 작성 및 Known Concerns 4항 문서화
- [x] SSM 12상태 + consensus-driver + v3-side-effects 테스트 green (R2 baseline)
- [x] MeetingService/MessageService/ChannelService/ArenaRootService/PermissionService/StreamBridge 실사용 가능(R2 + R5-Task11)
- [ ] `rolestra-phase-r6` 브랜치 `main`에서 생성 (Task 0 첫 step)
- [ ] spec §10 R6 블록 R3~R5 템플릿으로 확장 (Task 0)

---

## File Structure (R6 종료 시)

```
src/
├── main/
│   ├── engine/                                      # 자산 유지 (재사용)
│   │   ├── session-state-machine.ts                 # (변경 없음) SSM 12상태 599 LOC
│   │   ├── consensus-{machine,driver,evaluator}.ts  # (변경 없음)
│   │   ├── mode-judgment-collector.ts               # (변경 없음)
│   │   ├── persona-builder.ts                       # (변경 없음)
│   │   ├── message-formatter.ts                     # (변경 없음)
│   │   ├── history.ts                               # (변경 없음)
│   │   ├── turn-manager.ts                          # (변경 없음)
│   │   ├── patch-extractor.ts, diff-generator.ts    # (변경 없음)
│   │   ├── context-mode-resolver.ts                 # (변경 없음)
│   │   ├── app-tool-provider.ts                     # (변경 없음)
│   │   ├── v3-side-effects.ts                       # (변경 없음)
│   │   ├── orchestrator.ts                          # + @deprecated 주석, 호출자 0 (R11 제거 예약)
│   │   ├── turn-executor.ts                         # + @deprecated 주석, 호출자 0
│   │   ├── conversation.ts                          # + @deprecated 주석, 호출자 0
│   │   ├── execution-coordinator.ts                 # + @deprecated 주석
│   │   └── memory-coordinator.ts                    # + @deprecated 주석
│   ├── meetings/
│   │   ├── meeting-service.ts                       # (변경 없음)
│   │   ├── meeting-repository.ts                    # (변경 없음)
│   │   └── engine/                                  # NEW 디렉토리
│   │       ├── meeting-session.ts                   # NEW (MeetingSession, 350~450 LOC)
│   │       ├── meeting-turn-executor.ts             # NEW (MeetingTurnExecutor, 400~500 LOC)
│   │       ├── meeting-orchestrator.ts              # NEW (MeetingOrchestrator, 450~600 LOC)
│   │       ├── meeting-minutes-composer.ts          # NEW (회의록 포스팅 포맷, 100~200 LOC)
│   │       └── __tests__/*.test.ts                  # 각 파일 테스트
│   ├── ipc/handlers/
│   │   └── meeting-handler.ts                       # + meeting:start-orchestrator internal 핸들러
│   ├── streams/
│   │   └── stream-bridge.ts                         # + v3 meeting:turn-token / meeting:state-changed 이벤트 타입
│   └── index.ts                                     # + MeetingOrchestrator, MinutesComposer DI 배선
├── renderer/
│   ├── features/messenger/
│   │   ├── Thread.tsx                               # 본문 재작성 (placeholder → 실 분기)
│   │   └── MeetingBanner.tsx                        # 실 데이터 바인딩
│   ├── hooks/
│   │   └── use-meeting-stream.ts                    # NEW (stream 구독)
│   └── stream-subscribers/                          # (v2 stream:token 구독자 이전 / 제거)
├── shared/
│   ├── meeting-stream-types.ts                      # NEW (discriminated union)
│   ├── stream-types.ts                              # v3 meeting:* 추가, v2 stream:* deprecated 주석
│   └── ipc-types.ts                                 # (필요 시 내부 채널 추가)
├── docs/
│   └── superpowers/
│       ├── plans/
│       │   ├── 2026-04-22-rolestra-phase-r6.md       # (this file)
│       │   └── 2026-04-22-rolestra-phase-r6.md.tasks.json
│       └── specs/
│           ├── 2026-04-18-rolestra-design.md        # +§10 R6 체크박스 확장 (Task 0)
│           └── r6-done-checklist.md                 # NEW (Task 13)
├── e2e/
│   └── meeting-flow.spec.ts                         # NEW
├── tsconfig.node.json                               # legacy archived 경로 exclude (Task 10)
└── i18next-parser.config.js                         # +meeting.* dynamic 키 보호 regex
```

**파일 요약:**
- 신규 main: 4 engine 파일 + 4 테스트
- 재작성 renderer: Thread.tsx 본문 + MeetingBanner.tsx 실데이터
- 신규 renderer: use-meeting-stream.ts + 테스트
- 신규 shared: meeting-stream-types.ts
- 수정: `index.ts` (DI), `stream-bridge.ts`, `stream-types.ts`, `tsconfig.node.json`, `i18next-parser.config.js`, `meeting-handler.ts`
- 삭제: 없음 (R11에서 v2 engine orchestrator 3파일 + coordinator 2파일 일괄 삭제 예약)

---

## Tasks

### Task 0 — Branch + spec §10 R6 확장 + Decision Log

**목표**: R6 브랜치를 main tip(`2f9a998`)에서 파고, spec §10 R6 블록을 R3/R4/R5 템플릿(체크박스 + 산출물 링크)으로 확장, 공격적 옵션 E의 Decision Log를 기록한다.

- [x] `git checkout -b rolestra-phase-r6` from main tip (`2f9a998`)
- [ ] spec §10 R6 블록 확장:
  - `- [ ]` 항목 10~14개(Task 1~13 산출물과 1:1)
  - **scope 경계** 하단 블록: R7(승인 UX), R10(FTS/낙관 업데이트), R11(legacy 파일 삭제)
  - plan/done-checklist 링크 placeholder
- [ ] `docs/superpowers/plans/2026-04-22-rolestra-phase-r6.md.tasks.json` 생성 (14 task slot)
- [ ] Decision Log (본 plan 끝에 Decision Log 섹션 추가):
  - **D1 옵션 E 공격적**: SSM 등 자산 2,800 LOC 유지, orchestrator/turn-executor/conversation 3파일 재작성, permission/workspace/consensusFolder singleton 완전 제거
  - **D2 v2 IPC naming**: `stream:*` → `meeting:*` 전체 재명명, v2 이름 제거
  - **D3 회의록 포맷**: 메타 헤더(참여자/SSM/경과/투표) + 합의본 원문. LLM 요약 R10 이연
  - **D4 legacy typecheck**: `tsconfig.node.json` exclude 조정(R11 완전 삭제 전 단계)
  - **D5 deprecated 전략**: orchestrator 3파일은 `@deprecated` 주석만 추가하고 R11에서 일괄 삭제. 호출자를 먼저 v3 엔진으로 이전하고 legacy 파일은 보존
  - **D6 Thread 본문 구조**: DateSeparator grouping은 로컬 날짜 기준(`toLocaleDateString`), 같은 날 연속 메시지는 avatar/header 생략(compact 모드)
- [ ] 커밋: `docs(rolestra): R6 plan + tasks.json + spec §10 R6 체크리스트 확장 (R6-Task0)`

**AC**:
- `rolestra-phase-r6` 브랜치 존재
- spec §10 R6 블록 체크박스 + scope 경계 + 링크 placeholder
- tasks.json 14-slot skeleton
- Decision Log 6건 기록

**Testing**: N/A (docs-only commit)

---

### Task 1 — Shared stream types (`meeting-stream-types.ts`) + stream-bridge v3 이벤트

**목표**: v3 메신저 stream 이벤트를 shared로 추상화하고 stream-bridge에 발사 API 추가. renderer 구독 시 타입 안전.

- [ ] `src/shared/meeting-stream-types.ts` 신규:
  - Discriminated union:
    - `{ type: 'meeting:state-changed', meetingId, channelId, state, previousState, snapshotHash }`
    - `{ type: 'meeting:turn-start', meetingId, channelId, speakerId, messageId }`
    - `{ type: 'meeting:turn-token', meetingId, channelId, messageId, token, cumulative }`
    - `{ type: 'meeting:turn-done', meetingId, channelId, messageId, totalTokens }`
    - `{ type: 'meeting:error', meetingId, channelId, error, fatal }`
  - 각 타입에 zod schema export
- [ ] `src/main/streams/stream-bridge.ts`:
  - 기존 stream-bridge API에 `emitMeetingStateChanged(payload)`, `emitMeetingTurnStart/Token/Done(payload)` method 추가
  - preload 화이트리스트(`src/preload/index.ts`)에 `meeting:*` 이벤트 구독 API 등록
- [ ] zod 검증: 개발 모드에서 emit 시 schema.parse 경유(패턴은 R2 IPC 검증과 동일)
- [ ] __tests__/stream-bridge.test.ts 확장: meeting:* 5종 emit/subscribe round-trip
- [ ] 커밋: `feat(rolestra): meeting stream types + stream-bridge v3 events (R6-Task1)`

**AC**:
- meeting-stream-types.ts 5 이벤트 discriminated union + zod schema
- stream-bridge.emitMeeting* 5 method 존재
- preload 화이트리스트 등록 확인
- 기존 v2 `stream:*` API는 Task 4에서 제거 예정 — 본 Task에서는 **공존**

**Testing**: Vitest stream-bridge round-trip, 개발 모드 zod 검증 통과.

---

### Task 2 — `MeetingSession` 재작성 (v3)

**목표**: `src/main/meetings/engine/meeting-session.ts` 신규 작성. `ConversationSession`(v2) 대체. `meetingId`/`channelId`/`projectId`가 1급 시민.

- [ ] 신규 파일:
  - `class MeetingSession` — 생성자: `{ meetingId, channelId, projectId, participants, ssmCtx, sessionConfig?, onSnapshot }`
  - 내부적으로 기존 `SessionStateMachine` 재사용(import from `src/main/engine/session-state-machine.ts`)
  - 내부적으로 기존 `TurnManager` 재사용
  - Message history는 `ParticipantMessage[]` 로 보관 (기존 `history.ts` 패턴)
  - `adaptMessagesForProvider` 는 기존 함수 재사용
  - `start()`/`pause()`/`resume()`/`stop()` — 기존 v2와 동일 시맨틱
  - 1:1 vs multi-participant 분기는 **삭제**: R6에서 MeetingSession은 반드시 2+ 참여자 (1:1 DM은 R10에서 별도 `DmSession` 검토) — 본 Task 0의 D6에 주석
- [ ] `__tests__/meeting-session.test.ts`: start/pause/resume + SSM ctx injection + history adapt + participants>=2 enforcement
- [ ] 커밋: `feat(rolestra): MeetingSession v3 (R6-Task2)`

**AC**:
- MeetingSession 생성 시 ssmCtx.meetingId/channelId/projectId 빈 문자열 불허 (zod validate)
- SSM 자동 생성 (participants>=2 assertion)
- 기존 history.ts adapter 재사용 확인
- `src/main/engine/conversation.ts` import 0 (legacy)

**Testing**: Vitest 8~12 케이스.

---

### Task 3 — `MeetingTurnExecutor` 재작성 (v3 DI)

**목표**: `src/main/meetings/engine/meeting-turn-executor.ts` 신규. v2 `turn-executor.ts`의 `permissionService`/`workspaceService`/`consensusFolderService` singleton 5곳 참조를 **생성자 DI**로 제거.

- [ ] 신규 파일:
  - `class MeetingTurnExecutor`
  - 생성자 DI: `{ session: MeetingSession, streamBridge: StreamBridge, messageService: MessageService, permissionService: PermissionService, arenaRootService: ArenaRootService, providerRegistry, memoryCoordinator?, personaPrimedParticipants }`
  - `executeTurn(speaker: Participant)` — 기존 v2 로직 대부분 재활용(메시지 history adapt + provider.streamCompletion + token emit + DB append + deep debate tracking)
  - **v3 이벤트**: token 발사는 `streamBridge.emitMeetingTurnToken(...)`. turn-start/done 동일.
  - **Permission 조회**: `permissionService.getPermissionsForParticipant(speaker.id, projectId)` (v3 signature, projectId 포함)
  - **ArenaRoot/프로젝트 경로 조회**: `arenaRootService.getProjectFolder(projectId)`, `getConsensusFolder(projectId)`
  - `WORKER_PERMISSION_REQUEST_INSTRUCTION` 등 상수 그대로 재사용 가능
  - CLI permission 처리(`registerPendingCliPermission`)는 **R7 승인 시스템과 겹침** — R6에서는 v2 레지스트리 함수를 그대로 호출해 흐름 깨지지 않게 유지, 본체 교체는 R7
- [ ] `__tests__/meeting-turn-executor.test.ts`: DI 주입 확인 + streamBridge 이벤트 3종 순서 + 오류 시 error 이벤트 + permission 서비스 호출 인자
- [ ] 커밋: `feat(rolestra): MeetingTurnExecutor — DI + v3 stream events (R6-Task3)`

**AC**:
- `permissionService`/`workspaceService`/`consensusFolderService` singleton import 0
- Provider streamCompletion → streamBridge.emitMeetingTurnToken 호출 확인
- Turn 완료 시 messageService.append + emitMeetingTurnDone 순서
- 테스트 12~18 케이스

**Testing**: Vitest mock DI, provider stub.

---

### Task 4 — `MeetingOrchestrator` 재작성 + v2 `stream:*` 이벤트 이름 폐기

**목표**: `src/main/meetings/engine/meeting-orchestrator.ts` 신규. v2 `orchestrator.ts` 대체. v2 IPC 이벤트(`stream:token`/`chat:send` 등) 완전 제거, v3 이름만 사용.

- [ ] 신규 파일:
  - `class MeetingOrchestrator`
  - 생성자 DI: `{ session: MeetingSession, streamBridge: StreamBridge, messageService: MessageService, meetingService: MeetingService, channelService: ChannelService, notificationService: NotificationService, approvalService: ApprovalService, projectService: ProjectService, turnExecutor: MeetingTurnExecutor, minutesComposer: MeetingMinutesComposer, circuitBreaker: CircuitBreaker, memoryFacade?: MemoryFacade }`
  - `run()` — 기존 v2 orchestrator.loop / runArenaLoop 로직 이전. WAIT_STATES 목록 유지.
  - `wireV3SideEffects(...)` 호출 (이미 `src/main/engine/v3-side-effects.ts`에 존재) → SSM → Meeting/Stream/Message/Notification 배선 활성화
  - DONE 도달 시 `minutesComposer.compose(meeting, snapshot)` → `messageService.append(minutesChannelId, minutes)`
  - Error 시 `streamBridge.emitMeetingError`, meeting state = FAILED 반영 (meeting-service.finish(outcome='failed'))
- [ ] `src/main/ipc/handlers/meeting-handler.ts`:
  - `channel:start-meeting` 핸들러가 이미 `meetingService.start` 호출 — **그 뒤에** `meetingOrchestrator.run(meetingId, ...)` 추가 호출 (fire-and-forget async, main process 스코프)
  - MeetingOrchestrator 인스턴스는 main/index.ts 에서 singleton 관리 (동시 다수 회의는 Map<meetingId, Orchestrator>)
- [ ] `src/main/index.ts`:
  - ProviderRegistry, StreamBridge, PermissionService, ArenaRootService 생성자 주입으로 MeetingOrchestrator 생성. accessor set.
  - v3-side-effects.wireV3SideEffects 배선은 MeetingOrchestrator.run 내부에서 per-meeting 호출 (disposer 보관 → finish 시 정리).
- [ ] v2 IPC 이벤트 이름 제거:
  - `stream:token`, `stream:message-start`, `stream:message-done`, `stream:state`, `stream:error` 발사 지점 모두 `meeting:*` 로 교체 (단, legacy orchestrator는 `@deprecated` 주석 + 호출자 0 상태로 유지 → 발사 자체가 없음)
  - renderer stream subscriber (renderer/stream-subscribers/*, Thread 등) 를 v3 이벤트 구독으로 이전 (use-meeting-stream은 Task 8, 본 Task는 main쪽만)
- [ ] `__tests__/meeting-orchestrator.test.ts`: 기동/정지/SSM 종료 시 minutesComposer 호출/실패 시 error 이벤트/circuit-breaker 트립
- [ ] 커밋: `feat(rolestra): MeetingOrchestrator v3 + v2 stream:* 이벤트 폐기 (R6-Task4)`

**AC**:
- MeetingOrchestrator run → SSM 전이 → DONE → minutesComposer 호출 순서 증명
- v2 orchestrator import 0 (legacy 파일만 남음, 호출자 0)
- v2 stream:* 이벤트 emit 0
- 10~14 테스트 케이스 green

**Testing**: Vitest SSM mock + service mock + 전 생명주기.

---

### Task 5 — `MeetingMinutesComposer` — #회의록 포스팅 포맷

**목표**: 회의 종료 시 `#회의록` 시스템 채널에 포스팅할 텍스트 조립기.

- [ ] `src/main/meetings/engine/meeting-minutes-composer.ts`:
  - `class MeetingMinutesComposer` / 또는 순수 function `composeMinutes(meeting, snapshot, participants, votes)`
  - 포맷 (D3 결정):
    ```
    ## 회의 #<shortId>

    **참여자**: <names, comma-separated>
    **주제**: <topic>
    **SSM 최종 상태**: <state>
    **경과 시간**: <minutes>분
    **투표**: ✓ <yes>, ✗ <no>, · <pending>

    ---

    <consensus proposal 원문>

    ---

    _회의 종료 시각: <localized date-time>_
    ```
  - i18n: 라벨은 `t()` 경유 (`meeting.minutes.header.*`)
  - 길이 제한 없음 (R10에서 FTS 처리 고려)
- [ ] 합의본이 비어있는 비정상 종료(SSM=FAILED) 시 포맷:
  - "**회의 종료 원인**: <error message>" + "합의본 없음" 명시
- [ ] `__tests__/meeting-minutes-composer.test.ts`: happy path + FAILED path + 0 vote + 다수 참여자(3, 5) + i18n 라벨 치환
- [ ] 커밋: `feat(rolestra): MeetingMinutesComposer — 메타 헤더 + 합의본 포맷 (R6-Task5)`

**AC**:
- happy path 포맷 정확
- FAILED path 분기
- 8~10 테스트 케이스
- i18n 라벨 다국어 (ko/en) 작동 확인

**Testing**: Vitest pure function + snapshot.

---

### Task 6 — v2 singleton 완전 제거 + PermissionService DI 이전

**목표**: `src/main/ipc/handlers/workspace-handler.ts`의 `permissionService`/`workspaceService`/`consensusFolderService` export singleton이 MeetingTurnExecutor에서 참조되던 것을 **완전 끊는다**. v3 `PermissionService`/`ArenaRootService` 인스턴스가 Orchestrator 생성자 경로로 주입됨.

- [ ] 현재 상태 확인: `src/main/ipc/handlers/workspace-handler.ts` 에서 export된 3 singleton을 import하는 파일 목록 전수 grep.
- [ ] 각 import 지점 분류:
  - **engine/ 내부**: orchestrator / turn-executor (R6 Task 3~4에서 이미 DI로 교체 예정, 자동 해결)
  - **engine/ 외부**: 그 외 호출자 — 있다면 DI 이전 또는 v3 서비스 경유로 교체
- [ ] v2 singleton 3 export는 유지 (legacy 호환) but `@deprecated` 주석 추가 (Task 0 D5 패턴)
- [ ] MeetingOrchestrator / MeetingTurnExecutor 생성자 DI 경로 최종 검증 — workspace-handler import 0
- [ ] integration 테스트: 실제 app boot 시 (main/index.ts 기준) meeting flow 가 v3 service 만 사용함을 확인하는 스모크
- [ ] 커밋: `refactor(rolestra): MeetingTurnExecutor/Orchestrator singleton 완전 제거 (R6-Task6)`

**AC**:
- `src/main/meetings/engine/*.ts` 에서 `workspace-handler` import 0
- v2 singleton export는 유지 but `@deprecated` (Task 0 D5)
- 기존 테스트 0 regression
- meeting flow 스모크 v3 only

**Testing**: Vitest integration `meetings/engine/__tests__/smoke-v3-di.test.ts`.

---

### Task 7 — `execution-coordinator` / `memory-coordinator` 슬림 재작성 또는 흡수

**목표**: v2 `execution-coordinator.ts`(127 LOC) / `memory-coordinator.ts`(142 LOC)를 MeetingOrchestrator 내부 method 또는 meetings/engine/ 인접 helper로 흡수. ConversationSession 결합 제거.

- [ ] execution-coordinator 책임 (patch extract + approval + apply + review)을 MeetingOrchestrator의 `handleExecutingPhase()` 등 메서드로 이전. ExecutionService 호출은 DI로 주입.
- [ ] memory-coordinator 책임 (memory retrieval + extraction + maintenance)을 `meetings/engine/meeting-memory-coordinator.ts` 신규 helper로 이동 (단일 책임 유지). MemoryFacade DI 주입.
- [ ] 기존 v2 coordinator 2파일은 `@deprecated` 주석만 추가, 호출자 0 상태로 남김
- [ ] `__tests__`: meeting orchestrator 의 execute/memory 분기 통합 테스트로 흡수
- [ ] 커밋: `refactor(rolestra): execution/memory coordinator 흡수 (R6-Task7)`

**AC**:
- 두 v2 coordinator 파일 호출자 0
- MeetingOrchestrator handleExecutingPhase / runMemoryMaintenance 테스트 green
- 기존 execution-coordinator / memory-coordinator 테스트는 deprecated 주석 + skip 또는 MeetingOrchestrator 테스트로 이관

**Testing**: Vitest MeetingOrchestrator 확장 테스트.

---

### Task 8 — Renderer `use-meeting-stream` 훅

**목표**: stream-bridge `meeting:*` 이벤트를 구독하는 React 훅. Thread/MeetingBanner가 사용.

- [ ] `src/renderer/hooks/use-meeting-stream.ts`:
  - signature: `useMeetingStream(channelId: string | null)` → `{ liveMessages, liveTurns, ssmState, elapsedMs, error }`
  - channelId null이면 idle (derived shape, R5 패턴 답습)
  - preload API `window.rolestra.streamBridge.subscribe('meeting:*', handler)` 경유 (Task 1에서 등록한 API)
  - 내부 state: 현재 구독 중인 turn의 partial buffer (messageId → cumulative text), SSM state, meeting startedAt ← elapsed 계산
  - 이벤트 타입별 reducer:
    - `meeting:state-changed` → `setSsmState(payload.state)`
    - `meeting:turn-start` → `startLiveTurn(messageId, speakerId)`
    - `meeting:turn-token` → `appendLiveToken(messageId, token)`
    - `meeting:turn-done` → `finalizeLiveTurn(messageId)` + refetch trigger (useChannelMessages)
    - `meeting:error` → error surface
  - channelId 변경 시 구독 cleanup
- [ ] `__tests__/use-meeting-stream.test.tsx`: 5 이벤트 타입 각각 / channelId null idle / unmount cleanup / concurrent messages
- [ ] 커밋: `feat(rolestra): use-meeting-stream hook (R6-Task8)`

**AC**:
- 5 이벤트 타입 올바른 reducer
- channelId null idle shape
- unmount 시 구독 해제
- 10~14 테스트 케이스

**Testing**: Vitest React Testing Library, streamBridge mock.

---

### Task 9 — `Thread` 본문 재작성 — placeholder → 실 분기 렌더

**목표**: `src/renderer/features/messenger/Thread.tsx` 152줄의 `messageListPlaceholder` 제거. DateSeparator + Message + SystemMessage + ApprovalBlock 실제 분기.

- [ ] Thread.tsx:
  - `useChannelMessages(channelId)` 로 기존 기록 로드
  - `useMeetingStream(channelId)` 로 실시간 turn buffer 구독
  - `useMembers(projectId)` 로 MessageAuthorInfo join (R5-Task6에서 정한 shape)
  - 렌더 구조:
    - DateSeparator grouping (로컬 날짜 경계, D6)
    - 같은 날 연속 같은 author → compact mode (avatar/header 생략)
    - kind='system' → SystemMessage
    - kind='approval' → ApprovalBlock
    - kind='user' 또는 'member' → Message (user/member variant)
  - 실시간 live turn은 스크롤 끝에 임시 Message로 추가 (messageId 매칭되는 DB 메시지가 도착하면 replace)
- [ ] MeetingBanner 실 데이터 바인딩:
  - elapsed = useMeetingStream().elapsedMs (대체 시 meeting.startedAt 기반 재계산)
  - ssmState = useMeetingStream().ssmState
  - crewCount = useChannelMembers(channelId).length
- [ ] `__tests__/Thread.test.tsx` 보강: DateSeparator 분기 / 4 variant 렌더 / live turn append / live → DB replace
- [ ] `__tests__/MeetingBanner.test.tsx` 보강: 실 데이터 바인딩 (mock stream)
- [ ] 커밋: `feat(rolestra): Thread 실 분기 렌더 + MeetingBanner 실데이터 (R6-Task9)`

**AC**:
- Thread.tsx 152 placeholder 라인 제거
- 4 variant (DateSeparator/Message/SystemMessage/ApprovalBlock) DOM 단언
- compact mode (연속 author 같은 날) 단언
- live → DB replace 테스트
- MeetingBanner 실 데이터 단언
- hex literal 0

**Testing**: Vitest + RTL, 12~18 케이스.

---

### Task 10 — Legacy typecheck 170건 정리

**목표**: `tsconfig.node.json` 이 포함하는 archived migration import 지점 정리. `npm run typecheck` 전체 exit 0.

- [ ] 현황 파악: `npm run typecheck 2>&1 | head -200` 으로 170 에러 경로 수집.
- [ ] 전략 선택:
  - **(A)** `tsconfig.node.json` 의 `include/exclude`에 `src/main/{memory,recovery,remote}/__tests__/**` 배제 추가
  - **(B)** dead test 파일 삭제 (R3 archive 이후 호출자 0이면 완전 제거)
  - **(C)** import 경로만 fix (여전히 의미 있는 테스트)
- [ ] 각 경로별로 A/B/C 결정 — 대체로 A 우선, R11에서 B로 최종 정리
- [ ] `npm run typecheck` 전체 exit 0 확인
- [ ] 커밋: `chore(rolestra): legacy typecheck 170건 정리 (R6-Task10)`

**AC**:
- `npm run typecheck` exit 0
- `npm run typecheck:web` 여전히 exit 0
- 기존 테스트 regression 0
- 배제된 파일 수 / 삭제된 파일 수 커밋 메시지에 기록

**Testing**: `npm run test` 전체 pass 유지.

---

### Task 11 — i18n `meeting.*` namespace populate + keepRemoved

**목표**: 회의록 포맷, 스트림 상태, 진행 배지, 에러 문구 등 meeting.* 키 ko/en 채우기.

- [ ] ko/en locales 에 다음 추가:
  - `meeting.minutes.header.{title,participants,topic,ssmFinal,elapsed,votes,minutesFooter}`
  - `meeting.minutes.failed.{title,reason,noConsensus}`
  - `meeting.state.{CONVERSATION,MODE_TRANSITION_PENDING,WORK_DISCUSSING,SYNTHESIZING,VOTING,CONSENSUS_APPROVED,EXECUTING,REVIEWING,USER_DECISION,DONE,FAILED,PAUSED}` (12 상태 이름 번역)
  - `meeting.banner.state.{...}` (Banner에서 쓸 간단명)
  - `meeting.error.{startFailed,providerError,ssmTimeout,circuitBreaker}`
  - `meeting.notification.{workDone,error}`
- [ ] `i18next-parser.config.js` keepRemoved 확장:
  - `meeting.state.*` dynamic 키 보호 regex
  - `meeting.error.*` dynamic 키 보호 regex
- [ ] i18n:check clean
- [ ] 커밋: `feat(rolestra): meeting.* i18n populate (R6-Task11)`

**AC**:
- 30~40 신규 키 ko/en 동기화
- i18n:check idempotent clean
- keepRemoved 2 regex 추가
- 12 SSM 상태 번역 완비

**Testing**: N/A (locales update).

---

### Task 12 — Playwright E2E `meeting-flow.spec.ts`

**목표**: 프로젝트 생성 → 채널 → 회의 시작 → mock 턴 진행 → SSM=DONE → `#회의록` 포스팅 확인.

- [ ] `e2e/meeting-flow.spec.ts`:
  - `launchRolestra()` 재사용 (R4 헬퍼)
  - 프로젝트 생성 (kind='new')
  - 메신저 이동 → `#일반` 채널 선택
  - `[회의 시작]` 클릭 → 주제 입력 → 제출
  - MeetingBanner 등장 대기
  - (주의) 실제 AI provider 호출은 mock — `providerRegistry`에 스텁 등록 (`APP_CONFIG.e2eMockProvider=true` 플래그 또는 전역 mock)
  - SSM 전이 시뮬레이션 → stream-bridge 이벤트 강제 발사 (테스트 헬퍼)
  - DONE 도달 → `#회의록` 채널 전환 → 최신 메시지가 MinutesComposer 포맷인지 확인
- [ ] `e2e/helpers/mock-provider.ts` 헬퍼 추가
- [ ] WSL 제약 관행대로 DONE_WITH_CONCERNS 처리 (R4/R5 동일)
- [ ] 커밋: `test(rolestra): E2E meeting-flow spec (R6-Task12)`

**AC**:
- 스펙 파일 land, 로직 완비
- 로컬 WSL 제약 사항은 done-checklist에 기록
- R11 릴리스 전 Windows native 검증 예정

**Testing**: Playwright Electron (WSL limitations acknowledged).

---

### Task 13 — R6 closeout (done-checklist + spec §10 ✓ + tasks.json 14/14)

**목표**: r6-done-checklist.md 작성, spec §10 R6 체크박스 ✓ 표시, tasks.json 전체 completed, 최종 게이트 검증.

- [ ] `docs/superpowers/specs/r6-done-checklist.md` 신규 (R5 template 답습):
  - 구현 체크리스트 (Task 0~13)
  - 정식 게이트 통과 (typecheck / lint / test / i18n / theme / build / e2e)
  - 신규 산출물 요약
  - scope 경계 (R7/R10/R11 이연)
  - Known Concerns (R7 인수인계)
- [ ] spec §10 R6 블록의 모든 `- [ ]` → `- [x]` + 산출물 링크 실경로로 치환
- [ ] tasks.json 전체 task.status = "completed"
- [ ] 최종 게이트:
  - `npm run typecheck` exit 0 (Task 10 결과)
  - `npm run typecheck:web` exit 0
  - `npm run lint` 0 errors
  - `npm run test` 전체 (기존 2533 + R6 신규 ≥ 100)
  - `npm run i18n:check` idempotent clean
  - `npm run theme:check` clean
  - `npm run build` pass
- [ ] 커밋: `chore(rolestra): R6 closeout — done-checklist + tasks 14/14 (R6-Task13)`

**AC**:
- done-checklist 완비
- spec §10 R6 모든 체크박스 ✓
- tasks.json 14/14 completed
- 최종 게이트 전부 통과 (Playwright는 DONE_WITH_CONCERNS 허용)

**Testing**: 전체 정식 게이트.

---

## Decision Log

- **D1 옵션 E 공격적 재작성**: v2 engine 5,362 LOC 중 SSM/consensus/persona-builder/mode-judgment/turn-manager/message-formatter/patch/diff/history/app-tool-provider/v3-side-effects 약 2,800 LOC는 재사용 자산. orchestrator/turn-executor/conversation/execution-coordinator/memory-coordinator 약 1,900 LOC는 v2 IPC/singleton 부채 → `src/main/meetings/engine/` 로 v3 재작성. 결과: SSM 10,000 LOC 테스트 자산 보존 + v2 잔재 완전 제거.
- **D2 v2 IPC naming 폐기**: `stream:token`/`stream:message-start`/`stream:message-done`/`stream:state`/`stream:error` → `meeting:turn-token`/`meeting:turn-start`/`meeting:turn-done`/`meeting:state-changed`/`meeting:error` 전수 교체. 이유: v3 스트림은 항상 meeting 컨텍스트에서만 발생. DM/1:1은 R10의 `DmSession` 설계에서 별도 이름.
- **D3 회의록 포맷 — 메타 + 원문**: LLM 요약 호출 R10 이연. R6는 메타 헤더(참여자/주제/SSM/경과/투표) + 합의본 원문. 헤더 라벨 i18n 적용.
- **D4 legacy typecheck**: `tsconfig.node.json` exclude 조정으로 170건 해소. archived `src/main/{memory,recovery,remote}/__tests__` 가 R3 archived migration 경로 import 하던 dead code. R11에서 파일 자체 삭제 예약.
- **D5 deprecated 전략**: v2 orchestrator/turn-executor/conversation/execution-coordinator/memory-coordinator 5파일은 `@deprecated` 주석 + 호출자 0 상태로 유지. 기존 테스트는 남겨서 regression 방어. R11 릴리스 전 일괄 삭제.
- **D6 Thread 본문 구조**: DateSeparator grouping = `toLocaleDateString(i18n.language)` 날짜 키. 같은 날 연속 같은 author → compact mode (avatar/header 생략, content만). live turn은 스크롤 끝 임시 Message, messageId 매칭 DB 메시지 도착 시 replace.
- **D7 1:1 DM 분기 제거**: MeetingSession은 반드시 participants ≥ 2. 1:1 DM 은 MeetingSession을 사용하지 않음. R10에서 별도 `DmSession` 설계 예정.
- **D8 CLI permission 경로**: Task 3 MeetingTurnExecutor는 v2 `registerPendingCliPermission` 그대로 호출(흐름 보존). v3 PermissionService 완전 통합은 R7 승인 시스템에서 ApprovalService와 같이 처리.

---

## Scope 경계 — R7+ 이연 (변경 없음)

- ApprovalInbox UX (사용자가 승인 요청을 검토/승인/거절하는 화면) — R7
- 승인 버튼 클릭 → 실제 승인/거절 → AI 재시도 wire — R7
- CLI permission adapter v3 완전 교체 — R7
- DM 완성 기능 (read receipt / typing indicator 실 이벤트) — R10
- FTS5 메시지 검색 — R10
- 낙관적 업데이트 / Error Boundary 래핑 — R10
- LLM 요약 기반 회의록 요약 (현재는 원문 + 메타 헤더) — R10
- Playwright CI integration + OS matrix — R10
- v2 engine 5파일 물리적 삭제 — R11
- Retro 영어 복귀 결정 D8 (R5 시각 sign-off 후 판단) — R11 릴리스 전
