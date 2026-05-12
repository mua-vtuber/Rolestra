---
name: R12-C2 T10a P2-4a 진행 중 — 9 파일 land + turn-executor/orchestrator 재작성 남음 (2026-05-04)
description: T10a (P2-4a 새 backend skeleton) 절반 진행. shared types 4 + Channel maxRounds 매핑 + StreamBridge phase-changed + MeetingSession 통째 재작성 9 파일 미커밋 land. 다음 = turn-executor (~700 lines) + orchestrator (~600 lines) 통째 재작성 + IPC handler + main/index.ts + preload + 새 vitest 테스트. 현재 typecheck 깨진 상태 (옛 orchestrator/turn-executor 가 새 session.sessionMachine getter 호출).
type: project
originSessionId: r12c2-t10a-progress
---

## 진입 위치 + worktree 상태

- **worktree**: `/mnt/d/Taniar/Documents/Git/Rolestra-r12c2`
- **branch**: `feat/r12-c2-meeting-redesign`
- **tip**: `1686947` (T10 분할 commit) — *미커밋 변경 9 파일 working tree 안 그대로 남음*
- **base**: `e3cdafb` (R12-C 1차 main tip)
- **현재 typecheck**: ❌ 깨짐 (옛 orchestrator + turn-executor 가 새 session 에서 제거된 `sessionMachine` getter 호출 중)
- **현재 vitest**: 미실행 (typecheck 깨짐 상태)

## 사용자 4 결정 (2026-05-04, 이미 land)

| 항목 | 결정 |
|------|------|
| ① 화면 신호 | (가)+(나) 둘 다 — 새 신호 `stream:meeting-phase-changed` 추가 + 옛 `state-changed` 도 새 phase 문자열 dispatch (schema 호환) |
| ① 단서 | 옛 신호 코드 위치 파악 + 정리 계획 — 본 메모리 §"옛 신호 정리 계획" 절 |
| ② 발화 번호 | (나) DB 진실 — `OpinionService.nextLabelHint` + Session 의 in-memory 카운터 둘 다 (HW prime / SW counter) |
| ③ 인계 디폴트 | `check` (사용자 승인). `channel.handoffMode` 컬럼 그대로 활용 (R12-C 시점 land) |
| ④ max_rounds | `channels.max_rounds` 만 사용. NULL = 무제한 / 정수 = N cap. 부서 채널 디폴트 = 5 (코드 fallback `MEETING_DEFAULT_MAX_ROUNDS`). (b) `maxConversationRounds` 는 D-A 옛 흐름 안전장치 — 새 backend 와 분리 |

## 이번 세션에 land 한 9 파일 (모두 미커밋, working tree)

### 신규 (2 파일)

1. `docs/회의시스템-새로만들기-1차-쉬운설명.md` — 사용자용 쉬운 설명 (메타포 + 6 phase 다이어그램 + 부서별 흐름 + 4 결정 항목 + 옛 신호 정리 계획)
2. `src/shared/meeting-flow-types.ts` — Phase enum 8 종 (gather/tally/quick_vote/free_discussion/compose_minutes/handoff/aborted/done) + `MEETING_DEFAULT_MAX_ROUNDS=5` + `MEETING_OPINION_DEPTH_CAP=3` + `StreamMeetingPhaseChangedPayload` 인터페이스 + zod schema 4 종 (`Step1OpinionGatherSchema` / `Step25QuickVoteSchema` / `Step3FreeDiscussionSchema`) + `PHASE_RESPONSE_SCHEMAS` 매핑 + `MeetingTurnResult<T>` 타입

### 수정 (7 파일)

