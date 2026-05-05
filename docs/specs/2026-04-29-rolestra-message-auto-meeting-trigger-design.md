# Rolestra D-A — 메시지 자동 회의 트리거 + AI 복제 동시 회의

작성일: 2026-04-29
작업 코드: D-A (dogfooding round2 의 D 항목 중 핵심부)
원본 spec: `docs/specs/2026-04-18-rolestra-design.md` §7.4 (채널 시스템) — 본 문서가 §7.4 일부를 대체 / 확장한다.
브레인스토밍 세션 메모리:
  - `rolestra-r12-turn-status-and-dev-logs.md` (round2 A+B)
  - `rolestra-dogfooding-round1.md` #2 (사용자 보고 — 메시지 보내도 답이 없다)
  - `rolestra-feedback-chat-affordance-honesty.md` (채팅 affordance 정직성)
  - `rolestra-dm-identity.md` (DM = 개별 지시 방)
  - `rolestra-e-cross-room-handoff.md` (E 작업 — D-A 완료 후 별도)

---

## 1. 배경

### 1.1 사용자 보고 (Dogfooding round1 #2)

사용자가 Windows `npm run dev` 부팅 후 #일반 / DM 모두에 메시지를 보냈으나 AI 응답 전무. 첨부 로그는 부팅 정상 (`provider-restore`, `cli:warmup`, `consensus rehydrate {0,0}`) — 즉 회의 자체가 시작 안 된 상태. 사용자 표현: "느려서 안 오는 건지 안 오는 건지 모르겠다".

### 1.2 spec § 동작 vs 사용자 직관 갭

현 spec §7.4 "채널 내 회의 시작": 사용자가 채널 헤더 `[회의 시작]` 클릭 → 주제 모달 → Meeting 생성 → SSM 진행. 메시지 단순 송신은 회의를 시작하지 않음.

사용자 직관:
> "채팅창이 버젓이 있는데 입력하고 전송버튼이 막힌것도아니고, 보내지는데 대답을 안하다니 매우 사용감이 안좋아"

→ **입력창 보이고 전송 활성이면 응답이 와야 한다** 는 affordance 정직성 원칙 (메모리 기록).

### 1.3 이 문서의 목적

메시지 송신 = 회의 자동 트리거 모델로 spec §7.4 의 "회의 시작" 절을 재정의. 이를 위해 부수적으로 다음을 함께 정한다:
- 회의 lifecycle (자동 시작 / 명시 종료 / 합의 자동 종료 / 일시정지·재개)
- AI 직원의 "복제" 모델 (같은 멤버가 여러 회의실에 동시 참여)
- DM 의 정체성 분리 (회의 모델 아님)
- 종료 UX 위치 / 동작
- 앱 종료 / 부팅 시 회의 영속화

### 1.4 비목표

- **방 간 업무 인계** (기획방 결정 → 디자인방 컨텍스트 자동 전달) 은 본 문서 범위 밖. 별도 작업 E 에서 D-A 실사용 경험 후 spec 작성 (`rolestra-e-cross-room-handoff.md` 참고).
- **DM 의 권한 / 작업 실행** 은 spec §7.4 "DM 은 권한·실행 기능 비활성" 그대로 유지. D-A 가 이 제약을 풀지 않는다.
- **자동 응답 끄기 토글** 은 만들지 않는다. 끄고 싶으면 채널을 안 만들거나 입장하지 않으면 된다 (메모리 원칙: 자동 응답 토글을 큐 일시정지 등 다른 토글과 섞지 말 것).

---

## 2. 결정 종합

