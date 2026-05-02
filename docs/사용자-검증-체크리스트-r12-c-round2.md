# 사용자 검증 체크리스트 — R12-C round 2 (T8~T11 UI 묶음)

**대상 worktree**: `.worktrees/r12-c-channel-roles`
**대상 commit 범위**: `8c0c010` (T8) → `40fe888` (T11)
**전제 조건**: round 1 fix (`780b344`) 까지 round 2 사용자가 별도 보고한 항목 없음

이 문서는 R12-C 의 UI 4 task (T8 사이드바 / T9 일반 채널 / T10 entry view /
T11 부서 disabled) 가 dev 빌드에서 정상 동작하는지 사용자가 직접 점검하기
위한 체크리스트다. 각 항목은 (i) **무엇을 한다**, (ii) **어떤 결과를 본다**,
(iii) **틀어졌을 때 보고할 정보** 의 3 단으로 구성.

`기능-정의서.md` 의 사무실/부서 메타포 기준. 코드 / 함수명 / index 이름은
필요한 경우만 인용.

## 0. 환경 준비

| 항목 | 동작 | 기대 |
|---|---|---|
| 0-1 | Windows PowerShell 에서 worktree 진입 — `cd D:\Taniar\Documents\Git\AI_Chat_Arena\.worktrees\r12-c-channel-roles` | worktree 폴더 진입 |
| 0-2 | `git fetch && git pull` | tip = `40fe888` |
| 0-3 | `npm install` (WSL 측에서 `npm rebuild` 가 한 번이라도 돌았다면 Windows 측 바이너리 복구 위해 필수) | electron / better-sqlite3 Windows 네이티브 재컴파일 |
| 0-4 | `npm run typecheck` | 0 error |
| 0-5 | `npm run dev` | dev 서버 + Electron 창. 콘솔 에러 없음. migration 018 까지 적용 로그 |

**기존 ArenaRoot DB 사용 시**: migration 018 이 system_general 행을 정리한다
(전역 1 개 보존, 나머지 DELETE). 채널 / 메시지 일부가 사라질 수 있음. 새 ArenaRoot
폴더로 첫 부팅하면 깨끗한 상태로 진입.

---

## 1. T8 — 통합 사이드바 (general / projects / dm)

### 1-1 사이드바 layout (위 → 아래)

| 동작 | 기대 |
|---|---|
| Electron 창 좌측 사이드바 확인 | 위에서부터 3 섹션이 순서대로 보인다: ① 일반 (전역 일반 채널 1 개) ② 프로젝트 (project 별 collapsible accordion) ③ DM (제일 아래) |

**틀어졌을 때**:
- 일반 섹션 자리에 아무것도 안 보임 → `useGlobalGeneralChannel` IPC `channel:get-global-general` 응답 + boot 시점 `ensureGlobalGeneralChannel` 로그 확인
- 프로젝트 섹션이 비어 있음 → "프로젝트가 없습니다" 메시지면 정상 (프로젝트 미등록). 프로젝트가 있는데도 비어 있으면 `useProjects` 또는 `Sidebar.projects` prop 확인

### 1-2 프로젝트 accordion 토글

| 동작 | 기대 |
|---|---|
| 프로젝트 헤더 클릭 (▼ 펼침 상태) | ▼ → ▶ 토글, 자식 채널 list 사라짐 + 헤더 자체는 active project 로 전환됨 |
| 다시 클릭 | ▶ → ▼, 펼침 + 채널 list 재노출 |

**틀어졌을 때**:
- 클릭해도 토글 안 됨 → `useSidebarStore.toggleProject` 또는 `aria-expanded` 확인
- active project 전환 안 됨 → `onActivateProject` → `setActive` IPC `project:open`

### 1-3 펼침 상태 persist

| 동작 | 기대 |
|---|---|
| 프로젝트 A 접기 (▶) → 창 닫고 다시 띄우기 | 프로젝트 A 가 접힌 상태 그대로 |

**틀어졌을 때**:
- 매 reload 마다 다시 펼쳐짐 → localStorage `rolestra.sidebar.v1` 확인 (DevTools Application 탭). 키가 없으면 zustand persist 미적용

### 1-4 펼친 프로젝트 안 채널 그룹화