3. `src/shared/channel-types.ts` — `Channel.maxRounds: number | null` 필드 추가
4. `src/shared/stream-events.ts` — `StreamMeetingPhaseChangedPayload` + StreamEvent union 의 `stream:meeting-phase-changed` case
5. `src/main/streams/stream-bridge.ts` — `emitMeetingPhaseChanged` method + `KNOWN_EVENT_TYPES` 에 `stream:meeting-phase-changed` 추가 + `isValidEvent` 안 case
6. `src/main/channels/channel-repository.ts` — `ChannelRow.max_rounds` + `_UPDATABLE_COLUMNS` 에 `'max_rounds'` + `ChannelUpdatePatch.maxRounds?` + `PATCH_KEY_TO_COLUMN.maxRounds` + `CHANNEL_COLUMNS` SELECT 갱신 + `rowToChannel` mapping + `insert()` SQL 갱신
7. `src/main/channels/channel-service.ts` — 4 곳 Channel 생성에 `maxRounds` 추가 (부서 채널 = `MEETING_DEFAULT_MAX_ROUNDS` = 5, 그 외 system/dm/user/global-general = null) + import 라인
8. **`src/main/meetings/engine/meeting-session.ts` 통째 재작성 (354 줄)** — SSM/TurnManager/DeepDebate 의존 모두 제거. 새 surface:
   - `currentPhase` / `setPhase(phase)` / `currentRound` / `incrementRound()` / `resetRound()`
   - `currentOpinionScreenId` / `setCurrentOpinionScreenId(id|null)`
   - `nextLabel(providerId): string` (in-memory 카운터, 회의 단위)
   - `primeLabelCounter(providerId, nextNumber)` (DB hint 로 prime)
   - `aborted` / `abort()`
   - `aiParticipants` getter
   - 옛 surface 보존: 생성자 / `addMessage` / `createMessage` / `getMessagesForProvider` / `interruptWithUserMessage` / `appendUserMessage` / `toInfo` / `setProjectPath`
   - **제거**: `sessionMachine` getter / `state` / `turnManager` / `getNextSpeaker` / `isComplete` / `start/stop/pause/resume/setRoundSetting` (orchestrator 책임으로 옮김) / `deepDebate*`
   - `MeetingSessionInfo.phase` (옛 `state` 대신) / `currentOpinionScreenId` / `aborted` 추가
9. test fixture 3 종 maxRounds 보정:
   - `src/main/channels/__tests__/dm-auto-responder.test.ts`
   - `src/main/meetings/__tests__/meeting-auto-trigger.test.ts` (R12C_DEFAULTS 안)
   - `src/main/meetings/__tests__/meeting-minutes-service.test.ts` (`makeChannel` 안)

### diff 요약

```
13 files changed, 291 insertions(+), 240 deletions(-)
```

`.omx/*` state 4 파일은 hooks 자동 갱신 — 본 작업과 무관.

## 다음 세션에서 진행할 7 항목 (T10a 마무리)

### A. `src/main/meetings/engine/meeting-turn-executor.ts` 통째 재작성 (큰 작업, ~700 lines)

**보존**:
- work-status gate (spec §7.2) — speaker.status !== 'online' 시 skip + emitMeetingTurnSkipped + 시스템 메시지 persist
- provider lookup + AbortController + abort signal
- stream emit 5 종 (turn-start / turn-token / turn-done / error / turn-skipped)
- persona build (`memberProfileService.buildPersona(speaker.id)` + `buildPermissionRules(...)`)
- CLI permission prompt (CLI provider 한정, `approvalCliAdapter` 활용)
- message persistence (`messageService.append(...)`)
- circuitBreaker.recordError 호출

**폐기**:
- SSM state 별 format instruction (`getFormatInstruction` / `MessageFormatter`)
- `AppToolProvider` (옛 작업 모드 도구)
- worker-summary 파일 관리 (`lastWorkerSummaryFileName` / `WORK_SUMMARY_PREFIX`)
- `lastTurnResult` 누적 (orchestrator 가 phase loop 안 직접 result 처리)
- `workerPermissionInstructionSentForId` (옛 EXECUTING 분기)
- mode judgment 호출 / deep debate 분기

**신규**: phase 별 3 method
- `requestOpinionGather(speaker, sessionMeta): Promise<MeetingTurnResult<Step1OpinionGatherSchemaType>>`
- `requestQuickVote(speaker, screenIdsMd): Promise<MeetingTurnResult<Step25QuickVoteSchemaType>>`
- `requestFreeDiscussion(speaker, currentOpinionMd, childrenMd): Promise<MeetingTurnResult<Step3FreeDiscussionSchemaType>>`

각 method 흐름:
1. abort flag check → skipped:'aborted'
2. work-status gate
3. provider lookup
4. emitMeetingTurnStart
5. session.getMessagesForProvider + persona + phase prompt body 동봉
6. provider.streamCompletion (token-by-token emit)
7. raw text → zod schema parse
8. parse 실패 시 1 회 재요청 (schema 양식 다시 동봉) → 또 실패 시 skipped:'invalid-schema'
9. 성공 시 messageService.append + emitMeetingTurnDone + return ok
10. throw 시 emitMeetingError + circuitBreaker.recordError + return skipped:'provider-error'

### B. `src/main/meetings/engine/meeting-orchestrator.ts` 통째 재작성 (큰 작업, ~600 lines)