| # | 결정 항목 | 확정 |
|---|---|---|
| 1 | 트리거 범위 | DM + 시스템 쓰기 가능 (`#일반`) + 모든 사용자 채널. 시스템 read-only (`#승인-대기`, `#회의록`) 제외 |
| 2 | DM 모델 | 회의 아님 — 메시지 1 회 → AI 1 턴 응답. Meeting 레코드 안 만듦 |
| 3 | 일반/사용자 채널 모델 | 회의 1 개 단위 — 명시 [회의 종료] 또는 합의/라운드 한계 도달까지 활성. 첫 메시지 = 토픽 + user turn, 이후 메시지 = 같은 회의에 user turn append |
| 4 | AI 복제 | 같은 직원이 여러 회의에 동시 클론으로 참여. 줄 서기 없음 |
| 5 | autonomy 결합 | 자동 트리거는 autonomy 와 무관 — 항상 회의 시작. autonomy 는 AI 발언의 자동/수동만 통제 |
| 6 | 회의 토픽 | 첫 메시지 그대로 (>80자면 첫 80자 + ...). 사용자가 채널 헤더에서 편집 가능 |
| 7 | 종료 UX 위치 | 좌측 채널 사이드바 항목 라벨 "🟢 회의 중" → mouse-hover 시 `[회의 종료]` 버튼 swap |
| 8 | 종료 클릭 | 확인 다이얼로그 → 진행중 turn 마치고 종료 + #회의록 자동 요약 포스팅 |
| 9 | 자동 종료 | 합의 도달 시 즉시 자동 / 라운드 한계 도달 시 "합의된 것 + 논쟁 점" 정리 후 종료 |
| 10 | 채널 이동 | 회의에 무관 — 사용자 다른 채널 봐도 회의 계속 |
| 11 | 앱 종료 | 진행 회의 다이얼로그 → "일시정지하고 종료" / "끝까지 대기" / "취소". 일시정지된 회의는 다음 부팅 시 채널 사이드바에 "⏸ 일시정지" + 재개 (사용자 [재개] 또는 새 메시지로) |
| 12 | 복제 시각 표시 | 평소 표시 안 함. 응답 지연 시만 round2-A 의 `⏳ 응답 지연` 배지 활용 |
| 13 | 대시보드 KPI | "활성 회의" 라벨 + 모든 활성 회의 count 그대로 |

---

## 3. 채널 종류별 동작 모델

### 3.1 DM (kind = 'dm', project_id = NULL)

```
사용자: "이거 어떻게 생각해?"
   → message-service.append (meeting_id = NULL)
   → DM-handler 가 단일 turn 생성
   → 해당 provider 의 generate() 호출
   → AI 응답 1 메시지 append (meeting_id = NULL, role = 'assistant')
```

- Meeting 레코드 생성 안 함. SSM 안 돌림.
- 합의 / 회의록 / 종료 개념 모두 없음.
- 권한 / 작업 실행 비활성 (spec §7.4 그대로).
- 사용자 멘탈모델: Claude Code CLI 와 1:1 대화 (메모리 `rolestra-dm-identity.md`).

### 3.2 시스템 쓰기 가능 (`#일반`) + 모든 사용자 채널

```
[채널이 빈 상태 — 활성 회의 없음]
사용자가 첫 메시지 송신
   → message-service.append (meeting_id = NULL 일시 — 아래 확정)
   → channel-handler 가 active-meeting 조회 → 없음
   → 회의 자동 생성 (topic = 첫 메시지 슬라이스, kind = 'auto')
   → 해당 메시지의 meeting_id 를 새 Meeting 으로 update (또는 insert 시점에 결정)
   → MeetingOrchestrator.run() 진입
   → SSM 통해 직원들이 차례로 발언

[채널에 활성 회의 M 진행 중]
사용자가 메시지 송신
   → message-service.append (meeting_id = M)
   → MeetingOrchestrator (활성) 가 interruptWithUserMessage 로 user turn 합류
   → 다음 AI turn 진행

[합의 도달 또는 사용자 [회의 종료] 클릭]
   → MeetingOrchestrator → SSM DONE
   → MeetingMinutesComposer 가 #회의록 채널에 요약 메시지 append
   → 채널 사이드바 "🟢 회의 중" 라벨 사라짐
```

- 한 채널 동시 활성 회의 1 개 (DB `idx_meetings_active_per_channel` 그대로).
- 종료 후 새 메시지는 다시 새 회의를 자동 트리거.

### 3.3 시스템 read-only (`#승인-대기`, `#회의록`)

- 입력창 자체 비활성 (현재와 동일).
- 자동 트리거 대상 아님.
- affordance 정직성 원칙 위반 없음 — 응답 안 오는 채널은 입력 자체가 막혀 있다.

---

## 4. 회의 lifecycle

### 4.1 자동 시작

**트리거 조건**: 채널이 §3.2 종류이고, 해당 채널에 활성 회의 (`ended_at IS NULL`) 가 없을 때 사용자 메시지 송신.

**시작 절차**:
1. `MessageService.append()` 가 평소대로 row insert + `'message'` event emit.
2. 새 컴포넌트 `MeetingAutoTrigger` (또는 `channel-handler` 의 메시지 송신 후 hook) 가:
   - 활성 회의 조회.
   - 없으면: 토픽 추출 (첫 메시지 첫 80자) → `MeetingService.create({channelId, topic, kind: 'auto'})` → `messages.meeting_id` UPDATE → MeetingOrchestrator 인스턴스 생성 (factory) → `run()` 진입.
   - 있으면: `orchestrator.interruptWithUserMessage(message)` 호출.
3. 시스템은 그 후 SSM 의 turn 시퀀스를 평소대로 진행.

