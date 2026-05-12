---
name: R12-C2 T10b P2-4b 종결 — 옛 SSM 코드 + consensus_decision approval 흐름 통째 정리 (2026-05-05)
description: T10b (P2-4b 옛 SSM 통째 정리) 종결. commit a171c01 (worktree feat/r12-c2-meeting-redesign, base d4823e0 = T10a). 81 파일 / +200 / -9468. 14 production + 18 engine 테스트 + 4 voting-history 파일 = 36 항목 삭제 + 11 파일 갱신 (consensus_decision kind 통째 제거 + voting-history IPC 통째 제거 + SESSION_STATE_ORDER phase 재배선). typecheck:node + typecheck:web 0 / vitest 3230 PASS / 13 skip / 0 fail. 다음 = T10c (회의 1 round 시뮬레이션 e2e + T10 closeout).
type: project
originSessionId: r12c2-t10b-completion
---

## land 요약

- **commit**: `a171c01` (worktree `feat/r12-c2-meeting-redesign`, base `d4823e0` = T10a)
- **변경**: 81 파일 / +200 / -9468 (대량 dead code 정리)
- **검증**: typecheck:node + typecheck:web 0 / vitest 3230 PASS / 13 skip / 0 fail / 회귀 0
- **base 비교**: T10a tip `d4823e0` → T10b tip `a171c01` (R12-C2 P2-4 본체 종결)

## 변경 카테고리

### 삭제 (production 14)

옛 SSM 12-state 모델 잔재. 모두 T10a 시점에 dead code 상태였던 파일들:

- `src/main/engine/consensus-machine.ts` (deprecated since SessionStateMachine)
- `src/main/engine/consensus-evaluator.ts`
- `src/main/engine/decision-collector.ts`
- `src/main/engine/session-state-machine.ts` (12 SSM state union)
- `src/main/engine/v3-side-effects.ts` (옛 SSM listener wiring)
- `src/main/engine/turn-manager.ts`
- `src/main/engine/app-tool-provider.ts`
- `src/main/engine/context-mode-resolver.ts`
- `src/main/engine/diff-generator.ts`
- `src/main/engine/message-formatter.ts` (SSM state 별 format instruction)
- `src/main/engine/mode-judgment-collector.ts`
- `src/main/engine/patch-extractor.ts`
- `src/main/files/cli-permission-bridge.ts` (call site 0 — 정의만 있고 wire 안 됨)
- `src/main/meetings/engine/meeting-minutes-composer.ts` (T9 MeetingMinutesService 가 대체)

**보존**: `src/main/engine/history.ts` — 새 orchestrator/session/registry 가 import.

### 삭제 (테스트 18 + voting-history 4)

- `src/main/engine/__tests__/` 안 16 SSM 테스트 (consensus-machine / consensus-evaluator / consensus-execution-integration / decision-collector / session-state-machine / ssm-full-cycle.integration / soft-block-logic / turn-manager / v3-side-effects / app-tool-provider / context-mode-resolver / diff-generator / message-formatter / mode-judgment-collector / patch-extractor / engine-integration). `history-structured*.test.ts` 도 삭제 (StructuredMode 가 SSM 모드만 사용).
- `src/main/meetings/engine/__tests__/meeting-minutes-composer*.test.ts` (2)
- `src/main/meetings/voting-history.ts` + `voting-history.test.ts`
- `src/main/ipc/handlers/__tests__/meeting-handler.test.ts` (voting-history 한정 — abort/listActive 검증은 상위 라우터 통합 테스트가 커버)
- `src/renderer/features/approvals/detail/ApvConsensusContextCard.tsx` + 테스트

**보존**: `history.test.ts` — `history.ts` 가 보존되므로 (`adaptMessagesForProvider` 단위 테스트).

### consensus_decision approval kind 통째 제거 (11 파일)

옛 SSM DONE sign-off 흐름의 모든 흔적을 일괄 제거. DB CHECK constraint 의 enum 값(migrations 006/015)은 forward-only 원칙으로 그대로 두고, **코드에서 새 row 가 더 이상 만들어지지 않도록** 차단:

- `src/shared/approval-types.ts` — `ApprovalKind` union 에서 제거 + `ConsensusDecisionApprovalPayload` interface + `ApprovalPayload` discriminated union
- `src/shared/approval-stream-events.ts` — `approvalKindSchema` enum + `consensusDecisionPayloadSchema` + `approvalPayloadSchema` discriminated union
- `src/shared/timeouts.ts` — `CONSENSUS_DECISION_TTL_MS` + `MAX_SNAPSHOTS` (SSM 전용 ring-buffer 상한, 옛 consensus-machine + session-state-machine 공유)
- `src/main/approvals/approval-service.ts` — `rehydrateConsensusTimers` + `disposeRehydratedConsensusTimers` + `ConsensusRehydrateResult` + `rehydratedConsensusTimers` 필드 + `rehydratedConsensusDecidedListener` + `CONSENSUS_DECISION_TTL_MS` re-export
- `src/main/index.ts` — boot rehydrate try/catch 블록 (R10-Task11)
- `src/main/autonomy/autonomy-gate.ts` — `GateLabelKind` 에서 제거 + `evaluateDecision` 의 case + `NOT_ACCEPTED_OUTCOMES` set (dead)
- `src/main/approvals/approval-decision-router.ts` — placeholder 주석
- `src/main/approvals/approval-notification-bridge.ts` — `KIND_BODY_BUILDERS` 의 consensus_decision 항목 + `summariseConsensus` 함수
- `src/main/notifications/notification-labels.ts` — KO/EN 의 `approvalNotificationBridge.consensus_decision` (title/body) + `autonomyGate.label.consensus_decision` + `NotificationDictionary` 타입 + `NotificationLabelKey` union 4 키
- 렌더러 `ApprovalInboxView` + `ApvDetailHeader` + `ApprovalsWidget` 의 `kindLabel`/`formatContent`/`previewKind` 케이스
- 관련 단위 테스트 (approval-service / approval-decision-router / approval-notification-bridge / autonomy-gate / dashboard-service / execution-service / notification-labels / approval-stream-events / approval-handler / ApvDetailHeader / ApprovalDetailPanel / SsmBox / r11-ipc-schemas / 기타)

### meeting:voting-history IPC + ApvConsensusContextCard 통째 제거 (5 파일)

옛 `meeting:voting-history` 채널이 `meeting.state_snapshot_json` 의 SSM `votes` 배열을 approvals UI 의 `participantVotes` 로 projection. 새 phase 모델은 SSM snapshot 자체가 없어 데이터 소스가 사라짐. 새 의견 모델 표결 surface 는 P3/R12-H 에서 별도 IPC 로 재정의:

- `src/shared/ipc-types.ts` — `meeting:voting-history` 채널 타입 정의 제거 + `ApprovalConsensusContext` import 제거
- `src/shared/ipc-schemas.ts` — `meetingVotingHistorySchema` + `v3ChannelSchemas['meeting:voting-history']` 항목 제거
- `src/main/ipc/router.ts` — `handle('meeting:voting-history', ...)` 등록 제거 + import 제거
- `src/main/ipc/handlers/meeting-handler.ts` — `handleMeetingVotingHistory` 함수 + `voting-history` import 제거
- `src/main/ipc/handlers/approval-handler.ts` — `consensusContext` slice 가 항상 `null` 로 떨어짐 (옛 voting-history projection 호출 제거). `setApprovalDetailMeetingAccessor` 는 caller (main/index.ts + 테스트) 호환을 위해 시그니처만 보존(no-op)

### SESSION_STATE_ORDER + INITIAL_MEETING_STATE 새 phase 모델 (4 파일)

옛 12-state SSM ordering 을 phase loop 8 ordering 으로 재배선. dashboard widgets 와 옛 SsmBox 가 progress gauge 를 그릴 때 reference. P3/R12-H 에서 SsmBox 재설계 시 phase 기반 progress 표현으로 새로 사용:

- `src/shared/constants.ts` — `SESSION_STATE_ORDER` 가 `MEETING_PHASE_ORDER` (gather/tally/quick_vote/free_discussion/compose_minutes/handoff/done/aborted) 로 재배선. `SESSION_STATE_COUNT` 12 → 8. `sessionStateToIndex` 가 `MeetingPhase` 로 narrowing. `SessionState` import 제거.
- `src/main/meetings/meeting-service.ts` — `INITIAL_MEETING_STATE` `'CONVERSATION'` → `'gather'`. `SessionState` import 제거. 새 orchestrator 가 첫 phase 진입 시 phase enum 값으로 즉시 덮어쓴다.
- `src/main/meetings/__tests__/meeting-service.test.ts` — `stateIndex` 검증을 'VOTING' (옛 idx 4) → 'quick_vote' (idx 2) 로 재서술
- `src/renderer/features/messenger/SsmBox.tsx` — placeholder 코멘트 추가 (P3/R12-H 에서 phase 카드 + 박스 새 layout 재설계 예정)
- `src/renderer/features/messenger/__tests__/SsmBox.test.tsx` — ratio 검증 stateIndex=7 → stateIndex=3 (8/8=1 회피)