**보존 surface (caller 의존)**:
- `run()` / `stop()` / `pause()` / `resume()` / `handleUserInterjection(message)` / `injectInitialUserMessage(message)` 6 method
- `MeetingOrchestratorDeps` 인터페이스 (caller 가 의존하는 dep 이름 그대로)
- `onFinalized(...)` callback (R9 queue 통합)
- registerOrchestrator/unregisterOrchestrator (orchestrator-registry 활용)

**폐기**:
- SSM transition / WAIT_STATES / consensus_decision approval flow
- `wireV3SideEffects` 호출 (옛 SSM listener — T10b 가 v3-side-effects.ts 통째 삭제)
- `composeMinutes` (옛 함수 — `MeetingMinutesService.compose` 으로 대체)
- 옛 SsmBox 기반 stream 분기

**phase loop 본체**:
```
async run(): Promise<void> {
  try {
    await runPhase('gather');
    await runPhase('tally');
    
    const quickResult = await runPhase('quick_vote');
    if (session.aborted) return goAborted();
    
    if (quickResult.unresolved.length > 0) {
      // 자유 토론 — 의견 1 개씩 라운드 누적
      const freeResult = await runFreeDiscussionLoop(quickResult.unresolved);
      if (session.aborted) return goAborted();
      if (freeResult.maxRoundsReached) {
        // 사용자 호출 (Notification + 일시정지 → compose_minutes 점프)
        await notifyMaxRoundsReached();
      }
    }
    
    await runPhase('compose_minutes');
    await runPhase('handoff');
    await finalize('accepted');
  } catch (err) {
    await finalize('aborted');
    throw err;
  }
}

emit phase change = streamBridge.emitMeetingPhaseChanged({...}) + emitMeetingStateChanged({...state: phase 문자열...})
```

free discussion loop:
```
for each opinionId in unresolved (스택 — 자식 의견도 새로 unresolved 됨):
  session.setCurrentOpinionScreenId(map.uuidToScreen.get(opinionId))
  session.resetRound()
  while (round < maxRounds):
    session.incrementRound()
    emit phase-changed(free_discussion, round)
    for each speaker: turnExecutor.requestFreeDiscussion(...)
    const result = opinionService.freeDiscussionRound({opinionId, round, ...})
    if (result.agreed) break
    if (round >= maxRounds) {
      maxRoundsReached = true
      break
    }
  // 새로 등장한 자식 의견들이 unresolved 에 추가됨 → 다음 의견 진입
  unresolved.push(...result.additions.map(o => o.id))
```

max_rounds 결정:
```
const maxRounds = channel.maxRounds ?? MEETING_DEFAULT_MAX_ROUNDS;  // 무제한 = Infinity 매핑
if (channel.maxRounds === null) maxRounds = Infinity;
else maxRounds = channel.maxRounds;
```

> 주의: 사용자 결정 ④ 에서 NULL = 무제한 (사용자 명시 선택). 코드 fallback = 5 는 *부서 채널 생성 시* 적용 — DB row 의 max_rounds 가 NULL 인 *기존* 채널 (migration 019 backfill 안 됨) 만. 새로 만든 부서 채널은 항상 정수 5. 본 sub-task 의 orchestrator 는:
> - `channel.maxRounds === null` ⇒ 무제한 (사용자 의도 — 무제한 토론)
> - `channel.maxRounds === 정수` ⇒ 정수 cap
>
> 다만 *기존 채널 (migration 직후)* 도 NULL 이라 무제한이 됨. 의도와 다를 수 있는데 — 사용자 결정은 "*기본*은 5, *무제한*은 사용자 명시 선택". 이걸 정확히 구현하려면 *생성 시점* 에 디폴트 5 를 채워야 한다 (이미 channel-service.ts 에서 land 함). 따라서 *기존* row 만 NULL — 그건 migration 019 land 시점에 부서 채널이 아직 생성된 적 없으면 자연스럽게 디폴트 5 로 들어감 (P2 시점이 dev 환경이라 그렇게 가정).
>
> **결정 (T10a 안에서)**: NULL = 무제한 (사용자 의도). 부서 채널 디폴트 5 는 channel-service 가 보장. 본 orchestrator 는 단순 `channel.maxRounds === null ? Infinity : channel.maxRounds`.

handoff phase:
```
emit phase-changed('handoff')
if (channel.handoffMode === 'check') {
  notify user — Notification "회의 종료, 다음 부서 인계 결재 대기" (P6 R12-H 책임이라 본 sub-task = Notification 만)
} else { // 'auto'
  // 본 sub-task = no-op (P6 R12-H 가 다음 부서 channel 으로 인계 trigger)
}
```