**Race condition 가드**: 사용자가 빈 채널에 두 메시지를 거의 동시에 송신하면 두 hook 이 둘 다 "활성 회의 없음" 으로 판단할 수 있다. 두 번째 `MeetingService.create()` 시도는 `idx_meetings_active_per_channel` unique 제약으로 SQLite 가 거절 → trigger 가 catch 후 첫 회의의 `interruptWithUserMessage` 경로로 fallback. DB 가 진실의 단일 출처.

**토픽 슬라이스 규칙**:
```
toTopic(content) = content.length <= 80 ? content : content.slice(0, 77) + '...'
```
사용자가 채널 헤더에서 편집 가능 (현 spec §7.4 의 채널 이름 편집과 동일 흐름 — 새 IPC 안 만들고 `channel:rename` 의 sister 인 `meeting:edit-topic` 신설).

### 4.2 진행 중

- 메시지 = user turn (R6 의 `interruptWithUserMessage` 활용).
- AI turn 진행은 SSM + autonomy 모드 결합 (§5).
- 회의 진행 상태는 사이드바 채널 라벨 "🟢 회의 중" 으로 노출. 회의 진행 배지 (예: 합의 투표 N/M) 는 채널 헤더에 그대로 (현 spec §7.4 의 진행 배지 유지).

### 4.3 종료 — 자동

| 조건 | 동작 |
|---|---|
| **합의 도달 (SSM DONE state)** | MeetingMinutesComposer → #회의록 요약 포스팅. `meetings.ended_at` stamp. 사이드바 라벨 제거 |
| **라운드 한계 도달 (SSM FAILED state, 합의 미도달)** | MeetingMinutesComposer 가 "합의 + 논쟁" 분리 요약 포스팅 (§4.5) → `meetings.ended_at` stamp |

### 4.4 종료 — 사용자 명시

1. 사용자가 좌측 사이드바 채널 항목에 마우스오버 → "🟢 회의 중" 라벨이 `[회의 종료]` 버튼으로 swap.
2. 클릭 → 확인 다이얼로그 ("정말 종료?" + 회의 진행 상태 요약 표시).
3. 확정 → `MeetingService.requestStop({meetingId})` IPC.
4. MeetingOrchestrator 가 진행중 turn 마치고 (in-flight LLM 호출 cancel 안 함, 응답 받은 후 다음 turn 안 시작) SSM DONE 으로 종료. #회의록 요약 포스팅.

### 4.5 라운드 한계 시 부분 합의 + 논쟁 정리

- 현 `MeetingMinutesComposer` 가 회의 메시지 history 받아 요약. R10-Task11 의 LLM 보강 path 가 있음.
- D-A 변경: SSM FAILED 종료 시 `MeetingMinutesComposer` 의 옵션 `partial: true` 추가. 옵션 활성 시 LLM 프롬프트가 "합의된 결정 / 논쟁 점 / 미결 항목" 3 섹션으로 분리 정리하도록 변경.
- LLM 미설정 또는 실패 시 fallback: "회의가 라운드 한계로 종료됨. 합의 도달 안 함." 한 줄 메시지.

### 4.6 채널 이동

- 사용자가 다른 채널 / 다른 프로젝트로 이동해도 회의는 계속 진행.
- MeetingOrchestrator 는 채널 view 와 분리된 main process 인스턴스라 영향 없음 (현 구조 유지).

### 4.7 앱 종료

**시나리오**: 사용자가 앱 닫기 (종료 / 창 X 버튼) — 활성 회의가 ≥ 1 개 있을 때.

**동작**:
1. Electron `before-quit` (또는 `close`) 이벤트 가로채기.
2. `MeetingService.listActive()` 호출 → 활성 회의 N 개.
3. N ≥ 1 이면 다이얼로그 띄움:
   ```
   현재 N 개 회의가 진행 중입니다.
     · #기획 — 발언 중인 멤버 있음
     · #디자인 — 합의 투표 진행 중
   
   [일시정지하고 종료]  [회의 끝까지 기다림]  [취소]
   ```
4. 사용자 선택:
   - **일시정지하고 종료**: 모든 활성 회의를 `paused_at = now()` 마킹 → in-flight turn 은 응답이 완전히 도착할 때까지 대기 후 그 turn 만 마침 (강제 cancel 안 하므로 응답 잘림 없음). 그 다음 turn 은 시작 안 함 → DB flush → 앱 종료.
   - **회의 끝까지 기다림**: 다이얼로그 유지, 모든 활성 회의 `ended_at != NULL` 될 때까지 대기. 사용자가 [취소] 누를 수 있음.
   - **취소**: 다이얼로그 닫고 앱 종료 안 함.

### 4.8 다음 부팅 — 일시정지 회의 재개

