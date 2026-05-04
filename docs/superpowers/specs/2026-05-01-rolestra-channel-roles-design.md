# Rolestra v3 — Phase R12 Channel Roles + Persona/Skill Separation (Design)

작성일: 2026-05-01
작성 배경: D-A batch 2 (자동 회의 트리거) dogfooding 후 사용자 피드백으로 발전한 architecture 변경.

본 문서는 design 단계 — 구현 plan / tasks 는 phase 진입 시 별도 문서.

## 1. 동기 (Why)

D-A batch 2 dogfooding 에서 다음 한계가 드러남:

1. **회의 흐름이 채널 종류와 무관** — #일반 / 회의 채널 모두 같은 SSM 12-phase 사용. 사용자 의도는 채널 종류에 따라 다른 회의 (잡담 vs 본격 회의 vs 작업 vs 검토).
2. **AI 가 모든 일 다 함** — 한 AI 가 기획·디자인·구현·검토 전부 담당. 역할 분화 / 전문성 결여.
3. **persona 가 캐릭터 + 능력 모두 표현** — 사용자가 "신중한 PM" 같이 캐릭터 작성하려는데 그 안에 tool 권한 / 스킬까지 섞여 있음.
4. **회의 모드의 SSM 작업 phase (WORK_DISCUSSING ~ EXECUTING ~ REVIEWING) 가 복잡** — phase 간 전환 / 사용자 승인 게이트 / 권한 변동 모두 한 회의 안에 들어 있음.

사용자 vision (메타포):

```
프로젝트 = 회사
채널 = 부서 (역할 부여됨)
직원 = AI (캐릭터 페르소나 + 복수 역할 + 역할별 스킬)

기획 부서 회의 → 디자인 부서로 인계 → 디자인 결과 → 기획 부서 검토
  → 의도 맞으면 → 구현 부서로 인계 → 검토 부서 → 완료
  → 의도 다르면 → 디자인 부서 수정 의뢰
```

→ 각 부서 (채널) 가 명확한 역할 + 전용 회의 흐름 + 역할별 스킬 결합. **SSM 작업 phase 는 채널 인계로 자연 대체**.

## 2. 4 Phase 묶음 (요약)

| Phase | 내용 | 추정 |
|-------|------|------|
| **R12-S** | 페르소나 / 스킬 분리 (provider 데이터 모델) | 5~7 일 |
| **R12-C** | 채널 역할 (idea / planning / design / implement / review / general) | 7~10 일 |
| **D-B** | 구조화된 합의 (의견 + vote + 협의) — 기획 부서 흐름 | 17~28 일 |
| **R12-H** | 방 간 인계 (E 작업 통합) — 작업 모드 deprecate 종결 | 10~15 일 |
| **합계** | | **40~60 일** |

v0.1 → v0.2 / v0.3 메이저 릴리스급.

## 3. R12-S — 페르소나 / 스킬 분리

### 데이터 모델 변경

기존 `providers` row:
```
{
  id, type, displayName, model, capabilities, config, status,
  persona  ← 단일 텍스트, 캐릭터 + 능력 + 형식 instruction 섞여 있음
}
```

새 `providers` row:
```
{
  id, type, displayName, model, capabilities, config, status,
  persona      ← 자유 텍스트, 캐릭터 / 말투 / 정체성만
  roles        ← string[], 예: ['planning', 'design.ui', 'design.ux'] (다중 선택 가능)
  skill_overrides ← Record<string, string> | null, 사용자 customize
}
```

### 시스템 정의 스킬 카탈로그 (11 능력 — R12-C2 갱신 2026-05-04)

| Role ID | 한국어 라벨 | 핵심 |
|---------|-------------|------|
| `idea` | 아이디어 | 자유 brainstorm + 비판 보류 + 다양성 강조 |
| `planning` | 기획 | spec 작성 + 사용자 페르소나 분석 + 우선순위 매트릭스 + (외부) 시장조사 |
| `design.ui` | 디자인 (UI / 형태) | UI 형태 / 디자인 토큰 / 컴포넌트 시안 + (외부) 색상 추출 |
| `design.ux` | 디자인 (UX / 사용감) | 사용 흐름 / 정보 구조 / 사용자 여정 |
| `design.character` | 디자인 (캐릭터) | 게임 캐릭터 시안 / 모션 컨셉 — 게임 프로젝트만 |
| `design.background` | 디자인 (배경) | 게임 배경 시안 / 무드 보드 — 게임 프로젝트만 |
| `implement` | 구현 | 코드 생성 + 파일 쓰기 + 명령 실행 + diff 적용 + 테스트 실행 |
| `review` | **리뷰** (R12-C2 라벨 정정) | **주관 평가 / 개선 제안** — 결과물 인상 / 누락 시나리오 / 더 나은 안 / 사용자 ergonomics. **chain 외** — 두 entry: (a) 사용자 명시 호출 (할 일 큐 entry 부서 라디오 = 리뷰) (b) 검토 인계 결재 모달 안 *"+리뷰 부서도 시작"* 체크박스 / `handoff_mode='auto'` 시 Notification |
| `audit` | **검토** (R12-C2 신규, 옛 verify 흡수) | **객관 + 목적 통합** — 하드코딩 / 메모리 누수 / 보안 / 스파게티 / spec 의도 부합 / 누락 + 추가 감지. **표준 chain 끝 강제** (구현 후 자동 진입). NG → 항상 기획 부서로 인계 (검토는 문제 발견만, 처리는 기획에 위임) |
| `general` | 일반 (잡담) | `[##본문]` 감싸기로 의견 카드 등록 + 가벼운 동의/반대 카운터. 회의 X / 합의 X / 인계 X. R12-C2 정정 — 옛 "1라운드 단순 응답" 폐기. P4 본격 land 까지 P1.5 회귀 차단으로 자동 의견 등록 차단 (§11.3) |
| (시스템) `meeting-summary` | 회의록 자동 정리 (모더레이터) | system 만 호출, 직원 부여 X. R12-C2 결정 — `[합의 항목]` + `[제외 항목]` 두 섹션 정식화 + truncate 금지 prompt 강제 |

각 스킬 = (system prompt 템플릿 + tool 권한 matrix + 외부 자원 endpoint).

**부서 템플릿 9개 (디폴트 7 + 옵션 2, R12-C2 갱신)**:
- 디폴트 (프로젝트 만들면 자동 생성): 아이디어 / 기획 / 디자인 (UI+UX 묶음) / 구현 / **리뷰** / **검토** / 일반
- 옵션 (사용자 추가): 캐릭터 디자인 / 배경 디자인
- 디자인 부서 = `[design.ui, design.ux]` 두 능력 묶음 — UI/UX 의논 잦으니 분리하지 않음.
- 직원 능력은 부서 10 개 (`idea` / `planning` / `design.ui` / `design.ux` / `design.character` / `design.background` / `implement` / `review` / `audit` / `general`) 중 자유 다중 체크 — 한 직원이 여러 부서에 멤버. `meeting-summary` 는 system 전용 (직원 부여 X).
- **리뷰 vs 검토 (R12-C2 결정)**: 리뷰 = 주관 평가 (chain 외), 검토 = 객관 + 목적 통합 (chain 끝 강제). 옛 `verify` 부서는 신규 `audit` (한국어 "검토") 가 객관 + 목적 통합으로 흡수 — 별도 verify 부서는 R12-C2 시점부터 카탈로그에 추가하지 않음.

### 페르소나 prompt 합성

회의 / 인계 시:
```
{persona 자유 텍스트}    ← 캐릭터
+
당신은 {channel.role} 부서에서 일하고 있습니다.
{role_skill_template}    ← 능력
{permission_rules}       ← R7 권한 시스템
+
{format_instruction}     ← 채널 회의 흐름 별 format
```

페르소나가 "신중한 PM" 이면, 같은 사람이 기획 부서에선 기획 스킬, 디자인 부서에선 디자인 스킬 (할당된 경우) 사용. **캐릭터는 일관, 스킬은 채널 역할에 맞춤**.

### 설정 UI (R12-S)

직원 편집 모달 탭 분리:
- **캐릭터** 탭 — persona 자유 텍스트, 말투 가이드, 사용자 작성.
- **역할 + 스킬** 탭 — roles 다중 선택 (chip), 각 role 의 default 스킬 노출, customize 가능.

### DB Migration

`017-providers-roles-skills.ts`:
- persona 컬럼 의미 변경 (캐릭터 only) — 기존 데이터는 그대로 (사용자가 정리하라는 안내).
- `roles` 컬럼 (TEXT, JSON array, default '[]').
- `skill_overrides` 컬럼 (TEXT, JSON, nullable).

---

## 4. R12-C — 채널 역할

### 채널 데이터 모델 변경

기존 `channels.kind`: `'system_general' | 'system_approval' | 'system_minutes' | 'user' | 'dm'`

새 `channels.kind`: 동일 (마이그레이션 호환). 추가 컬럼:
- `role`: `'idea' | 'planning' | 'design.ui' | 'design.ux' | 'design.character' | 'design.background' | 'implement' | 'review' | 'audit' | 'general' | null` (R12-C2 갱신 — `'audit'` 신규 / `'review'` 역할 정정)
- `purpose`: 자유 텍스트 (사용자 작성, optional)
- `handoff_mode`: `'check' | 'auto'` (R12-C 018 마이그레이션 land — 부서 인계 직전 사용자 confirm 모드)
- `drag_order`: INTEGER NULL (R12-C 018 마이그레이션 land — 참여 멤버 발화 순서)
- `max_rounds`: INTEGER NULL (R12-C2 신규 — 회의 종료 조건. NULL = 무제한 / N 라운드 도달 시 사용자 호출. 본격 land = P2 backend 시점)

### 부서별 회의 흐름 (R12-C2 갱신, 2026-05-04)

옛 R12-C 매트릭스의 `OPINION_GATHERING / OPINION_TALLY / AGREEMENT_VOTE / REVISION_NEGOTIATION` 12 단계 합의 진행 모델은 **R12-C2 시점에 폐기**. 새 모델 = §5 의 5 단계 + 2.5 일괄 투표. 모든 풀세트 부서가 같은 backend (`OpinionService` + `MeetingMinutesService`) 공유 + 부서별 SsmBox layout / workflow 분기.