abort:
```
async stop(): Promise<void> {
  session.abort();  // _aborted = true, _phase = 'aborted'
  turnExecutor.abort();  // AbortController.abort()
  await finalize('aborted');
}

async finalize(outcome): Promise<void> {
  meetingService.finish(meetingId, outcome, null);
  emit phase-changed(outcome === 'aborted' ? 'aborted' : 'done')
  if (onFinalized) await onFinalized({meetingId, projectId, channelId, outcome});
}
```

handleUserInterjection / injectInitialUserMessage:
```
handleUserInterjection(message: ParticipantMessage): void {
  this.session.interruptWithUserMessage(message);
  // phase loop 가 다음 turn 경계에서 자연스럽게 prompt 안에 user 메시지 포함
}

injectInitialUserMessage(message: ParticipantMessage): void {
  this.session.appendUserMessage(message);
}
```

pause / resume:
```
async pause(): Promise<void> {
  this._paused = true;
  // turn-executor 의 in-flight call 은 다 완료 후 다음 turn 경계에서 멈춤
  meetingService.updateState(meetingId, this.session.currentPhase, /*pausedAt*/ Date.now());
}

async resume(): Promise<void> {
  this._paused = false;
  meetingService.updateState(meetingId, this.session.currentPhase, /*pausedAt*/ null);
}
```

phase loop 안 매 turn 경계에서 `if (this._paused) await waitForResume();`.

### C. `src/main/ipc/handlers/meeting-handler.ts` 갱신

- `meeting:abort` — orchestrator.stop() 호출 + meetingService.finish('aborted') (현재 형태 그대로)
- `meeting:request-stop` (D-A T2) — 새 의미: orchestrator 의 phase=`compose_minutes` 점프 호출 (graceful stop). 옛 graceful 로직은 SSM 분기였는데 새 모델은 단순 점프
- `meeting:edit-topic` — session.topic mutate (현재 형태 유지 가능?) + meetingService.updateTopic + 재방출
- `meeting:pause` — orchestrator.pause()
- `meeting:resume` — orchestrator.resume()
- `meeting:list-active` — 그대로 (state index 가 새 phase 문자열로 바뀌지만 ActiveMeetingSummary.stateName 값만 바뀜)
- `meeting:llm-summarize` — 그대로 (R10 별 흐름)
- `meeting:voting-history` — 본 sub-task 에서는 graceful no-op (T10b 가 통째 삭제)

### D. `src/main/index.ts` factory 분기 갱신

- `MeetingOrchestrator` import 갱신 (새 deps 시그니처 — turnExecutor 등)
- `MeetingTurnExecutor` 새 deps (member-profile-service / approvalCliAdapter / circuitBreaker 그대로 + 옛 personaPrimedParticipants 도 그대로 활용)
- `wireV3SideEffects` 호출 + 관련 import 제거 (옛 SSM listener)
- 옛 `composeMinutes` import 제거
- `MeetingMinutesService` instance 주입 — orchestrator 가 deps 안에 받음

### E. `src/preload/index.ts`

- `onStream('stream:meeting-phase-changed', cb)` 추가 (1 줄)
- 새 type 노출 (renderer 가 useStream 시 사용)

### F. 새 vitest 단위 테스트 (engine/__tests__)

`meeting-orchestrator-flow.test.ts` (또는 기존 meeting-orchestrator.test.ts 재작성):
- 시나리오 1: gather → 의견 N 개 row 생성
- 시나리오 2: quick_vote 만장일치 → free_discussion skip → compose_minutes 점프
- 시나리오 3: free_discussion 라운드 누적 → 자식 의견 추가 → 깊이 cap 3 도달
- 시나리오 4: max_rounds 도달 → maxRoundsReached
- 시나리오 5: abort → 회의록 미생성 + outcome='aborted'
- 시나리오 6: handleUserInterjection 끼어들기

`meeting-turn-executor-phase.test.ts`:
- requestOpinionGather schema 검증 PASS
- requestOpinionGather schema 부합 안 함 → 1 회 재요청 → 성공
- requestQuickVote schema 부합 안 함 → 2 회 실패 → skipped:'invalid-schema'
- requestFreeDiscussion + abort flag check
- work-status gate skip

### G. 옛 테스트 정리 (지원되는 한 살리기)

- `engine/__tests__/meeting-orchestrator.test.ts` (옛) — SSM 분기 의존 → T10a 시점에 *통째 재작성* (위 §F) 또는 .skip 처리. 본 sub-task 가 *살릴* 수 있는 부분만 골라 살림.
- `engine/__tests__/meeting-turn-executor.test.ts` (옛) — work-status gate / provider lookup 부분만 살리고 SSM 분기 부분은 .skip 또는 통째 삭제 (T10b 가 마무리)
- `engine/__tests__/meeting-session.test.ts` (옛) — 새 surface (phase / round / label) 테스트로 통째 재작성