1. 부팅 시 `MeetingService.listActive()` 가 `paused = true` 회의들을 반환.
2. 채널 사이드바에 해당 채널 옆 "⏸ 일시정지" 라벨 표시 (라벨 hover 시 `[재개]` 버튼).
3. 재개 트리거:
   - 사용자가 라벨 hover → [재개] 클릭 → `MeetingService.resume({meetingId})`.
   - 또는 사용자가 그 채널에 새 메시지 송신 → 자동 재개 + 메시지 = user turn 합류.
4. 재개 시 MeetingOrchestrator 새 인스턴스 생성 → 마지막 SSM snapshot 으로부터 rehydrate (현 R10-Task5 의 consensus rehydrate 흐름 활용) → 다음 turn 부터 진행.

---

## 5. autonomy 모드 결합

D-A 의 자동 회의 트리거는 autonomy 모드와 **완전히 무관**. 트리거 항상 발생.

| autonomy 모드 | 메시지 송신 후 동작 |
|---|---|
| **manual** | 회의 자동 시작. 첫 AI turn 직전에 ApprovalService 가 사용자 [승인] 대기. 승인 시 turn 진행. 즉 사용자 입장: "회의는 만들어졌다, 첫 발언 승인 필요" |
| **hybrid** | 회의 자동 시작. 자동/수동 분기는 turn-별 권한 (예: 정보 수집 자동, 파일 편집 승인 — 현 spec §7.6 그대로) |
| **auto** | 회의 자동 시작 + 모든 turn 자동 진행 (현재 동작과 동일) |

manual 사용자는 D-A 도입 후에도 "내가 통제" 의도를 잃지 않는다 — turn 단위 승인은 그대로다.

---

## 5.5 회의 prompt 메시지 주입 계약 (round2.6 dogfooding 발견 갭)

### 5.5.1 문제

§3.2 / §4.2 / §4.8 은 "사용자 메시지 = user turn 합류" 라고 본문에 가정하지만, 현 구현 (`MeetingSession.interruptWithUserMessage()` + `MeetingOrchestrator.handleUserInterjection()`) 은 **turn rotation 만 interrupt** 하고 *메시지 텍스트 자체를 회의 buffer (`_messages`) 에 push 하지 않는다*. 또한 `MeetingSession.topic` 은 constructor 가 받지만 *logging 에만* 쓰이고 prompt 로 들어가지 않는다.