| 부서 (role) | 회의 형식 | 종료 조건 | 결과물 | trigger | 구현 phase |
|------------|----------|----------|--------|---------|-----------|
| **idea (아이디어)** | **D-B-Light** — 의견 제시 + 시스템 취합까지만 (자유 토론 skip) + USER_PICK (사용자 카드 선택 + 자유 코멘트) | 사용자가 카드 선택 + 코멘트 → 기획 부서 인계 | 의견 카드 list → 사용자 선택 | 할 일 큐 entry (auto) | R12-C2 P3 |
| **planning (기획)** | **풀세트** — 의견 제시 → 시스템 취합 → 일괄 동의 투표 → 자유 토론 → 모더레이터 회의록 (§5 정식) | 모든 의견 합의/제외 처리 + 회의록 작성 | 회의록 markdown ([합의]+[제외]) + spec markdown | 인계 only | R12-C2 P3 (R12-C2 simple) → D-B phase (본격) |
| **design.ui + design.ux** (디폴트, 통합) | **7 단계** — 와이어프레임 5 (시스템→UX 지시 / UX 작성 / 의견 #1 등록 / UI+UX 풀세트 회의 / 합의 시 시스템→UI 수정 지시) + 디자인 2 (시스템→UI HTML/CSS 지시 / 의견 #2 등록 → 풀세트 회의 → 합의 → 인계). Playwright PNG | 두 회의 모두 합의 + Playwright 스냅샷 생성 | HTML/CSS + 와이어프레임 + PNG (desktop 1280x720 + mobile 375x812) | 인계 only | R12-C2 P3 |
| **design.character / design.background** (옵션, 게임/일러스트) | 미정 (이미지 생성 phase) | — | 캐릭터/배경 시안 이미지 | 인계 only | R12-D (보류) |
| **implement (구현)** | **R12-C2 = simple 1 명** — designated 직원이 spec 받아 작성 (회의 X). **R12-W = 분담 + tier system + worktree 분할** (별 phase) | 사용자 승인 + ExecutionService apply | 코드 변경 + git commit | 인계 only | R12-C2 P5 (1 명) → R12-W (분할) |
| **review (리뷰)** (R12-C2 라벨 정정) | **풀세트 — 주관 평가 / 개선 제안** (§5 와 같은 5 단계) | 모든 의견 합의/제외 처리 + 회의록 작성 — *후속 자동 인계 X* (사용자가 회의록 보고 자유 발화) | 회의록 markdown (주관 의견 + 개선 제안 정리) | **chain 외** — 두 entry: (a) 사용자 명시 호출 (할 일 큐 entry 부서 라디오 = 리뷰) (b) 검토 인계 결재 모달 안 *"+리뷰 부서도 시작"* 체크박스 / `handoff_mode='auto'` 시 Notification | R12-C2 P3 |
| **audit (검토)** (R12-C2 신규, 옛 verify 흡수) | **풀세트 — 객관 + 목적 통합** (하드코딩 / 메모리 누수 / 보안 / spec 의도 부합 / 누락 + 추가 감지) | OK → 사용자 승인 게이트 + chain 종료. NG → **기획 부서 자동 인계** (검토는 문제 발견만, 처리는 기획에 위임) | 회의록 markdown ([합의]=문제 + [제외]=논의 후 수용 가능) + 인계 payload (NG 시) | **표준 chain 끝 강제** (구현 후 자동 진입) | R12-C2 P3 |
| **general (일반)** | **`[##본문]` 강제** — 메시지 안 `[##]` 감싸기로 의견 카드 등록 + 가벼운 동의/반대 카운터. 그 외 메시지 = 일반 채팅 (자동 등록 X). 회의 X / 합의 X / 인계 X | — (chat 흐름 자체가 종료 X, 사용자 자유 발화) | 누적 카드 list (동의/반대 카운터 + 직원 자유 응답) | 사용자 입력 즉시 (auto, 단 자동 의견 등록은 [##] 감싼 본문만) | R12-C2 P1.5 (회귀 차단 land 완료) → P4 (본격 [##] 파서 + 모달 + SsmBox variant) |

→ 채널 역할 = (workflow + prompt template + permission matrix + trigger 방식 + handoff_mode + drag_order + max_rounds + SsmBox variant) 한 묶음.
→ R12-C2 의 `OpinionService` + `MeetingMinutesService` 가 의견 제시 / 시스템 취합 / 일괄 투표 / 자유 토론 / 모더레이터 회의록을 *모든 풀세트 부서가 공유하는 토대* 로 land — 부서별 차이는 workflow (시스템 prompt + 종료 조건 + handoff target) 과 SsmBox variant 에 한정. 옛 OPINION_GATHERING / OPINION_TALLY 분리 service 명세는 폐기.

#### 디자인 부서 7 단계 흐름 (R12-C2 정식)

```
[와이어프레임 단계 — 5 단계]
1. 시스템 → UX 직원에게 "기획서 받고 와이어프레임 작성" 지시 (개별 task)
2. UX → 와이어프레임 (구조도) 작성
3. 시스템 → 그 와이어프레임을 *의견 #1* 로 회의에 등록 (SsmBox 카드)
4. UI + UX 직원이 풀세트 회의 (의견 + 일괄 투표 + 자유 토론 + 모더레이터 회의록)
5. 합의 시 → 시스템이 UI 직원에게 "합의 결과대로 와이어프레임 수정" 지시 (개별 task)

[디자인 단계 — 2 단계]
6. 시스템 → UI 직원에게 "수정된 와이어프레임 받고 디자인 (HTML/CSS) 만들기" 지시 (개별 task)
7. UI 디자인 → 의견 #2 로 회의 등록 → 풀세트 회의 → 합의 → handoff_mode 따라 인계
```

→ 두 번의 풀세트 회의 (와이어프레임 + 디자인). 다른 풀세트 부서 (planning / review / audit) 와 흐름 일관.
→ 결과물 = HTML / CSS + 와이어프레임 + Playwright PNG (desktop 1280x720 + mobile 375x812).
→ 옛 "UX → UI → UX 3R cap" 모델 폐기 — 새 회의 시스템의 의견 트리 깊이 cap 3 (§5) 으로 자연 대체.

#### 일반 부서 새 정의 (R12-C2 정식)

옛 "1라운드 단순 응답" 흐름 폐기. 새 정의:

- `[##본문]` 감싸기로 의견 카드 등록 — 한 메시지 안 `[##]` 여러 개 가능 (각각 별 카드)
- 그 외 메시지 = 일반 채팅 (자동 의견 등록 X)
- 별도 *의견 게시* 버튼 (사용자가 모달에서 제목 + 본문) 도 지원
- 카드 = 가벼운 동의/반대 카운터 (직원 + 사용자 양쪽 가능) + 직원 자유 응답 누적
- 회의 X / 합의 X / 인계 X — 잡담 정체성 유지
- 멤버 = ProviderRegistry 동적 합성 — `channel_members` 테이블 sync X (모든 등록 직원 자동 멤버, R12-C2 P1.5 land)
- 응답 모델 = N턴 순차 (P1.5 land) — *완성 메시지 단위* 자동 표시 + 멤버별 dragOrder 순서. token-by-token typing indicator + 동시 응답 + 직원 응답 생략은 **P4 본격 land 시 추가**

#### 채널 입력란 enable / disabled 분기

| 채널 종류 | 입력란 상태 |
|---------|-------------|
| 부서 채널 (workflow 진입 전) | **disabled** — placeholder "할 일 큐의 할 일 작성으로 시작" |
| 부서 채널 (workflow 진입 후) | enabled — 메시지 = 끼어들기 (D-A T2.5 dispatcher 활용) |
| 일반 채널 | 항상 enabled (잡담) |
| DM | 항상 enabled (개별 지시 방) |
| 시스템 채널 (`system_general` / `system_approval` / `system_minutes`) | 시스템 정의 분기 — read-only 또는 사용자 입력 (system_general) |

### 사이드바 UX 변경

기존 사이드바:
```
시스템
  #일반
  #승인-대기
  #회의록
채널
  채널A
  채널B
DM
  Claude DM
```

새 사이드바 (R12-C2 갱신, 2026-05-04):
```
시스템
  #일반 (general, 전역)        — §11.3 — 프로젝트 외부 1 개
  #승인-대기 / #회의록
부서 (프로젝트 기본, R12-C2 매트릭스 따라 7 default)
  💡 아이디어 (idea)
  📋 기획 (planning)
  🎨 디자인 (design.ui + design.ux 통합)
  🔧 구현 (implement)
  📝 리뷰 (review)            — chain 외 (사용자 명시 호출)
  🔍 검토 (audit)             — chain 끝 강제
  💬 일반 (general)
사용자 채널 (자유)
  채널A (general)
  ...
DM
  Claude DM
```

→ **부서 = 프로젝트 단위 자동 1 개씩 default 7 개** (idea / planning / design / implement / review / audit / general). 사용자가 추가 자유 채널 만들 수 있지만 default role='general'.
→ **#일반 (system_general) 은 프로젝트 외부 전역 1 개** (§11.3 — R12-C 진입 시점에 land).
→ 옛 "1라운드 단순 응답" 모델 폐기 — `[##]` 강제 + 가벼운 동의 카운터 (R12-C2 P1.5 회귀 차단 + P4 본격).

### 작업 모드 deprecate (R12-C2 시점에 SSM 통째 폐기)

- **R12-C 시점**: 구현 부서 (role='implement') = 작업 권한 자동 ON. 메시지 = 즉시 작업 (회의 안 거침). EXECUTING phase 를 구현 부서 default behavior 로 흡수. WORK_DISCUSSING / SYNTHESIZING / VOTING 은 일단 보존.
- **R12-C2 시점 (2026-05-04 결정)**: SSM 12 단계 (DISCUSSING / PROPOSING / VOTING / WORK_DISCUSSING / SYNTHESIZING / EXECUTING / REVIEWING / ...) **통째 폐기**. `OpinionService` + `MeetingMinutesService` 새 모델로 재배선 (P2 backend land 시점).
- 옛 SSM 코드 / DB 컬럼은 *forward-only migration* 으로 폐기 — 새 컬럼 (`opinion` / `opinion_vote` 테이블 + author_label + status enum) 추가 + 옛 SSM phase 컬럼 삭제 또는 deprecate 마킹 (P2 migration 019 시점에 결정).

### auto-trigger vs 인계 trigger 분기 (R12-C2 갱신, 2026-05-04)

- **auto-trigger** (사용자가 할 일 큐 entry → 회의 자동 시작):
  - 적용: idea, planning (할 일 큐 entry 의 default 시작 부서). general 은 회의 X — auto-trigger 도 X (P1.5 회귀 차단으로 자동 의견 등록도 X — `[##]` 감싼 본문만 카드 등록)
- **인계 trigger** (다른 부서가 의뢰 → 부서가 받아서 작업 시작, 사용자 직접 트리거 X):
  - 적용: design.*, implement, audit (검토는 chain 끝 자동 진입)
- **사용자 명시 호출 (chain 외)**:
  - 적용: review (할 일 큐 entry 부서 라디오 = 리뷰 명시 선택)
  - 추가 entry: audit 인계 결재 모달 안 *"+리뷰 부서도 시작"* 체크박스 / `handoff_mode='auto'` 시 Notification (auto 인계 시 알림 등장)

### Migration

`018-channels-role-purpose-handoff.ts` (R12-C 결정으로 컬럼 4개 + system_general 전역화, 2026-05-02 land):
- `role` TEXT NULL (system 채널 = NULL, 부서 채널 = RoleId)
- `purpose` TEXT NULL (자유 텍스트, 사용자 작성)
- `handoff_mode` TEXT NOT NULL DEFAULT 'check' (부서 인계 직전 사용자 confirm 모드, 'check' | 'auto'. R7 ApprovalService 와 별개 — R7 = 파일 적용 gate, handoff_mode = 부서 인계 gate)
- `drag_order` INTEGER NULL (참여 멤버 발화 순서, designated worker 디폴트 알고리즘 fallback)
- 추가: `providers.is_department_head` TEXT JSON `Record<RoleId, boolean>` — designated worker 부서장 핀 (R12-C Task 18, 마이그레이션 018 통합)
- system_general 전역화 — 기존 프로젝트 종속 row → 가장 오래된 1 개만 보존 (projectId NULL), 나머지 DELETE.
- 기존 사용자 user 채널 = role='general' default. 기존 DB 데이터는 wipe (사용자 결정).

`019-opinion-tables.ts` (R12-C2 P2 backend land 시점, 2026-05-04 결정):
- `opinion` 테이블 신규:
  - `id` (UUID PRIMARY KEY)
  - `parent_id` (UUID NULL, FK opinion.id) — 의견 트리 부모 chain
  - `meeting_id` / `channel_id`
  - `kind` TEXT NOT NULL — `'root'` / `'revise'` / `'block'` / `'addition'` / `'self-raised'` / `'user-raised'`
  - `author_provider_id` TEXT NULL (NULL = `user-raised`)
  - `author_label` TEXT NOT NULL — 회의 단위 발화 카운터 (예: `codex_1`, 회의 끝나면 리셋)
  - `title` / `content` / `rationale` (NULL)
  - `status` TEXT NOT NULL — `'pending'` / `'agreed'` / `'rejected'` / `'excluded'`
  - `exclusion_reason` TEXT NULL — `status='rejected'`/`'excluded'` 시 회의록 제외 사유
  - `round` / `created_at` / `updated_at`
- `opinion_vote` 테이블 신규:
  - `id` / `target_id` (FK `opinion.id`) / `voter_provider_id` (NULL = 사용자) / `vote` (`'agree'`/`'oppose'`/`'abstain'`) / `comment` (NULL) / `round` / `round_kind` (`'quick_vote'` / `'free_discussion'`) / `created_at`
- `channels.max_rounds` INTEGER NULL — 회의 종료 조건 (NULL = 무제한 / N 라운드 도달 시 사용자 호출). 본격 land = R12-C2 P2 시점

`020-providers-capability-tier.ts` (R12-W 진입 시점, 보류):
- `providers.capability_tier` TEXT NOT NULL DEFAULT `'mid'` — `'frontier'` / `'mid'` / `'local'`. 분담 알고리즘 (구현 부서장 AI 가 sub-task 마다 tier 보고 배정) 의 토대. R12-C2 시점에는 ALTER 안 함 — R12-W 진입 시 land.

`021-providers-is-department-head.ts` (R12-C2 P7-2 land 시점, 보류):
- `providers.is_department_head` 가 R12-C 시점에 JSON 컬럼으로 land 했지만, P7-2 *부서장 핀* surface 진입 시 enum index 또는 NOT NULL 보강 ALTER 추가 가능 — P7-2 진입 design round 후 결정.

---

## 5. D-B — 구조화된 합의 (모든 풀세트 부서 공유 토대, R12-C2 갱신)

> **R12-C2 정정 (2026-05-04)**: 옛 12 단계 SSM 합의 진행 모델 (`OPINION_GATHERING` / `OPINION_TALLY` / `AGREEMENT_VOTE` / `REVISION_NEGOTIATION` 등) **통째 폐기**. 새 모델 = 5 단계 + 2.5 일괄 투표 + 모더레이터 회의록. 본 §5 가 기획 부서만이 아니라 모든 풀세트 부서 (planning / design / review / audit) 가 공유하는 backend 토대 — 부서별 차이는 `OpinionService` + `MeetingMinutesService` 위에 얹는 workflow 분기로만 표현.

### Phase 흐름 (R12-C2 정식)

```
1. 의견 제시 (화면 보임)
   직원이 JSON 양식으로 의견 작성 — 같은 직원이 회의 안에서 여러 의견 제시 가능.
   발화 ID 부여: codex_1 / codex_2 / claude_1 / gemini_1 / ...
   → 회의 단위 카운터 (회의 끝나면 리셋. 다음 회의에서 다시 codex_1 부터)
   화면에 발화 ID 표시 (사용자가 어느 의견을 누가 제시했는지 한눈에)

2. 시스템 취합 + 의견 ID 부여 (화면 안 보임 / SsmBox 에 의견 list 등장)
   시스템이 모은 의견에 트리 ID 매김:
       ITEM_001, ITEM_002, ITEM_003 ... (root 의견)
       ITEM_001_01, ITEM_001_02 ...    (수정 / 반대 / 추가 의견 = ITEM_001 의 자식)
       ITEM_001_01_01 ...                  (자식의 자식, 깊이 cap = 3 / 디폴트 3)
   → DB 저장은 단순 (id UUID + parent_id) / 화면 표시는 시스템이 parent chain 따라
      ITEM_NNN_NN_NN 형식 가공.

★ 2.5 일괄 동의 투표 (보임, SsmBox 에 vote 진행 표시)
   모든 직원에게 의견 list 보내고 *한꺼번에 동의 여부* 응답.
   - 만장일치 의견 → 즉시 합의 반영 (자유 토론 skip)
   - 만장일치 못 받은 의견만 step 3 으로
   - 동의하면서 코멘트 가능 (optional)

3. 자유 토론 (화면 보임, SsmBox 반영)
   시스템이 의견 1 개씩 제시 → 직원들이 형식 갖춰 자유 발언 + 동의/반대/수정/추가.
   - 동의 / 반대 / 보류
   - 수정 의견 / 반대 의견 / 추가 의견 = 자체 의견 카드로 등록 (트리 자식)
       예: ITEM_001 의 수정 의견 → ITEM_001_01
       그 수정 의견의 또 다른 수정 → ITEM_001_01_01 (cap 3 도달)
   - 다음 라운드에서 다른 직원들이 다시 투표 가능

4. 합의되면 시스템이 *다음 의견* 으로 넘어가서 제시 → step 3 반복

5. 모두 합의 / 제외 처리 → 모더레이터 회의록 작성
   ★ 회의록 정리 모델 = R12-S MeetingSummaryService + getResolvedSummaryModel
     (시스템 = 모더레이터 직원 X, system 호출). 회의 통째 발화 history + 의견 트리
     받아 정리. 시스템 자동 정리는 deterministic 합의 list 만 만들고 본문 작성은
     모더레이터.
   ★ 회의록만 보고도 이해 가능한 *상세 설명* (요약 X / 축약 X)
     - 의견 본문 통째 보존 (truncate 금지 prompt 강제)
     - 근거 통째 보존
     - 결정 사유 (왜 합의 / 왜 제외) 모더레이터 작성
   두 섹션:
     [합의 항목]  — 합의된 의견 + 통째 본문 + 결정 (X 명 동의)
     [제외 항목]  — 제외된 의견 + 통째 본문 + 제외 사유
                     ☞ 사용자가 회의록 보고 "회의록 X — 제외 항목 #2 다시 진행"
                       같은 발화로 작업 재발화 가능 (정보 손실 방지)

6. handoff_mode 따라 다음 부서 인계 (§6 R12-H 참조)
   'auto'  = 자동 인계 (단 검토 → 리뷰 entry 시 *Notification* 등장)
   'check' = 사용자 결재 모달 (회의록 미리보기 + 인계 사유 + 확인 버튼)
             검토 → 기획 인계 시 모달 안 *"+리뷰 부서도 시작"* 체크박스 (chain 외 entry)
```

### 데이터 모델 (R12-C2 — opinion 트리 + opinion_vote)

`opinion` (R12-C2 P2 land — migration 019, §4 Migration 정식):
- `id` UUID PRIMARY KEY
- `parent_id` UUID NULL FK `opinion.id` — 트리 부모 chain (NULL = root)
- `meeting_id` / `channel_id`
- `kind` TEXT NOT NULL — `'root'` / `'revise'` / `'block'` / `'addition'` / `'self-raised'` / `'user-raised'`
- `author_provider_id` TEXT NULL (NULL = `user-raised`)
- `author_label` TEXT NOT NULL — 회의 단위 발화 카운터 (예: `codex_1`)
- `title` / `content` / `rationale` (NULL)
- `status` TEXT NOT NULL — `'pending'` / `'agreed'` / `'rejected'` / `'excluded'`
- `exclusion_reason` TEXT NULL — `status='rejected'`/`'excluded'` 시 회의록 제외 사유
- `round` / `created_at` / `updated_at`

`opinion_vote` (R12-C2 P2 land — migration 019):
- `id` / `target_id` (FK `opinion.id`) / `voter_provider_id` (NULL = 사용자) / `vote` (`'agree'` / `'oppose'` / `'abstain'`) / `comment` (NULL) / `round` / `round_kind` (`'quick_vote'` / `'free_discussion'`) / `created_at`

→ 옛 `opinion_revisions` 테이블 폐기 — `opinion.parent_id` + `opinion.kind` 가 트리 + revision 정보 통째 흡수.

### 의견 ID — 저장 vs 화면 표시 분리

| 영역 | 형식 |
|------|------|
| DB 저장 | `id` (UUID) + `parent_id` (UUID 또는 NULL) — 단순 |
| 화면 표시 (SsmBox / 채팅창 카드) | 시스템이 parent chain 따라 가공 — `ITEM_001` / `ITEM_001_01` / `ITEM_001_01_01` |

깊이 cap = 3 (의견 트리 무한 루프 방지, 사용자 결정).

### 발화 ID 카운터 (회의 단위 리셋)

- 한 회의 안에서 직원 (provider) 별 카운터: `codex_1` → `codex_2` → ...
- 회의 끝나면 리셋. 다음 회의에서 다시 `codex_1` 부터.
- `opinion.author_label` 컬럼 (회의 단위 카운터 결과) 저장.

### Message Schema (R12-C2)

직원 응답 JSON schema 정식 명시는 §11.18 (R12-C2 P1.5 sub-task — JSON schema 단락) 참조. 4 종 schema:
- step 1 의견 제시 (`{ name, label, opinions: [...] }`)
- step 2.5 일괄 동의 투표 (`{ name, label, quick_votes: [...] }`)
- step 3 자유 토론 (`{ name, label, votes: [...], additions: [...] }`)
- 모더레이터 회의록 prompt 양식 (truncate 금지)

### 컨텍스트 / token 관리 (R12-C2 정식)

| 의견 수 | 전달 방식 |
|--------|----------|
| ≤ 5 | prompt 직접 (markdown 표) |
| > 5 | `<ArenaRoot>/<projectId>/consensus/<meetingId>/opinions.md` 파일 작성 + read 권한 부여 |
| 회의 종료 후 | DB → 회의록 markdown ([합의] + [제외] 두 섹션, truncate 금지) |
| 다음 회의 / 인계 | 회의록 markdown 만 prompt + 자세한 history 는 파일 read |

→ DB = 진실 source. RAM 만 사용 X (앱 재시작 시 회의 진행 상태 잃음).

추가:
- **Anthropic API prompt caching** — 재사용 부분 (스킬 템플릿, 페르소나) cache.
- **검토 (audit) 부서**: 코드 + spec 만 read (전체 대화 안 봄). **리뷰 (review) 부서**: 회의 history + 결과물 둘 다 read (주관 평가 위해 맥락 필요).
- **메모리 시스템 (R12-M, future)** 진입 시 working memory 압축 (bara_system 의 hybrid search 응용).

### 의견 트리 깊이 cap (옛 revision cap 폐기)

- 옛 "per-opinion revision 최대 3 R 강제 reject" 폐기 — 의견 트리 자체로 자연 대체.
- 새 모델: **의견 트리 깊이 cap 3** — `ITEM_001` (root) → `ITEM_001_01` (자식) → `ITEM_001_01_01` (손자) 까지. 더 깊은 자식 의견 = 시스템이 거부 + "더 깊은 수정은 새 root 의견으로 다시 제시하라" prompt.
- 같은 의견 위에 새 자식 의견이 무한 누적되는 것은 prompt + cap 3 으로 막음. token 폭발 / 끝말잇기 같은 자연 무한 안전장치 = §11.x channels.max_rounds (회의 종료 조건) + D-A round 5 의 maxConversationRounds=5 hard cap (이미 land).

---

## 6. R12-H — 방 간 인계 (E 작업 통합)

기존 메모리 `rolestra-e-cross-room-handoff.md` 의 E 작업이 R12-H 로 흡수.

### 인계 워크플로우 (사용자 확정)

```
아이디어 부서 → (회의록 생성) → 기획 부서
기획 부서   → (기획 완료) → 디자인 부서
디자인 부서 → (의도 확인) → 기획 부서
기획 부서 의도 확인:
  ✅ 맞음 → 디자인 부서 archive + 구현 부서로 인계
  ❌ 다름 → 디자인 부서로 수정 요청 (revision loop)
구현 부서 → (작업 완료) → 검토 부서 (구현은 대기)
검토 부서 → 검증:
  ✅ 통과 → 업무 완료 처리
  ❌ 불통과 → 구현 부서 재작업
```

### 인계 데이터 모델

`handoffs`:
- id (UUID), meeting_id, from_channel_id, to_channel_id, kind ('forward' | 'revision'),
- payload_path (consensus 폴더 회의록 파일 경로), depth (cycle prevention), parent_handoff_id, created_at

### Cycle prevention

- max depth (예: 5).
- parent chain 추적 — 같은 from→to 반복 시 reject.
- prompt 안내 "X 부서에서 Y 부서로의 N번째 인계입니다. 정확한 지시를 부탁합니다".

### 자동 채널 생성 (기획 부서 권한)

기획 부서가 디자인 / 구현 / 검토 부서 자동 생성:
- 사용자 승인 게이트 (R7 approval 흐름 활용).
- 기본 채널 만 1 개 (role 별). 추가 sub-channel (예: design.character vs design.background) 은 사용자 결정.

### 작업 모드 완전 deprecate (R12-H 종결 시)

- WORK_DISCUSSING / SYNTHESIZING / VOTING / EXECUTING / REVIEWING SSM phase 정리.
- 보존: `consensus_decision` approval gate (사용자 승인 흐름). 이건 R12-H 종결 시점에 인계 승인 / 검토 통과 시점으로 통합.
- 결과 SSM: CONVERSATION + 종료 / 일시정지 + 인계 transition 정도로 단순화.

---

## 7. 결정 사항 (사용자 답변 반영)

### P0
1. **레거시 폴더 보존 후 삭제** ✅ — `legacy/` 폴더 이동 = 새 시스템 진입 시점. 삭제 = 안정화 후. DB migration 010~016 그대로 보존 (forward-only).
2. **Fallback 정책** ✅ — AI 가 역할 안 따른 응답 시 inappropriate 표시 + 인계 권유.
3. **스킬 scope** ✅ — prompt + tool 권한 + 외부 자원 (단계적 추가).

### P1
4. 권한 시스템 재설계 ✅ — 채널 단위 권한 체계 (R7 path-guard 흡수).
5. 인계 워크플로우 ✅ (위 R12-H 참조). 컨텍스트 관리 = 회의록 + prompt cache + 부분 read.
6. Revision cap ✅ — per-opinion / per-handoff cap + prompt 명시.

### P2
7. 사이드바 위치 ✅ — 좌측 메뉴 프로젝트 폴더 아래 부서 고정.
8. 기존 사용 내역 wipe ✅ — DB migration 시 회의 / 채널 / persona 정리.
9. auto-trigger vs 인계 trigger 분기 ✅ (위 부서별 표 참조).

---

## 8. 진입 순서

```
지금 (2026-05-01)
  ↓ D-A batch 2 잔여 (DM 삭제 / stale UI / 라벨) ✅ 종결
  ↓
R12-S 페르소나 / 스킬 분리   [기반]
  ↓
R12-C 채널 역할             [기반]
  ↓
D-B 구조화 합의             [기획 부서 회의 흐름]
  ↓
R12-H 방 간 인계            [통합 + 작업 모드 deprecate]
  ↓
R12 종결 → v0.2 / v0.3 메이저 릴리스
```

각 phase 진입 시 별도 plan / tasks.json 작성.

## 9. 예상 위험

P0:
- 데이터 마이그레이션 forward-only — 사용자 의사 반영 (기존 wipe).
- AI 가 역할 강제 prompt 따르나 — fallback 정책으로 mitigate.
- 스킬 scope 외부 자원 단계 — 처음엔 prompt + tool 권한만, 외부는 R12-S 후 단계 추가.

P1:
- R7 권한 시스템 재설계 — R12-C 작업 안에서.
- 채널 폭증 — auto archive / lifecycle 도입.
- 인계 cycle — depth + parent chain detection.

P2:
- renderer UX 큰 변화 — 사이드바 부서 그룹화, 부서별 view.
- 기존 사용자 user 채널 호환 — role='general' default.
- 부서별 trigger 방식 다름 — auto vs 인계 분기 명확화.

## 10. 관련 문서 / 메모리

- `rolestra-r12-channel-roles-design.md` (메모리 — 본 design 의 첫 정리)
- `rolestra-e-cross-room-handoff.md` (E 작업 — R12-H 로 흡수)
- `rolestra-d-a-batch2-dogfooding-fix-round*.md` (D-A 잔여 검증)

---

## 11. 사용자 추가 의견 (2026-05-01) 반영

### 11.1 컨텍스트 폭발 — 세션 진척도 저장 + 워크트리/브랜치 분할

**옵션 A (R12-H 통합 — 1차)**: **세션 진척도 저장 + resume**
- 작업 중간 *N 단위* (예: 큰 함수 1 개 / 5 파일 변경 / 30 분 작업) 마다 snapshot 저장.
  - `<ArenaRoot>/<projectId>/consensus/progress/<task_id>.md` (markdown)
  - provider sessionState (Claude Code CLI 의 `--resume <session_id>` 활용)
- 새 session 진입 시 snapshot 읽어 resume. 토큰 절감 — 전체 history 대신 *직전 snapshot + 변경된 파일* 만.
- 구현: TaskSnapshotService 신규. R10-Task11 의 LLM summarize 활용 (큰 task 일 때 snapshot 자체를 LLM 요약).

**옵션 B (별도 phase R13 — 2차)**: **기능별 worktree / branch 분할**
- 기획 부서가 task 를 sub-task 로 분할 → 각 sub-task 를 별도 branch / worktree 에서 AI 작업 → 머지.
- **충돌 처리 정책**:
  1. **Dependency graph 우선 sequential**: A 가 base, B 가 A 의존 → A 완료 후 B 시작. 병렬 X.
  2. **자동 conflict 발생 시 사용자 승인 필수** — AI 가 임의 resolve 절대 X.
  3. **Rebase 우선**, 다발 시 reject + 재계획.
  4. **Shared 파일 변경 lock**: 같은 파일 두 branch 동시 변경 금지 → sequential 강제.
- R13 phase 로 분리. R12 종결 후 진입.

**진입 결정**: R12-H 에 옵션 A, R13 (multi-worker) 에 옵션 B.

### 11.2 사이드바 구조 갱신

```
💬 일반 채널 (전역, 프로젝트 외부)         ← 단일 전역 채널, 회의 X
─────
📁 프로젝트 A  [▼ 펼침 토글]
  ├ 시스템 채널 (#승인-대기 / #회의록)
  ├ 부서: 💡아이디어 / 📋기획 / 🎨디자인 / 🔧구현 / ✅검토
  └ 사용자 자유 채널 (선택)
📁 프로젝트 B  [▲ 접힘]
  ...
─────
💬 DM (전역, 제일 아래)
```

- 프로젝트별 collapsible (Radix Accordion). 펼침/접힘 상태 zustand persist.
- DM 은 기존 그대로 제일 아래 별도 섹션.
- 일반 채널 = 프로젝트 외부 전역 1 개 (현재 system_general 의 프로젝트 종속에서 변경).

### 11.3 일반 채널 = 프로젝트 외부 전역, 회의 X

- **회의 시작/종료 버튼 제거**. auto-trigger 도 X.
- "새 대화 시작" 버튼 — 이전 세션 archive (consensus 폴더 또는 별도 archive) + 채널 비우기.
- 단순 chat 모드 — round 5 fix 의 1라운드 응답 그대로.
- DB migration: system_general 의 의미 변경 (프로젝트 종속 → 전역 1 개). 프로젝트 단위 system_approval / system_minutes 는 유지.

### 11.4 분기 — 프로젝트 워크플로우 Entry "할 일 작성"

기존 auto-trigger / manual [회의 시작] 둘 다 변형 / 통합:

**프로젝트 진입 화면**:
- "할 일 작성" 입력란 (project entry view) — 현재 빈 화면 / 첫 채널 default 대신.
- 입력 → 자동 워크플로우 시작 — **default 시작 부서 = 아이디어 (또는 사용자 선택)**.
- 사용자가 이미 기획안 있으면 entry 시점에 "기획 부터 시작" 옵션 선택.

**회의 시작 전까지 부서 채널 메시지란 disabled**:
- 부서 채널은 워크플로우 진입 후에만 메시지란 enabled.
- 사용자가 회의 시작 전 임의 메시지 입력 불가.
- **트리거 = 할 일 큐의 할 일 작성란** (R12-C 결정, 2026-05-02). 사용자가 할 일을 작성하면 자동 워크플로우 시작 + 부서 채널 메시지란 enabled. placeholder: "할 일 큐의 할 일 작성으로 시작" (워크플로우 진입 전).

**회의 시작 후**:
- 메시지란 enabled.
- 사용자 메시지 = 끼어들기 (D-A T2.5 dispatcher 활용 — 이미 구현).
- 일시정지 가능 (T7 — 미구현. R12-C 진입 시 우선 implement).

**부서 인계 직전 사용자 승인 gate**:
- 디자인 → 기획 / 기획 → 구현 / 검토 통과 / etc 모든 부서 transition 시 R7 approval gate 흡수 또는 신규 handoff_approval kind.
- 사용자가 "이 인계로 진행 OK" 명시 승인.

**구현 범위 옵션** (사용자 design 핵심):
- 프로젝트 entry 또는 기획 종결 시 사용자 confirmation:
  - **논스톱 완성**: 한 번에 끝까지.
  - **단계별 (MVP → 1단계 → 2단계 → 완성)**: 각 단계 종결 시 사용자 confirm gate.
  - **사용자 정의 단계**: 자유 단계 작성.
- 디폴트 = **단계별 (MVP first)** — 사용자 본인 경험 ("논스톱이라 생각했는데 중간 완성이라 화남") 반영.
- UI 에 명확 표시 — entry 화면 / 기획 종결 시 모달.

**결론**: auto-trigger / manual 분기 사실상 사라짐. 단일 흐름 = "프로젝트 entry → 할 일 입력 → 워크플로우 자동 진행 → 부서별 인계 승인 → 사용자 끼어들기 가능".

### 11.5 회의록 작성자 — 시스템 자동 정리

- **시스템이 LLM 으로 자동 정리** (R10-Task11 의 `MeetingSummaryService` 활용 — 첫 ready provider 의 summarize capability 사용).
- 사용자 settings 에서 customize:
  - 어떤 model 로 정리할지
  - prompt 템플릿 (객관적 / 친근한 톤 / 짧게 / 상세)
- AI 직원 중 하나가 정리하면 그 직원 캐릭터가 회의록 톤에 영향 — 객관적 정리는 system 이 좋음.

**디폴트 자동 선택 로직 (R12-S)**:
1. 사용자 등록 provider 중 `summarize` capability + `kind='api'` + Anthropic Haiku 모델 우선
2. 없으면 `kind='api'` + Gemini Flash 모델
3. 없으면 `summarize` capability 인 다른 api/cli provider
4. 마지막 fallback: `kind='local'` Ollama 첫 번째 ready provider
5. 모두 없으면 정리 skip (회의록 deterministic minutes 만)

사용자가 settings 에서 명시 선택 시 자동 선택 무시.

### 11.6 부서별 AI 둘 이상 — Designated Worker 디폴트

| 옵션 | 설명 | 적용 시점 |
|------|------|----------|
| 1. **Designated worker (디폴트)** | 한 명만 작업. 부서 만들 때 사용자 선택 또는 자동 (부서장 핀 / 발화 순서). 다른 AI 는 옵저버. | R12-C |
| 2. **Pre-batch 사용자 결정** | 누가 할지 매 task 마다 사용자 선택 | R12-C |
| 3. **병렬 작업 + 머지** | 두 시안 / 두 구현 결과 → 부서 회의에서 선택 / 머지 | **R12-W** (구현 부서 worktree+merge phase, 신규) |

**디폴트 알고리즘 (R12-C 결정, 2026-05-02)**:
1. 사용자가 직원 편집 모달에서 "부서장 핀" 마크 → 1순위
2. 핀 없으면 참여 멤버 드래그 순서 1번 → 2순위 (`channels.drag_order` 또는 `channel_members.drag_order` 컬럼)

분담 알고리즘 (자원 모델 "내가 X 잘 함" + 사용자 override) 자체는 R12-W 에서 land. 옵션 3 (병렬 작업 + 머지) 가 R12-W 의 정확한 scope — 구현 부서만 worktree+merge 분할. 다른 부서 분할은 R13 별도.

### 11.7 phase 별 새 task 추가

**R12-S (페르소나/스킬)**:
- 스킬 카탈로그 정의에 "회의록 정리 prompt 템플릿" 옵션 포함 (사용자 customize 위함).
- 회의록 정리 모델 별도 settings (`summaryModelProviderId`) — 디폴트 자동 선택 로직 + 사용자 명시 선택.
- agestra plugin agent 의 system prompt 를 reference (plugin cache 위치) 하되 한국어로 재작성.

**R12-C (채널 역할)** — 갱신된 task 목록 (2026-05-02):
- 사이드바 collapsible 프로젝트 그룹 (Radix Accordion + 디폴트 펼침 + zustand persist).
- 일반 채널 전역 분리 + system_general migration (전역 1 개 row, projectId NULL).
- 프로젝트 entry view "할 일 작성" 입력란 + 워크플로우 시작 IPC + 디폴트 시작 부서 = 아이디어.
- 부서 채널 메시지란 disabled / enabled 상태 관리 (할 일 큐 트리거).
- T7 (pause/resume) 의 일시정지 IPC 우선 implement.
- Designated worker 선택 UI (부서장 핀 + 드래그 순서).
- 디자인 부서 워크플로우 (UX → UI → UX 토론 시퀀스, 3R cap).
- 아이디어 부서 워크플로우 (D-B-Light + USER_PICK + 의견 카드 list UI 다중 선택 + 자유 코멘트 + 추가 라운드).
- 검토 부서 워크플로우 (OPINION_GATHERING + TALLY → 기획 자동 분류 → 분류 카드 → 수정 group 만 구현 인계).
- 구현 부서 단순화 (designated 1명 spec 받아 작성, 분할은 R12-W 로 미룸).
- SKILL.md 자동 배치 (.agents/skills/ + .claude/skills/ — Codex+Gemini+Claude alias 호환) + PromptComposer 스킬 경로 주입 (자기 spec 합리화 방어 로직 frontmatter 동봉).
- PlaywrightSnapshotService — 디자인 결과물 웹 스샷 PNG (desktop 1280x720 + mobile 375x812, R6 인프라 재활용).
- handoff_mode auto/check 채널별 옵션 + 인계 모달 (디폴트 check, R7 ApprovalService 와 별개 — R7 = 파일 적용 gate, handoff_mode = 부서 인계 gate).
- 참여 멤버 드래그 순서 UI (dnd-kit) + designated worker 디폴트 (부서장 핀 우선, 드래그 1번 fallback).
- OpinionService — D-B 의 OPINION_GATHERING + OPINION_TALLY 재사용 service 추출 (아이디어 / 검토 / R12-W 가 부분 phase 만 사용).
- general 능력 모든 직원 자동 부여 (디폴트 ON, 사용자 토글 가능).

**R12-H (인계 + 작업 모드 deprecate)**:
- 옵션 A (세션 진척도 + resume) 통합.
- 인계 승인 gate (handoff_approval).
- 구현 범위 옵션 (논스톱 / MVP / 단계별 / 사용자 정의) gate.

### 11.8 phase 추정 갱신

| Phase | 변경 전 (2026-05-01) | 변경 후 (2026-05-02) |
|-------|---------------------|---------------------|
| R12-S | 5~7 일 | ✅ 종결 (2026-05-02, main tip `ce1c80c`) |
| R12-C | 10~14 일 | **14~20 일** (디자인/아이디어/검토 워크플로우 + SKILL.md 자동 배치 + 웹 스샷 + handoff_mode + 드래그 순서 + OpinionService 추출 추가) |
| D-B | 17~28 일 | 17~28 일 (변경 없음) |
| **R12-W (신규)** | — | **5~10 일** (구현 부서 worktree + 분할 commit + merge — 자원 모델 "내가 X 잘 함" + 사용자 override) |
| R12-H | 15~20 일 | 15~20 일 (변경 없음) |
| **합계** | 47~69 일 | **51~78 일** |

R12-D (이미지 생성 + ComfyUI/Diffusion) — 보류, 완성 이후 별도 phase (§11.11 참조).
R13 (multi-worker / branch 분할) — R12-W 가 일부 흡수 (구현 부서). 잔여 (다른 부서 분할 / branch 관리 대규모) 는 R13 별도.

### 11.9 SKILL.md 자동 배치 (R12-C land)

R12-S 의 SKILL_CATALOG (R12-C2 갱신 후 11 능력 = 부서 10 + 시스템 1 `meeting-summary`) 중 *부서 10 개* 를 프로젝트 폴더에 SKILL.md 로 자동 배치 — 3 provider (Claude / Codex / Gemini) 가 각자 자동 로드. `meeting-summary` 는 system 전용이라 배치 X.

**경로**:
- Claude: `<projectRoot>/.claude/skills/<roleId>/SKILL.md` (자동 로드 + 라이브 watch)
- Codex / Gemini: `<projectRoot>/.agents/skills/<roleId>/SKILL.md` (alias 공통, Gemini 도 `.gemini/skills/` 인식)
- meeting-summary 는 system 전용 — 배치 X

**양식** (3 provider 공통, Gemini silent skip 방지):
```yaml
---
name: <roleId>
description: Rolestra <부서명> 부서 — <한 줄 설명>
---

# <부서명> 부서

[skill-catalog.ts 의 systemPromptKo 본문]

## 자기 spec 합리화 방어 (필수 준수)

- 본인이 작성한 산출물에 대한 검토 의견을 받았을 때, 무조건 "의도임" 으로 분류 금지.
- 검토 의견의 근거 (코드 / 행동 / 사용자 영향) 를 spec 텍스트와 직접 대조 후 판단.
- 의도 vs 검토 의견 충돌 시 객관적으로 검토 의견 우선 인정.
- 의심스러우면 "수정 group" 으로 분류 (false negative 비용 < false positive 비용).
```

**자동 sync**:
- 프로젝트 생성 시 자동 배치 (`ProjectSkillSyncService.syncProjectSkills`)
- 카탈로그 변경 시 IPC `project:syncSkills(projectId, options: { force?: boolean })` 호출 → 두 폴더 재배치
- 사용자 수정 SKILL.md (mtime 변경 감지) 가 있으면 사용자 confirm 받은 후 덮어쓰기 (force=true 시 무시)
- PathGuard 가 ArenaRoot 봉인 검증 (junction realpath 비교 — CA-3 TOCTOU)

**PromptComposer 확장**: 부서 회의 진입 시 prompt 끝에 다음 단락 자동 주입:
```
[skill 경로] 이번 부서 = <roleId> (<부서명>).
- Claude: .claude/skills/<roleId>/SKILL.md
- Codex/Gemini: .agents/skills/<roleId>/SKILL.md
해당 파일을 읽고 내용을 그대로 따르라.
```

→ 사용자 의도: "스킬내용은 시스템 구현 후 한번 천천히 다듬을 계획. 필수적으로 들어가야하는 부분을 문서화 해 둘 것" — 양식 + 방어 로직 4 항 frontmatter 동봉이 필수, 본문 systemPromptKo 는 R13+ 에서 사용자가 천천히 다듬음.

### 11.10 R12-W phase 정의 (구현 부서 worktree + 분할 commit + merge, 신규)

**Goal**: 구현 부서가 designated 1명 작성 (R12-C) 에서 → 다수 provider 가 worktree 기반 병렬 commit + merge 까지 확장. 사용자 의견 ("혼자 다 하면 다른 프로바이더가 아까워") 의 정확한 해결책.

**Scope**:
- OPINION_GATHERING (자원 모드) — 각 AI 가 "내가 어디 / 무엇 잘 함" 자원 ("frontend 잘 함" / "DB 마이그레이션 잘 함" / "테스트 코드 잘 함")
- OPINION_TALLY — OpinionService (R12-C 에서 추출) 재사용. 시스템 dedup + 충돌 감지 (같은 파일 두 명 자원 시)
- 충돌 시 vote 라운드 또는 사용자 split
- 사용자에게 분담표 표시 → 수동 override 가능
- worktree N개 + branch N개 spawn → 병렬 작업
- merge — D-B Light (merge conflict 시 부서 회의)
- shared 파일 lock + dependency graph 우선 sequential (§11.1 의 결정 채택)

**No-go**:
- 다른 부서 (아이디어 / 기획 / 디자인 / 검토 / 일반) 의 분할 (R12-W 는 구현 부서만)
- 외부 자원 endpoint 연동 (R12-S slot 만)
- 이미지 생성 (R12-D 보류)

**의존성**: R12-C 종결 후 진입. D-B 와 R12-H 사이에 위치. R12-C 의 OpinionService + designated-worker-resolver + handoff_mode 인프라 재활용.

**예상 폭**: 5~10 일 (§11.8 phase 추정).

### 11.11 R12-D phase 보류 (이미지 생성 + ComfyUI/Diffusion)

R12 묶음 첫 출시 (R12-S + R12-C + D-B + R12-W + R12-H 종결) 이후 별도 phase. 사용자 결정 (2026-05-02): "컴피UI 또는 디퓨전은 완성 이후 생각해 볼 일로 예정".

**Scope (미래)**:
- `image-generation` capability 추가 (provider matrix 확장)
- nano banana (Gemini 플러그인) endpoint 연동
- Codex image endpoint 연동
- ComfyUI / Stable Diffusion 외부 endpoint 연동
- design.character + design.background sub-skill 활성화
- 이미지 미리보기 UI / 파일 저장 (`.png` / `.svg`) / ExecutionService 이미지 적용

**현재 상태 (R12-C 시점)**:
- R12-S 에서 4 sub-skill 카탈로그 정의됨 (`design.ui` / `design.ux` / `design.character` / `design.background`)
- R12-C 에선 `design.ui` + `design.ux` 만 활성화 (HTML/CSS + Playwright 웹 스샷)
- `design.character` / `design.background` 는 grayed out (provider 가 image-generation capability 없으면 선택 불가)
- ComfyUI / Stable Diffusion 연동은 R12-D 로 미룸 — 첫 출시 (`v0.2.0` 또는 그 이후) 이후 사용자 dogfooding 결과 보고 진입 결정

### 11.12 부서 lock 사이클 + 대기 큐 + 컨텍스트 + 변경 규모 분기 (R12-W land)

R12-C 의 single-meeting-per-channel 가드 (`AlreadyActiveMeetingError` + `ChannelMeetingControl` 버튼 분기 + queue runner 의 자동 `startNext`) 위에서, **부서별로 lock 사이클이 다르다** 는 사용자 결정 (2026-05-03) 을 정식화한다. 본격 구현 land 는 R12-W 와 함께 — R12-C 에서는 spec/메모리 결정만.

#### 11.12.1 부서별 lock 사이클 매트릭스

| 부서 | 한 사이클 | lock 풀림 시점 |
|------|-----------|----------------|
| 아이디어 | 회의 → 기획 인계 | **인계서 보내는 순간** (인계 후 즉시 자유) |
| 기획 | 회의 → 인계 → 구현 → 검증 | **검증 OK 까지** (검증 NG 회귀 시 다시 잠김 — 사이클 미종료) |
| 디자인 | 회의 → 시안 → 인계 | 인계서 보내는 순간 (아이디어와 동일 패턴) |
| 구현 | 회의 → 작성 → 검증 인계 | 검증 인계 보내는 순간 |
| 검토 | 회의 → 결과 인계 | 결과 인계 보내는 순간 |
| 일반 | 단발 chat | lock 없음 |

**핵심 차이**: 기획만 사이클이 *부서 밖까지 늘어남* — 자기가 만든 기획서가 끝까지 살아있는지 책임. 다른 부서는 "내 손 떠난 뒤" 가 끝.

**구현 범위 옵션 (§11.4) 과의 결합**: 사용자가 단계별 MVP 선택 시에도 **기획 lock 은 모든 단계 검증 OK 까지** 유지. 단계 사이의 사용자 confirm gate 는 "현재 단계 검증 OK + 다음 단계 진입 동의" — 기획 lock 은 그 사이엔 안 풀림 (사용자 결정 2026-05-03).

#### 11.12.2 lock 범위 = 프로젝트 단위

- 프로젝트 A 의 기획이 잠겨있어도 프로젝트 B 의 기획은 자유. 사무실은 프로젝트별 분리.
- 동시 활성 프로젝트 수 자체에는 임의 한도 두지 않음 — 사용자 컴퓨터 RAM 한도 안에서 사용자가 자율 결정 (CLI provider 자식 프로세스가 100~500 MB / 직원, 5 프로젝트 동시 = 500MB ~ 2.5GB).
- Dashboard 에 "현재 일하는 프로젝트 N개 / 추정 RAM" 표시는 R13 의 friendly UX (Phase R12 scope 외).

#### 11.12.3 대기 큐 — 차단 X, 자동 진입

- 부서가 잠긴 동안 같은 부서 / 같은 프로젝트로 들어오는 새 할 일: **차단 X**, `pending` 으로 큐에 쌓임 + UI 가 "회의 종료 후 시작" 표시.
- 사이클 lock 풀림 = `meeting.onFinalized` → queue runner 의 자동 `startNext` 가 다음 pending 항목 claim → 새 회의 시작 (R10-Task7 으로 이미 wired).
- 검증 NG 로 기획이 다시 잠길 때: 대기 중인 새 기획 할 일은 **그대로 더 기다림**. 회귀는 사이클 미종료이므로 lock 유지 (사용자 결정 2026-05-03).

#### 11.12.4 컨텍스트 주입 — 새 task = 새 세션

- 같은 부서가 task A 끝내고 한참 뒤 task B 받을 때: **task A 의 회의록 / 인계서를 task B 첫 prompt 에 자동 prepend 하지 않음**. 깨끗한 새 회의 (사용자 결정 2026-05-03).
- 같은 *프로젝트* 안에서 부서 간 인계 chain 으로 흐르는 산출물 (아이디어 → 기획서 → 디자인 시안 → 구현 spec) 은 **인계 메커니즘** 으로 다음 부서가 받음 — 자동 prepend 가 아니라 인계서가 다음 부서 첫 prompt 에 동봉되는 정상 흐름. (별 의미.)
- **아이디어 부서의 사용자 요청 검증**: 사용자가 아이디어 task 등록 시 아이디어 부서가 **기존 아이디어 / 기획 문서 (consensus 폴더 기반) 읽고 일치 여부 먼저 검증** → 맞으면 진행, 아니면 "새 프로젝트로 만드시는 게 어떨까요" 권장 (사용자 결정 2026-05-03). consensus 폴더 read 는 `permission_mode='hybrid'` 이상에서 자동.

#### 11.12.5 자동 워크플로우 진행 중 변경 요청 — 규모별 분기

자동 워크플로우 (부서 인계 chain) 진행 중 사용자가 기능 추가 / 변경 요청 시:

| 규모 | 예시 | 처리 경로 |
|------|------|-----------|
| 작은 변경 | 버튼 텍스트 / 색상 / 사소한 wording | 사용자 메시지로 active 부서에 끼어들기 (D-A T2.5 dispatcher — `interruptWithUserMessage` 이미 land) |
| 중간 변경 | 요구사항 1개 추가 / 작은 기능 추가 | T7 일시정지 → **기획 부서로 변경 인계** → 재계획 → 재개 |
| 큰 변경 | 다른 기능 / 골격 변경 | 큐에 새 task 등록 → 현재 chain 끝나고 처리 |

**디폴트 = "중간"** (기획 일시정지 → 변경 인계). UI 의 "변경 요청" 버튼 → 모달 → 작은/중간/큰 사용자 선택. R12-W 의 새 surface (UI 컴포넌트 + IPC + 인계 흐름).

#### 11.12.6 외부 수정 감지 — R12-H 로 미룸

사용자가 외부 터미널에서 진행 중 프로젝트의 산출물 파일 (기획서 / 시안 / 코드) 직접 수정 후 돌아오는 경우:

- **신뢰 모델**: 사용자 책임 영역. Rolestra 가 우회 사용 자체를 막지 않음.
- **자연스러운 안전망**: CLI 직원이 같은 파일 손댈 때 ExecutionService 의 baseline diff 검출 (R3 D3 land) → 사용자 승인 모달. 추가 방어 코드 0줄.
- **CLI 가 파일 안 만지는 시나리오** (회의 → 인계만): 부서 산출물의 mtime 변화 감지 → 인계 직전 사용자에게 "기획서가 외부에서 변경됐습니다 — 인계 OK 하시겠어요?" 모달. 가벼운 가드.
- 본격 land 는 **R12-H** (인계 phase) 와 함께. R12-C / R12-W scope 외.

#### 11.12.7 R12-C / R12-W / R12-H 분담 정리

| Phase | 본 절의 어디까지 land |
|-------|----------------------|
| R12-C | spec 결정만 (본 §11.12). single-meeting-per-channel 가드는 이미 land. 코드 변경 0. |
| R12-W | §11.12.1 부서 lock 매트릭스 + §11.12.3 대기 큐 정교화 + §11.12.4 아이디어 부서 사용자 요청 검증 + §11.12.5 변경 규모 분기 UI. |
| R12-H | §11.12.6 외부 수정 감지 (인계 직전 mtime 가드). |

### 11.13 SsmBox 부서별 layout (R12-C2 P3 land)

회의 진행 본체가 부서마다 흐름이 다른 만큼 우측 SsmBox 도 부서별 variant 5 종으로 분기. 모든 variant 는 같은 backend (`OpinionService` + `MeetingMinutesService`) 데이터 (`opinion` + `opinion_vote`) 를 읽되 표현 layer 만 다름.

| 부서 | layout |
|------|--------|
| **idea** | 의견 list (kind='root' 만, 단순) + 옆에 사용자 선택 여부 (체크 마크). 진행 상황 X — step 2 까지만. step 2.5 / 3 / 4 / 5 surface X (D-B-Light) |
| **planning / review / audit** | 의견 트리 (parent chain 들여쓰기) + 현재 진행 의견 highlight + 각 카드 동의/반대/수정 표시 + 카운터 (예: "2/3 동의") + 회의록 [합의]+[제외] 미리보기 footer |
| **design** | 토론 round 표시 + UX/UI 시퀀스 (와이어프레임 5 단계 / 디자인 2 단계) + Playwright PNG 미리보기 (별 컴포넌트 — `<DesignPreview>` desktop / mobile 탭) |
| **implement** | designated AI 표시 + 진행도 게이지 + 작업 중 파일 list (별 컴포넌트 — `<ImplementProgress>`). 회의 X — opinion 트리 / 투표 surface 자체가 없음 |
| **general** | 카드 누적 list (kind='self-raised' / 'user-raised' 도 표시) + 가벼운 동의/반대 카운터 + 사용자 동의/반대 버튼. 합의/회의록/인계 surface 모두 X (잡담 정체성 유지) |

→ SsmBox component 의 props 는 `channelId` 1 개만 받고, 내부에서 `channel.role` 보고 variant 결정. 부서별 컴포넌트는 같은 폴더 (`renderer/features/messenger/SsmBox/`) 안에 5 개 파일 분리.

#### 11.13a 채팅창 카드 표시 (R12-C2 P3 land)

회의 안 의견 발화 (`opinion` row 의 root / revise / block / addition kind) 는 *채팅창 메시지 row* + *SsmBox 카드* 둘 다 표시 — 사용자가 채팅 흐름 따라가면서도 회의 진행 한눈에 볼 수 있게.

- 채팅창 = `Card primitive` (R3 시점 land) 활용 + `themeKey` 따라 변형 (브랜드 / 미니멀 / 노블 / 페이퍼 / 시노그래피 / TUI 6 테마 — R5 D3 / R10 D4 결정 그대로).
- 본문 truncate 금지 (사용자 명시: "잘리지 말고 다 보여 줘"). long content 도 카드 안 scroll 또는 expand 버튼.
- 카드 안 [선택 / 취소] / [동의 / 반대] 같은 액션 버튼 (kind 별).
- 발화 ID (`codex_1` / `claude_2`) + 의견 트리 ID (`ITEM_001_01`) 둘 다 카드 헤더에 표시.
- DM / 일반 채널 / 부서 채널 모두 같은 Card primitive 사용. 부서별 차이는 액션 버튼 종류 + 카드 색상 톤 (themeKey 안 부서별 tint).

→ MessageRenderer 의 *카드 variant* 가 R12-C2 P3 신규 surface (P3-1 sub-task). 옛 plain text 메시지 렌더러는 그대로 유지 (회의 외 채팅용).

### 11.14 channels.max_rounds (R12-C2 P2 land — 회의 종료 조건)

채널 설정 옵션에 두 독립 차원:

```
[1] 인계 방식 (handoff_mode)
    ( ) 자동 인계 (auto)
    (•) 사용자 승인 후 인계 (check)

[2] 회의 종료 조건 (max_rounds)         — R12-C2 신규
    ( ) 무제한 (합의까지)
    (•) [N] 라운드 도달 시 사용자 호출
```

→ 두 차원 독립 — 둘 다 동시 설정 가능.

**구분되는 시스템 default (사용자 설정 X)**:
- **의견 트리 깊이 cap = 3** (§5) — 의견 트리 (`ITEM_001` → `ITEM_001_01` → `ITEM_001_01_01`) 깊이 cap. 무한 루프 방지.
- **maxConversationRounds = 5** (D-A round 5 hard cap, 이미 land) — 끝말잇기 같은 자연 무한 주제 안전장치.

DB ALTER = `019-opinion-tables.ts` (P2 backend land 시점, §4 Migration) 안 `channels.max_rounds INTEGER NULL` 통합.

채널 설정 UI = 채널 헤더 우측 ⚙ 버튼 → 모달 안 두 차원 토글 (R12-C2 P3 또는 P6 land — design round 후 결정).

### 11.15 providers.capability_tier (R12-W 진입 시 ALTER, 보류)

R12-W 본격 phase = 구현 부서 분담 + tier system + worktree 분할. 토대 컬럼:

```typescript
provider {
  ...
  capabilityTier: 'frontier' | 'mid' | 'local'   // R12-W 신규
}
```

| tier | 작업 |
|------|------|
| `frontier` | Claude Opus / GPT-5 / Gemini Ultra — **중요 / 핵심 로직** |
| `mid` | Claude Sonnet / GPT-4 / Gemini Pro — 일반 / 보일러플레이트 |
| `local` | Ollama qwen / llama — **쉬운 / 반복 / 리팩토링 / 주석 / 테스트 보일러** |

분배 규칙 (구현 부서장 AI 가 sub-task 마다 tier 보고 배정):
- 시킬 게 없으면 → 대기 (idle)
- frontier 작업이 많으면 → mid 가 보조
- 수동 핀: 사용자가 특정 직원에게 특정 sub-task 강제 가능

DB ALTER = `020-providers-capability-tier.ts` (R12-W 진입 시 land, §4 Migration). **R12-C2 시점에는 ALTER 자체 안 함**.

### 11.16 부서 lock 사이클 R12-C2 정정 (§11.12.1 매트릭스 보강)

§11.12.1 매트릭스 6 행이 R12-C 시점 (옛 review 한 부서) 기준이라 R12-C2 의 review/audit 분리 후 정정:

| 부서 | 한 사이클 | lock 풀림 시점 |
|------|-----------|----------------|
| 아이디어 (idea) | 회의 → 기획 인계 | 인계서 보내는 순간 |
| 기획 (planning) | 회의 → 인계 → 구현 → 검토 (audit) | **검토 OK 까지** (NG 시 다시 잠김) |
| 디자인 (design) | 회의 → 시안 → 인계 | 인계서 보내는 순간 |
| 구현 (implement) | 회의 → 작성 → 검토 (audit) 인계 | 검토 인계 보내는 순간 |
| **리뷰 (review)** (R12-C2 정정) | 회의 → 회의록 → 사용자 자유 발화 | **회의록 작성 직후** (chain 외 — 사용자 후속 작업 발화는 별 task) |
| **검토 (audit)** (R12-C2 신규) | 회의 → 결과 인계 | 결과 인계 보내는 순간. NG 인계 (기획 부서) 도 인계 시점에 lock 풀림 |
| 일반 (general) | 단발 chat | lock 없음 |

**핵심 차이 (변경 X)**: 기획만 사이클이 *부서 밖까지* 늘어남 — 자기가 만든 기획서가 검토 OK 까지 살아있는지 책임. 다른 부서는 "내 손 떠난 뒤" 가 끝.

**리뷰 lock 모델 (R12-C2 신규)**: 리뷰는 chain 외라 인계 시점이 없음. 회의록 작성 직후 lock 풀림 — 사용자가 회의록 보고 후속 작업 발화 시 새 task 로 처리 (같은 부서 큐에 다른 user/audit 인계가 와도 차단 X).

본격 land = R12-W (§11.12 의 phase 분담 그대로).

### 11.17 변경 요청 분기 R12-C2 정정 (§11.12.5 위 UI 명시)

§11.12.5 의 변경 요청 규모별 분기 (작은 / 중간 / 큰) 위에 R12-C2 P6 시점 UI 신규:

```
부서 채널 헤더 우측 [변경 요청] 버튼
        ↓
모달 — "변경 요청 규모 선택"
   ( ) 작은 변경 (텍스트 / 색상 / 사소한 wording)
       → active 부서에 끼어들기 (D-A T2.5 dispatcher / interruptWithUserMessage 이미 land)
   (•) 중간 변경 (요구사항 1 개 추가 / 작은 기능 추가)         ← 디폴트
       → 현재 chain 일시정지 (T7 pause/resume) → 기획 부서로 변경 인계 → 재계획 → 재개
   ( ) 큰 변경 (다른 기능 / 골격 변경)
       → 현재 chain 그대로 진행 + 큐에 새 task 등록 (현재 chain 끝나고 처리)

   [변경 내용] textarea
   [취소]                                           [확인]
```

→ 규모 선택 후 변경 내용 textarea 입력 + 확인 → 시스템이 분기 따라 처리.

UI surface land = R12-C2 P6 (인계 phase). 본격 backend wire = R12-W phase 안 다른 sub-task 와 동시.

### 11.18 직원 응답 JSON schema (R12-C2 정식)

§5 Message Schema 단락이 reference 한 정식 schema 4 종. 본 §11.18 가 모든 풀세트 부서가 공유하는 단일 schema 정의 — 부서별 차이는 prompt template + workflow 분기로만 표현 (schema 자체는 통일).

#### 11.18.1 발화 ID 카운터 + 의견 트리 ID 형식 (전제)

- **발화 ID (`label`)**: 회의 단위 카운터. 형식 `<provider_id>_<n>` (예: `codex_1`, `claude_2`, `gemini_3`). 한 회의 안에서 직원별 카운터, 회의 끝나면 리셋. 다음 회의에서 다시 `codex_1` 부터.
- **의견 트리 ID (`target_id` / `parent_id`)**:
  - DB 저장 = `id` (UUID v4) + `parent_id` (UUID 또는 NULL)
  - **schema 안 직원 응답에서 사용하는 `target_id` / `parent_id`** = *시스템이 가공한 화면 ID* (`ITEM_NNN` / `ITEM_NNN_NN` / `ITEM_NNN_NN_NN`). 직원에게는 UUID 노출 X — 시스템이 schema 응답 받으면 ID 매핑 (화면 ID → UUID) 후 DB 반영.
  - 깊이 cap = 3 (§5)

#### 11.18.2 step 1 — 의견 제시 (직원 → 시스템)

```typescript
type Step1OpinionGather = {
  name: string;                     // 직원 표시명 (예: "Codex")
  label: string;                    // 회의 단위 발화 ID (예: "codex_1")
  opinions: Array<{
    title: string;                  // 의견 제목 (카드 헤더, ≤ 80 글자 권장)
    content: string;                // 의견 본문 (truncate 금지 — schema 자체에 길이 제약 X)
    rationale: string;              // 근거 / 이유 (왜 이 의견인지)
  }>;
};

// 예시
{
  "name": "Codex",
  "label": "codex_1",
  "opinions": [
    {
      "title": "WebView2 단일 프로세스로 가자",
      "content": "Electron 의 multi-process 모델은 데스크톱 메모리 폭발이 잦으니 ...",
      "rationale": "사용자 RAM 8GB 환경에서 5 프로젝트 동시 = 4GB ↑ — 단일 프로세스 모델이 OOM 안전"
    }
  ]
}
```

→ 같은 직원이 회의 안에서 여러 의견 제시 가능 (`opinions` 배열 길이 ≥ 1). 시스템이 받으면 step 2 (시스템 취합) 로 넘어가 `opinion` row 생성 + 트리 ID 부여.

#### 11.18.3 step 2 — 의견 row (시스템 취합 결과, DB)

step 2 는 직원 응답이 아니라 *시스템이 step 1 응답을 DB 에 반영* 한 결과. schema = `opinion` 테이블 row (§5 데이터 모델 + §4 Migration 019):

```typescript
type OpinionRow = {
  id: string;                                            // UUID v4 PRIMARY KEY
  parent_id: string | null;                              // UUID FK opinion.id (NULL = root)
  meeting_id: string;
  channel_id: string;
  kind: 'root' | 'revise' | 'block' | 'addition'         // 회의 안 의견
      | 'self-raised' | 'user-raised';                   // 일반 채널 (§4 일반 부서 새 정의 / P4)
  author_provider_id: string | null;                     // NULL = user-raised
  author_label: string;                                  // 회의 단위 카운터 (예: "codex_1")
  title: string;
  content: string;                                       // truncate 금지
  rationale: string | null;
  status: 'pending' | 'agreed' | 'rejected' | 'excluded';
  exclusion_reason: string | null;                       // status='rejected'/'excluded' 시 회의록 제외 사유
  round: number;
  created_at: string;                                    // ISO 8601
  updated_at: string;
};
```

step 2 종결 후 시스템이 모든 root 의견에 화면 ID 부여:
- 첫 번째 root 의견 = `ITEM_001`
- 두 번째 root 의견 = `ITEM_002`
- ...
- `ITEM_001` 의 자식 = `ITEM_001_01`, `ITEM_001_02` ...
- `ITEM_001_01` 의 자식 = `ITEM_001_01_01` (cap 3 도달)

화면 ID 는 *시스템이 parent chain depth-first 순회* 로 매핑 — DB 직접 저장 X (UUID 만 진실 source).

#### 11.18.4 step 2.5 — 일괄 동의 투표 (직원 → 시스템)

시스템이 step 2 결과 (의견 list) prompt 안에 markdown 표로 주입 + step 2.5 응답 schema 안내:

```typescript
type Step25QuickVote = {
  name: string;                     // 직원 표시명
  label: string;                    // 회의 단위 발화 ID (예: "claude_1")
  quick_votes: Array<{
    target_id: string;              // 화면 ID (예: "ITEM_001")
    vote: 'agree' | 'oppose' | 'abstain';
    comment?: string;               // optional — 동의하면서도 코멘트 가능
  }>;
};

// 예시
{
  "name": "Claude",
  "label": "claude_1",
  "quick_votes": [
    { "target_id": "ITEM_001", "vote": "agree" },
    { "target_id": "ITEM_002", "vote": "oppose", "comment": "Y 안은 token 비용 큼" },
    { "target_id": "ITEM_003", "vote": "agree", "comment": "찬성!" }
  ]
}
```

→ 시스템이 모든 직원 응답 받아 `opinion_vote` row 생성 (`round_kind='quick_vote'`).

→ **만장일치 (모두 agree)** 의견 = `opinion.status='agreed'` 즉시 반영 + 자유 토론 skip.
→ **만장일치 못 받은** 의견 = step 3 (자유 토론) 으로 진입.

#### 11.18.5 step 3 — 자유 토론 (직원 → 시스템)

시스템이 step 2.5 에서 합의 못 받은 의견 1 개씩 prompt 에 제시 + 자식 의견 list 동봉:

```
현재 진행 의견: ITEM_002
  내용: "Y 하자" (Codex)
  근거: "..."

자식 의견 (수정/반대/보강):
  - ITEM_002_01 (revise, Gemini): "Y' 가 더 좋겠다"

이 의견 (또는 자식) 에 대해:
- 동의 / 반대 / 보류 표명
- 또는 수정안 / 반대안 / 보강안 제시 가능

응답 형식: {schema 안내}
```

응답 schema (한 턴에 vote + 새 의견 동시 가능):

```typescript
type Step3FreeDiscussion = {
  name: string;
  label: string;                    // 회의 단위 발화 ID (예: "claude_2")
  votes: Array<{
    target_id: string;              // 화면 ID (예: "ITEM_002" 또는 "ITEM_002_01")
    vote: 'agree' | 'oppose' | 'abstain';
    comment?: string;
  }>;
  additions: Array<{
    parent_id: string;              // 자식이 매달릴 부모 화면 ID (예: "ITEM_002")
    kind: 'revise' | 'block' | 'addition';   // 수정 / 반대 / 보강
    title: string;
    content: string;                // truncate 금지
    rationale: string;
  }>;
};

// 예시
{
  "name": "Claude",
  "label": "claude_2",
  "votes": [
    { "target_id": "ITEM_002", "vote": "agree" },
    { "target_id": "ITEM_002_01", "vote": "oppose" }
  ],
  "additions": [
    {
      "parent_id": "ITEM_002",
      "kind": "revise",
      "title": "Y'' 하자",
      "content": "...",
      "rationale": "..."
    }
  ]
}
```

→ 시스템이 votes → `opinion_vote` row (`round_kind='free_discussion'`), additions → `opinion` row (kind 따라 분기, 화면 ID 새로 부여 — `ITEM_002_02` 등).

→ 합의 도달 (모든 직원 agree) → `opinion.status='agreed'` + 다음 의견 진입. 깊이 cap 3 도달 또는 max_rounds (§11.14) 도달 시 사용자 호출.

#### 11.18.6 step 5 — 모더레이터 회의록 prompt (시스템 → 모더레이터)

step 4 (모든 의견 합의/제외) 후 시스템이 모더레이터 (R12-S `MeetingSummaryService` + `getResolvedSummaryModel`) 에게 회의록 작성 요청. **모더레이터 응답은 자유 markdown 본문** — JSON schema 강제 X. 단 prompt 가 양식 + truncate 금지 강제.

```
당신은 회의 모더레이터입니다. 아래 회의 history + 의견 트리를 받아
회의록을 작성하세요.

[규칙 — 반드시 준수]
- 의견 본문 통째 보존 (truncate / 요약 / 축약 금지)
- 근거 통째 보존
- 결정 사유 (왜 합의 / 왜 제외) 직접 작성

[양식]
# {meeting_topic} — {date}

## 합의 항목
- 의견 ITEM_NNN: "{title}" ({author_label} 발의)
  - 본문: ... (통째)
  - 근거: ... (통째)
  - 결정: 합의 (X 명 동의)

(후략 — 모든 status='agreed' 의견 반복)

## 제외 항목
- 의견 ITEM_NNN: "{title}" ({author_label} 발의)
  - 본문: ... (통째)
  - 근거: ... (통째)
  - 제외 사유: ... (모더레이터 작성)
  - ☞ 사용자가 다시 발화하려면: "회의록 X — 제외 항목 #N (title) 다시 진행"

(후략 — 모든 status='rejected' / 'excluded' 의견 반복)

## 다음 단계
- 인계: planning → design (handoff_mode='check' — 사용자 승인 대기)

[회의 history]
... (시스템이 발화 통째 동봉)

[의견 트리]
... (시스템이 opinion + opinion_vote 통째 동봉)
```

→ 모더레이터 응답 = 회의록 markdown 본문 → 시스템이 그대로 `<ArenaRoot>/<projectId>/consensus/<meetingId>/minutes.md` 저장 + 채팅창 카드로 표시 (Card primitive, §11.13a).

#### 11.18.7 schema 검증 + fallback

- 직원 응답이 schema 부합 안 하면 시스템이 1 회 재요청 (prompt 안 schema 양식 다시 동봉). 2 회 실패 시 *해당 직원 응답 skip + 다음 직원 진행* — 회의 자체는 멈추지 않음.
- 모더레이터 응답이 truncate / 요약 의심 시 시스템이 회의록 본문 길이 ↔ 의견 본문 합 비교 + 임계 (회의록 ≥ 의견 본문 합 × 1.2) 하회 시 1 회 재요청. 사용자 결정 (2026-05-04): "잘리지 말고 다 보여 줘".

---

---

## 참고 spec / 메모리

- `2026-04-18-rolestra-design.md` (기존 v3 spec — R12-H 후 일부 deprecate 표시)
- `docs/superpowers/plans/2026-05-01-rolestra-r12-s-persona-skills.md` (R12-S 종결)
- `docs/superpowers/plans/2026-05-02-rolestra-phase-r12-c.md` (R12-C 진입 plan)
- 메모리: `rolestra-r12-c-plan-land.md` (R12-C 결정 12 항 + 의문 풀이)