### 부수 정리 (3 파일)

- `src/test-utils/fixtures.ts` — `makeVote` (옛 VoteRecord builder) + `VoteRecord` import 제거. 새 의견 모델은 `opinion-repository.test.ts` 자체 makeVote 헬퍼 사용.
- `src/test-utils/index.ts` — `makeVote` re-export 제거
- `docs/superpowers/plans/2026-05-04-rolestra-phase-r12-c2.md.tasks.json` — T10b status='completed' + land 요약

## 보존된 dead code (의도적, T10b 범위 밖)

다음 v2 잔재들은 **호환 유지 + 다른 곳에서 import 됨** 으로 의도적으로 보존:

- `src/shared/consensus-types.ts` — VoteRecord/AggregatorStrategy/DecisionSchemaVersion 등이 옛 stream-types.ts 안 ConsensusInfo 등을 통해 간접 참조됨. 진짜 dead code 가 되려면 stream-types.ts 도 함께 제거해야 하는데 v2 stream events 통째 정리는 별도 sweep.
- `src/shared/session-state-types.ts` — meeting-service.ts 외 stream-types.ts 의 ModeJudgment/SessionInfo 가 import. 같은 이유로 보존.
- `src/shared/stream-types.ts` — preload/index.ts 의 typedOn<E> 제네릭이 사용. v2 stream events 통째 정리는 별도 phase 책임.
- `meeting:voting-history` 의 DB CHECK constraint 안 `consensus_decision` enum (migrations 006/015) — forward-only 원칙. 새 row 가 만들어지지 않으므로 무해.

## R12-C2 P2 의존 그래프 (T10b 후)

```
T7 (migration 019)              ✅ land
   ↓
T8 (OpinionService)             ✅ land
   ↓
T9 (MeetingMinutesService)      ✅ land
   ↓
T10a (새 backend skeleton)       ✅ land (d4823e0)
   ↓
T10b (옛 SSM 통째 정리)          ✅ land (a171c01) ← 본 sub-task
   ↓
T10c (회의 1 round e2e + T10 closeout)   ← 다음 sub-task
   ↓                ↓
T11 (할 일 큐 트리거)  T12 (회의록 chat block — T9 의존이라 T10c 없이도 진입 가능)
                       ↓
                P3 진입 (T13~T18)
```

## 세션 종료 상태 (2026-05-05, T10b 종결 시점)

- **worktree**: `/mnt/d/Taniar/Documents/Git/Rolestra-r12c2`
- **branch**: `feat/r12-c2-meeting-redesign`
- **tip**: `a171c01` (T10b commit) ← `d4823e0` (T10a) ← `1686947` (T10 split) ← `e3cdafb` (R12-C 1차 main tip = base)
- **Push 안 됨**: worktree branch 만 — main merge 시점은 P8 closeout (작업 마지막)

### `git status -s` 출력 (T10b 종결 직후)

```
 M .omx/metrics.json                  ← 세션 hooks 자동 갱신 (무시)
 M .omx/state/hud-state.json          ← 세션 hooks 자동 갱신 (무시)
 M .omx/state/notify-hook-state.json  ← 세션 hooks 자동 갱신 (무시)
 M .omx/state/tmux-hook-state.json    ← 세션 hooks 자동 갱신 (무시)
 M CLAUDE.md                          ← T10b 작업 전부터 있던 미커밋 변경 (무시)
 D INTEGRATION_TEST_REPORT.md         ← T10b 작업 전부터 있던 미커밋 삭제 (무시)
?? .graphifyignore                    ← graphify skill 부산물 (무시)
?? graphify-out/                      ← graphify skill 부산물 (무시)
```

**모두 본 작업과 무관한 preexisting noise** — 다음 세션에서 그대로 두고 T10c 진입.

## 진입 가이드 (다음 세션 — T10c)