증상: 사용자가 회의를 시작 (수동 또는 자동) 한 뒤 채널에 단순 주제 ("1+1=2 동의?") 를 적어도, AI 들이 받는 prompt = `persona + formatInstruction (단계별 행동 지침) + 비어있는 messages`. 주제 텍스트가 없고 사용자 추가 메시지도 전달되지 않아, AI 가 generic 메타 토론으로 빠진다 (round2.6 dogfooding 보고 #3).

### 5.5.2 계약

D-A 의 "회의 prompt" 는 다음 4 종 메시지로만 구성된다:

| 종류 | 역할 | 주입 시점 | 보존 위치 |
|---|---|---|---|
| **회의 주제** | `system` | `MeetingSession` 생성 직후 (constructor 끝) — 1 회 | `_messages[0]` |
| **단계별 형식 지시** | `system` | turn-executor 가 매 turn 직전 unshift | turn 단위 (영속 X) |
| **사용자 메시지** | `user` | 사용자 채널 메시지 송신 시 — 첫 메시지 (`firstMessage`) 와 후속 메시지 모두 | `_messages` 끝에 append |
| **AI 발언** | `assistant` | turn 종료 시 turn-executor 가 push (현 line 439) | `_messages` 끝에 append |

> **불변식**: `_messages[0]` 이 `system` role 의 topic 메시지가 아니면 `MeetingSession` 생성이 잘못된 것이다. 자동 트리거 (T4/T5) 와 수동 [회의 시작] 양쪽 모두 동일.

### 5.5.3 시그니처 변경

- `MeetingSession.constructor` 끝에서 `_messages.push({ role: 'system', content: topic 으로 만든 prompt 문자열, ... })`. 문자열 형식: `${i18n('meeting.topicSystemPrompt')}: ${topic}` — 한글: "회의 주제: {topic}" 정도. dictionary 경유 (CLAUDE.md `#5 하드코딩 UI 문자열 금지` 의 정신을 main-process prompt 까지 확장).
- `MeetingSession.interruptWithUserMessage()` → `interruptWithUserMessage(message: ParticipantMessage)` 로 시그니처 확장. 내부에서:
  1. `_messages.push(message)` (role='user' 보장된 채로)
  2. `_turnManager.interruptWithUserMessage()` (기존 동작 유지)
- `MeetingOrchestrator.handleUserInterjection()` → `handleUserInterjection(message: ParticipantMessage)`. 호출자 (channel-handler / message-service hook / T5 의 wiring) 는 채널의 user 메시지 송신 직후 이 메서드를 호출하며 메시지 객체를 인자로 전달.
- 자동 트리거 T4/T5 의 `createAndRun({meetingId, channelId, topic, firstMessage})` 도 같은 계약을 따른다 — `firstMessage` 는 `MeetingSession` 생성 후 `interruptWithUserMessage(firstMessage)` 로 주입 (또는 동등한 push 경로). topic 은 constructor 가 자동 주입.

### 5.5.4 prompt 구성 (turn-executor)

turn-executor 가 매 turn 시작 시 만드는 messages 배열:
1. `_messages` 전체 (= topic system + user/assistant 누적)
2. 그 위에 단계별 `formatInstruction` 을 system role 로 `unshift` (현 line 345 그대로)
3. 결과: `[formatInstruction(system), topic(system), user1, assistant1, user2, ...]` 순.

`persona` 인자는 주제와 별개로 provider.streamCompletion 에 그대로 전달 — 즉 AI 마다 자기 역할/성격은 그대로 주입되고, *모든 AI 가 공유하는 회의 주제* 는 `_messages` 안의 첫 system 메시지로 단일 출처.

### 5.5.5 fallback / 에러

- topic 이 빈 문자열 또는 `< 3` 자라면 `MeetingSession` constructor 가 throw (현 line 126 그대로). 즉 topic 부재 시 prompt 가 비어있는 상태로 회의가 만들어지는 경로는 *존재할 수 없다*. silent fallback 금지 (CLAUDE.md `mock/fallback 절대 금지`).
- `interruptWithUserMessage(message)` 가 `message.role !== 'user'` 인 객체를 받으면 throw — 호출자 실수를 prompt 오염 전에 catch.
- `_messages[0].role !== 'system'` 인 상태로 turn-executor 가 들어오면 dev assertion fail (즉 `MeetingSession` 생성 후 누군가 `_messages` 를 직접 만지면 잡힘).

### 5.5.6 마이그레이션

기존 회의 (D-A 이전 생성된 row 들) 는 영향 없음 — `_messages` 는 in-memory buffer 라 부팅 시 history 에서 rehydrate 되며, rehydrate 흐름은 §4.8 의 SSM snapshot path. 본 계약은 **신규 `MeetingSession` 생성 시점부터** 적용. 부팅 시 paused 회의 재개 (§4.8) 도 새 인스턴스이므로 동일 적용.

---

## 6. AI 복제 모델 (동시 회의 격리)

### 6.1 문제

현 시스템: `providerRegistry` 가 글로벌 싱글톤. 같은 provider 인스턴스가 모든 회의에 공유됨. 특히 CLI provider 의 `CliSessionState` (sessionId / rateLimited / isFirstResponse) 가 인스턴스 필드라, 두 회의가 동시 같은 직원의 turn 호출하면 session 상태 교차 오염 가능.

지금까지는 사용자가 회의를 명시 1 개씩 시작했기에 발현 안 됐다. D-A 자동 트리거 + 다채널 동시 회의 시 자연스럽게 발현.

### 6.2 결정

**provider 호출은 회의 단위 session 으로 격리한다.**

구현 옵션 (plan 단계에서 1 택, 변형 가능):

- **(A) per-meeting CliSessionState**: CliProvider 가 호출 인자에 `sessionContext` 받아 (channelId or meetingId 기준) session state map 으로 분기. provider 인스턴스 자체는 싱글톤 유지.
- **(B) per-meeting provider instance**: `providerRegistry` 가 회의별 sub-instance 생성. 메모리 사용 ↑, 격리 안전성 ↑.
- **(C) per-turn process spawn (CLI 만)**: CLI 직원의 매 turn 마다 새 process. session resume 못 함 — Claude Code 의 `--resume` 플래그 의존도 큼. 비효율.

**추천**: (A). CliSessionState 의 인스턴스 필드 셋 (`sessionId`, `rateLimited`, `isFirstResponse`, `warmedUp`, `sessionStartedAt`) 을 `Map<MeetingId, CliSessionState>` 로 외부화. provider 의 호출 entry point 가 `meetingId` 를 받아 해당 state 를 가져옴.

API provider (Anthropic SDK / OpenAI SDK / Google SDK / xAI SDK) 는 HTTP stateless 라 동시 호출 안전 — 변경 없음.

Local provider (Ollama) 는 모델 인스턴스가 단일이지만 HTTP API 가 동시 처리 (큐잉 또는 concurrent setting 따라). 변경 없음.

### 6.3 표시

- 평소 직원 카드 / 회의실 안에서 표시 안 함.
- 응답이 일정 임계 (예: 60s) 넘게 지연되면 round2-A 의 `⏳ 응답 지연` 배지가 그 turn 옆에 노출 (이미 wired up).
- "동시 N 곳 회의 중" 카운터 같은 메타 표시는 만들지 않음 — 정보 과잉, 사용자 멘탈모델 단순 유지.

---

## 7. 데이터 모델 변경

### 7.1 `meetings` 테이블

```sql
-- 신규 칼럼 (migration 016 가정)
ALTER TABLE meetings ADD COLUMN paused_at INTEGER DEFAULT NULL;
ALTER TABLE meetings ADD COLUMN kind TEXT DEFAULT 'manual'
  CHECK (kind IN ('manual', 'auto'));
```

- `paused_at`: 일시정지 시각. NULL 이면 일시정지 아님. `idx_meetings_active_per_channel` 의 partial 조건은 `ended_at IS NULL` 그대로 유지 (paused 도 active 로 간주 — 채널당 1 회의 제약 유지).
- `kind`: 'manual' (사용자가 [회의 시작] 클릭) vs 'auto' (D-A 의 자동 트리거). 통계 / debug 용. 동작 분기 안 함.

### 7.2 `messages.meeting_id`

- 현재: NULL 허용 (회의 외 메시지 가능). 변경 없음.
- DM 메시지: NULL 그대로.
- 자동 회의 채널 메시지: 회의 자동 시작 시 그 메시지의 `meeting_id` 를 UPDATE 또는 트리거 시점에 transaction 내에서 INSERT (구현 디테일은 plan 단계).

### 7.3 마이그레이션 016

- forward-only, idempotent 원칙 그대로 (CLAUDE.md 절대 위반 금지).
- 컬럼 추가 + 기존 행 default 적용. 기존 회의는 `paused_at = NULL`, `kind = 'manual'` 로 기록됨 — D-A 이전 회의는 모두 manual 트리거였으므로 정확.

---

## 8. IPC 변경

### 8.1 신규

| 채널 | 입력 | 출력 | 설명 |
|---|---|---|---|
| `meeting:request-stop` | `{meetingId: string}` | `{stoppedAt: number}` | 좌측 사이드바 [회의 종료] 클릭. 확인 다이얼로그 통과 후 호출 |
| `meeting:edit-topic` | `{meetingId: string, topic: string}` | `{topic: string}` | 사용자가 자동 추출된 토픽이 어색해서 편집 |
| `meeting:pause` | `{meetingId: string}` | `{pausedAt: number}` | 앱 종료 다이얼로그의 "일시정지하고 종료" |
| `meeting:resume` | `{meetingId: string}` | `{resumedAt: number}` | 사이드바 [재개] 또는 새 메시지 자동 재개 |

### 8.2 기존 변경

- `message:append`: 변경 없음. 자동 트리거는 main process 의 hook (`MessageService.append` 의 'message' event listener 또는 `channel-handler.ts`) 에서 처리.
- `meeting:list-active`: 응답에 `pausedAt` 추가.
- `channel:start-meeting`: 그대로 유지 (manual 트리거 backup, dev/test 용).
- `meeting:abort`: 그대로 유지 (강제 abort vs request-stop 의미 분리 — abort 는 즉시, request-stop 은 진행중 turn 마침).

### 8.3 zod 스키마

`src/shared/ipc-schemas.ts` 에 4 신규 채널의 zod 스키마 추가. 입력 / 출력 모두 strict.

---

## 9. UI 변경

### 9.1 좌측 채널 사이드바 (ChannelRail)

- 회의 활성 채널: 채널 이름 우측에 작은 라벨 "🟢 회의 중" (theme 토큰 — accent 또는 success).
- 라벨 mouse-hover 시 swap → `[회의 종료]` 버튼 (작은 secondary).
- 일시정지 채널: "⏸ 일시정지" 라벨, hover 시 `[재개]` 버튼.
- accessibility: 라벨에 aria-label 명시 (`messenger.channelRail.meetingActive`, `meetingPaused` 신규 i18n 키).

### 9.2 ChannelHeader

- 현 `[회의 시작]` 버튼: D-A 가 자동 트리거이므로 평소 비노출. 단 dev/test 용 fallback 으로 유지하되 settings 의 dev tools 영역에서만 노출 (또는 hidden by default + 환경변수 `ROLESTRA_E2E` 시 노출).
- 회의 진행 배지 (예: "🗳 합의 투표 3/4"): 변경 없음.
- 토픽 표시 + [편집] 아이콘: 신규. 클릭 시 inline edit 또는 작은 모달.

### 9.3 앱 종료 다이얼로그

- 새 컴포넌트 `AppQuitMeetingDialog` (renderer) — `before-quit` 이벤트 시 main → renderer push. 사용자 선택 후 main 으로 IPC 응답.

### 9.4 i18n 신규 키

```
messenger.channelRail.meetingActive
messenger.channelRail.meetingPaused
messenger.channelRail.endMeetingButton
messenger.channelRail.resumeMeetingButton
messenger.channelHeader.editTopic
messenger.endMeetingDialog.title
messenger.endMeetingDialog.body  (회의 상태 요약)
messenger.endMeetingDialog.confirm
messenger.endMeetingDialog.cancel
app.quitDialog.title
app.quitDialog.body  (활성 회의 N 개 + 채널 목록)
app.quitDialog.pauseAndQuit
app.quitDialog.waitFinish
app.quitDialog.cancel
meeting.partialSummary.consensusHeading
meeting.partialSummary.disagreementHeading
meeting.partialSummary.unresolvedHeading
```

ko / en 양쪽 추가.

### 9.5 대시보드 KPI

- "진행 회의" → "활성 회의" 라벨 변경 (i18n key `dashboard.kpi.activeMeetings` 본문 변경, 키는 그대로).
- 카운트 정의: `meetings.ended_at IS NULL` 그대로 (paused 포함). 라벨이 "활성" 이므로 의미 정합.

---

## 10. 에러 / 엣지 케이스

| 케이스 | 동작 |
|---|---|
| 메시지 송신 시 활성 회의 조회 IPC 실패 | 메시지는 그대로 append (사용자 입력 손실 안 함). 자동 트리거만 skip. UI 에 "회의 시작 실패 — 재시도" toast |
| 회의 자동 생성 직후 SSM init 실패 | 회의 row 즉시 `ended_at = now()` + `outcome = 'init-failed'` stamp. 사용자에게 toast |
| 동시 메시지 race (사용자 빠른 enter 연타) | `idx_meetings_active_per_channel` unique 가 두 번째 INSERT 거절 → 두 번째 메시지 쪽 hook 이 catch → 첫 회의로 합류 |
| autonomy = manual + 회의 자동 시작 후 사용자 승인 안 함 | 회의는 PAUSED state 같이 wait. 사용자가 승인 또는 [회의 종료] 누를 때까지 그대로 |
| 라운드 한계 도달 시 LLM 요약 호출 실패 | fallback "회의가 라운드 한계로 종료됨" 한 줄 #회의록 포스팅. 다음 부팅에 영향 없음 |
| 일시정지 회의 재개 시 SSM rehydrate 실패 | `meetings.outcome = 'rehydrate-failed'` stamp + 사용자에게 toast. 회의 종료 처리 |
| 앱 종료 다이얼로그에서 사용자가 [취소] 후 다시 닫기 시도 | 같은 다이얼로그 다시 노출 (idempotent) |
| 같은 멤버가 동시 N 회의에서 호출되어 rate-limit 발생 | provider rate-limit 기존 메커니즘 (extended timeout, retry) 그대로. 사용자에겐 응답 지연 배지 |

---

## 11. 테스트 전략

### 11.1 단위 테스트

- `MeetingAutoTrigger` (또는 hook 함수): 채널 종류별 분기 (DM / system rw / system ro / user) 4 케이스. 활성 회의 있음/없음 2 케이스. 합 8 시나리오.
- 토픽 슬라이스: 짧은 / 긴 / 정확히 80자 / 빈 / 한글 (4 byte char) edge.
- per-meeting CliSessionState: 두 meetingId 동시 호출 시 state 격리 검증 — sessionId 교차 오염 안 함.
- 라운드 한계 종료 + partial 요약 fallback.

### 11.2 통합 테스트

- 메시지 → 회의 자동 시작 → SSM DONE → #회의록 포스팅 e2e.
- 일시정지 → 다음 부팅 rehydrate → 재개 → 새 turn 진행 e2e.
- 동시 3 채널 자동 트리거 → 각 회의 독립 진행.

### 11.3 dogfooding 검증 시나리오

dogfooding round3 에서 사용자가 직접 확인:
- #일반 / DM 모두 메시지 보내면 응답 옴.
- #기획 + #디자인 + #구현 동시 회의 진행 — 같은 직원 끼인 케이스에서 답변 꼬임 없음.
- 회의 진행 중 다른 채널 봐도 해당 회의 계속.
- 앱 닫기 시 다이얼로그 → 일시정지 → 재부팅 → 재개 가능.
- DM 은 회의 안 만들고 그냥 1 턴 응답.
- autonomy = manual 시 회의는 시작되지만 첫 발언 승인 대기.

### 11.4 회귀

- 기존 R6 / R7 / R10 / R11 회의 / 메시지 / 합의 / 회의록 / 결재 흐름 그대로 통과.
- 기존 E2E 테스트 (`e2e/messenger-flow.spec.ts`, `e2e/meeting-flow.spec.ts`) 가 자동 트리거 도입에 깨지지 않는지 — 깨지는 부분은 spec 변경에 맞춰 수정.

---

## 12. spec / ADR 갱신

### 12.1 spec 본문 수정 (`docs/specs/2026-04-18-rolestra-design.md`)

- §7.4 "채널 시스템" 의 "채널 내 회의 시작" 절 — 본 spec 으로 대체. 사용자 명시 시작 → 자동 시작 + 명시 종료.
- §7.4 "DM" 절 — 자동 응답 모델 명시.
- §7.5 대시보드 KPI 라벨 "진행 회의" → "활성 회의".
- §8 SSM — `paused_at` 칼럼 + 일시정지/재개 SSM transition 명시.

### 12.2 ADR 신규

`docs/decisions/cross-cutting.md` 에 추가:
- **CC-N**: 메시지 자동 회의 트리거 + AI 복제 모델 — D-A 결정 종합.

또는 D-A 가 R12 phase 의 첫 ADR 이라면 새 파일 `docs/decisions/R12-decisions.md` 신설하여 D-A 를 첫 항목으로.

### 12.3 메모리 갱신 (구현 완료 후)

- `rolestra-phase-status.md` — D-A merge 완료 시점 갱신.
- `rolestra-r12-turn-status-and-dev-logs.md` — D-A 진입 시 "다음 세션" 항목 갱신.

---

## 13. 미해결 / E 작업으로

- **방 간 업무 인계** (E): D-A 완료 후 별도 spec. `rolestra-e-cross-room-handoff.md` 에 7 결정 항목.
- **C 작업 — 초기화 버튼**: D-A 와 독립. 별도 세션에서 진행.
- **D-A 의 long-term**: dogfooding round3 후 자동 트리거가 답답한 케이스 (예: 잠깐 메모용 메시지 인데 회의 시작됨) 가 보이면 채널별 "자동 트리거 OFF" 옵션 검토 — 현재 의도적으로 만들지 않음.

---

## 14. 변경 영향 (구현 단위 추정)

| 영역 | 파일 (추정) | 변경 규모 |
|---|---|---|
| DB | `migrations/016-meeting-paused-at.ts` | 신규 |
| Main / 회의 | `meetings/auto-trigger.ts` (신규), `meetings/meeting-service.ts`, `meetings/engine/meeting-orchestrator.ts`, `channels/channel-service.ts`, `ipc/handlers/meeting-handler.ts`, `ipc/handlers/channel-handler.ts` | 중규모 |
| Main / DM | `channels/dm-auto-responder.ts` (신규) — DM 단일 turn 핸들러 | 신규 |
| Main / providers | `providers/cli/cli-session-state.ts` (per-meeting Map 화), `providers/cli/cli-provider.ts` (sessionContext arg) | 중규모 |
| Main / index | 앱 종료 hook (`before-quit`) + 일시정지 IPC | 소규모 |
| Renderer / Channel sidebar | `features/messenger/ChannelRail.tsx` (회의 활성 라벨 + hover swap), 신규 컴포넌트 `MeetingStatusLabel` | 중규모 |
| Renderer / ChannelHeader | `features/messenger/ChannelHeader.tsx` (수동 [회의 시작] 숨김), 신규 `MeetingTopicEditor` | 소규모 |
| Renderer / Quit dialog | `App.tsx` 또는 신규 `AppQuitMeetingDialog` | 신규 |
| Shared / IPC types | `ipc-types.ts`, `ipc-schemas.ts` (4 신규 채널) | 소규모 |
| i18n | `locales/ko.json`, `locales/en.json` (15+ 신규 키) | 소규모 |
| 테스트 | 단위 테스트 + e2e 시나리오 | 중규모 |

총 추정: 중대형 작업. 11~14 task 분할 (writing-plans 단계에서 정확화).

---

## 15. 참고

- spec 본문: `docs/specs/2026-04-18-rolestra-design.md` §7.4, §7.5, §8.
- ADR: `docs/decisions/cross-cutting.md` C1 (ConsensusStateMachine), C2 (Provider Capability), C3 (ExecutionService 경계).
- round1 보고: `rolestra-dogfooding-round1.md` #2.
- round2 A+B (이미 구현됨, uncommitted): `rolestra-r12-turn-status-and-dev-logs.md`. D-A 의 turn status / dev logger 와 직접 연동 — D-A 구현 시 round2 A+B 를 그대로 활용.
- 사용자 원칙: `rolestra-feedback-chat-affordance-honesty.md`, `rolestra-dm-identity.md`.
- 후속 작업: `rolestra-e-cross-room-handoff.md`.
