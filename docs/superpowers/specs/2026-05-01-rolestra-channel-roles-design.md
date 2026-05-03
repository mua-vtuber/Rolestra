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

### 시스템 정의 스킬 카탈로그 (10 능력)

| Role ID | 한국어 라벨 | 핵심 |
|---------|-------------|------|
| `idea` | 아이디어 | 자유 brainstorm + 비판 보류 + 다양성 강조 |
| `planning` | 기획 | spec 작성 + 사용자 페르소나 분석 + 우선순위 매트릭스 + (외부) 시장조사 |
| `design.ui` | 디자인 (UI / 형태) | UI 형태 / 디자인 토큰 / 컴포넌트 시안 + (외부) 색상 추출 |
| `design.ux` | 디자인 (UX / 사용감) | 사용 흐름 / 정보 구조 / 사용자 여정 |
| `design.character` | 디자인 (캐릭터) | 게임 캐릭터 시안 / 모션 컨셉 — 게임 프로젝트만 |
| `design.background` | 디자인 (배경) | 게임 배경 시안 / 무드 보드 — 게임 프로젝트만 |
| `implement` | 구현 | 코드 생성 + 파일 쓰기 + 명령 실행 + diff 적용 + 테스트 실행 |
| `review` | 검토 | lint / typecheck / 테스트 실행 + 스파게티 / 하드코딩 / 버그 위험 평가 + e2e |
| `general` | 일반 (잡담) | 1라운드 단순 응답, 회의 안 함, 채널 권한 매트릭스 X |
| (시스템) `meeting-summary` | 회의록 자동 정리 | system 만 호출, 직원 부여 X |

각 스킬 = (system prompt 템플릿 + tool 권한 matrix + 외부 자원 endpoint).

**부서 템플릿 8개 (디폴트 6 + 옵션 2)**:
- 디폴트 (프로젝트 만들면 자동 생성): 아이디어 / 기획 / 디자인 (UI+UX 묶음) / 구현 / 검토 / 일반
- 옵션 (사용자 추가): 캐릭터 디자인 / 배경 디자인
- 디자인 부서 = `[design.ui, design.ux]` 두 능력 묶음 — UI/UX 의논 잦으니 분리하지 않음.
- 직원 능력은 9 개 중 자유 다중 체크 — 한 직원이 여러 부서에 멤버.

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
- `role`: `'idea' | 'planning' | 'design.ui' | 'design.ux' | 'design.character' | 'design.background' | 'implement' | 'review' | 'general' | null`
- `purpose`: 자유 텍스트 (사용자 작성, optional)

### 부서별 회의 흐름 (R12-C 결정 매트릭스, 2026-05-02 갱신)

| 부서 (role) | 회의 형식 | 종료 조건 | 결과물 | trigger | 구현 phase |
|------------|----------|----------|--------|---------|-----------|
| **idea (아이디어)** | D-B-Light (OPINION_GATHERING + OPINION_TALLY) + USER_PICK | 사용자가 카드 선택 + 코멘트 → 기획 부서 인계 | 의견 카드 list → 사용자 선택 | 할 일 큐 entry | R12-C |
| **planning (기획)** | D-B 풀세트 (§5 — OPINION_GATHERING → OPINION_TALLY → AGREEMENT_VOTE → REVISION_NEGOTIATION) | 모든 의견 합의/거절 처리 | spec markdown | 인계 only | D-B phase |
| **design.ui + design.ux** (디폴트, 통합) | UX → UI → UX 토론 시퀀스 (3R cap) + Playwright 웹 스샷 | UX 동의 신호 또는 3R cap (사용자 개입 모달) | HTML/CSS + 와이어프레임 + PNG snapshot (desktop 1280x720 + mobile 375x812) | 인계 only | R12-C |
| **design.character / design.background** (옵션, 게임/일러스트) | 미정 (이미지 생성 phase) | — | 캐릭터/배경 시안 이미지 | 인계 only | R12-D (보류) |
| **implement (구현)** | designated 1명 spec 받아 작성 (R12-C) → 자원 모델 + worktree+merge (R12-W) | 사용자 승인 + ExecutionService apply | 코드 변경 + git commit | 인계 only | R12-C (1명) → R12-W (분할) |
| **review (검토)** | OPINION_GATHERING + TALLY → 기획 부서 자동 분류 (의도/수정) → 분류 카드 | 사용자 OK → 수정 group 만 구현 부서 인계 | issue list 분류 결과 + 펼쳐 보기 | 인계 only | R12-C |
| **general (일반)** | 1라운드 단순 응답 (round 5 fix 보존, 모든 직원 자동 부여) | round 1 응답 후 즉시 종결 | 응답 메시지 | 사용자 입력 즉시 | 기존 (변경 없음) |

→ 채널 역할 = (SSM phase line + prompt template + permission matrix + trigger 방식 + handoff_mode + drag_order) 한 묶음.
→ R12-C 의 OpinionService 가 D-B 의 처음 2 단계 (OPINION_GATHERING + OPINION_TALLY) 를 분리한 재사용 가능 service 로 land — 아이디어 / 검토 / R12-W 가 부분 phase 만 사용.

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

새 사이드바 (R12-C):
```
시스템
  #일반 (general)
  #승인-대기 / #회의록
부서 (프로젝트 기본)
  💡 아이디어
  📋 기획
  🎨 디자인 (아트)
  📐 디자인 (형태)
  🔧 구현
  ✅ 검토
사용자 채널 (자유)
  채널A (general)
  ...
DM
  Claude DM
```

→ **부서 = 프로젝트 단위 자동 1 개씩 default**. 사용자 가 추가 자유 채널 만들 수 있지만 default role='general'.
→ **#일반 (system_general) 은 기존 그대로** — 영향 없음 (round 5 fix 의 1라운드 단순 응답 보존).