```
[1] worktree 진입 + tip 확인
    cd /mnt/d/Taniar/Documents/Git/Rolestra-r12c2
    git log --oneline -3   # tip = a171c01 (T10b)
    git status -s          # 위 noise 외 미커밋 변경 0 기대

[2] T10c 시작 — vitest 통합 4 시나리오 + T10 closeout
    plan tasks.json id 37 description 본문
    python3 -c "import json; d=json.load(open('docs/superpowers/plans/2026-05-04-rolestra-phase-r12-c2.md.tasks.json')); print(next(t for t in d['tasks'] if t['id']==37)['description'])"

[3] vitest 통합 시나리오 신규 (4 종):
    1. 만장일치     — gather 의견 2 → quick_vote 만장일치 → free_discussion skip → compose_minutes → handoff
    2. 자유 토론    — gather 의견 1 → quick_vote 비만장일치 → free_discussion 라운드 누적 (3 라운드 + 깊이 cap 3 자식 의견) → 합의 → compose_minutes
    3. max_rounds 도달 — free_discussion 5 라운드 → 합의 미도달 → 사용자 호출 (Notification + 일시 정지)
    4. abort       — free_discussion 진행 중 meeting:abort → 즉시 중단 + 회의록 미생성 + outcome='aborted'

[4] 4 게이트 spec 부합 검토
    - §5 phase 흐름 / §11.18 schema 4 종 / 깊이 cap 3 / 발화 ID 회의 단위 카운터 / 회의록 truncate 금지 / handoff_mode 분기

[5] commit (mua-vtuber identity) + tasks.json T10c sync + 메모리 land summary
```

### 진입 grep (T10c 시작 시 유용)

```bash
# 새 phase 모델 진실원천 (T10a land)
grep -n "^export " src/shared/meeting-flow-types.ts

# 새 orchestrator + turn-executor + session surface (T10a land)
grep -n "^  [a-z].*(\|^export" src/main/meetings/engine/meeting-orchestrator.ts
grep -n "^  [a-z].*(\|^export" src/main/meetings/engine/meeting-turn-executor.ts
grep -n "^  [a-z].*(\|^export" src/main/meetings/engine/meeting-session.ts

# OpinionService API (T8 land — caller)
grep -n "^  [a-z].*(\|^export" src/main/meetings/opinion-service.ts

# MeetingMinutesService API (T9 land — caller)
grep -n "^  [a-z].*(\|^export" src/main/meetings/meeting-minutes-service.ts

# 옛 SSM 잔재 (T10b 가 정리 완료 — 결과 0 기대)
grep -rn "ConsensusStateMachine\|SessionStateMachine\|wireV3SideEffects\|composeMinutes(\|consensus_decision" src/main/ src/preload/ src/renderer/ src/shared/ | head

# 본 sub-task 검증 명령
npm run typecheck
npx vitest run
```

## 잔여 (T10c 책임)

- 회의 1 round 시뮬레이션 e2e (만장일치 / 자유토론 / max_rounds / abort 4 시나리오)
- T10 closeout: §5 + §11.18 + 깊이 cap 3 + 발화 ID 회의 단위 카운터 + 회의록 truncate 금지 + handoff_mode 분기 acceptance 통째 검토
- 옛 흐름 의존 잔재 정리 (T10b 가 못 지운 것 — 발견 시점에 흡수)

## 작업 환경 메모

- **commit identity**: `mua-vtuber` / `mua.vtuber@gmail.com` 만
- **CLAUDE.md mock/fallback 금지** — fake provider 는 vitest 통합 테스트 한정 (`__tests__/` 안)
- **사용자 = 코딩 무지인** — 사무실 메타포로 보고 ("회의 시스템 옛 진행 엔진 (12 단계 SSM) 잔재 통째 정리. 옛 합의 결과 결재 (consensus_decision) 흐름도 같이 정리. 새 8 phase 진행으로 dashboard / sidebar 도 갈아끼움. 옛 회의록 카드는 P3 새 카드 들어올 자리 placeholder 로 남김")
- **worktree merge reminder**: 작업 끝나면 (P8 closeout 시점) main merge + worktree remove + branch 삭제

## 핵심 invariant (T10c 진입 시 보존)

- **새 surface (factory/registry/orchestrator)**: caller 4 곳 (channel-handler / index.ts / queue / auto-trigger) 의존 보존
- **6 phase loop method**: `run / stop / pause / resume / handleUserInterjection / injectInitialUserMessage` + `onFinalized` callback
- **stream:meeting-state-changed**: 옛 신호 schema 호환 유지 (`state: string` 필드에 새 phase 문자열 dispatch). 새 신호 `stream:meeting-phase-changed` 와 둘 다 발사.
- **consensus_decision approval kind 사라짐**: ApprovalKind union 4 종 (cli_permission / mode_transition / review_outcome / failure_report) + circuit_breaker. **DB CHECK constraint 의 enum 은 forward-only 로 보존** — 새 row 가 만들어지지 않을 뿐.
- **SESSION_STATE_ORDER = MEETING_PHASE_ORDER** (8 phase): dashboard / banner / 옛 SsmBox 가 phase 진행률 표현
- **INITIAL_MEETING_STATE = 'gather'**: meeting row insert 시 첫 phase
