---
name: R12-C2 T14 종결 — MessageRenderer 카드 variant + 채팅창 의견 카드 (2026-05-05)
description: R12-C2 Round 2 P3 진입 1 호 완료. CardVariant.tsx (opinion 6 kind + minutes 3 source × 6 테마) + Thread.tsx dispatcher 분기 + MessageMeta opinion/minutes 타입 + i18n messageCard 키 추가. 다음 T15 (idea-workflow) 또는 T16 (design-workflow) 진입 가이드.
type: project
---
# R12-C2 T14 종결 (2026-05-05)

worktree `feat/r12-c2-redesign-r2`, base `6b5cb59` = T13 (`fe7b452` work-log mirror 위). 7 파일 / +996 / -0 (production code +617, test +359, i18n +62).

**Why:** spec §11.13a — 회의 안 의견 발화 (`opinion` row root/revise/block/addition) + 일반 채널 [##본문] (self-raised/user-raised) + 회의록 (compose_minutes 출력) 이 채팅창 안에서 *Card primitive* (R3 시점 land) 로 렌더되어야 한다. 본 sub-task = P3 신규 surface 1 호. T15 / T16 / T17 (부서별 workflow) 가 본 카드 위에서 실제 액션을 wire 한다.

**How to apply:** 새 세션 진입 시 T15 (P3-2 idea-workflow) 또는 T16 (P3-3 design-workflow) 진입 — 본 카드의 `opinionHandlers` props 를 workflow 측에서 주입한다. 액션 버튼은 미주입 시 footer 자체 렌더 X (placeholder 버튼 금지 — CLAUDE.md mock/fallback rule 준수).

## 산출 요약

### 1. shared 타입 확장 (`src/shared/message-types.ts`)

- `MessageMeta` 에 `opinion?: OpinionCardMeta` + `minutes?: MinutesCardMeta` 두 필드 추가.
  - 본문 truncate 금지 + author/screen ID 표시는 spec §11.13a 그대로.
  - `OpinionCardMeta` = `{ opinionRef, opinionKind, opinionScreenId, authorLabel, opinionTitle?, opinionRationale? }`.
  - `MinutesCardMeta` = `{ minutesPath, minutesSource, minutesProviderId? }` — 기존 orchestrator `compose_minutes` phase 에서 이미 사용 중인 비공식 키를 정식 타입화.
- `hasOpinionMeta(meta)` / `hasMinutesMeta(meta)` type guard — Thread.tsx + CardVariant 가 dispatch 분기에 사용.
- `OpinionKind` 는 `opinion-types.ts` 에서 import (cyclic 없음, opinion-types 가 import 안 함).

### 2. CardVariant 컴포넌트 (`src/renderer/features/messenger/MessageRenderer/CardVariant.tsx`)

- `MessageCardVariant` entry 컴포넌트 — meta 보고 OpinionCard / MinutesCard 분기. 둘 다 없으면 null 반환 (defensive).
- `OpinionCard` — Card + CardHeader (authorLabel / screenId / kind label / title) + CollapsibleBody + OpinionActionFooter.
- `MinutesCard` — Card + CardHeader (minutes title + source) + CollapsibleBody + MinutesActionFooter.
- `CollapsibleBody` — body 가 600 자 초과 시 collapsed default + max-height 240px + [더 보기] / [접기] 토글. **truncate 가 아니다** — DOM 안 본문은 항상 통째 (CSS overflow 만 가린다). spec §11.13a "본문 truncate 금지 — long content 도 카드 안 scroll 또는 expand 버튼" 준수.
- `OpinionActionFooter` — props.handlers 에 따라 동적 버튼 노출:
  - `onVote` → [동의] / [반대] (모든 opinion kind)
  - `onSelectToggle` → [선택] / [선택 취소] (`kind='root'` 만 — idea-workflow 한정)
  - `onPropose` → [수정안 제시] (root / revise / block / addition 만 — self-raised / user-raised 는 회의 surface 외)
  - 핸들러 미주입 → footer 자체 렌더 X.
- `MinutesActionFooter` — `onMinutesOpen` → [전체 보기], `onHandoff` → [다음 부서로 인계].
- `isCardMessage(message)` helper export — Thread.tsx 가 dispatch 분기에 사용. `system` author + minutes meta 인 경우 SystemMessage 가 아닌 MinutesCard 로 가야 한다.

### 3. Thread.tsx dispatcher 갱신 (`src/renderer/features/messenger/Thread.tsx`)

- `ThreadItem` discriminated union 에 `{ kind: 'card'; key; message }` 추가.
- items builder 안 `isApprovalMessage` 다음, `isSystemMessage` *전* 에 `isCardMessage` 분기 추가 — minutes 메시지가 SystemMessage 로 흐르는 것을 차단.
- items.map 안 `kind === 'card'` 분기 — `<MessageCardVariant message={it.message} />` 렌더. 본 sub-task 시점 핸들러 미주입 (T15+ workflow sub-task 가 wire).

### 4. i18n locale 키 (`src/renderer/i18n/locales/ko.json` + `en.json`)

- `messenger.messageCard.expand` / `.collapse`
- `messenger.messageCard.opinion.kindLabel.{root|revise|block|addition|self-raised|user-raised}`
- `messenger.messageCard.minutes.title`
- `messenger.messageCard.minutes.source.{moderator|moderator-retry|fallback}`
- `messenger.messageCard.action.{agree|oppose|select|unselect|propose|minutesOpen|handoff}`

### 5. snapshot 테스트 (`src/renderer/features/messenger/MessageRenderer/__tests__/CardVariant.test.tsx`)

총 69 테스트, 6 그룹:

1. **`isCardMessage` dispatcher (4)** — opinion meta / minutes meta / plain / 부분 누락 (silent fallback 검증).
2. **6 테마 × 6 opinion kind 렌더 (36)** — `data-card-variant=opinion` + `data-opinion-kind=*` + `data-theme-variant=*` + 헤더 authorLabel/screenId 표시 + 본문 통째.
3. **본문 collapse / expand (2)** — 짧은 본문 = 토글 X, 긴 본문 = collapsed default + 토글 클릭 시 펼침. truncate 없이 DOM 안 본문 통째 보존.
4. **opinion 액션 버튼 (handlers 기반, 6)** — 미주입 footer 미렌더 / onVote / onSelectToggle root only / onPropose self-raised|user-raised 제외 / onPropose root|revise|block|addition 노출 / selected=true 라벨.
5. **minutes variant (3 source × 6 테마 + handlers, 19)** — 카드 attrs / 본문 [합의]+[제외] 통째 / [전체 보기] + [다음 부서로 인계] 핸들러 호출.
6. **null fallback (1)** — meta 둘 다 없으면 null 반환.

## 검증

- `npm run typecheck:web` — **0 error**.
- `npm run typecheck:node` — **0 error**.
- `npm test` (전체) — **3351 PASS / 13 skip / 0 fail** (T13 baseline 3282 + 69 신규).
- `npm run inspect:safety` — **95 hits** (T13 baseline 95 와 동일 — T14 추가 위반 0).
- `npm run lint` — 본 sub-task 변경 파일 0 위반 (사전 50 problems 는 unrelated, T13 이전 baseline 그대로).

## 핵심 결정

1. **MessageMeta 정식 타입화** — 기존 `[k: string]: unknown` open-end 위에 `opinion?` / `minutes?` 두 옵션 필드만 추가. 다른 비공식 키 (`turnSkipped` / `handoff` / `maxRoundsReached` 등) 는 그대로 유지 — 본 sub-task 는 P3 surface 만, 다른 비공식 키 정리는 cleanup 별 round.
2. **CardVariant = surface only.** 액션 버튼 핸들러는 부모 props 로 분리 — Thread.tsx 가 본 sub-task 시점 미주입. T15+ workflow sub-task 가 wire (idea-workflow → onSelectToggle, design/planning/review/audit-workflow → onVote/onPropose, planning workflow → onHandoff/onMinutesOpen). spec §11.13a 도 "DM / 일반 / 부서 채널 모두 같은 Card primitive" 라 부서별 차이를 props 단계에서 주입하는 모델이 자연.
3. **truncate 금지 → CSS max-height + overflow.** spec §11.13a "잘리지 말고 통째" 정확 준수 — DOM 안 본문은 항상 full content, collapsed 상태에서도 `<div>` 안 텍스트는 그대로. CSS `max-height: 240px; overflow: hidden` 만 사용.
4. **600 자 threshold.** 일반 의견 본문 (≤ 200~300 자) 은 통째 펼침 default, long markdown / 회의록 (몇 KB) 은 collapsed default. 사용자 토글로 항상 즉시 전환.
5. **kind 별 액션 분기** — root 만 onSelectToggle (idea workflow), self-raised/user-raised 는 onPropose 차단 (회의 surface 외). spec §11.13 부서별 layout 표 의 row 별 동작과 정합.
6. **dispatcher 분기 위치** — `isCardMessage` 가 `isSystemMessage` *전* 에 와야 한다. minutes 메시지는 `authorKind='system'` 이라 isSystemMessage 가 먼저 잡아버리면 SystemMessage 로 흐른다. 순서 = approval → card → system → message.
7. **opinion 메시지 → 채팅창 row 자동 wire 미land.** Orchestrator gather/quick_vote/free_discussion 이 opinion row 만 insert 하고 message row 는 *직원 응답 raw JSON* 으로만 append (`persistAssistantMessage`). T14 시점 채팅창에는 opinion 메시지가 표시되지 않는다 — *surface 만 준비*. opinion → message linkage 는 별 sub-task (T13b 또는 T15 wire 시점에 함께). Thread.tsx 가 isCardMessage 를 보더라도 production 메시지 row 에는 아직 opinion meta 가 없어 분기 미발동.

## 다음 진입 가이드

**T15 (idea-workflow)** — 의존 = T13 land 후. plan §P3 T15.

- 신규 모듈: `src/main/meetings/workflows/idea-workflow.ts` — D-B-Light 흐름 (gather + quick_vote 만, step 2.5 / 3 / 4 / 5 surface X).
- 신규 UI: `IdeaCardList` (SsmBox 우측) — `kind='root'` 카드 list + 사용자 선택 체크 + 자유 코멘트 textarea + [기획 부서로 보내기] 버튼.
- T14 의 `MessageCardVariant` 의 `onSelectToggle` 핸들러를 IdeaCardList 가 wire — 사용자 선택 상태 zustand store 안 보존, [보내기] 버튼이 선택된 opinion list + 자유 코멘트 → 기획 부서 인계 IPC.

**T16 (design-workflow)** — 의존 = T13 + T14 land 후 (현 시점부터 가능). plan §P3 T16.

- 와이어프레임 5 단계 + 디자인 2 단계 흐름.
- `<DesignPreview>` 컴포넌트 (별 sub-task 안 컴포넌트 분리) — desktop 1280x720 / mobile 375x812 탭.
- `playwright-snapshot.ts` (off-screen Chromium → PNG, PathGuard 봉인).

**T17 (review/audit-workflow)** — 의존 = T13 + T14 land 후. plan §P3 T17.

- review = chain 외 (사용자 명시 호출 + 검토 인계 결재 모달 안 체크박스 entry).
- audit = chain 끝 (NG 시 기획 자동 인계 분기 — 본 sub-task 는 분기 본체 X, T25 land).

## 위험 / 미land 영역

- **opinion → 채팅창 row wire 미land.** orchestrator gather/quick_vote/free_discussion 이 opinion row 만 insert. 채팅창에 카드 뜨려면 별 sub-task 가 OpinionService.gather 결과로 messageService.append 호출 추가 필요. 본 sub-task 의 surface 는 production 시 *조용히* (분기 미발동, 사용자 영향 0). T15+ workflow wire 시점에 함께 land 권장.
- **handoff 결재 모달 미land.** spec §11.18.8b 룰 5 (minutes+chain → handoff) 가 `MessageCardVariant` 의 minutes 카드 [다음 부서로 인계] 버튼으로 surface 되지만 본 sub-task 는 *버튼만 준비*. 모달 본체는 T27 (P6 진입 1 호 — HandoffApprovalModal land). 그 전까지는 handoff handler 미주입 = 버튼 미렌더.
- **i18n parser 정합 미검증.** i18next-parser 가 `messenger.messageCard.opinion.kindLabel.${kind}` 같은 동적 키를 keepRemoved regex 로 보존하도록 i18next-parser.config.js 갱신 여부는 별 round. 현재 lint 0 위반이지만 다음 i18n 정리 sub-task 에서 확인.
