# R12-C 1차 결정 기록

R12-C (채널 역할 + 사이드바 통합 + 부서별 능력 + 멤버 패널 정확화) 1차 단계의 결정 9 건. R11 첫 사용자 출시 + R12-S 페르소나/스킬 분리 위에서 — 사무실에 *부서별 회의실* 을 정식 마련하고, *직원 능력* 을 부서 단위로 묶고, *사이드바* 를 한 곳에 통합해 사용자가 한눈에 일하는 흐름 land. R12-C 의 본 회의 진행 재설계 (12 단계 합의 → 의견 트리 + 일괄 동의 투표) 는 R12-C2 라는 새 phase 로 분할.

---

## D1. 부서 회의실 5 개를 프로젝트마다 자동으로 마련

**결정:**
- 새 프로젝트 만들 때 *부서 채널 5 개* 가 자동 생성됨 — 아이디어 / 기획 / 디자인 / 구현 / 검토.
- 채널마다 4 가지 부가 정보를 영구 보관: **역할** (어느 부서) / **목적** (사용자가 자유 텍스트로 적는 한 줄) / **인계 모드** (다음 부서로 자동 인계할지 / 사용자 결재받고 인계할지) / **멤버 발화 순서** (드래그로 직원 순서 정함).
- 옵션 부서 2 개 (*캐릭터* / *배경*) 는 *blueprint + service param* 까지 land 하되, 사용자 화면에서 만드는 흐름 (UI propagate) 은 **R12-D 라는 별 phase 로 보류**. R12-C 안 작업량 폭증 방지.

**왜:**
1. 사무실 = "부서별 책상 + 부서별 회의실" 이 자연. 부서 채널이 없으면 직원 혼자 일하는 것처럼 보임.
2. 채널마다 *역할* 만 있으면 부족 — *목적* (어떤 일을 하는 채널인지) + *인계 모드* (자동 vs 결재) 까지 같은 자리에 두는 게 사용자가 한눈에 봄.
3. 옵션 부서 (캐릭터 / 배경) 는 일부 프로젝트에만 필요해 *기본 5 부서* 와 분리 — 사용자가 만들 때 골라 추가하는 흐름. R12-C 안에 다 넣으면 작업량 폭증.

**대안:** 채널 = 단순 채팅방 (역할 없음). 사용자가 채널 이름으로 부서 표시 — 각하 (시스템이 부서 인식 못 해 회의 자동 진행 / 인계 흐름 land 불가).

**산출:**
- DB migration 018 — channels 테이블에 4 컬럼 추가 (role / purpose / handoff_mode / drag_order).
- T1~T4 commit (`71dfe6d` ~ `a27dde7`).

---

## D2. 사이드바 통합 (일반 + 프로젝트 펼침 + DM 한 곳)

**결정:**
- 화면 좌측 사이드바를 **3 섹션 layout** 으로 통합:
  1. 위 — *일반 채널* (전역, 잡담)
  2. 가운데 — *프로젝트 목록* (각 프로젝트 펼침/접힘 토글, 펼치면 그 프로젝트의 시스템 채널 + 부서 5 개 + 자유 채널 표시)
  3. 아래 — *DM 목록* (전역, 직원 1:1)
- 프로젝트 펼침 상태는 새로고침 후에도 보존 (사용자 선호 기억).
- 자유 채널 row 옆에는 *회의 시작* 버튼이 hover 시 살짝 등장 + 회의 활성 시 *● 회의 중* + *중단* 버튼이 항상 보임.
- 회의 시작 / 종료 / 채널 추가-삭제 / 멤버 변경 시 사이드바 채널 라벨 / 멤버 패널이 stale 없이 *즉시* 갱신 (이전엔 새로고침 해야 보였음).