## 진입 절차 (다음 세션)

```
[1] worktree 진입 + working tree 확인 (이번 세션 미커밋 9 파일 그대로 있는지)
[2] turn-executor 통째 재작성 (큰 작업) — 위 §A 명세 따라
[3] orchestrator 통째 재작성 — 위 §B 명세 따라
[4] IPC handler / main/index.ts / preload 갱신 (작은 작업)
[5] 새 vitest 단위 테스트 작성 + 옛 테스트 정리
[6] typecheck 0 + vitest PASS 검증
[7] commit (mua-vtuber identity)
[8] tasks.json T10a status='completed' sync + 메모리 land summary
[9] 사용자 OK
```

진입 grep:

```bash
# 미커밋 변경 그대로 있는지
cd /mnt/d/Taniar/Documents/Git/Rolestra-r12c2 && git status -s

# 본 세션 land 한 파일 9 개 확인
git diff --stat

# 옛 sessionMachine 호출 위치 (turn-executor + orchestrator + v3-side-effects)
grep -n "sessionMachine\|SessionStateMachine\|SessionState\|TurnManager" src/main/meetings/engine/meeting-orchestrator.ts src/main/meetings/engine/meeting-turn-executor.ts | head -30

# OpinionService API (이미 land — caller)
grep -n "^  [a-z].*(\|^export" src/main/meetings/opinion-service.ts | head -20

# MeetingMinutesService API (이미 land — caller)
grep -n "^  [a-z].*(\|^export" src/main/meetings/meeting-minutes-service.ts | head -10
```

## 옛 신호 정리 계획 (사용자 ① 단서, T10b 책임)

T10b 가 통째 삭제할 옛 신호 publisher 1 곳:
- `src/main/engine/v3-side-effects.ts` 통째 삭제 (옛 SSM listener wiring 의 유일 publisher — 새 orchestrator 가 직접 `emitMeetingStateChanged` + `emitMeetingPhaseChanged` 둘 다 호출)

옛 신호 subscriber (renderer) 는 P3 SsmBox 마이그레이션 종결 시점에 통째 삭제:
- `src/renderer/hooks/use-active-meetings.ts`
- `src/renderer/hooks/use-meeting-stream.ts`
- 관련 test files

본 sub-task (T10a) = 신호 자체 schema 호환 보존 (`stream:meeting-state-changed` 의 `state: string` 필드에 새 phase 문자열 dispatch). 새 신호 (`phase-changed`) 는 prev/round/currentOpinionScreenId 정보 풍부.

## 작업 환경 메모

- **commit identity**: `mua-vtuber` / `mua.vtuber@gmail.com` 만
- **CLAUDE.md mock/fallback 금지** — fake provider 는 vitest 통합 테스트 한정 (`__tests__/` 안)
- **WSL ↔ Windows native binding drift** 가능성: `npm i --no-save @rollup/rollup-linux-x64-gnu` + `npm rebuild better-sqlite3`
- **사용자 = 코딩 무지인** — 사무실 메타포로 보고 (T10a = "회의 시스템 진행 엔진 통째 새로")
- **본 세션에 작성한 사용자용 쉬운 문서**: `docs/회의시스템-새로만들기-1차-쉬운설명.md` — 새 세션 진입 시 사용자 회상에 유용
- **현재 typecheck 깨진 상태** = 새 turn-executor + orchestrator land 후 자연 정합 회복

## 중요 invariant

- 새 MeetingSession 의 surface 가 `sessionMachine` getter / `state` getter 등을 *제거*. 옛 turn-executor + orchestrator 가 그것들을 호출 — 새 코드가 land 되어야 typecheck 회복.
- D-A T2.5 dispatcher (`dispatchUserMessageToActiveMeeting`) 의 caller invariant 는 `orchestrator.handleUserInterjection(participantMessage)` — 새 orchestrator 도 같은 method 보존.
- D-A T5 auto-trigger 의 caller invariant 는 `orchestrator.injectInitialUserMessage(participantMessage)` — 새 orchestrator 도 같은 method 보존.
- factory 인터페이스 (`MeetingOrchestratorFactory.createAndRun({meeting, projectId, participants, topic, ssmCtx, roundSetting?})`) 는 그대로 유지 — caller 4 곳 (channel-handler / index.ts / queue / auto-trigger) 보호.
