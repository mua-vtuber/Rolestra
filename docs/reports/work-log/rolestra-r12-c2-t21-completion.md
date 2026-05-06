---
name: R12-C2 T21 종결 — 일반 SsmBox final + light vote (P4 진입 2 호, 2026-05-06)
description: R12-C2 Round 2 P4 진입 2 호 완료. 일반 채널 GeneralVariant 본체 (카드 누적 list + 가벼운 동의/반대 카운터 + 사용자 동의/반대 버튼). migration 021 round_kind 'light' 추가 + opinion:listGeneralCards/toggleLightVote IPC. 다음 T22 (일반 채널 RunStep 분기) 진입 가이드.
type: project
originSessionId: 745d3321-cadb-4153-82f6-3ccf7d1188e9
---
# R12-C2 T21 종결 (2026-05-06)

worktree `feat/r12-c2-redesign-r2`, base `2a8cbdc` (= T20 work-log mirror, T20 production `409b8e5` 위). production commit (TBD) + work-log mirror (TBD).

**Why:** spec §11.13 general row — "카드 누적 list + 가벼운 동의/반대 카운터 + 사용자 동의/반대 버튼. 합의/회의록/인계 surface 모두 X (잡담 정체성 유지)". T20 이 [##본문] 파서 + 모달 entry 를 land 했고, T21 이 그 카드를 *볼 수 있는* SsmBox 본체 + 사용자가 *반응* 할 수 있는 light vote toggle 을 land. P4 진입 2 호 = T20 의 backend surface 위에 UI surface 완성.

**How to apply:** 새 세션 진입 시 T22 (P4 진입 3 호 — 일반 채널 RunStep 분기) 권장. T22 의존 = T12 + T19 + T20 = 모두 충족. T22 = RunStepService 가 일반 채널 메시지도 영속 (step_kind='opinion_gather' + actor_kind='employee'/'user', meeting_id NULL 허용) + T19 aggregator 가 일반 채널 카드 카운트 → 대시보드 위젯 ("일반 — 잡담 카드 N").

## 핵심 결정 + 산출

### 신규 5 + 변경 9 = 14 파일 (대략, tasks.json 포함)

**신규 5:**
- `src/main/database/migrations/021-opinion-vote-light.ts` — opinion_vote.round_kind CHECK 제약 확장 (`'quick_vote' | 'free_discussion'` → `+ 'light'`). SQLite 가 ALTER CHECK 직접 안 되므로 12-step rebuild 패턴 사용 (CREATE opinion_vote_new + INSERT … SELECT + DROP + RENAME + 인덱스 재생성). migrator 가 트랜잭션 wrap 하므로 본 SQL 안 BEGIN/COMMIT 불필요. forward-only invariant 유지 — DROP 은 chain 안 *rebuild* 이지 *rollback* 아님.
- `src/main/database/__tests__/migration-021.test.ts` — 11 항목 (CHECK 'light' accept 1 / quick_vote+free_discussion 호환 2 / 'lazy' 거부 1 / 인덱스 재생성 1 / 컬럼 8 보존 1 / FK CASCADE+SET NULL 보존 + voter NULL 허용 3 / migrations index 20 1 / idempotency 1).
- `src/renderer/hooks/use-general-opinion-cards.ts` — `useGeneralOpinionCards(channelId)` hook. mount + channelId 변경 시 `opinion:listGeneralCards` 1 회 호출 + stream:channel-message 도착 시 같은 channelId refetch + `toggleLightVote(opinionId, vote)` 함수 — IPC 호출 후 결과의 카드 1 건만 in-place patch (전체 list refetch 없이). channelId=null → cards=null + loading=false (skip).
- `src/renderer/features/messenger/__tests__/GeneralVariant.test.tsx` — 6 항목 (cards 0 → empty / cards 2 → 제목+본문+author label / 정렬 등록 역순 / userVote=agree 버튼 active / 동의 버튼 클릭 → IPC 호출 + 카운터 갱신 / 반대 버튼 클릭 → IPC 호출).
- (work-log mirror — `docs/reports/work-log/rolestra-r12-c2-t21-completion.md`, T20 패턴.)

**변경 9:**
- `src/main/database/migrations/index.ts` — `m021` import + migrations 배열 끝에 추가.
- `src/main/meetings/opinion-repository.ts` — 3 메서드 추가: `listLightVotesByChannel(channelId)` (opinion 과 inner join 으로 channel_id + round_kind='light' 필터, T21 의 단일 query source) / `findUserLightVote(opinionId)` (voter_provider_id IS NULL + round_kind='light' LIMIT 1, T21 toggle invariant 검사) / `deleteVote(voteId)` (toggle 의 취소 / 대체 path 에서 사용).
- `src/main/meetings/opinion-service.ts` — 2 메서드 + 1 에러 추가: `listGeneralCards(channelId)` (kind='self-raised'/'user-raised' 필터 + listLightVotesByChannel 1 회로 카드별 agree/oppose/userVote 집계, abstain 카운터 미반영) / `toggleLightVote(input)` (DELETE-or-INSERT-or-REPLACE — 같은 vote 재요청 = removed, 반대 vote = replaced, 처음 = inserted. 호출 후 listLightVotesByChannel 1 회로 대상 카드 카운터 재계산해 응답에 동봉) / `LightVoteTargetError` (kind != self-raised/user-raised OR meetingId !== null 시 throw).
- `src/main/meetings/__tests__/opinion-service.test.ts` — 11 항목 신규 (listGeneralCards: 빈 / kind 필터 / 정렬 / 초기 카운터 0 = 4 / toggleLightVote: inserted / removed / replaced / list 반영 / NotFoundError / TargetError / 사용자 voter 1 인 invariant = 7).
- `src/shared/opinion-types.ts` — `OpinionRoundKind` union 에 `'light'` 추가 + 신규 4 타입 export: `GeneralOpinionCard` (Opinion + agreeCount/opposeCount/userVote) / `ListGeneralCardsResult` / `ToggleLightVoteInput` (vote = 'agree'/'oppose' 만, abstain UI 미노출) / `ToggleLightVoteResult` (effect = 'inserted'/'removed'/'replaced' + userVote + 카운터).
- `src/shared/ipc-types.ts` — 2 채널 정의: `'opinion:listGeneralCards'` (channelId → ListGeneralCardsResult) / `'opinion:toggleLightVote'` (opinionId+vote → ToggleLightVoteResult).
- `src/shared/ipc-schemas.ts` — `opinionListGeneralCardsSchema` + `opinionToggleLightVoteSchema` (vote enum 'agree'/'oppose' 만 허용) + v3ChannelSchemas 등록.
- `src/main/ipc/handlers/opinion-handler.ts` — `handleOpinionListGeneralCards` + `handleOpinionToggleLightVote` 추가 (다른 opinion 핸들러와 동일 위임 패턴).
- `src/main/ipc/handlers/__tests__/opinion-handler.test.ts` — 2 항목 신규 + ServiceMock 확장.
- `src/main/ipc/router.ts` — 두 채널 등록 (`isDev` gate, 다른 opinion 채널과 동일).
- `src/renderer/features/messenger/SsmBox/index.tsx` — `'general'` role 분기 시 channelId 도 GeneralVariant 에 전달.
- `src/renderer/features/messenger/SsmBox/GeneralVariant.tsx` — final 본체 (T18 placeholder 위에 useGeneralOpinionCards hook + 카드 list `<ul>` + 카운터 + 동의/반대 버튼 + i18n + Tailwind 토큰 success/danger). 카드 정렬 = createdAt 오름차순 (backend) → renderer reverse (최신이 위). 본문 truncate 금지 (max-h-32 + overflow-auto + whitespace-pre-wrap). userVote=agree → aria-pressed=true + active class. 같은 vote 재클릭 = 토글 취소.
- `src/renderer/features/messenger/__tests__/SsmBoxRouting.test.tsx` — installArenaStub 에 `'opinion:listGeneralCards'` mock 추가 (cards 빈 배열) + general empty 테스트를 async + waitFor 로 변경 (hook 가 비동기라 첫 렌더에 ssm-box-empty 가 X).
- `src/main/database/__tests__/schema-008-011.test.ts` — migration count 단언 20 → 21 (text + tracking 표).
- `src/renderer/i18n/locales/ko.json` + `en.json` — `messenger.ssmBox.variants.general` 안 신규 키 (loading / error / cardCount / untitled / voteGroupAria / agreeButton / agreeButtonAria / opposeButton / opposeButtonAria / kind { self-raised / user-raised / root / revise / block / addition }).
- `docs/plans/2026-05-04-rolestra-phase-r12-c2.md.tasks.json` — T21 status='completed' + land summary.

### Verify
- typecheck:web 0 / typecheck:node 0
- vitest **3568 PASS / 13 skip** (T20 baseline 3538 → +30: migration-021 11 + opinion-service +11 + opinion-handler +2 + GeneralVariant 6).
- inspect:safety **99** (T20 95 → +4: 신규 m021 의 framework-managed false positive — `mig-non-idempotent` 3 (CREATE TABLE / 2 인덱스) + `mig-non-forward-only` 1 (DROP TABLE rebuild). m019 / m020 와 동일 패턴 — migrator 가 idempotent 실행 보장. 신규 *production* 코드 위반 0).

### 핵심 결정

1. **round_kind 'light' = 신규 enum** — `'quick_vote'` 재사용 X. 회의 의미 (step 2.5 만장일치 합의 도구) 와 일반 채널 의미 (잡담 가벼운 표시) 가 다르므로 별도 enum. T22 RunStep 의 step_kind 분기에서도 round_kind 가 명확한 신호.
2. **table rebuild 패턴 = SQLite CHECK ALTER 부재 보완** — `CREATE opinion_vote_new + INSERT…SELECT + DROP + RENAME + 인덱스 재생성`. forward-only invariant 유지 (chain 안 rebuild 이지 rollback X). 인스펙터 4 hits = framework-managed false positive (m019 / m020 와 동일).
3. **light vote 사용자 1 인 invariant = service 가 강제** — voter_provider_id NULL 의 light vote row 가 카드별 0 또는 1 건. DB UNIQUE 제약 X (NULL 비교 SQLite 특성) — service 의 toggle 메서드가 findUserLightVote 후 INSERT-or-DELETE-or-REPLACE 로 강제. 동시성 위협 X — 사용자 1 인 voter 라 race 없음.
4. **counter 통합 (직원 + 사용자)** — UI 가 "직원+사용자 모두 합산" 표시. abstain 은 카운터 미반영 (UI 미노출). T21 시점 직원 light vote 등록 surface 없지만 (회의 카드 quick_vote / free_discussion 만), 미래 확장 (직원 자율 light vote) 대비 통합 카운터.
5. **카드 정렬 = backend 오름차순 + renderer reverse** — backend (`OpinionService.listGeneralCards`) 는 createdAt 오름차순 안정 정렬. renderer 가 표시할 때 reverse (최신이 위). 정렬 책임 = backend (정확성), 표현 책임 = renderer (UX).
6. **toggle 결과 = in-place patch (전체 refetch X)** — IPC 응답에 갱신된 카운터 + userVote 동봉 → hook 가 카드 1 건만 setState 갱신. 다른 카드 안정성 유지 + 응답성. stream:channel-message 도착 시는 list refetch (새 카드 추가 가능).
7. **Tailwind 토큰 success/danger 사용** — theme tokens 에 status- prefix / -soft variant 없음. `border-success` / `text-success` / `font-semibold` 조합으로 active 강조. hex literal 없음 (SsmBox/ folder hex guard 통과).
8. **routing 테스트 async 전환** — GeneralVariant 가 IPC async 라 첫 렌더에 cards=null. 기존 sync test (`screen.getByTestId('ssm-box-empty')`) 가 fail → `await waitFor(() => ...)` 로 변경. installArenaStub 에 mock 추가 필요.
9. **GeneralVariant 테스트 cleanup() 명시** — vitest + RTL auto-cleanup 이 안 작동 (globals 미설정?) → afterEach 안 명시적 cleanup() 호출. 첫 run 에 4 fail 회귀 fix.

## 발견 (T21 외 scope)

- (없음 — 사용자 voter 1 인 invariant 의 동시성 race 는 spec 가 사용자 단일 voter 보장으로 구조적으로 차단.)

## 다음 = T22 (P4 진입 3 호 — 일반 채널 RunStep 분기) 권장

T22 의존 = T12 + T19 + T20 = 모두 충족. T22 작업:
- RunStepService 가 일반 채널 메시지도 영속 (step_kind='opinion_gather' + actor_kind='employee'/'user', meeting_id NULL 허용 — migration 020 의 meeting_id NOT NULL 검토 필요)
- T19 aggregator 가 일반 채널 카드 카운트 → 대시보드 위젯 ("일반 — 잡담 카드 N" 표시)

T22 의 *주의*: migration 020 의 `run_step.meeting_id NOT NULL` constraint 가 일반 채널 (meeting 없음) 영속을 차단할 수 있음 — 검토 후 m022 ALTER 또는 dummy meeting 사용 결정.
