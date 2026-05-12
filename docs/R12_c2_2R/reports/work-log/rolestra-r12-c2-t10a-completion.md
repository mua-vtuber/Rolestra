---
name: R12-C2 T10a P2-4a 종결 — 회의 phase loop backend skeleton land (2026-05-04)
description: T10a (P2-4a 새 backend skeleton) 종결. SSM 12 단계 폐기 + 5+2.5 phase loop 새 모델로 통째 재작성. 19 파일 / 2806 insertions / 2670 deletions / commit d4823e0. typecheck:node + typecheck:web 0 / vitest 3540 PASS / 13 skip. 다음 = T10b (옛 SSM 코드 통째 정리).
type: project
originSessionId: r12c2-t10a-completion
---

## land 요약

- **commit**: `d4823e0` (worktree `feat/r12-c2-meeting-redesign`, base `e3cdafb` = R12-C 1차 main)
- **변경**: 19 파일 / +2806 / -2670
- **검증**: typecheck:node + typecheck:web 0 / vitest 3540 PASS / 13 skip / 회귀 0

## 변경 카테고리

### 신규 (2 파일)

1. `src/shared/meeting-flow-types.ts` — `MeetingPhase` enum 8 종 (gather / tally / quick_vote / free_discussion / compose_minutes / handoff / aborted / done) + zod schema 4 종 (Step1OpinionGather / Step25QuickVote / Step3FreeDiscussion + PHASE_RESPONSE_SCHEMAS 매핑) + `MeetingTurnResult<T>` discriminated union + `MEETING_DEFAULT_MAX_ROUNDS=5` + `MEETING_OPINION_DEPTH_CAP=3` + `StreamMeetingPhaseChangedPayload`
2. `docs/회의시스템-새로만들기-1차-쉬운설명.md` — 사용자용 메타포 + 6 phase 다이어그램 + 부서별 흐름 + 4 결정 항목

### 통째 재작성 (production 3 파일)

3. `src/main/meetings/engine/meeting-session.ts` (354 lines) — SSM/TurnManager/DeepDebate 의존 모두 제거. 새 surface: `currentPhase / setPhase / currentRound / incrementRound / resetRound / currentOpinionScreenId / setCurrentOpinionScreenId / nextLabel / primeLabelCounter / aborted / abort / aiParticipants`. 옛 `getNextSpeaker / sessionMachine / state / start / pause / resume / stop / deepDebate*` 모두 폐기 (orchestrator 책임)
4. `src/main/meetings/engine/meeting-turn-executor.ts` (~700 lines) — phase 별 3 method (`requestOpinionGather / requestQuickVote / requestFreeDiscussion`). work-status gate / abort / provider lookup / persona (+ permissionRules) / streamCompletion / zod parse + 1 회 재요청 / messageService.append / circuit breaker. JSON 추출 helper (`extractLastBraceBlock` — escape-aware scanner). 옛 `executeTurn / getFormatInstruction / parseOutputByState / appToolProvider / lastWorkerSummaryFileName / workerPermissionInstruction` 모두 폐기
5. `src/main/meetings/engine/meeting-orchestrator.ts` (~700 lines) — phase loop 본체 (gather → tally → quick_vote → free_discussion → compose_minutes → handoff → done/aborted). max_rounds 도달 시 사용자 호출 (Notification + system message). depth cap reached prompt 안 안내. opinion 트리 markdown render helper 4 종. 옛 SSM transition / WAIT_STATES / consensus_decision approval gate / wireV3SideEffects / composeMinutes 모두 폐기. caller invariant (`run / stop / pause / resume / handleUserInterjection / injectInitialUserMessage` 6 method + `onFinalized` callback) 보존

### 통째 재작성 (vitest 3 파일)

6. `src/main/meetings/engine/__tests__/meeting-session.test.ts` — 새 surface 단위 (생성자 validation / topic system 메시지 invariant / phase / round / opinion screen ID / label counter / abort / user message intake / toInfo)
7. `src/main/meetings/engine/__tests__/meeting-turn-executor.test.ts` — work-status gate skip / provider lookup miss / ok happy-path (valid Step1 + trailing JSON 추출) / invalid-schema retry (2 회 실패 / 1 회 후 성공) / abort 가드 / DI smoke
8. `src/main/meetings/engine/__tests__/meeting-orchestrator.test.ts` — happy-path phase loop / free_discussion 진입 (unresolved 시) / abort 처리 / onFinalized fire-and-forget / handleUserInterjection + injectInitialUserMessage caller surface

### 부분 수정 (10 파일)

9. `src/shared/channel-types.ts` — `Channel.maxRounds: number | null`
10. `src/shared/stream-events.ts` — `StreamMeetingPhaseChangedPayload` + StreamEvent union
11. `src/main/streams/stream-bridge.ts` — `emitMeetingPhaseChanged` + `KNOWN_EVENT_TYPES` 갱신
12. `src/main/channels/channel-repository.ts` — `max_rounds` 컬럼 매핑 (insert / update patch / rowToChannel / SELECT)
13. `src/main/channels/channel-service.ts` — 부서 채널 디폴트 = 5, 그 외 = null
14. `src/main/notifications/notification-labels.ts` — `meetingMinutes.{handoffTitle/Body, maxRoundsTitle/Body}` 4 키 (KO + EN)
15. `src/main/index.ts` factory — orchestrator deps 갱신 (approvalService 제거 + opinionService + meetingMinutesService 추가). MeetingSession 의 roundSetting arg 제거
16. `src/main/channels/__tests__/dm-auto-responder.test.ts` / `src/main/meetings/__tests__/meeting-auto-trigger.test.ts` / `src/main/meetings/__tests__/meeting-minutes-service.test.ts` — Channel fixture 의 maxRounds 보정
17. `docs/superpowers/plans/2026-05-04-rolestra-phase-r12-c2.md.tasks.json` — T10a (id=10) status='completed' + land 결과 description 추가