| 동작 | 기대 |
|---|---|
| 프로젝트를 펼친다 | 안에 3 그룹: ① 시스템 (#승인-대기 / #회의록) ② 부서 (💡아이디어 / 📋기획 / 🎨디자인 / 🔧구현 / ✅검토) ③ 자유 채널 (사용자 작성한 user 채널 — 디폴트 신규 프로젝트는 빈 상태) |
| 부서 채널 표시 검증 | 이모지 + 부서 라벨 (한국어 카탈로그 — "아이디어" / "기획" / "디자인 (UI)" 등). 채널을 사용자가 임의 작명한 경우만 라벨 옆에 보조 표시 |

**틀어졌을 때**:
- 부서 채널이 자유 채널 섹션에 보임 → migration 018 이 `role` 컬럼을 채우지 못한 가능성. dev console 에서 `channel:list` 응답의 `role` 값 확인
- 5 부서가 아닌 7 부서 (캐릭터 / 배경 포함) 보임 → optional 부서 자동 생성. spec 상 default 5만이므로 사용자 결정 필요
- 라벨이 "idea" / "planning" 등 영문으로 보임 → SKILL_CATALOG label.ko 매핑 확인

### 1-5 회의 컨트롤 — 자유 user 채널만

| 동작 | 기대 |
|---|---|
| 자유 user 채널 row 의 우측 컨트롤 확인 | "회의 시작" 버튼 노출 |
| 부서 채널 / 일반 채널 / 시스템 채널 / DM row 의 우측 컨트롤 확인 | 회의 컨트롤 없음 (빈 우측 슬롯) |

**틀어졌을 때**:
- 부서 채널에서도 회의 시작 버튼이 보임 → `ProjectAccordion.renderFreeChannel` 분기 또는 free user channel 필터 (`role === null || role === 'general'`) 확인

### 1-6 active 표시

| 동작 | 기대 |
|---|---|
| 부서 채널 클릭 | 그 row 가 active 강조 (배경 sunk + 좌우 border) + active project 도 함께 강조 |
| messenger view 로 자동 전환 | 우측 본문이 messenger 에 진입하고 ChannelHeader 가 부서 채널 이름을 보여줌 |

---

## 2. T9 — 일반 채널 (전역) 회의 X + 새 대화 시작

### 2-1 일반 채널 진입 시 회의 표면 hide

| 동작 | 기대 |
|---|---|
| 사이드바 최상단 일반 채널 클릭 | messenger 진입. ChannelHeader 위에 단순 chat 안내 배너가 보임 ("일반 채널은 단순 chat 입니다. 회의는 부서 채널에서 진행합니다.") + 우측에 "새 대화 시작" 버튼. MeetingBanner 는 보이지 않음 |
| 메시지 입력란 | enabled. placeholder 일반 메시지 |

**틀어졌을 때**:
- MeetingBanner 가 보임 → `Thread.tsx` 의 `activeChannel.kind !== 'system_general'` 분기 확인
- "새 대화 시작" 배너 자체가 안 보임 → `GeneralChannelControls` import / mount 확인

### 2-2 새 대화 시작 archive

| 동작 | 기대 |
|---|---|
| 일반 채널에 메시지 2~3 개 보낸다 (자동 1라운드 응답이 와도 OK) | 채널에 user + AI 메시지 누적 |
| "새 대화 시작" 클릭 | confirm 다이얼로그: "지금까지의 대화를 보관함에 저장하고 채널을 비웁니다. 계속할까요?" |
| 확인 클릭 | 버튼이 "저장 중…" 으로 잠시 변경 → 채널이 빈 상태가 됨. 메시지 list 0 |
| ArenaRoot 폴더 확인 | `<ArenaRoot>/conversations-archive/` 폴더가 생성됐고, 안에 `<ISO>-<channelId>.json` 파일 1 개. 그 안에 channelId / channelName / archivedAt / messages[] dump |

**틀어졌을 때**:
- 다이얼로그 "확인" 후 채널이 안 비워짐 → `channel:archive-conversation` IPC 응답 + ChannelService.archiveConversation 동작 확인. dev console 에 IPC 에러 있는지
- archive json 파일이 없음 → ChannelService deps (`archiveRoot.getArenaRoot()`) wiring 확인 (main/index.ts)
- 채널은 비워졌는데 아카이브 json 이 빈 messages 배열 → MessageRepository.listAllByChannel SQL 확인

### 2-3 자동 1라운드 응답 보존 (round 5 fix 동작 그대로)

| 동작 | 기대 |
|---|---|
| 일반 채널에 짧은 user 메시지 입력 → Enter | 잠시 후 등록된 AI 직원들이 1 턴씩 응답. 회의 객체는 보이지 않음 (UI hide) |

**알려진 차이**: 백엔드 측은 여전히 1라운드 회의 객체를 만든다 (round 5 fix). spec
§11.3 "auto-trigger X" 와는 부분 충돌이지만 round 1 사용자 결정에서 1라운드 응답
보존 우선. 사용자가 보고하면 meeting-auto-trigger.ts 에서 system_general 분기를
DM responder 같은 단순 1턴 path 로 교체할 수 있음.

---

## 3. T10 — 프로젝트 entry view "할 일 작성"

### 3-1 카드 노출

| 동작 | 기대 |
|---|---|
| Dashboard 진입 (active project 있을 때) | hero (KPI 4 + 빠른 동작) 아래 "할 일 작성" 카드. textarea + "시작 부서" 라디오 (💡아이디어 / 📋기획) + "워크플로우 시작" 버튼 |
| Dashboard 진입 (active project 없을 때) | 카드 안 보임 |

### 3-2 디폴트 부서 = 아이디어

| 동작 | 기대 |
|---|---|
| 라디오 그룹 첫 진입 | "💡 아이디어" 가 체크된 상태 |

### 3-3 제출 → 부서 채널 active + 자동 회의 시작

| 동작 | 기대 |
|---|---|
| textarea 에 "퍼즐 게임 컨셉을 잡아보자" 입력 → "워크플로우 시작" 클릭 | 버튼이 "시작 중…" 변경. 잠시 후 messenger view 로 자동 전환되고 active 채널 = 아이디어 부서 채널 |
| 아이디어 채널의 메시지 list 확인 | 사용자 메시지 ("퍼즐 게임 컨셉을 잡아보자") 가 INSERT 되어 있고 자동 회의 트리거가 동작 (AI 직원들이 1턴씩 응답 시작) |

**틀어졌을 때**:
- 클릭해도 messenger 로 안 넘어감 → `setActiveChannelId` + `setView('messenger')` 호출 확인
- 채널 이동은 됐으나 메시지가 INSERT 안 됨 → `message:append` IPC 응답
- 회의 자동 시작 안 됨 → 부서 채널에 active 멤버가 0 명일 가능성. 프로젝트 멤버가 비어 있으면 회의 트리거가 침묵 (정상). 멤버가 있는데도 침묵 시 meeting-auto-trigger.ts 분기 확인

### 3-4 기획 부서로 시작

| 동작 | 기대 |
|---|---|
| 라디오에서 "📋 기획" 선택 후 textarea 입력 → 워크플로우 시작 | 기획 채널로 이동, 동일하게 메시지 + 자동 회의 |

### 3-5 빈 입력 차단

| 동작 | 기대 |
|---|---|
| textarea 비운 채로 클릭 | 버튼 disabled — 클릭이 무시됨 |

---

## 4. T11 — 부서 채널 Composer disabled

### 4-1 워크플로우 미진입 부서 채널 = disabled

| 동작 | 기대 |
|---|---|
| 사이드바에서 부서 채널 (예: 🎨 디자인) 직접 클릭. T10 entry 카드 거치지 않음 | messenger 진입. 메시지 입력란이 비활성. badge 영역에 placeholder = "할 일 큐의 할 일 작성으로 시작" |
| textarea 클릭 시도 | 입력 불가 |

**틀어졌을 때**:
- 입력란이 활성 → 그 채널에 활성 회의가 이미 있어 enabled 분기 진입한 가능성. 다른 부서 채널로 시도. 모든 부서 채널이 활성이면 `useChannelDisabledState` hook 분기 확인 (`isDepartmentChannel` 조건 — `channel.kind === 'user' && role !== null && role !== 'general'`)

### 4-2 활성 회의 진행 중 부서 채널 = enabled

| 동작 | 기대 |
|---|---|
| T10 entry 카드로 아이디어 부서 워크플로우 시작 → 자동 회의 진행 중 상태 | 아이디어 채널 입력란 활성. placeholder 일반 메시지 |
| 사용자 메시지 입력 → Enter | 끼어들기 메시지가 INSERT 되어 진행 중 회의에 합류 (D-A T2.5 dispatcher) |

### 4-3 일반 / DM / 자유 user 영향 없음

| 동작 | 기대 |
|---|---|
| 일반 채널 / DM / 자유 user 채널 진입 | 입력란 항상 활성. placeholder 일반 메시지 |

---

## 5. 회귀 발견 시 분기

| 회귀 종류 | 분기 |
|---|---|
| 백엔드 (IPC / service / DB) | dev console + main process 로그 캡처 → fix round PR 진입 |
| UI 스타일 / 토글 | 스크린샷 + reproduction 시나리오 보고 → fix round 진입 |
| spec 과 의도된 동작 차이 | 사용자 결정 필요 — 예: 일반 채널 자동 1라운드 회의 객체 (§2-3) 유지 / 변경 |

## 6. round 2 PASS 기준

- 위 1-1 ~ 4-3 항목 전부 OK
- dev console 에러 0
- archive json 1 개 정상 생성 (§2-2)
- 자동 회의 1 라운드 응답 도착 (§3-3)

PASS 시:
- T8~T11 회귀 fix round 없이 main merge 단계 진입 결정
- T12 (OpinionService — D-B 의 OPINION_GATHERING + OPINION_TALLY 분리, backend only) 진입

FAIL 시:
- 회귀 항목 list 보고 → fix round 1 commit → 재검증 round 3
