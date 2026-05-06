---
name: R12-C2 T20 종결 — 일반 채널 [##본문] 파서 + PostOpinionModal (P4 진입 1 호, 2026-05-06)
description: R12-C2 Round 2 P4 진입 1 호 완료. 일반 채널 (system_general 또는 user role='general') 메시지 자동 [##본문] 카드 등록 + 별 entry 모달. 다음 T21 (일반 SsmBox final variant) 진입 가이드.
type: project
---

# R12-C2 T20 종결 (2026-05-06)

worktree `feat/r12-c2-redesign-r2`, base `db0edef` (= T19 work-log mirror, T19 production `209e97c` 위). 21 파일 / +1907 / -2 (8 신규 + 13 변경 — tasks.json 포함).

production commit `409b8e5`.

**Why:** spec §4 일반 부서 새 정의 + §11.13 SsmBox general row — 일반 채널 (잡담 정체성) 안에서 [##본문] 으로 감싼 segment 만 의견 카드로 등록한다. 회의 X / 합의 X / 인계 X. P1.5 회귀 차단 (T0) 이 *옛 1라운드 응답 / 12 단계 SSM 회귀* 를 막았고, 본 T20 이 **새 카드 모델** 을 land 한다. P4 진입 1 호 = P3 (T15~T19 부서 workflow + RunStep + SsmBox) 다음 자리.

**How to apply:** 새 세션 진입 시 T21 (P4 진입 2 호 — 일반 SsmBox final variant) 진입. T21 의존 = T19 + T20 = 모두 충족. T21 = T18 의 GeneralVariant placeholder 위에 카운터 (직원+사용자 가벼운 동의/반대) + 사용자 동의/반대 버튼 land. opinion_vote round_kind 'light' 추가 (migration 없이 CHECK 제약만 확장)는 T21 시점.

## 핵심 결정 + 산출

### 8 신규 + 13 변경 = 21 파일

**신규 8:**
- `src/shared/parsers/double-hash-parser.ts` — 순수 함수 `parseDoubleHash(text): DoubleHashMatch[]` + DoubleHashMatch (body/start/end). `[##` 시작 / 첫 `]` 종결 (중첩 disallow) / trim 후 빈 본문 skip / 닫히지 않은 `[##` skip / matchAll 등장 순서 유지.
- `src/shared/__tests__/double-hash-parser.test.ts` — 18 항목 (0/1/N 매칭 + 빈 본문 / whitespace 본문 / 닫히지 않은 / 중첩 / 줄바꿈 / 한글 + 특수문자 / start/end index / 연속 [##a][##b] / `[#single hash]` skip).
- `src/main/channels/general-channel-opinion-flow.ts` — `GeneralChannelOpinionFlow.onMessage(message)` listener + `isGeneralChannel` helper export. system_general 또는 user role='general' 만 처리 / authorKind='system' skip / 채널 lookup 실패 skip + 로그 / parser 0 건 silent skip / N 건 → 단일 batch postFromGeneralChannel 호출 / service throw → listener swallow + 로그 (message 영속 흐름 유지).
- `src/main/channels/__tests__/general-channel-opinion-flow.test.ts` — 17 항목 (system_general user-raised / user role='general' / member self-raised / N 건 batch / 빈 본문 skip / authorKind='system' skip / 부서 / DM / system_approval / system_minutes / lookup null / service throw swallow / isGeneralChannel 진리표 5).
- `src/renderer/features/messenger/PostOpinionModal.tsx` — Radix Dialog + 제목 (선택, max 400) + 본문 (필수, textarea, max 100,000). 빈 본문 → submit disabled. 빈 / whitespace 제목 → backend 에 title=null normalize. PostFromGeneralValidationError → validation 에러 메시지 / 그 외 → generic. 모달 open 마다 reset.
- `src/renderer/features/messenger/__tests__/PostOpinionModal.test.tsx` — 13 항목 (open/close 3 + submit gating 3 + success 3 + error 2 + open reset 1 + hex guard 1).

**변경 13:**
- `src/main/meetings/opinion-service.ts` — `postFromGeneralChannel(input)` 메서드 + `PostFromGeneralValidationError`. parts.length === 0 throw / 빈 content (whitespace-only) throw / kind=authorProviderId null→user-raised, 그 외→self-raised / authorIdentifier=authorProviderId ?? 'user' / authorLabel = `${authorIdentifier}_${listByChannel 안 같은 author 카드 수 + 1 + i}` (batch 안 incremental) / title null → deriveUserCommentTitle (회의 카드와 공유) / meetingId=null parentId=null status='pending' round=0 / content trim.
- `src/main/meetings/__tests__/opinion-service.test.ts` — 9 항목 신규 (user-raised label 'user_1' / self-raised provider 별 카운터 / title=null derive 첫 줄 / 80 자 cut + 말줄임 / batch 카운터 base 기존 row 기반 / author 별 독립 카운터 / parts 빈 throw / whitespace content throw / content trim / 회의+일반 같은 author 카운터 합산 — label 표시용 식별자).
- `src/shared/opinion-types.ts` — PostFromGeneralChannelInput / PostFromGeneralChannelResult export.
- `src/shared/ipc-types.ts` — 'opinion:postFromGeneral' 채널 정의.
- `src/shared/ipc-schemas.ts` — `opinionPostFromGeneralSchema` (channelId 1..128 / authorProviderId 1..128 nullable / parts 1..32, title 1..400 nullable / content 1..100,000) + v3ChannelSchemas 등록.
- `src/main/ipc/handlers/opinion-handler.ts` — `handleOpinionPostFromGeneral` 추가 (다른 4 opinion 핸들러와 동일 패턴).
- `src/main/ipc/handlers/__tests__/opinion-handler.test.ts` — 1 항목 신규 (postFromGeneral forwards args + wraps result).
- `src/main/ipc/router.ts` — 핸들러 등록 (`isDev` gate, 다른 opinion 채널과 동일).
- `src/main/index.ts` — GeneralChannelOpinionFlow 인스턴스 + messageService.on('message') 추가 listener (meeting-auto-trigger 와 책임 분리, listener throw isolate try/catch).
- `src/renderer/features/messenger/ChannelHeader.tsx` — `onPostOpinion` prop + `isGeneralChannel` 헬퍼 (system_general 또는 user role='general') + [의견 게시] 버튼 (showPostOpinion = isGeneralChannel(channel) && onPostOpinion 정의 둘 다 만족 시만 노출).
- `src/renderer/features/messenger/__tests__/ChannelHeader.test.tsx` — 5 항목 신규 (system_general 노출 + 클릭 / role='general' 노출 / role='planning' 미노출 / onPostOpinion 미정의 미노출 / DM 미노출) + makeChannel 디폴트 role/purpose/handoffMode/maxRounds 추가.
- `src/renderer/features/messenger/Thread.tsx` — postOpinionOpen state (early return *위* hooks 룰 — `if (activeChannel === null)` 위) + handlePostOpinion useCallback + ChannelHeader.onPostOpinion + PostOpinionModal hosting (channelId=activeChannel.id).
- `src/renderer/i18n/locales/ko.json` + `en.json` — `messenger.channelHeader.postOpinion` (버튼 라벨) + `messenger.postOpinion` 섹션 (title/cancel/submit/contentLabel/titleLabel/titleHint/titlePlaceholder/contentPlaceholder/description + errors 5 종 contentRequired/contentTooLong/generic/titleTooLong/validation).
- `docs/plans/2026-05-04-rolestra-phase-r12-c2.md.tasks.json` — T20 status='completed' + land summary.

### Verify
- typecheck:web 0 / typecheck:node 0
- vitest **3538 PASS / 13 skip** (T19 baseline 3474 → +64: parser 18 + flow 17 + modal 13 + service 9 + ChannelHeader 5 + handler 1 + 기존 ChannelHeader makeChannel 디폴트 1).
- inspect:safety **95** (T19 동일, 신규 코드 위반 0 — 신규 모두 순수 helper / Radix Dialog UI / IPC adapter).

### 핵심 결정

1. **파서 단순성** — `/\[##([^\]]*)\]/g` regex + 첫 `]` 종결 (중첩 disallow). escape 룰 없음 — 본문에 `]` 가 필요하면 두 segment 로 나눠 작성. 사용자가 모달 별 entry 도 쓸 수 있어 escape 부재가 표현력 갭이 안 됨.
2. **모달 vs 자동 파서 = 동일 backend surface** — 둘 다 `OpinionService.postFromGeneralChannel` 호출. 차이 = caller (모달 = `null` author / 파서 = message author). 코드 중복 0.
3. **자동 파서 wire 위치 = 별도 listener** — meeting-auto-trigger 와 같은 'message' 이벤트를 받지만 책임 분리. meeting-auto-trigger = 회의 모델 라우팅 / 본 flow = 카드 등록. 둘이 race 안 함 (둘 다 read-only flow + opinion insert 만).
4. **listener throw isolate** — service throw 시 silent swallow + 로그 (silent fallback X — 로그 loudly). message 영속은 이미 끝났으므로 카드 등록 실패가 사용자 입력을 막아선 안 됨.
5. **authorLabel 식별자 시맨틱** — 표시용. 회의 안 카드와 일반 카드 같은 author 면 카운터 *합산* (분리 X) — '같은 사람의 N 번째 발화' 가 자연스러운 의미. label 은 진실원천 (provider id + parent chain) 위 표시 layer 일 뿐.
6. **author 'user' literal vs USER_AUTHOR_LITERAL** — authorLabel 형식은 freeform string. 모듈 import 회피해 service 가 channelService / messageService 에 의존 안 하도록 (좁은 surface 유지).
7. **모달 [의견 게시] 버튼 =  user-raised 만** — 모달 직원 발화 surface 는 spec 상 정의 X (직원은 메시지 안 [##본문] 으로 자동 등록). 모달은 사용자만.
8. **early return 위 hooks 룰** — Thread.tsx 의 useState/useCallback 은 `if (activeChannel === null)` *위* 에 둔다. (회귀 1 회 fix — Thread.test.tsx 9 fail → 9 PASS).

### 발견 (T20 외 scope)

**user role='general' 채널 회의 모델 차단 가드 누락** — meeting-auto-trigger.ts 는 system_general (전역) 만 dm-auto-responder 위임 / role='general' user 채널은 handleMeetingChannel 진입. 본 T20 은 *카드 등록 분기* 만 추가했고 *회의 모델 차단* 은 별도. P1.5 후속 (회귀 차단 확장) 으로 land 권장 — `meeting-auto-trigger.ts` 의 system_general 분기에 `isGeneralChannel(channel)` 진리값을 사용하면 한 줄 fix.

## 다음 진입

**T21 — P4 진입 2 호 — 일반 SsmBox final variant**

T21 의존 = T19 (RunStep aggregator) + T20 (본 sub-task) — 둘 다 충족.

산출 (예상):
- `src/renderer/features/messenger/SsmBox/GeneralVariant.tsx` final — opinion 누적 카드 list + 가벼운 동의/반대 카운터 (직원+사용자 양쪽) + 사용자 동의/반대 버튼.
- IPC `opinion:lightVote(opinionId, vote)` — opinion_vote 신규 round_kind='light' (migration 없이 CHECK 제약 확장).
- 합의/회의록/인계 surface X 유지.

Verify (예상): vitest snapshot + e2e (모달 → 카드 등장 → 사용자 동의 클릭 → 카운터 증가).

**T22 (일반 채널 RunStep 분기)** 의존 = T13 + T20 + T21 — T21 land 후 진입. RunStepService 의 일반 채널 분기 (meeting_id NULL 허용) + T19 aggregator 가 일반 채널 카드 카운트 → 대시보드 위젯 ("일반 — 잡담 카드 N").
