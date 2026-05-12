---
name: R12-C2 P1.5 종결 — 일반 채널 회귀 차단 + dogfooding 3 round (2026-05-04)
description: R12-C2 plan task 0 (P1.5) 본체 + follow-up round 1 (멤버 sync + MemberPanel) + 정정 + round 2 (N턴 + stream subscribe) + dogfooding 1/1.5/2.5 round 결과 누적. worktree tip 8fcde8a. 다음 작업 = P1 spec round (T1~T6) 진입.
type: project
originSessionId: 9001b9e7-r12c2-p15
---

## 진입 위치 + worktree 상태

- **worktree**: `/mnt/d/Taniar/Documents/Git/Rolestra-r12c2`
- **branch**: `feat/r12-c2-meeting-redesign`
- **tip**: `8fcde8a` (R12-C2 P1.5 follow-up round 2)
- **base**: `e3cdafb` (R12-C 1차 main tip)
- **main tip**: `bb29558` (router.ts 무한 재귀 hotfix). worktree 는 main 에 fast-forward 가능 (rebase 로 hotfix 흡수 + P1.5 commits 누적).
- **vitest baseline**: 3488 passed / 13 skipped / 0 failed / total 3501 (+2 from P1.5 신규 it)
- **typecheck**: 0 error
- **WSL ↔ Windows native binding drift**: 사용자 dev 빌드 후 better-sqlite3 + rollup 복구 절차 필요. `npm rebuild better-sqlite3` + `npm i --no-save @rollup/rollup-linux-x64-gnu` + `git checkout package-lock.json`.

## 5 commit 누적 (R12-C 1차 land 위)

```
8fcde8a  feat: P1.5 follow-up round 2 — 일반 채널 N턴 응답 + stream:channel-message 자동 표시
98a6be8  docs: 일반 채널 합의 surface 표현 정정 — "장난식" → "가벼운"
15873cb  fix:  P1.5 follow-up round 1 — 일반 채널 멤버 자동 sync (ProviderRegistry 동적 합성) + MemberPanel 참여자 카드 표시
42d9780  fix:  P1.5 — 일반 채널 회의 row 신규 생성 차단 + 잔존 row 화면 회복
bb29558  fix:  clearChannelRegistry 무한 재귀 (main hotfix, worktree 는 rebase 흡수)
e3cdafb  chore: R12-C 1차 종결 (main tip)
```

## P1.5 land 요약 — 일반 채널 회귀 차단

### 회귀 진단

사용자 dogfooding 보고 (2026-05-04): 일반 채널에서 메시지 입력 → 우측 SsmBox 에 `1/12` 같은 12 단계 회의 진행도 표시 → 회의 주제처럼 보임. spec §11.3 + 메모리 r12-meeting-system-redesign §3 결정 (일반 채널 = 회의 X) 위반.

Root cause: `MeetingService.start` 호출자 4 곳 중 *일반 채널 가드는 meeting-auto-trigger 한 곳만 land*. IPC `channel:start-meeting` + queue `default-meeting-starter` 가드 X — 후자는 R10 시점 leftover 로 *system_general 자체가 default landing* 이라 회귀 본진.

### Fix (commit `42d9780`)

**Backend 가드 (신규 row 생성 차단)**:
- `handleChannelStartMeeting` (channel-handler.ts): channel.kind === 'system_general' 가드 throw
- `default-meeting-starter` (resolveChannelId 결과): 일반 채널 결과면 QueueMeetingStarterError throw — queue runner catch → queue_items.last_error surface

**Frontend defensive (잔존 active row 즉시 회복)**:
- MemberPanel.tsx + Thread.tsx: activeMeeting useMemo 에 일반 채널 분기 → null. SsmBox empty / MeetingBanner hide.

**Tests**:
- handlers-v3.test.ts: channelSvc 타입 + setup 에 `get` mock 추가 + 신규 it (system_general throw 검증)
- queue-service-meeting-starter.test.ts: makeChannel default kind 'system_general' → 'user', makeQueueItem default targetChannelId 'c-plan' (R12-C2 후 *queue prompt 는 항상 부서 채널 pin* 이 정직), 기존 happy path 갱신, 신규 sad path it 추가