## 4 사용자 결정 (이미 land)

| 항목 | 결정 |
|------|------|
| ① 화면 신호 | 새 신호 `stream:meeting-phase-changed` + 옛 `state-changed` 호환 유지 (둘 다) |
| ② 발화 번호 | DB hint (`OpinionService.nextLabelHint`) + Session in-memory 카운터 (HW prime + SW counter). 카운터 단위 = 발화 시도 (invalid-schema skip 도 +1) |
| ③ 인계 디폴트 | `check` (사용자 승인) — `channel.handoffMode` 컬럼 그대로 활용 |
| ④ max_rounds | NULL = 무제한 / 정수 = N cap. 부서 채널 디폴트 = 5 (channel-service 시 적용) |

## phase loop 흐름 invariants

- `gather` — AI 마다 `requestOpinionGather` 1 회 → opinions[] insert. session.aborted 시 즉시 finalize('aborted')
- `tally` — provider 호출 X. system 만 `OpinionService.tally` 호출
- `quick_vote` — AI 마다 `requestQuickVote` 1 회 → opinion_vote insert + 만장일치 의견 = agreed. unresolved=[] 면 free_discussion skip
- `free_discussion` — unresolved 의견 1 개씩, max_rounds cap 안 라운드 누적. 자식 의견 추가 시 unresolved 큐 tail 에 push (다음 의견 진입 시 다룸). max_rounds 도달 시 사용자 호출 (Notification + system message — pause 흐름 본격은 P6 R12-H)
- `compose_minutes` — `MeetingMinutesService.compose` 1 회 + 채팅창 system message 1 건 (meta 안 minutesPath / minutesSource / minutesProviderId)
- `handoff` — handoff_mode='check' = Notification + system message / 'auto' = no-op (P6 R12-H 책임)
- `done` / `aborted` — finalize 호출 + meetingService.finish + onFinalized callback fire-and-forget

## 잔여 (T10b / T10c)

### T10b (id=36) — 옛 SSM 코드 통째 정리

본 sub-task 가 production import 끊은 *dead code* 상태. T10b 가 통째 삭제:
- `src/main/engine/consensus-machine.ts`
- `src/main/engine/session-state-machine.ts`
- `src/main/engine/consensus-evaluator.ts`
- `src/main/engine/decision-collector.ts`
- `src/main/engine/v3-side-effects.ts` (옛 SSM listener — 본 sub-task 가 자체 emit 으로 대체)
- `src/main/meetings/engine/meeting-minutes-composer.ts` (옛 — T9 service 가 대체)
- 옛 테스트 (`consensus-machine.test.ts` / `consensus-evaluator.test.ts` / `consensus-execution-integration.test.ts` 등)
- 옛 IPC 통로 (`meeting:advance` 등) + consensus_decision approval 흐름 (`approval-types.ts` 의 `ConsensusDecisionApprovalPayload` 등)
- 렌더러 옛 `SsmBox` 컴포넌트 비활성 (P3 새 layout 자리 placeholder) + 옛 stream 구독 hook 정리

### T10c (id=37) — 회의 1 round 시뮬레이션 e2e + T10 closeout

vitest 통합 시나리오 4 종 — 만장일치 / 자유 토론 / max_rounds 도달 / abort. T10b 끝나야 진입.

## 진입 가이드 (다음 세션)

```
[1] worktree 진입 + 현재 상태 확인
    cd /mnt/d/Taniar/Documents/Git/Rolestra-r12c2
    git log --oneline -3
    git status -s

[2] T10b 시작 — 옛 SSM 코드 통째 정리 (대량 삭제)
    grep -rn "ConsensusStateMachine\|OPINION_GATHERING\|wireV3SideEffects" src/main/ | head
    # production import 가 모두 끊겼는지 먼저 확인

[3] 옛 파일 통째 삭제 + 옛 테스트 .skip → 통째 삭제
    git rm src/main/engine/consensus-machine.ts ...

[4] 옛 IPC 통로 + 옛 SsmBox renderer 정리

[5] typecheck 0 + vitest 회귀 0 검증

[6] commit (mua-vtuber identity)
```

진입 grep:

```bash
# 본 sub-task 가 끊은 production import 확인
grep -rn "ConsensusStateMachine\|wireV3SideEffects\|OPINION_GATHERING\|composeMinutes" src/main/ src/preload/ src/renderer/ | head

# 새 phase 모델 진실원천
grep -n "^export " src/shared/meeting-flow-types.ts
```

## 작업 환경 메모

- **commit identity**: `mua-vtuber` / `mua.vtuber@gmail.com` 만
- **CLAUDE.md mock/fallback 금지** — 본 sub-task 도 fake provider 는 vitest 단위 테스트 안 한정
- **사용자 = 코딩 무지인** — 사무실 메타포로 보고 ("회의 시스템 진행 엔진을 통째 새 모델로 갈아엎었다 — 1 단계: 의견, 2 단계: 시스템 정리, 3 단계: 동의 표결, 4 단계: 자유 토론, 5 단계: 회의록, 6 단계: 다음 부서 인계")
- **본 세션에 작성한 사용자용 쉬운 문서**: `docs/회의시스템-새로만들기-1차-쉬운설명.md`