### 작업 모드 deprecate 시작

R12-C 진입 시:
- 구현 부서 (role='implement') = 작업 권한 자동 ON. 메시지 = 즉시 작업 (회의 안 거침).
- 기존 SSM 의 EXECUTING phase 를 구현 부서 default behavior 로 흡수.
- WORK_DISCUSSING / SYNTHESIZING / VOTING 은 일단 보존 (deprecate 는 R12-H 종결 시).

### auto-trigger vs 인계 trigger 분기

- **auto-trigger**: 사용자가 채널 메시지 입력 → 회의 자동 시작 (현재 D-A T4/T5 흐름).
  - 적용: idea, planning, general
- **인계 trigger**: 다른 부서가 의뢰 → 부서가 받아서 작업 시작.
  - 적용: design.*, implement, review
  - 사용자 직접 트리거 안 됨 (의도된 제약 — 인계 chain 통해서만)

### Migration

`018-channels-role-purpose-handoff.ts` (R12-C 결정으로 컬럼 4개 + system_general 전역화, 2026-05-02 갱신):
- `role` TEXT NULL (system 채널 = NULL, 부서 채널 = RoleId)
- `purpose` TEXT NULL (자유 텍스트, 사용자 작성)
- `handoff_mode` TEXT NOT NULL DEFAULT 'check' (부서 인계 직전 사용자 confirm 모드, 'check' | 'auto'. R7 ApprovalService 와 별개 — R7 = 파일 적용 gate, handoff_mode = 부서 인계 gate)
- `drag_order` INTEGER NULL (참여 멤버 발화 순서, designated worker 디폴트 알고리즘 fallback)
- 추가: `providers.is_department_head` TEXT JSON `Record<RoleId, boolean>` — designated worker 부서장 핀 (R12-C Task 18, 마이그레이션 018 통합)
- system_general 전역화 — 기존 프로젝트 종속 row → 가장 오래된 1 개만 보존 (projectId NULL), 나머지 DELETE.
- 기존 사용자 user 채널 = role='general' default. 기존 DB 데이터는 wipe (사용자 결정).

---

## 5. D-B — 구조화된 합의 (기획 부서)

기획 부서 (role='planning') 의 회의 흐름. 다른 부서는 별도.

### Phase 흐름

```
[OPINION_GATHERING]   각 AI 가 주제에 대한 의견 제시 (자연어, R1)
   ↓
[OPINION_TALLY]       시스템 취합 + opinion_id 부여 (안 보임)
   ↓
[AGREEMENT_VOTE]      모든 AI 가 각 의견 동의 여부 응답 (안 보임)
   ↓
[합의 결과 표시]       시스템 메시지: 합의 N개 / 미합의 M개 카드
   ↓
[REVISION_NEGOTIATION] 미합의 의견 1개씩 협의
   ↓ 합의 도달
[모든 의견 처리 완료]   → DONE → 회의록 (= spec 문서)
```

### 데이터 모델 (D-B)

`opinions`:
- id (UUID), meeting_id, author_provider_id, content, round, status

`opinion_votes`:
- opinion_id, voter_provider_id, agree (bool), round

`opinion_revisions`:
- parent_opinion_id, child_opinion_id, proposer_provider_id, kind ('revise' | 'block'), round

### Message Schema (D-B)

**OPINION_GATHERING (R1)**:
```json
{ "name": "Claude", "opinion": "...", "rationale": "..." }
```

**AGREEMENT_VOTE** (system → AI):
```
prompt 에 의견 표 주입 (markdown 표):
| id | author | content |
응답 schema:
{ "name": "Claude", "votes": [{"opinion_id": 1, "agree": true}, ...] }
```

**REVISION_NEGOTIATION**:
```json
{
  "name": "Codex",
  "opinion_id": 2,
  "stance": "revise" | "block" | "agree",
  "revision": "...",
  "rationale": "..."
}
```

### 컨텍스트 / token 관리 (사용자 우려 해결)

| 의견 수 | 전달 방식 |
|--------|----------|
| ≤ 5 | prompt 직접 |
| > 5 | `<ArenaRoot>/<projectId>/consensus/opinions.md` 파일 작성 + read 권한 부여 |
| 누적 R3+ | 직전 회의록 markdown 만 prompt + 자세한 history 는 파일 read |
| 인계 시 | 회의록 + 합의 결과만. 자세한 내용은 인계받은 채널이 필요 시 read |

추가:
- **Anthropic API prompt caching** — 재사용 부분 (스킬 템플릿, 페르소나) cache.
- **검토 부서**: 코드 + spec 만 read. 전체 대화 안 봄.
- **메모리 시스템 (R12-M, future)** 진입 시 working memory 압축 (bara_system 의 hybrid search 응용).

### Revision cap

- per-opinion revision 최대 3 R 후 강제 reject + 다음 의견 진행.
- prompt 에 명시: "수정 지시 N회 제한이니 정확한 지시 작성하라".

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

R12-S 의 SKILL_CATALOG (10 능력) 를 프로젝트 폴더에 SKILL.md 로 자동 배치 — 3 provider (Claude / Codex / Gemini) 가 각자 자동 로드.

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

---

## 참고 spec / 메모리

- `2026-04-18-rolestra-design.md` (기존 v3 spec — R12-H 후 일부 deprecate 표시)
- `docs/superpowers/plans/2026-05-01-rolestra-r12-s-persona-skills.md` (R12-S 종결)
- `docs/superpowers/plans/2026-05-02-rolestra-phase-r12-c.md` (R12-C 진입 plan)
- 메모리: `rolestra-r12-c-plan-land.md` (R12-C 결정 12 항 + 의문 풀이)