**왜:**
1. 이전엔 좌측 좁은 strip (프로젝트만) + 메신저 안 ChannelRail (그 프로젝트 채널) 둘로 분리 → 사용자가 *어느 프로젝트의 무슨 채널을 보고 있는지* 한눈에 어려움.
2. 통합 사이드바 = "사무실 명단판 한 장 보면 됨" 의 직관.
3. 회의 진행 상태 / 멤버 변경 같은 *직원 활동* 은 사용자가 새로고침 안 해도 보여야 자연 — 실시간 갱신 fix 함께 land.

**대안:** ChannelRail 분리 유지 — 각하 (사용자 동선 길어짐). 통합하되 펼침 상태 persist 안 함 — 각하 (매번 다시 펼침 = 짜증).

**산출:**
- T8 commit `8c0c010` (사이드바 통합 land).
- 정리 #3 commit `cc088fa` (옛 ProjectRail / ChannelRail 통째 삭제).
- 정리 #5 commit `9d6b67b` (실시간 갱신 fix — 회의 시작-종료 + 채널 CRUD + 멤버 변경 시점에 stale 차단).
- 정리 #8 commit `38c5ada` (통합 테스트 사이드바 기준 재작성).

---

## D3. 일반 채널 = 회의 X, 단순 1 라운드 응답 + "새 대화 시작" 버튼

**결정:**
- 일반 채널 (전역 잡담방) 에는 *회의 시작* 버튼 안 보임 + 자동 회의 트리거 X.
- 사용자 메시지 → AI 들이 *각자 1 라운드 응답* 만 하고 끝. 12 단계 합의 진행 X.
- *새 대화 시작* 버튼 = 지금까지의 잡담을 archive 폴더에 dump 후 채널 비움. 사용자가 잡담 끊고 깨끗하게 시작 가능.

**왜:**
1. 잡담은 회의 흐름과 본질이 다름 — 합의 도달 / 결과 인계 같은 게 필요 없음.
2. 잡담이 길어지면 *프로젝트 회의* 와 컨텍스트 섞여 직원 혼란.
3. 사용자가 잡담 끊고 새 주제로 자연 전환할 entry point 필요.

**대안:** 일반 채널도 회의 가능하게 — 각하 (잡담의 정체성 잃음). 사용자가 직접 메시지 삭제 — 각하 (수동 + 실수로 중요 메시지 삭제 위험).

**산출:**
- T9 commit `65fa6a2`.
- archive 폴더 = `<ArenaRoot>/conversations-archive/<timestamp>-<channelId>.json`.

---

## D4. 부서별 능력 (SKILL.md) 을 프로젝트 폴더에 자동 배치

**결정:**
- 새 프로젝트 만들 때 (또는 사용자가 *능력 동기화* 누를 때) 프로젝트 폴더의 두 자리 (`.agents/skills/` + `.claude/skills/`) 에 부서별 SKILL.md 9 개가 자동 작성됨.
- 각 SKILL.md = *그 부서가 회의 진행 시 어떻게 행동해야 하는지* 의 안내문 (한국어). 직원이 회의 진입 시 자기 부서 SKILL.md 의 경로를 prompt 끝에 받음 → AI 가 자기 부서 역할에 맞게 응답.
- SKILL.md 양식 안에 *방어 로직 4 항* (Gemini silent skip 방어 등) 명시.
- 사용자가 SKILL.md 직접 수정한 경우 *content diff* 로 감지 — 자동 동기화 시 사용자 수정본 보존 (force 옵션 켤 때만 덮어씀).

**왜:**
1. 직원마다 모든 부서 능력 다 들고 있으면 prompt 비대 + reflection 흐려짐.
2. 부서마다 *책임* 이 다름 (아이디어 = 자유 brainstorm / 검토 = 객관 검사) — 각 부서 SKILL.md 가 그 책임 명시.
3. SKILL.md 가 *프로젝트 폴더 안* 에 있으니 직원 (CLI AI) 이 자기 자리에서 자연 접근.
4. 사용자가 SKILL.md 수정해서 자기 사무실 색 입힐 수 있어야 — 자동 동기화 시 보존 필수.

**대안:** SKILL.md 를 prompt 본문에 통째 inline — 각하 (token 폭증). prompt 안 부서 안내 inline + SKILL.md 미배치 — 각하 (사용자가 수정 못 함).