**boundary 가드를 MeetingService.start 자체에 두지 않은 이유**: ChannelService 의존 추가 = 광범위 refactor. P2 OpinionService 도입 시 structural refactor 안에서 옮길 예정.

## P1.5 follow-up round 1 — 일반 채널 멤버 자동 sync (commit `15873cb`)

### 회귀 진단 (사용자 dogfooding round 1)

**보고 #1**: 일반 채널 메시지 입력 → AI 응답 무반응
**보고 #2**: 우측 멤버 목록이 보이면 좋겠다
**보고 #3**: "장난식이라도 합의기능은 있는데, 없앤건 후에 추가 예정인가?"

Root cause (#1, #2 공통): R12-C 에서 system_general 을 *전역 1 개* (project_id NULL) 로 통합하면서 *channel_members 자동 등록 코드 자체*가 정의 안 됨. ensureGlobalGeneralChannel 은 channel row 만 insert, ProjectService.addMember 도 일반 채널 sync hook 없음. 결과:
- dm-auto-responder.handle 의 `if (members.length === 0) return` 가드 hit → 무반응 (silent return)
- useChannelMembers 의 channel:list-members IPC 결과 0 명 → MemberPanel 참여자 카드 자체 hide (R12-C round 4 결정으로 panel 통째 안내 문구로 대체)

### Fix 전략 — ProviderRegistry 동적 합성

`channel_members` 테이블 sync (boot reconcile + 직원 등록/삭제 hook + 프로젝트 간 직원 중복 cleanup) 대신 **`ChannelService.listMembers` 가 일반 채널일 때 ProviderRegistry.listAll() 동적 반환**. spec §11.3 "일반 채널 = 프로젝트 외부 전역 1 개 / 모든 직원 자동 멤버" 정체성과 일치. DB write 0, hook 0, cleanup 0.

```typescript
// channel-service.ts:listMembers
const channel = this.repo.get(channelId);
if (channel?.kind === 'system_general') {
  return providerRegistry.listAll().map((p, idx) => ({
    channelId, projectId: null, providerId: p.id, dragOrder: idx,
  }));
}
return this.repo.listMembers(channelId);
```

### MemberPanel 변경 (#2)

- isGeneralChannel 분기 (panel 통째 안내 문구로 대체) 통째 제거
- 참여자 카드는 항상 표시
- 합의 카드 (Card+SsmBox) 만 일반 채널 시 hide — *가벼운 동의 카운터 surface 가 P4 land 전까지 정의 안 됐으므로 카드 자체 X*

### #3 답 — 합의 기능 P4 예약

옛 12 단계 회의 진행도 (1/12) = *회의 모델 잔재* (P1.5 차단). 사용자 vision 인 *가벼운 동의/반대 카운터 + `[##본문]` 카드*는 P4 본격 일반 채널 흐름 land 시점에 등장. **없앤 게 아니라 다음 phase 예약**.

## terminology 정정 (commit `98a6be8`)

사용자 발화: "우리 장난식을 가벼운으로 바꿀까?"

- MemberPanel.tsx 주석 1 곳에 *"장난식 동의/반대 카운터"* 표현 → "가벼운" 으로 정정
- spec/plan/메모리에는 "장난식" 단어 사용 0 (이미 "QUICK_VOTE" 또는 "동의/반대 카운터" 표현)
- **P1 spec round (T1~T6) 에서 spec §11.3 일반 채널 흐름 정식화 시 *가벼운 동의 카운터* 표현으로 land 예정**

## P1.5 follow-up round 2 — N턴 응답 + stream subscribe (commit `8fcde8a`)

### 회귀 진단 (사용자 dogfooding round 1.5)

**보고 #1**: 메시지 입력 후 AI 가 "읽었다" 진행 상태 X
**보고 #2**: 다른 탭 다녀와야 응답 메시지 등장
**보고 #3**: AI 1 명만 응답 (사용자 vision = 여러 직원 자유 응답)

사용자 결정 (옵션 다): *부분 fix (stream subscribe + N턴)*. 사용자 통찰:
> 미루면 결국 아무것도 안 하고 작업은 밀리기만 하지 않을까?

→ P4 본격 phase 까지 dogfooding 보류 비용 큼. **증분 land + 피드백 loop** 가 안전.

### Backend (#3 fix — N턴 응답)

- dm-auto-responder.ts:
  · `handle()` 안에 channel.kind 분기. system_general 이면 모든 멤버 순차 1 턴씩 응답. DM 은 1 턴 (idx_dm_unique_per_provider 보장).
  · 기존 단일 턴 응답 로직을 `private respondAs(channel, member)` 헬퍼로 추출. 멤버별 독립 (한 명 실패가 다음 멤버 흐름을 막지 않음).
  · 각 응답마다 messageService.append → backend stream:channel-message emit (이미 land) → renderer 자동 표시. 1 명씩 차례로 등장하는 게 *자연스러운 진행 표시* 역할.

### Frontend (#2 fix — 자동 표시)

- use-channel-messages.ts:
  · `stream:channel-message` 구독 추가 useEffect. AI 응답이 다른 surface 에서 append 될 때 *현재 탭에서 즉시 표시*.
  · user 메시지는 send() 의 optimistic + invoke resolve reconcile 에 맡기고 stream 에서 skip — server 가 meta.clientId 를 echo 안 하므로 stream payload 만으로 임시 row 와 매칭할 키 없음. authorKind === 'user' 분기 차단.
  · 중복 방어: 같은 server id 가 list 에 있으면 skip.

### #1 답 — typing indicator P4 예약

token-by-token stream surface 정의는 P4 본격 land. 현재는 *완성 메시지 단위* 자동 표시 + N 명 차례 등장이 진행 표시 역할.

## dogfooding 3 round 결과 매트릭스

| round | 보고 | round 후 결과 |
|-------|------|---------------|
| 1 (round 1) | #1 메시지 무반응 | ✅ fix (`15873cb` ProviderRegistry 동적 합성) |
| 1 (round 1) | #2 멤버 목록 보고 싶음 | ✅ fix (`15873cb` MemberPanel 분기 변경) |
| 1 (round 1) | #3 합의 기능 일정 | ✅ 답 — P4 예약 (commit 본문 + 본 메모리 명시) |
| 1.5 | "장난식 → 가벼운" | ✅ 정정 (`98a6be8`) |
| 2.5 | #1 응답 진행 표시 | ❌ 그대로 (예상 — P4 typing indicator 예약). "느렸지만 모두 대답함으로 정정" 으로 사용자도 인지 후 진행 OK |
| 2.5 | #2 자동 표시 | ✅ fix 확인 — stream subscribe 효과 |
| 2.5 | #3 1명만 → 모두 응답 | ✅ fix 확인 — N턴 효과 (느림 = 1명씩 순차 부산물) |

## P4 본격 land 시 추가 surface (P1.5 잔존 갭 추적)

P1.5 회귀 차단은 minimal scope — 사용자 vision 의 80% 도달. 나머지 20% 는 P4 land 시:

- **token-by-token typing indicator** (현재 *완성 메시지 단위* 자동 표시)
- **가벼운 동의/반대 카운터** UI + 카운터 IPC
- **`[##본문]` 파서 + 의견 게시 모달**
- **SsmBox 일반 채널 variant** (카드 누적 list + 동의/반대 버튼)
- **직원이 응답 *생략* 결정 가능** (현재 *모든 멤버 1턴 강제*)
- **동시 응답 또는 자유 발화** (현재 멤버 dragOrder 순차 1 명씩 — 느림 부산물)
- **dm-auto-responder 분기 자체를 일반 채널 N턴 모델로 교체** (현재 helper 추출로 *공유 가능* 해진 구조 위에서 자연 확장)

## 다음 세션 첫 작업 — P1 spec round 진입 (T1~T6)

R12-C2 plan task 1~6 = **spec `2026-05-01-rolestra-channel-roles-design.md` 정식 갱신** (게이트 — 모든 후속 phase 의 토대). 코드 변경 0, 문서만:

| sub-task | 내용 |
|----------|------|
| **T1 P1.1** | spec §3 부서 카탈로그 갱신 — verify 폐기 / 검토 (audit) 신규 / 리뷰 (review) 라벨 정정 |
| **T2 P1.2** | spec §4 부서별 회의 매트릭스 — 디자인 7단계 / 구현 단계적 / **일반 `[##]` 강제 + 가벼운 동의 카운터** |
| **T3 P1.3** | spec §5 D-B 흐름 — 의견 트리 ITEM_NNN_NN_NN + 일괄 투표 + 자유 토론 + 모더레이터 회의록 [합의]+[제외] |
| **T4 P1.4** | spec §11.x 신규 — SsmBox 부서별 layout / channels.max_rounds / providers.capability_tier (R12-W ALTER) / 부서 lock 매트릭스 |
| **T5 P1.5** | JSON schema 정식 명시 — 의견 제시 / 일괄 투표 / 자유 토론 응답 양식 |
| **T6 P1.6** | P2~P8 sub-task 정식 분할 + tasks.json sync (P1 결과 반영) |

### P1.5 dogfooding 결과 → spec §11.3 반영 항목 (T2 P1.2 안에서)

- 일반 채널 멤버 = *모든 등록 직원 자동* (ProviderRegistry 동적 합성 — channel_members 테이블 sync X) 명시
- 응답 모델 = *현재 N턴 순차* + *P4 본격 (가벼운 동의 카운터 + token typing + 직원 응답 생략 + 동시 응답)* 단계적 명시
- typing indicator 부재 = P4 예약 명시 (사용자 dogfooding 거슬림 추적)
- "장난식 → 가벼운" terminology 정정 — spec/plan 안 *가벼운 동의 카운터* 표현 통일

### 진입 순서

1. 본 메모리 + r12-c2-entry.md + r12-meeting-system-redesign 메모리 read
2. tasks.json 의 task 1 (T1 P1.1) 부터 4 게이트 워크플로우 따라 진행
3. 작은 sub-task 는 게이트 1+2 생략 OK (사유 commit message 안)
4. 각 task 종결 시 commit + 사용자 OK 후 다음

### 4 게이트 워크플로우 효과 (P1.5 사례)

R12-C T10 reverted 사고 차단용 4 게이트 (설계 → 의도 부합 검토 → 구현 → spec 부합 검토 → commit) 가 P1.5 에서 **게이트 2 (의도 부합 검토)** 가 핵심 작동:

- 사용자 발화 *"문서 확인하면 기록 있을 텐데..."* 가 게이트 2 enforce
- claude 가 옵션 늘어놓는 안티패턴을 사용자가 차단 → spec/메모리 즉시 적용 → 정확한 회귀 진단 + minimal fix
- **결정원칙**: spec/메모리에 박혀 있을 때는 *옵션을 묻지 말고 그대로 적용* (R12-C T10 의 "옵션 추측해서 진행" 안티패턴 반복 차단)

## 사용자 결정원칙 — "미루면 작업이 밀린다" (2026-05-04)

P1.5 round 2 분기 시점에 사용자가 (다) 옵션 (부분 fix) 결정하면서:

> 미루면 결국 아무것도 안 하고 작업은 밀리기만 하지 않을까?

- **적용 범위**: 큰 phase 가 멀고 dogfooding 차단 surface 가 있을 때 *minimal 부분 fix* 가 정직 (perfect blocks good 안티패턴 차단)
- **반대 적용**: 본격 phase 의 *핵심 결정사항*을 부분 fix 로 *고정* 하는 건 위험 (P4 결정사항이 P1.5 부분 fix 로 *암묵적 land* 되지 않게 — 본 메모리의 "P4 본격 land 시 추가 surface" 명시가 그 안전장치)
- **증분 land + 피드백 loop** 가 한 번에 perfect 보다 빠르고 안전