**산출:**
- T5~T7 commit (`f8c215f` ~ `2018b8f`).
- ProjectSkillSyncService — 9 부서 두 폴더 작성 + PathGuard 봉인 + 사용자 수정 보존.
- IPC `project:syncSkills` (사용자가 수동 동기화 가능).
- PromptComposer 의 channelRole 옵션 — 부서 회의 진입 시 prompt 끝에 SKILL.md 경로 단락 추가.

---

## D5. Windows 의 폴더 별칭 (junction) 통한 우회 차단 보강

**결정:**
- 사무실 폴더 (ArenaRoot) 안에서만 파일 작업 가능 (이전부터의 봉인) — Windows 의 *junction* (폴더 별칭) 으로 사무실 밖 폴더를 가리키게 만들면 우회될 수 있는 빈틈을 보강.
- normalizePathForCompare helper 추가 — Windows / POSIX 분기 + 드라이브 문자 대문자 통일 + `\\?\` prefix 정리 + 경로 구분자 통일. 그 후 realpath 와 ArenaRoot 비교.
- Windows-only 검증 테스트 2 건 신규.

**왜:**
1. 보안 봉인은 *우회 가능 빈틈* 자체가 위험 — 우회되는 순간 사무실 밖 파일이 손상될 수 있음.
2. junction 은 Windows 흔한 기능 — 사용자가 의도치 않게 만들거나 외부에서 셀프 설치 시 만들어질 수 있음.
3. 비교 함수가 한 군데로 모이면 향후 변경 시 한 곳만 수정.

**대안:** 그대로 두기 — 각하 (보안 빈틈). PathGuard 통째 재작성 — 각하 (작업량 + 회귀 위험).

**산출:**
- 정리 #6 commit `bd6c56d`.

---

## D6. 부서 채널 메시지란 disabled — 할 일 큐 트리거 시점에 enable (1차에선 disabled 분기까지만)

**결정:**
- 부서 채널 (아이디어 / 기획 / 디자인 / 구현 / 검토) 의 입력란은 *기본 disabled*. 이유 = "부서 회의는 *할 일 큐 작성* 시점에 시작" 이라는 워크플로우 결정.
- 1 차에서는 **disabled 분기만 land**. enable 트리거 (할 일 큐 textarea → 부서 회의 자동 시작) 자체는 R12-C2 P2 안에서 wire — 회의 진행 재설계와 함께 통합 land 가 안전.
- placeholder 한국어: "*할 일 큐의 할 일 작성으로 시작*".

**왜:**
1. 부서 채널은 *회의 진행 결과 archive* 자리 — 사용자가 직접 메시지 보내 시작하면 회의 흐름 깨짐.
2. *할 일 큐* 라는 단일 entry point 가 명확 — 사용자가 일을 한 곳에 적으면 시스템이 그 일에 맞는 부서로 회의 자동 시작.
3. 1 차에서 disabled 분기만 먼저 land = *원하지 않는 동작 (사용자가 부서 채널에 직접 메시지)* 을 차단해 회의 재설계 land 전 회귀 방지.

**대안:** 부서 채널도 자유롭게 메시지 가능 — 각하 (워크플로우 의도 깨짐). disabled 분기 + 트리거 모두 1 차에 land — 각하 (회의 재설계 결정 후 acceptance 광범위 재정의).

**산출:**
- T11 commit `40fe888` (Composer disabled 분기).
- Spec `2026-05-01-rolestra-channel-roles-design.md:454/517` 에 트리거 결정 명시 (구현은 R12-C2).

---

## D7. dead 컴포넌트 5 + dead 분기 1 통째 삭제 — T10 결과물 (ProjectEntryView) 도 함께 reverted

**결정:**
- 정리 #3 단계에서 *production import 0 건* 으로 확인된 5 개 컴포넌트 (ChannelRail / ProjectRail / ProjectEntryView / 그 테스트들) + 1 개 dead 분기 (main/index.ts:551) 통째 삭제.
- 그 중 **ProjectEntryView 는 T10 의 결과물** — 즉 1 차 land 시점에 만들어졌으나 다른 화면에서 mount 안 한 상태에서 정리 #3 에서 dead 판정 → 통째 삭제.
- T10 = 사실상 *reverted*. R12-C2 P2 (회의 기능) 안에서 새 흐름 (할 일 큐 textarea → 부서 회의 자동 트리거) 으로 재구현.

**왜:**
1. dead 컴포넌트는 *유지보수 비용* 만 발생 + 사용자에게 의도 혼동 — 정리 단계에서 즉시 삭제.
2. T10 의 ProjectEntryView 는 *옛 acceptance* (의견 카드 list 화면) 로 만들어진 것이라 회의 진행 재설계 결정 후 의도 자체가 바뀜. *재구현* 이 정직.
3. 1 차에 reverted 표기 + R12-C2 매핑 = 흐름 명료.

**대안:** ProjectEntryView 를 살려두고 R12-C2 에서 *수정* — 각하 (옛 acceptance 잔재가 새 흐름 land 시 회귀 위험). 정리 #3 에서 *dead 판정* 했으면서 보존 — 각하 (CLAUDE.md 의 "production code 안 mock / 잔재 금지" 위반).

**산출:**
- 정리 #3 commit `cc088fa`. net -1116 lines.
- T10 의 acceptance 는 R12-C2 P2 안에서 재정의.

---

## D8. 멤버 패널 거짓 표시 fix — channel 별 멤버 IPC 신설 (R5 D6 결정 reverse)

**결정:**
- R5 시점 결정 D6 ("`channel:list-members` 신규 IPC 미도입") 의 reverse — *현재 채널의 실제 참여자 목록* 을 가져오는 IPC 신설.
- 이전 동작: useChannelMembers 가 *프로젝트 전체 등록 직원* 목록 을 그대로 표시 → 자유 채널에 2 명만 추가했어도 3 명 표시 / DM 1:1 도 3 명 표시 (CLAUDE.md "거짓 UI 금지" 위반).
- main 의 channel_members 테이블 + drag_order 정렬은 R12-C T2 시점에 이미 완비 → IPC 노출 + renderer fetch 만 새로 wire.
- DM 채널은 channel_members 에 *AI 1 명만* (사용자 참여는 암묵적) → 자동 *DM = 1 명* 으로 정상 표시.

**왜:**
1. 거짓 UI = 사용자 신뢰 즉시 손상 + CLAUDE.md global rule "Better to crash with a clear error than to render a UI populated by fake data" 위반.
2. main 데이터는 이미 정확 (channel_members 테이블) — 단지 renderer 가 안 가져갔을 뿐. fix scope 작음.
3. R12-C 부서 채널 분리 시점에 처음 표면화 (R5 ~ R12-C 까지 latent) — 회의 시스템 재설계 land 전에 *멤버 패널 토대* 부터 정확화.

**대안:** R12-C2 안에서 fix — 각하 (회의 시스템 재설계 land 시 회귀 분리 어려움). 그대로 두기 — 각하 (CLAUDE.md 위반).

**산출:**
- dogfooding round 1 commit `adb1591`.
- IPC `channel:list-members` 신설 (channelId → MemberView[]).
- useChannelMembers refactor (useMembers wrap 제거 + 자체 fetch + invalidation 구독).

---

## D9. R12-C 1차 종결 + R12-C2 분할 — 회의 진행 재설계 결정 후 plan 광범위 재정의

**결정:**
- 원래 R12-C plan 의 21 단계 (T0~T20) 중 **T0~T11 + 정리 #1~#8 + dogfooding round 1** 까지를 *1차* 로 끊어 main 에 land.
- *T12~T20 + 회의 진행 재설계 본체* 는 **R12-C2** 라는 새 phase 로 분할. 새 phase 는 다음 8 단계 (P1~P8) 로 재구성:
  1. P1 — spec 갱신 round (회의 시스템 재설계 결정 → spec 정식화). 모든 후속 phase 의 게이트
  2. P2 — 회의 기능 (의견 트리 + 일괄 동의 투표 + 회의록 [합의] [제외])
  3. P3 — 부서 워크플로우 + 부서별 회의 화면 (아이디어 / 기획 / 디자인 / 검토 + 검토 분리)
  4. P4 — 합의 인식 + 일반 채널 가벼운 의견 (`[##]` 파싱)
  5. P5 — 구현 부서 simple 1 명 + 검증 인계
  6. P6 — 인계 기능 (HandoffApprovalModal + 부서 lock + 변경 요청 분기)
  7. P7 — 편의 기능 (멤버 드래그 순서 + 부서장 핀 + 프로젝트 대시보드 + 프로젝트 삭제)
  8. P8 — closeout
- 회의 진행 재설계 본체 = **12 단계 합의 진행 (DISCUSSING / PROPOSING / VOTING / ...) 통째 폐기** → *의견 트리 (parent.child) + 일괄 동의 투표 (QUICK_VOTE) + 자유 토론 + 회의록 [합의] + [제외 항목]* 새 흐름. 부서 매트릭스도 *검토 (한국어 리뷰 = 주관 평가, chain 외) + 검토 (한국어 검토 = 객관 + 목적 통합, chain 끝 강제) 분리 / verify 폐기*. 디자인 부서는 *와이어프레임 회의 + 디자인 회의* 2 번 풀세트. 구현 부서는 R12-C2 = simple 1 명 / R12-W = 분담 + tier system.
- 자세한 결정 기록은 메모리 `rolestra-r12-meeting-system-redesign-2026-05-03.md` + R12-C2 spec round (P1) 에서 정식화.

**왜:**
1. T11 시점에 사용자 + 직원 토론으로 회의 진행 본체가 통째 재설계 — *그 결정이 T12 이후 task 의 acceptance 를 광범위 재정의*. 한 worktree 안에서 두 의도 (옛 acceptance + 새 결정) 가 누적되면 회귀 분리 어려움.
2. R12-C 1 차 결과물 (사이드바 통합 / 부서 채널 / Skill 자동 배치 / 멤버 패널 정확화) 는 그 자체로 사용자 ship 가능 — 1 차 closeout 후 main land 가 안정.
3. R12-C2 가 새 worktree 에서 처음부터 다시 시작 = 옛 plan 잔재 없이 깨끗.

**대안:** R12-C 안에서 모두 land — 각하 (작업량 폭증 + 회귀 분리 어려움). closeout 없이 즉시 R12-C2 진입 — 각하 (1 차 결과 main 에 안 묶여 다음 phase 의 baseline 모호).

**산출:**
- 본 closeout commit (tasks.json sync + 구현현황 + 본 ADR).
- main fast-forward merge (`feat/r12-c-channel-roles` → `main`).
- worktree 정리 (`/mnt/d/Taniar/Documents/Git/Rolestra-r12c` 제거 + branch 삭제).
- 새 worktree (`/mnt/d/Taniar/Documents/Git/Rolestra-r12c2` + branch `feat/r12-c2-meeting-redesign`) 진입.
- R12-C2 plan + tasks.json (P1~P8) 작성.

---

## 1차 검증 결과

- vitest **3486 passed / 13 skip / 0 fail / total 3499** (R11 종결 시점 3306 → R12-S `+~30` → R12-C 1차 + 정리 + round 1 누적).
- typecheck 0 error.
- lint baseline 유지.

## 핵심 참조

- R12-C plan: [`docs/plans/2026-05-02-rolestra-phase-r12-c.md`](../superpowers/plans/2026-05-02-rolestra-phase-r12-c.md)
- 회의 시스템 재설계 결정 (메모리, R12-C2 P1 spec round 입력): `rolestra-r12-meeting-system-redesign-2026-05-03.md`
- R12-C2 plan: `docs/plans/2026-05-03-rolestra-phase-r12-c2.md` (작성 예정)
