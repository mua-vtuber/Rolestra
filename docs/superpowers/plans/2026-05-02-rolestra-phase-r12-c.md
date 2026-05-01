# Rolestra v3 — Phase R12-C 채널 역할 + 부서별 회의 형식 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 채널을 부서 (`channels.role`) + 목적 (`channels.purpose`) + 인계 모드 (`channels.handoff_mode`) + 발화 순서 (`channels.drag_order`) 로 확장하고, 부서별 회의 형식 (아이디어 D-B-Light + USER_PICK / 디자인 UX→UI→UX 토론 / 검토 OPINION_GATHERING+TALLY → 기획 자동 분류 / 구현 designated 1명 / 일반 1라운드) 을 land 한다. 사이드바 collapsible + 일반 채널 전역화 + 프로젝트 entry "할 일 작성" + 부서 채널 disabled→enabled + SKILL.md 자동 배치 + 디자인 결과물 웹 스샷 + handoff_mode auto/check 토글.

**Architecture:**
- **DB**: Migration 018 — `channels` 테이블 ALTER `role TEXT NULL`, `purpose TEXT NULL`, `handoff_mode TEXT NOT NULL DEFAULT 'check'`, `drag_order INTEGER NULL`. Forward-only, chain-level idempotent. system_general 전역화 마이그레이션 (기존 프로젝트 종속 row → 전역 1개 row, projectId NULL).
- **Shared types**: `src/shared/channel-role-types.ts` — `ChannelRole = RoleId | null`, `ChannelPurpose ('handoff_target' | 'observation' | 'free' | null)`, `HandoffMode ('check' | 'auto')`. Channel + ChannelMember 인터페이스 확장.
- **부서 회의 형식 추출**: `src/main/meetings/opinion/opinion-service.ts` — D-B 의 OPINION_GATHERING + OPINION_TALLY 단계를 D-B 풀세트에서 분리한 재사용 가능 service. 부서별 워크플로우가 이 service 의 부분 phase 만 사용 가능.
- **부서별 워크플로우 매트릭스**:

| 부서 | 형식 | 출력 |
|------|------|------|
| 아이디어 (`idea`) | D-B-Light (OPINION_GATHERING + OPINION_TALLY) + USER_PICK | 의견 카드 list → 사용자 선택 + 코멘트 → 기획 부서 인계 |
| 기획 (`planning`) | D-B 풀세트 (별도 D-B phase) | spec markdown |
| 디자인 (`design.ui`/`design.ux`) | UX → UI → UX 토론 시퀀스 (3R cap) + Playwright 스샷 | HTML/CSS + PNG snapshot |
| 구현 (`implement`) | designated 1명 spec 받아 작성 | 코드 변경 + ExecutionService apply (R12-W 에서 분할) |
| 검토 (`review`) | OPINION_GATHERING + TALLY → 기획 부서 자동 분류 → 분류 카드 → 수정 group 만 구현 인계 | issue list 분류 결과 |
| 일반 (`general`) | 1라운드 단순 응답 (기존) | 응답 메시지 |

- **SKILL.md 자동 배치**: `src/main/skills/project-skill-sync-service.ts` — 프로젝트 entry 시 `<projectRoot>/.agents/skills/<roleId>/SKILL.md` (Codex/Gemini alias) + `<projectRoot>/.claude/skills/<roleId>/SKILL.md` (Claude) 두 폴더 자동 배치. 카탈로그 systemPromptKo + 방어 로직 (자기 spec 합리화 금지) frontmatter 동봉. IPC `project:syncSkills` (수동 트리거).
- **PromptComposer 확장**: 부서 회의 진입 시 prompt 에 "이번 부서 = X. 스킬 파일 위치: .claude/skills/X/SKILL.md (Claude) / .agents/skills/X/SKILL.md (Codex/Gemini). 해당 파일을 읽고 내용을 그대로 따르라" 명시.
- **사이드바 UX**: Radix Accordion 으로 프로젝트 collapsible (디폴트 펼침 + zustand persist). 일반 채널 전역 1개 (상단 별도) / 프로젝트 그룹 (중간) / DM (하단 별도).
- **프로젝트 entry view**: 첫 진입 화면 = "할 일 작성" 입력란. 입력 → 디폴트 시작 부서 (아이디어) 의 워크플로우 IPC 호출. 사용자가 "기획부터 시작" 옵션 선택 가능.
- **부서 채널 메시지란**: 워크플로우 진입 전 = disabled (placeholder "할 일 큐의 할 일 작성으로 시작"). 진입 후 = enabled (사용자 끼어들기 = D-A T2.5 dispatcher 활용).
- **디자인 결과물**: design.ui 가 출력한 HTML/CSS → `PlaywrightSnapshotService` (off-screen Chromium) → 1280x720 desktop + 375x812 mobile PNG → `<ArenaRoot>/<projectId>/design/snapshots/round-N-{desktop,mobile}.png` 저장 → 메시지창 미리보기 + 코드 펼치기 토글.
- **handoff_mode auto/check**: 부서 인계 직전 gate. check (디폴트) = 사용자 confirm 모달 (산출물 미리보기 + "확인하고 인계" / "수정"). auto = 알림 없이 자동 인계. R7 ApprovalService 와 별개 (R7 = 파일 적용 gate, handoff_mode = 부서 인계 gate).
- **designated worker 디폴트**: (a) 사용자가 직원 편집 모달에서 "부서장" 핀 → 1순위. (b) 핀 없으면 발화 순서 1번 (참여 멤버 드래그 순서 첫 멤버) → 2순위. 분담 알고리즘 자체는 R12-W 까지 보류.
- **참여 멤버 드래그 순서**: `channels.drag_order` 또는 `channel_members.drag_order` 컬럼 (마이그레이션 018 에서 결정). 사용자가 우측 사이드 패널에서 드래그하면 발화 순서 update.

**Tech Stack:** TypeScript strict, better-sqlite3 (migration 018), zod (IPC schema), Zustand (renderer state — sidebar accordion / dragOrder / handoffMode), React 19 + Radix Accordion + Radix Tabs + dnd-kit (드래그), Playwright Electron (off-screen snapshot — R6 인프라 재활용), Vitest (unit + integration), eslint-plugin-i18next.

**사용자 결정 요약 (2026-05-02)**:
1. 사이드바 collapsible 디폴트 = **펼침** (zustand persist)
2. system_general 전역화 — 기존 프로젝트 종속 row 를 전역 1개 row 로 마이그레이션
3. 부서 채널 메시지란 = **disabled** (워크플로우 진입 전), **enabled** (진입 후 끼어들기)
4. 디자인 부서 = `[design.ux, design.ui]` 통합 + **UX → UI → UX 토론 시퀀스** (3R cap, 단순 모드 토글 X)
5. `general` 능력 = 모든 직원에 **자동 부여** (디폴트 ON, 사용자 토글 가능)
6. 스킬 그룹 모델: 디자인 (4 중 0~1) / 일반 (yes-no) / 자유 (idea/planning/implement/review 0~4)
7. 부서별 회의 형식 매트릭스 (위 Architecture 표)
8. 디자인 결과물 = HTML/CSS + Playwright 웹 스샷 PNG (R12-C 포함). character/background 이미지는 R12-D 보류 (완성 이후).
9. handoff_mode auto/check 채널별 옵션, 디폴트 check
10. designated worker 디폴트 = (a) 부서장 핀 (b) 발화 순서 1번. 분담은 R12-W (구현 부서 worktree+merge phase, 신규)
11. SKILL.md 자동 배치 = `.agents/skills/<roleId>/SKILL.md` (Codex+Gemini alias) + `.claude/skills/<roleId>/SKILL.md` (Claude). 자기 spec 합리화 방어 로직 frontmatter 명시.
12. R12-D (이미지 생성 phase + ComfyUI/Diffusion) 보류 — 완성 이후

**No-go**:
- 기획 부서 D-B 풀세트 워크플로우 (D-B phase 영역, OpinionService 만 분리)
- 구현 부서 worktree + merge + 분할 commit (R12-W phase)
- 방 간 인계 (R12-H phase) — handoff_mode 옵션은 R12-C 의 gate 만, 인계 의 흐름 자체는 R12-H 에서 풀세트
- 이미지 생성 (R12-D 보류)

**참고 메모리 / spec**:
- `docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md` (단일 권위 spec)
- `docs/superpowers/plans/2026-05-01-rolestra-r12-s-persona-skills.md` (R12-S 종결)
- 메모리: `rolestra-r12-channel-roles-design.md`, `rolestra-r12-s-completion.md`, `rolestra-phase-status.md`
- 메모리: `user-non-coder.md` — 사무실/직원 메타포 위주 설명
- 메모리: `worktree-merge-reminder.md` — phase 종결 시 main merge + worktree 정리
- 메모리: `git-identity.md` — commit identity (mua-vtuber)

---

## File Structure

| 경로 | 책임 | 동작 |
|------|------|------|
| `src/main/database/migrations/018-channels-role-purpose-handoff.ts` | DB 컬럼 추가 + system_general 전역화 | Create |
| `src/main/database/migrations/index.ts` | migration 018 등록 | Modify |
| `src/shared/channel-role-types.ts` | ChannelRole / ChannelPurpose / HandoffMode | Create |
| `src/shared/channel-types.ts` | Channel + ChannelMember 인터페이스 확장 | Modify |
| `src/main/channels/channel-repository.ts` | role / purpose / handoff_mode / drag_order CRUD | Modify |
| `src/main/channels/channel-service.ts` | 신규 메서드 (updateRole, updateHandoffMode, reorderMembers) | Modify |
| `src/main/channels/__tests__/channel-repository.test.ts` | repo unit | Modify |
| `src/main/channels/__tests__/channel-service.test.ts` | service unit | Modify |
| `src/main/projects/project-service.ts` | 프로젝트 생성 시 6 부서 채널 자동 생성 + 일반 채널 전역 1개 보장 | Modify |
| `src/main/projects/__tests__/project-service.test.ts` | unit | Modify |
| `src/main/skills/project-skill-sync-service.ts` | `.agents/skills/` + `.claude/skills/` 자동 배치 | Create |
| `src/main/skills/__tests__/project-skill-sync-service.test.ts` | unit | Create |
| `src/main/skills/skill-md-template.ts` | SKILL.md frontmatter + 방어 로직 양식 | Create |
| `src/main/skills/prompt-composer.ts` | 부서별 스킬 경로 prompt 주입 추가 | Modify |
| `src/main/skills/__tests__/prompt-composer.test.ts` | composer unit 갱신 | Modify |
| `src/main/meetings/opinion/opinion-service.ts` | OPINION_GATHERING + OPINION_TALLY 분리 service | Create |
| `src/main/meetings/opinion/__tests__/opinion-service.test.ts` | unit | Create |
| `src/main/meetings/workflows/idea-workflow.ts` | D-B-Light + USER_PICK | Create |
| `src/main/meetings/workflows/__tests__/idea-workflow.test.ts` | unit | Create |
| `src/main/meetings/workflows/design-workflow.ts` | UX → UI → UX 토론 시퀀스 (3R cap) | Create |
| `src/main/meetings/workflows/__tests__/design-workflow.test.ts` | unit | Create |
| `src/main/meetings/workflows/review-workflow.ts` | OPINION_GATHERING + TALLY → 기획 자동 분류 | Create |
| `src/main/meetings/workflows/__tests__/review-workflow.test.ts` | unit | Create |
| `src/main/meetings/workflows/implement-workflow.ts` | designated 1명 spec 받아 작성 | Create |
| `src/main/meetings/workflows/__tests__/implement-workflow.test.ts` | unit | Create |
| `src/main/design/playwright-snapshot-service.ts` | off-screen Chromium HTML/CSS → PNG | Create |
| `src/main/design/__tests__/playwright-snapshot-service.test.ts` | smoke | Create |
| `src/main/ipc/handlers/channel-handler.ts` | channel.updateRole / updateHandoffMode / reorderMembers IPC | Modify |
| `src/main/ipc/handlers/project-handler.ts` | project.syncSkills / project.startWorkflow IPC | Modify |
| `src/main/ipc/handlers/workflow-handler.ts` | workflow.startIdea / startDesign / startReview / startImplement / pickIdea / approveHandoff IPC | Create |
| `src/shared/ipc-schemas.ts` | zod schema 추가 | Modify |
| `src/shared/ipc-types.ts` | IpcChannelMap 추가 | Modify |
| `src/preload/index.ts` | typedInvoke whitelist 추가 | Modify |
| `src/renderer/components/shell/Sidebar.tsx` | Radix Accordion + 프로젝트 collapsible + 일반/DM 별도 섹션 | Modify |
| `src/renderer/features/sidebar/ProjectAccordion.tsx` | 프로젝트 단위 collapsible 컴포넌트 | Create |
| `src/renderer/features/sidebar/GeneralChannelEntry.tsx` | 일반 채널 (전역) 단일 entry | Create |
| `src/renderer/features/project/ProjectEntryView.tsx` | "할 일 작성" 입력란 + 디폴트 아이디어 부서 시작 | Create |
| `src/renderer/features/messenger/Composer.tsx` | 부서 채널 disabled / enabled 상태 표시 | Modify |
| `src/renderer/features/idea/IdeaCardList.tsx` | 의견 카드 list + 다중 선택 + 자유 코멘트 + 추가 라운드 / 인계 버튼 | Create |
| `src/renderer/features/design/DesignSnapshotPreview.tsx` | PNG 미리보기 + 코드 펼치기 토글 | Create |
| `src/renderer/features/review/ReviewClassificationCard.tsx` | 검토 분류 결과 카드 + 펼쳐 보기 | Create |
| `src/renderer/features/channel/ChannelMemberOrderPanel.tsx` | 참여 멤버 드래그 순서 패널 (dnd-kit) | Create |
| `src/renderer/features/channel/HandoffModeToggle.tsx` | auto/check 토글 + 인계 모달 | Create |
| `src/renderer/features/handoff/HandoffApprovalModal.tsx` | 인계 직전 확인 모달 | Create |
| `src/renderer/features/settings/StaffEditModal.tsx` | "부서장 핀" 토글 추가 | Modify |
| `src/renderer/hooks/use-channel-role.ts` | role/handoffMode/dragOrder 상태 + IPC | Create |
| `src/renderer/hooks/use-workflow.ts` | startWorkflow / pickIdea / approveHandoff | Create |
| `src/renderer/stores/sidebar-store.ts` | accordion 펼침/접힘 zustand persist | Create |
| `src/renderer/i18n/locales/ko/channel.json` | role 라벨 / handoffMode / disabled placeholder | Modify |
| `src/renderer/i18n/locales/en/channel.json` | en | Modify |
| `src/renderer/i18n/locales/ko/workflow.json` | workflow 메시지 / 모달 라벨 | Create |
| `src/renderer/i18n/locales/en/workflow.json` | en | Create |
| `docs/아키텍처-결정-기록/r12-c-channel-roles.md` | ADR | Create |
| `docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md` | §4 부서 회의 매트릭스 + §11 갱신 + §11.9 SKILL.md 자동 배치 + §11.10 R12-W 신규 | Modify |
| `docs/구현-현황.md` | R12-C 행 추가 | Modify |
| `tests/e2e/r12-c-channel-roles.spec.ts` | Playwright Electron e2e (smoke) | Create |

---

## Task 0: Spec §4 + §11 갱신 (이번 라운드 결정 반영)

**Goal:** 사용자 결정 (2026-05-02) 을 spec 에 반영 — §4 부서 회의 매트릭스 추가, §11.4 부서 채널 disabled 트리거 명시, §11.6 designated worker 디폴트 (부서장 핀 + 발화 순서) 명시, §11.7 R12-C task 항목 갱신, §11.8 phase 추정 갱신 (R12-C 14~20일 + R12-W 5~10일 신규), §11.9 SKILL.md 자동 배치 신규, §11.10 R12-W (구현 부서 worktree+merge) 신규 phase 명시, §11.11 R12-D (이미지 생성) 보류 명시. plan 본 작업 진입 전 spec 정합 먼저.

**Files:**
- Modify: `docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md`

**Acceptance Criteria:**
- [ ] §4 끝에 "부서별 회의 형식 매트릭스" 표 6 행 추가 (아이디어/기획/디자인/구현/검토/일반)
- [ ] §11.4 "부서 채널 메시지란 disabled" 단락에 "할 일 큐의 할 일 작성란이 트리거" 명시
- [ ] §11.6 designated worker 디폴트 = (a) 부서장 핀 (b) 발화 순서 1번 명시
- [ ] §11.7 R12-C 항목에 디자인 워크플로우 / 아이디어 워크플로우 / 검토 워크플로우 / SKILL.md 자동 배치 / 웹 스샷 / handoff_mode auto/check / 드래그 순서 추가
- [ ] §11.8 phase 추정 표에 R12-W 5~10일 신규 행 + R12-C 14~20일 갱신 + 합계 51~78일
- [ ] §11.9 신규 — SKILL.md 자동 배치 (.agents/skills/ + .claude/skills/) + 방어 로직 명시
- [ ] §11.10 신규 — R12-W (구현 부서 worktree + 분할 commit + merge) phase 정의
- [ ] §11.11 신규 — R12-D (이미지 생성 + ComfyUI/Diffusion) 보류 명시
- [ ] git diff --stat 으로 1 file changed, 100~150 insertions 확인

**Verify:** `git diff --stat docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md`
Expected: 1 file changed, 100~150 insertions(+).

**Steps:**

- [ ] **Step 1: §4 끝에 부서별 회의 형식 매트릭스 표 추가**

§4 끝 (현재 §5 이전) 에 다음 단락 삽입:

```markdown
### 4.x 부서별 회의 형식 매트릭스

| 부서 (role) | 형식 | 출력 | 구현 phase |
|-------------|------|------|-----------|
| 아이디어 (`idea`) | D-B-Light (OPINION_GATHERING + OPINION_TALLY) + USER_PICK | 의견 카드 list → 사용자 선택 + 코멘트 → 기획 부서 인계 | R12-C |
| 기획 (`planning`) | D-B 풀세트 (§5) | 합의된 spec markdown | D-B |
| 디자인 (`design.ux` + `design.ui`) | UX → UI → UX 토론 시퀀스 (3R cap) + Playwright 웹 스샷 | HTML/CSS + PNG snapshot | R12-C |
| 구현 (`implement`) | designated 1명 spec 받아 작성 | 코드 변경 + ExecutionService apply | R12-C (1명) → R12-W (분할) |
| 검토 (`review`) | OPINION_GATHERING + TALLY → 기획 부서 자동 분류 → 분류 카드 → 수정 group 만 구현 인계 | issue list 분류 결과 | R12-C |
| 일반 (`general`) | 1라운드 단순 응답 (round 5 fix 보존) | 응답 메시지 | 기존 (변경 없음) |

D-B 풀세트는 §5 (D-B phase) 의 OPINION_GATHERING → OPINION_TALLY → AGREEMENT_VOTE → REVISION_NEGOTIATION 4 단계.
R12-C 의 OpinionService 가 처음 2 단계를 분리한 재사용 가능 service 로 land.
```

- [ ] **Step 2: §11.4 트리거 명시**

§11.4 의 "회의 시작 전까지 부서 채널 메시지란 disabled" 단락에 한 줄 추가:

```markdown
- 트리거 = **할 일 큐의 할 일 작성란**. 사용자가 할 일을 작성하면 자동 워크플로우가 시작되고, 그 시점부터 부서 채널 메시지란이 enabled.
```

- [ ] **Step 3: §11.6 designated worker 디폴트 명시**

§11.6 표 아래에 추가:

```markdown
**디폴트 알고리즘 (R12-C land)**:
1. 사용자가 직원 편집 모달에서 "부서장" 핀 → 1순위
2. 핀 없으면 참여 멤버 드래그 순서 1번 → 2순위

분담 알고리즘 (자원 모델 + 사용자 override) 자체는 R12-W (구현 부서 worktree+merge phase) 에서 land.
```

- [ ] **Step 4: §11.7 R12-C 항목 갱신**

§11.7 R12-C 항목에 다음 줄 추가:

```markdown
- 디자인 부서 워크플로우 (UX → UI → UX 토론 시퀀스, 3R cap)
- 아이디어 부서 워크플로우 (D-B-Light + USER_PICK + 의견 카드 list UI)
- 검토 부서 워크플로우 (OPINION_GATHERING + TALLY → 기획 자동 분류 → 분류 카드)
- 구현 부서 단순화 (designated 1명, 분할은 R12-W 로 미룸)
- SKILL.md 자동 배치 (.agents/skills/ + .claude/skills/) + PromptComposer 스킬 경로 주입
- PlaywrightSnapshotService — 디자인 결과물 웹 스샷 PNG
- handoff_mode auto/check 채널별 옵션 + 인계 모달 (디폴트 check)
- 참여 멤버 드래그 순서 UI + designated worker 디폴트
- OpinionService — D-B 의 OPINION_GATHERING + OPINION_TALLY 재사용 service 추출
```

- [ ] **Step 5: §11.8 phase 추정 표 갱신**

§11.8 표 갱신:

```markdown
| Phase | 변경 전 (2026-05-01) | 변경 후 (2026-05-02) |
|-------|---------------------|---------------------|
| R12-S | 5~7 일 | ✅ 종결 (2026-05-02) |
| R12-C | 10~14 일 | **14~20 일** (디자인/아이디어/검토 워크플로우 + SKILL.md 자동 배치 + 웹 스샷 + handoff_mode + 드래그 순서 추가) |
| D-B | 17~28 일 | 17~28 일 (변경 없음) |
| **R12-W (신규)** | — | **5~10 일** (구현 부서 worktree + 분할 commit + merge — 자원 모델 + 사용자 override) |
| R12-H | 15~20 일 | 15~20 일 (변경 없음) |
| **합계** | 47~69 일 | **51~78 일** |

R12-D (이미지 생성 + ComfyUI/Diffusion) — 보류, 완성 이후 별도 phase.
```

- [ ] **Step 6: §11.9 SKILL.md 자동 배치 신규**

§11.8 뒤에 §11.9 신규 단락 추가:

```markdown
### 11.9 SKILL.md 자동 배치 (R12-C land)

**경로**:
- Claude: `<projectRoot>/.claude/skills/<roleId>/SKILL.md`
- Codex / Gemini: `<projectRoot>/.agents/skills/<roleId>/SKILL.md` (alias 공통)

**양식**:
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
- 프로젝트 생성 시 자동 배치
- 카탈로그 변경 시 IPC `project:syncSkills` 호출 → 두 폴더 재배치
- 사용자 수정 SKILL.md 가 있으면 사용자 confirm 받은 후 덮어쓰기

**PromptComposer 확장**: 부서 회의 진입 시 prompt 에 "이번 부서 = X. 스킬 파일: .claude/skills/X/SKILL.md (Claude) 또는 .agents/skills/X/SKILL.md (Codex/Gemini). 해당 파일을 읽고 그대로 따르라" 명시.
```

- [ ] **Step 7: §11.10 R12-W phase 정의**

§11.9 뒤에 §11.10 신규 단락 추가:

```markdown
### 11.10 R12-W phase 정의 (구현 부서 worktree + 분할 commit + merge)

**Goal**: 구현 부서가 designated 1명 작성 (R12-C) 에서 → 다수 provider 가 worktree 기반 병렬 commit + merge 까지 확장.

**Scope**:
- OPINION_GATHERING (자원 모드) — 각 AI 가 "내가 어디 / 무엇 잘 함" 자원
- 시스템 dedup + 충돌 감지 (같은 파일 두 명 자원 시)
- 충돌 시 vote 라운드 또는 사용자 split
- 사용자에게 분담표 표시 → 수동 override 가능
- worktree N개 + branch N개 spawn → 병렬 작업
- merge — D-B Light (merge conflict 시 부서 회의)

**No-go**:
- 다른 부서 (아이디어 / 기획 / 디자인 / 검토 / 일반) 의 분할 (R12-W 는 구현 부서만)
- 외부 자원 endpoint 연동 (R12-S slot 만)

**의존성**: R12-C 종결 후 진입. D-B 와 R12-H 사이.
```

- [ ] **Step 8: §11.11 R12-D 보류**

§11.10 뒤에 §11.11 신규 단락 추가:

```markdown
### 11.11 R12-D phase 보류 (이미지 생성 + ComfyUI/Diffusion)

R12 묶음 첫 출시 (R12-S + R12-C + D-B + R12-W + R12-H 종결) 이후 별도 phase.

**Scope (미래)**:
- `image-generation` capability 추가 (provider matrix 확장)
- nano banana (Gemini 플러그인) endpoint 연동
- Codex image endpoint 연동
- ComfyUI / Stable Diffusion 외부 endpoint 연동
- design.character + design.background sub-skill 활성화
- 이미지 미리보기 UI / 파일 저장 (`.png` / `.svg`) / ExecutionService 이미지 적용

**현재 상태**: R12-S 에서 4 sub-skill 카탈로그는 정의됨, R12-C 에선 character / background 비활성 (provider 가 image-generation capability 없으면 grayed out).
```

- [ ] **Step 9: 변경 검증**

```bash
git diff --stat docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md
```

Expected: `1 file changed, 100~150 insertions(+), 5~15 deletions(-)`.

```bash
grep -n "부서별 회의 형식 매트릭스\|11.9 SKILL.md\|11.10 R12-W\|11.11 R12-D" docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md
```

Expected: 4 매칭.

---

## Task 1: DB Migration 018 — channels 컬럼 추가 + system_general 전역화

**Goal:** `channels` 테이블 ALTER 4 컬럼 (role / purpose / handoff_mode / drag_order). 기존 system_general row 를 전역 1개 row 로 마이그레이션 (projectId NULL). Forward-only, chain-level idempotent.

**Files:**
- Create: `src/main/database/migrations/018-channels-role-purpose-handoff.ts`
- Modify: `src/main/database/migrations/index.ts`
- Test: `src/main/database/__tests__/migrator.test.ts` (018 row 추가)

**Acceptance Criteria:**
- [ ] migration 018 export `up(db)` — `ALTER TABLE channels ADD COLUMN role TEXT NULL` (NULL = system 채널), `purpose TEXT NULL`, `handoff_mode TEXT NOT NULL DEFAULT 'check'`, `drag_order INTEGER NULL`
- [ ] system_general 전역화 — `UPDATE channels SET projectId = NULL WHERE kind = 'system_general'` + 중복 제거 (DELETE 후 1개만 INSERT)
- [ ] index.ts 가 [..., migration017, migration018] 순서로 export
- [ ] migrator.test.ts: 018 적용 후 PRAGMA table_info 가 4 새 컬럼 표시 + system_general row 가 정확히 1개 (projectId NULL)
- [ ] vitest run migrator.test.ts → all PASS

**Verify:** `npx vitest run src/main/database/__tests__/migrator.test.ts`
Expected: all green, 018 추가 케이스 PASS.

**Steps:**

- [ ] **Step 1: 018 마이그레이션 파일 작성**

`src/main/database/migrations/018-channels-role-purpose-handoff.ts`:

```typescript
import type { Database } from 'better-sqlite3';

export const migration018 = {
  version: 18,
  name: '018-channels-role-purpose-handoff',
  up(db: Database): void {
    // 1. ALTER 4 컬럼
    db.exec(`ALTER TABLE channels ADD COLUMN role TEXT NULL`);
    db.exec(`ALTER TABLE channels ADD COLUMN purpose TEXT NULL`);
    db.exec(`ALTER TABLE channels ADD COLUMN handoff_mode TEXT NOT NULL DEFAULT 'check'`);
    db.exec(`ALTER TABLE channels ADD COLUMN drag_order INTEGER NULL`);

    // 2. system_general 전역화
    // 기존 프로젝트 종속 system_general row 들 → 가장 오래된 1 개만 보존, projectId NULL 로 update
    const oldest = db
      .prepare(`SELECT id FROM channels WHERE kind = 'system_general' ORDER BY createdAt ASC LIMIT 1`)
      .get() as { id: string } | undefined;
    if (oldest) {
      db.prepare(`UPDATE channels SET projectId = NULL WHERE id = ?`).run(oldest.id);
      db.prepare(`DELETE FROM channels WHERE kind = 'system_general' AND id != ?`).run(oldest.id);
    } else {
      // system_general 자체 없음 — 마이그레이션 skip (전역 1개 생성은 ProjectService 기동 시점)
    }
  },
};
```

- [ ] **Step 2: index.ts 등록**

`src/main/database/migrations/index.ts` 의 `migrations` 배열에 `migration018` 추가.

- [ ] **Step 3: migrator unit test**

`src/main/database/__tests__/migrator.test.ts` 에 케이스 추가:

```typescript
describe('migration 018', () => {
  it('adds role/purpose/handoff_mode/drag_order columns', () => {
    // ... migrate to 018
    const cols = db.prepare(`PRAGMA table_info(channels)`).all() as Array<{ name: string }>;
    expect(cols.find((c) => c.name === 'role')).toBeDefined();
    expect(cols.find((c) => c.name === 'purpose')).toBeDefined();
    expect(cols.find((c) => c.name === 'handoff_mode')).toBeDefined();
    expect(cols.find((c) => c.name === 'drag_order')).toBeDefined();
  });

  it('consolidates system_general to single global row', () => {
    // seed 3 system_general rows (different projectId) before migrate
    // run migration 018
    const rows = db.prepare(`SELECT * FROM channels WHERE kind = 'system_general'`).all();
    expect(rows.length).toBe(1);
    expect((rows[0] as any).projectId).toBeNull();
  });

  it('handoff_mode default = check', () => {
    db.prepare(`INSERT INTO channels (id, kind, name) VALUES ('test', 'user', 'test')`).run();
    const row = db.prepare(`SELECT handoff_mode FROM channels WHERE id = 'test'`).get() as any;
    expect(row.handoff_mode).toBe('check');
  });
});
```

- [ ] **Step 4: 검증**

```bash
npx vitest run src/main/database/__tests__/migrator.test.ts
```

Expected: 018 신규 케이스 3 개 + 기존 케이스 모두 PASS.

---

## Task 2: Shared Types — ChannelRole / ChannelPurpose / HandoffMode + Channel 인터페이스 확장

**Goal:** `src/shared/channel-role-types.ts` 신규 — RoleId 재사용 + ChannelPurpose / HandoffMode + ALL_HANDOFF_MODES. Channel + ChannelMember 인터페이스에 새 필드 추가.

**Files:**
- Create: `src/shared/channel-role-types.ts`
- Modify: `src/shared/channel-types.ts`

**Acceptance Criteria:**
- [ ] `ChannelRole = RoleId | null` (R12-S 의 RoleId import)
- [ ] `ChannelPurpose = 'handoff_target' | 'observation' | 'free' | null`
- [ ] `HandoffMode = 'check' | 'auto'`
- [ ] `ALL_HANDOFF_MODES = ['check', 'auto'] as const`
- [ ] `Channel` 인터페이스에 `role: ChannelRole`, `purpose: ChannelPurpose`, `handoffMode: HandoffMode`, `dragOrder: number | null` 필수 필드
- [ ] `ChannelMember` 인터페이스에 `dragOrder: number` 필수 필드 (참여 멤버 발화 순서)
- [ ] `npm run typecheck` 0 error (호출지 임시 default 채워 통과)

**Verify:** `npm run typecheck`
Expected: 0 error.

**Steps:**

- [ ] **Step 1: channel-role-types.ts 작성**

```typescript
import type { RoleId } from './role-types';

export type ChannelRole = RoleId | null;

export type ChannelPurpose = 'handoff_target' | 'observation' | 'free' | null;

export type HandoffMode = 'check' | 'auto';

export const ALL_HANDOFF_MODES = ['check', 'auto'] as const;

export function isHandoffMode(value: unknown): value is HandoffMode {
  return typeof value === 'string' && (ALL_HANDOFF_MODES as readonly string[]).includes(value);
}
```

- [ ] **Step 2: channel-types.ts 확장**

기존 `Channel` 인터페이스에 4 필드 추가:

```typescript
import type { ChannelRole, ChannelPurpose, HandoffMode } from './channel-role-types';

export interface Channel {
  // ... 기존 필드
  role: ChannelRole;
  purpose: ChannelPurpose;
  handoffMode: HandoffMode;
  dragOrder: number | null;
}

export interface ChannelMember {
  // ... 기존 필드
  dragOrder: number;
}
```

- [ ] **Step 3: typecheck**

```bash
npm run typecheck
```

호출지가 새 필수 필드 부재로 컴파일 에러 발생하면 임시 default (role: null, purpose: null, handoffMode: 'check', dragOrder: null) 채워 통과. ChannelService / Repository 가 다음 task 에서 진짜 값 채움.

---

## Task 3: ChannelRepository + ChannelService 확장

**Goal:** ChannelRepository read/write 가 4 새 컬럼 처리. ChannelService 가 신규 메서드 (updateRole / updateHandoffMode / reorderMembers / getGlobalGeneralChannel).

**Files:**
- Modify: `src/main/channels/channel-repository.ts`
- Modify: `src/main/channels/channel-service.ts`
- Modify: `src/main/channels/__tests__/channel-repository.test.ts`
- Modify: `src/main/channels/__tests__/channel-service.test.ts`

**Acceptance Criteria:**
- [ ] `ChannelRepository.loadAll()` SELECT 가 role / purpose / handoff_mode / drag_order 포함
- [ ] `ChannelRepository.save()` INSERT/UPDATE 가 4 컬럼 write
- [ ] `ChannelRepository.parseRole(raw, channelId)` — unknown role → throw (silent fallback 금지)
- [ ] `ChannelService.updateRole(channelId, role)` — saveRole + broadcast
- [ ] `ChannelService.updateHandoffMode(channelId, mode)` — save + broadcast
- [ ] `ChannelService.reorderMembers(channelId, orderedMemberIds)` — drag_order update + broadcast
- [ ] `ChannelService.getGlobalGeneralChannel()` — projectId NULL + kind=system_general 1개 row 반환 (없으면 throw)
- [ ] repo unit test: role/handoffMode/dragOrder round-trip + unknown role throw
- [ ] service unit test: 4 새 메서드 PASS
- [ ] vitest run channels → all PASS, 회귀 없음

**Verify:** `npx vitest run src/main/channels/__tests__/`
Expected: all green, 신규 케이스 6+ PASS.

**Steps:**

- [ ] **Step 1: ChannelRepository — SELECT/INSERT/UPDATE 갱신** (4 컬럼 추가)
- [ ] **Step 2: parseRole helper** — RoleId 또는 null 만 허용, unknown → `throw new Error(`Unknown channel role: ${raw} for channel ${channelId}`)`
- [ ] **Step 3: ChannelService 신규 메서드 4 개** (updateRole / updateHandoffMode / reorderMembers / getGlobalGeneralChannel)
- [ ] **Step 4: 단위 테스트 — 6+ 케이스**
- [ ] **Step 5: 검증** `npx vitest run src/main/channels/__tests__/`

---

## Task 4: ProjectService — 프로젝트 생성 시 6 부서 채널 자동 생성 + 일반 채널 전역 보장

**Goal:** ProjectService.createProject 가 6 디폴트 부서 채널 (idea / planning / design / implement / review) + 사용자 자유 채널 placeholder 생성. 일반 채널 (전역 1개) 은 앱 기동 시점에 1번 보장.

**Files:**
- Modify: `src/main/projects/project-service.ts`
- Modify: `src/main/projects/__tests__/project-service.test.ts`
- Modify: `src/main/main.ts` (앱 기동 시 ensureGlobalGeneralChannel 호출)

**Acceptance Criteria:**
- [ ] `createProject` 가 5 부서 채널 자동 생성 (디자인 부서 = role=null + purpose='handoff_target' + sub-skills 표시 메타데이터)
  - `idea` (📁 부서: 아이디어), `planning` (📁 부서: 기획), `design` (디자인 — UX+UI 묶음), `implement` (구현), `review` (검토)
- [ ] 부서 템플릿 옵션 2 (캐릭터/배경 디자인) 은 `createProject` 인자로 옵션 (디폴트 X)
- [ ] 각 부서 채널의 `handoffMode` 디폴트 = 'check'
- [ ] `ensureGlobalGeneralChannel()` — projectId NULL + kind=system_general row 가 0개면 1개 INSERT (일반 채널 전역 1개 보장)
- [ ] 앱 기동 시 main.ts 가 ensureGlobalGeneralChannel 호출
- [ ] project-service unit test: 5 부서 채널 자동 생성 + 일반 채널 별도 보장
- [ ] vitest run projects → all PASS

**Verify:** `npx vitest run src/main/projects/__tests__/`

**Steps:**

- [ ] **Step 1: 부서 디폴트 정의** — `DEFAULT_DEPARTMENT_ROLES = ['idea', 'planning', 'design', 'implement', 'review'] as const`
- [ ] **Step 2: createProject 확장** — 부서 채널 5 개 INSERT
- [ ] **Step 3: ensureGlobalGeneralChannel** — main.ts 기동 시 호출
- [ ] **Step 4: 단위 테스트** — 5 부서 + 일반 채널 보장 + 옵션 부서 테스트
- [ ] **Step 5: 검증**

---

## Task 5: SKILL.md template + 양식 정의 + 방어 로직 명시

**Goal:** `src/main/skills/skill-md-template.ts` — SKILL.md frontmatter + 본문 양식 정의 함수. SKILL_CATALOG 의 systemPromptKo + 방어 로직 frontmatter 동봉.

**Files:**
- Create: `src/main/skills/skill-md-template.ts`
- Create: `src/main/skills/__tests__/skill-md-template.test.ts`

**Acceptance Criteria:**
- [ ] `renderSkillMd(roleId: RoleId): string` — frontmatter (name + description) + 본문 (systemPromptKo + 방어 로직)
- [ ] frontmatter `--- 다음 줄에 빈 줄, 그 다음 본문` 의 정확한 양식 (Gemini 가 silent skip 하지 않도록)
- [ ] 방어 로직 단락 = "## 자기 spec 합리화 방어 (필수 준수)" 4 항 (메모리 / 검토 의견 우선 / false negative 우선)
- [ ] `npx vitest run skill-md-template.test.ts` → 4+ PASS (각 부서 roleId, frontmatter parse-able, 본문 포함)

**Verify:** `npx vitest run src/main/skills/__tests__/skill-md-template.test.ts`

**Steps:**

- [ ] **Step 1: 양식 함수 작성** (frontmatter + 본문 + 방어 로직)
- [ ] **Step 2: unit test** (4 부서 sample + frontmatter parse + 본문 검증)
- [ ] **Step 3: 검증**

---

## Task 6: ProjectSkillSyncService — `.agents/skills/` + `.claude/skills/` 자동 배치

**Goal:** `src/main/skills/project-skill-sync-service.ts` — 프로젝트 entry 시 SKILL.md 두 폴더 자동 배치. IPC `project:syncSkills` (수동 트리거 — 카탈로그 변경 시).

**Files:**
- Create: `src/main/skills/project-skill-sync-service.ts`
- Create: `src/main/skills/__tests__/project-skill-sync-service.test.ts`
- Modify: `src/main/ipc/handlers/project-handler.ts` (`project:syncSkills`)
- Modify: `src/shared/ipc-schemas.ts`, `src/shared/ipc-types.ts`, `src/preload/index.ts`

**Acceptance Criteria:**
- [ ] `syncProjectSkills(projectRoot)` — `<projectRoot>/.agents/skills/<roleId>/SKILL.md` (9 직원 능력) + `<projectRoot>/.claude/skills/<roleId>/SKILL.md` 작성. mkdir -p + atomic write (tmp + rename).
- [ ] meeting-summary 는 system 전용 — SKILL.md 배치 X
- [ ] PathGuard 가 ArenaRoot 봉인 검증 (junction realpath 비교 — CA-3 TOCTOU)
- [ ] 사용자 수정 SKILL.md (mtime 변경됨) 감지 시 confirm 모달 IPC return — 자동 덮어쓰기 X
- [ ] IPC `project:syncSkills(projectId, options: { force?: boolean })` — force=true 시 사용자 confirm 무시
- [ ] unit test: 9 부서 능력 두 폴더 작성 + meeting-summary 제외 + 사용자 수정 감지

**Verify:** `npx vitest run src/main/skills/__tests__/project-skill-sync-service.test.ts`

**Steps:**

- [ ] **Step 1: syncProjectSkills 작성** — for-each roleId, renderSkillMd → write to two folders
- [ ] **Step 2: PathGuard 통합** — projectRoot junction realpath 검증
- [ ] **Step 3: 사용자 수정 감지** — 기존 SKILL.md mtime > 카탈로그 lastModified 시 사용자 confirm 요구
- [ ] **Step 4: IPC handler + zod schema + types + preload whitelist**
- [ ] **Step 5: unit test 5+**
- [ ] **Step 6: 검증**

---

## Task 7: PromptComposer 확장 — 부서별 스킬 경로 prompt 주입

**Goal:** PromptComposer 가 부서 회의 진입 시 prompt 에 "이번 부서 = X. 스킬 파일: .claude/skills/X/SKILL.md (Claude) / .agents/skills/X/SKILL.md (Codex/Gemini). 해당 파일을 읽고 그대로 따르라" 주입.

**Files:**
- Modify: `src/main/skills/prompt-composer.ts`
- Modify: `src/main/skills/__tests__/prompt-composer.test.ts`

**Acceptance Criteria:**
- [ ] `compose` 옵션에 `channelRole: RoleId | null` 추가 — 부서 회의 진입 시 사용
- [ ] channelRole 이 null 이 아니면 prompt 끝에 "[skill 경로] 이번 부서 = <roleId>. .claude/skills/<roleId>/SKILL.md 또는 .agents/skills/<roleId>/SKILL.md 를 읽고 그대로 따르라." 한 단락 추가
- [ ] channelRole 이 null 이면 (예: 일반 채널) skip
- [ ] composer unit test: channelRole 있음/없음 두 케이스 + 정확한 경로 문자열

**Verify:** `npx vitest run src/main/skills/__tests__/prompt-composer.test.ts`

**Steps:**

- [ ] **Step 1: compose 시그니처 확장** — channelRole 옵션
- [ ] **Step 2: 경로 단락 생성 함수** (스킬 카탈로그의 displayName 도 포함)
- [ ] **Step 3: unit test 4+** (channelRole=null / 'idea' / 'design.ui' / 'implement')
- [ ] **Step 4: 검증**

---

## Task 8: 사이드바 — Radix Accordion + 프로젝트 collapsible + 일반/DM 별도 섹션

**Goal:** Sidebar 재구성 — 상단 "일반 채널 (전역)" 1 entry + 중간 "프로젝트 그룹" (Radix Accordion 으로 각 프로젝트 collapsible, 디폴트 펼침) + 하단 "DM" 별도 섹션.

**Files:**
- Modify: `src/renderer/components/shell/Sidebar.tsx`
- Create: `src/renderer/features/sidebar/ProjectAccordion.tsx`
- Create: `src/renderer/features/sidebar/GeneralChannelEntry.tsx`
- Create: `src/renderer/stores/sidebar-store.ts` (zustand persist — accordion state)
- Modify: `src/renderer/i18n/locales/{ko,en}/channel.json`

**Acceptance Criteria:**
- [ ] Sidebar 가 3 섹션 layout (general / projects / dm)
- [ ] ProjectAccordion 이 Radix Accordion.Root collapsible + multiple
- [ ] 디폴트 펼침 — sidebar-store 의 `expandedProjectIds` 가 빈 배열일 때 모두 펼침으로 처리
- [ ] zustand persist (localStorage) — 사용자 토글 상태 보존
- [ ] GeneralChannelEntry — 단일 entry (전역 1개 채널) + selected 상태
- [ ] DM 은 기존 DM 섹션 유지 (변경 없음, 위치만 하단 고정)
- [ ] 부서 채널 클릭 시 router → ChatView 진입
- [ ] i18n: `channel.role.idea`, `channel.role.planning`, `channel.role.design.ui`, `channel.role.design.ux`, `channel.role.implement`, `channel.role.review`, `channel.role.general`, `channel.section.general`, `channel.section.projects`, `channel.section.dm`

**Verify:** `npm run dev` 후 사이드바 시각 검증 (한 번 펼치고 토글 → reload 후 상태 보존)

**Steps:**

- [ ] **Step 1: sidebar-store 작성** (zustand persist, expandedProjectIds Set)
- [ ] **Step 2: ProjectAccordion 컴포넌트** (Radix Accordion + 부서 채널 list)
- [ ] **Step 3: GeneralChannelEntry 컴포넌트**
- [ ] **Step 4: Sidebar 재구성** (general / projects / dm 3 섹션)
- [ ] **Step 5: i18n 키 추가** (ko + en)
- [ ] **Step 6: 시각 검증** (dev 빌드 띄워 사용자 확인)

---

## Task 9: 일반 채널 동작 — 회의 X + "새 대화 시작" 버튼

**Goal:** 일반 채널 = 1라운드 단순 응답 (round 5 fix 보존). 회의 시작/종료 버튼 / auto-trigger 모두 X. "새 대화 시작" 버튼 — 이전 세션 archive + 채널 비우기.

**Files:**
- Modify: `src/renderer/features/messenger/ChatView.tsx` (channel.kind=system_general 분기)
- Modify: `src/renderer/features/messenger/MeetingControls.tsx` (system_general 시 hide)
- Modify: `src/main/channels/message-service.ts` (system_general 메시지 = 1라운드 dispatcher)
- Create: `src/renderer/features/general/GeneralChannelControls.tsx` ("새 대화 시작" 버튼)
- Modify: `src/main/ipc/handlers/channel-handler.ts` (`channel:archiveAndClear` IPC)

**Acceptance Criteria:**
- [ ] system_general 채널에서 MeetingControls (시작/종료/일시정지) 안 보임
- [ ] auto-trigger 도 X — D-A T4 자동 회의 트리거가 system_general 에서 invoke 안 됨 (분기)
- [ ] "새 대화 시작" 버튼 — 클릭 시 archive (consensus 폴더로 이전 메시지 export) + 채널 비우기
- [ ] 일반 채널 = 모든 ready provider 가 1라운드 단순 응답 (D-A round 5 fix 의 conversation 모드 보존)
- [ ] e2e smoke: 일반 채널 입력 → AI 1턴 응답 → "새 대화 시작" → 메시지 비워짐

**Verify:** `npx vitest run src/main/channels/__tests__/message-service.test.ts` + dev 빌드 시각

**Steps:**

- [ ] **Step 1: MeetingControls 분기** — channel.kind=system_general 시 return null
- [ ] **Step 2: auto-trigger 분기** — D-A T4 의 trigger condition 에 system_general 제외
- [ ] **Step 3: "새 대화 시작" 버튼 + IPC** (archive + clear)
- [ ] **Step 4: unit test + e2e smoke**

---

## Task 10: 프로젝트 entry view — "할 일 작성" + 디폴트 시작 부서 = 아이디어

**Goal:** 프로젝트 진입 시 첫 화면 = "할 일 작성" 입력란 + 디폴트 시작 부서 (아이디어) 선택. 입력 → 자동 워크플로우 시작 IPC 호출.

**Files:**
- Create: `src/renderer/features/project/ProjectEntryView.tsx`
- Modify: `src/renderer/features/dashboard/ProjectDashboard.tsx` (entry view routing)
- Modify: `src/main/ipc/handlers/project-handler.ts` (`project:startWorkflow` IPC)
- Modify: `src/main/projects/project-service.ts` (startWorkflow method)

**Acceptance Criteria:**
- [ ] 프로젝트 첫 진입 시 ProjectEntryView 표시 (workflow 시작 전)
- [ ] "할 일 작성" textarea + "시작 부서" 라디오 (아이디어 디폴트, 옵션: 기획부터)
- [ ] [워크플로우 시작] 버튼 클릭 → `project:startWorkflow({projectId, taskText, startRole})` IPC
- [ ] startWorkflow 가 시작 부서 채널 entry 메시지 INSERT + 워크플로우 진입
- [ ] 워크플로우 진입 후 ProjectEntryView 사라지고 시작 부서 채널이 active
- [ ] 사용자가 다시 entry view 보고 싶으면 "프로젝트 설정 > 새 워크플로우" 버튼 (기존 워크플로우는 archive)

**Verify:** dev 빌드 시각 + e2e smoke

**Steps:**

- [ ] **Step 1: ProjectEntryView 컴포넌트** (textarea + 라디오 + 시작 버튼)
- [ ] **Step 2: ProjectDashboard routing** (워크플로우 진입 전 = entry view)
- [ ] **Step 3: project:startWorkflow IPC + zod + types + preload**
- [ ] **Step 4: project-service.startWorkflow 메서드** (entry 메시지 INSERT + 워크플로우 시작)
- [ ] **Step 5: e2e smoke** (텍스트 입력 → 시작 → 아이디어 채널 active)

---

## Task 11: 부서 채널 메시지란 disabled / enabled 상태 management

**Goal:** Composer 가 channel.role 이 부서 (idea/planning/design.*/implement/review) + 워크플로우 진입 전 = disabled (placeholder "할 일 큐에서 할 일을 작성하세요"). 워크플로우 진입 후 = enabled (사용자 끼어들기).

**Files:**
- Modify: `src/renderer/features/messenger/Composer.tsx`
- Create: `src/renderer/hooks/use-channel-disabled-state.ts`
- Modify: `src/main/channels/channel-service.ts` (workflowActive flag — runtime state)
- Modify: `src/renderer/i18n/locales/{ko,en}/channel.json` (disabled placeholder)

**Acceptance Criteria:**
- [ ] use-channel-disabled-state 가 channel.role + workflowActive flag 결합 → boolean
- [ ] Composer 가 disabled 상태일 때 textarea readonly + placeholder 표시
- [ ] 일반 채널 (system_general) + DM + 사용자 자유 채널 (role=null) 은 항상 enabled (변경 없음)
- [ ] 워크플로우 진입 (project:startWorkflow IPC) 시 해당 부서 채널 workflowActive=true
- [ ] 워크플로우 종결 시 workflowActive=false (disabled 복귀)
- [ ] e2e smoke: 부서 채널 disabled → 할 일 작성 → enabled

**Verify:** dev 빌드 + e2e smoke

**Steps:**

- [ ] **Step 1: use-channel-disabled-state hook** (channel.role + workflowActive)
- [ ] **Step 2: workflowActive flag** (channel-service runtime state — DB 안 함, in-memory)
- [ ] **Step 3: Composer disabled 처리**
- [ ] **Step 4: i18n placeholder + 시각 검증**
- [ ] **Step 5: e2e smoke**

---

## Task 12: OpinionService — D-B 의 OPINION_GATHERING + OPINION_TALLY 분리 service

**Goal:** D-B 풀세트의 OPINION_GATHERING + OPINION_TALLY 단계를 재사용 가능 service 로 분리. 아이디어 / 검토 / R12-W (구현) 가 이 service 의 부분 phase 만 사용.

**Files:**
- Create: `src/main/meetings/opinion/opinion-service.ts`
- Create: `src/main/meetings/opinion/__tests__/opinion-service.test.ts`

**Acceptance Criteria:**
- [ ] `gatherOpinions(meetingId, members, prompt): Promise<Opinion[]>` — 각 member 에게 prompt 전달 + JSON 응답 parse + opinion 배열 반환
- [ ] `tallyOpinions(opinions): TallyResult` — dedup (LLM similarity 또는 단순 equal), opinion_id 부여, "from" 매핑
- [ ] dedup 알고리즘: 1차 = exact match (content trim + lowercase), 2차 = R12-D 에서 LLM similarity (R12-C 는 1차만)
- [ ] `Opinion` 인터페이스: `{ id: string, author: string, content: string, rationale?: string, round: number }`
- [ ] `TallyResult` 인터페이스: `{ opinions: Array<Opinion & { mergedFrom: string[] }> }`
- [ ] unit test 6+ 케이스 (3 멤버 collected / dedup 정확 / opinion_id 유일 / from 매핑 / round 증가 / parse 실패 throw)

**Verify:** `npx vitest run src/main/meetings/opinion/__tests__/opinion-service.test.ts`

**Steps:**

- [ ] **Step 1: 인터페이스 정의** (Opinion / TallyResult)
- [ ] **Step 2: gatherOpinions** — provider.send 병렬 + JSON parse + 누락 시 throw
- [ ] **Step 3: tallyOpinions** — exact dedup + ID 부여 + from 매핑
- [ ] **Step 4: unit test 6+**
- [ ] **Step 5: 검증**

---

## Task 13: 아이디어 부서 워크플로우 — D-B-Light + USER_PICK + 의견 카드 list UI

**Goal:** 아이디어 부서 진입 시 OpinionService.gather + tally → 메시지창에 의견 카드 list 표시 → 사용자 다중 선택 + 자유 코멘트 + [기획 부서 인계] 또는 [추가 의견 라운드] 버튼.

**Files:**
- Create: `src/main/meetings/workflows/idea-workflow.ts`
- Create: `src/main/meetings/workflows/__tests__/idea-workflow.test.ts`
- Create: `src/renderer/features/idea/IdeaCardList.tsx`
- Create: `src/renderer/hooks/use-workflow.ts` (startIdea / pickIdea / requestMoreOpinions)
- Modify: `src/main/ipc/handlers/workflow-handler.ts` (workflow.startIdea / pickIdea / requestMoreOpinions IPC)
- Modify: `src/renderer/i18n/locales/{ko,en}/workflow.json`

**Acceptance Criteria:**
- [ ] `startIdeaWorkflow(channelId, taskText)` — gather + tally 후 message INSERT (kind='idea_card_list', payload: opinions)
- [ ] `pickIdea(channelId, opinionIds, userComment, target='planning')` — 선택한 의견 + 코멘트 prompt 합성 + 기획 부서 entry 메시지 INSERT
- [ ] `requestMoreOpinions(channelId, selectedIds, userComment)` — R2 OPINION_GATHERING (선택 의견 prompt 주입)
- [ ] IdeaCardList — 카드별 다중 선택 (체크박스) + 자유 코멘트 textarea + 두 버튼
- [ ] 카드 내용 풀 텍스트 표시 (요약 X)
- [ ] 카드 클릭 → 펼침 (rationale 보임) — 디폴트 펼침
- [ ] e2e smoke: 아이디어 진입 → 카드 list → 다중 선택 → 인계

**Verify:** `npx vitest run src/main/meetings/workflows/__tests__/idea-workflow.test.ts` + dev 빌드 시각

**Steps:**

- [ ] **Step 1: idea-workflow.ts** (startIdeaWorkflow / pickIdea / requestMoreOpinions)
- [ ] **Step 2: IPC + zod + types + preload**
- [ ] **Step 3: use-workflow hook**
- [ ] **Step 4: IdeaCardList 컴포넌트** (Radix Checkbox + textarea + 두 버튼)
- [ ] **Step 5: ChatView 메시지 렌더링 분기** (kind='idea_card_list' → IdeaCardList 컴포넌트)
- [ ] **Step 6: i18n 추가**
- [ ] **Step 7: unit test 5+ + e2e smoke**

---

## Task 14: 디자인 부서 워크플로우 — UX → UI → UX 토론 시퀀스 (3R cap)

**Goal:** 디자인 부서 진입 시 UX → UI → UX 3 step 토론 시퀀스. UX 가 와이어프레임/구조 출력 → UI 가 형태/컬러 + UX 코멘트 → UX 가 동의/수정. 동의 시 종결, 수정 시 추가 라운드 (3R cap).

**Files:**
- Create: `src/main/meetings/workflows/design-workflow.ts`
- Create: `src/main/meetings/workflows/__tests__/design-workflow.test.ts`
- Modify: `src/main/ipc/handlers/workflow-handler.ts` (workflow.startDesign IPC)
- Modify: `src/renderer/i18n/locales/{ko,en}/workflow.json`

**Acceptance Criteria:**
- [ ] `startDesignWorkflow(channelId, planningSpec)` — UX provider 가 와이어프레임 markdown 출력 → UI provider 가 HTML/CSS + UX 코멘트 → UX provider 가 동의/수정
- [ ] UX/UI provider = 부서 멤버 중 design.ux / design.ui 능력 보유 직원 (designated worker 디폴트 알고리즘)
- [ ] 동의 신호 = JSON `{ name, status: 'agree' | 'revise', message }` — agree 시 종결
- [ ] 3R cap — 3 라운드 후에도 미동의 시 사용자 개입 모달 (UX 안 / UI 안 / 사용자 직접 결정)
- [ ] 라운드별 메시지 INSERT (UX 라운드 / UI 라운드)
- [ ] 종결 시 산출물 = HTML/CSS + 와이어프레임 markdown 묶음
- [ ] unit test 8+ (1 라운드 종결 / 2 라운드 / 3R cap 모달 / UX 부재 throw / UI 부재 throw / agree 신호 parse / revise 신호 / payload format)

**Verify:** `npx vitest run src/main/meetings/workflows/__tests__/design-workflow.test.ts`

**Steps:**

- [ ] **Step 1: design-workflow.ts** (UX → UI → UX 시퀀스 + cap)
- [ ] **Step 2: agree/revise JSON parse + 종결 조건**
- [ ] **Step 3: 3R cap + 사용자 개입 모달 IPC**
- [ ] **Step 4: IPC + zod + types + preload**
- [ ] **Step 5: unit test 8+**
- [ ] **Step 6: i18n 추가**
- [ ] **Step 7: 검증**

---

## Task 15: PlaywrightSnapshotService — HTML/CSS render → PNG + 디자인 결과물 미리보기

**Goal:** off-screen Chromium 으로 HTML/CSS 를 render → 1280x720 desktop + 375x812 mobile 두 viewport PNG 캡처 → ArenaRoot 저장 → 메시지창 미리보기.

**Files:**
- Create: `src/main/design/playwright-snapshot-service.ts`
- Create: `src/main/design/__tests__/playwright-snapshot-service.test.ts`
- Create: `src/renderer/features/design/DesignSnapshotPreview.tsx`
- Modify: `src/main/files/path-guard.ts` (design/snapshots/ ArenaRoot 봉인)
- Modify: `src/renderer/features/messenger/MessageRenderer.tsx` (kind='design_snapshot' 분기)

**Acceptance Criteria:**
- [ ] `captureHtmlSnapshot(html, css, projectId, round)` — off-screen Chromium 띄움 + render + 두 viewport PNG 저장
- [ ] 저장 위치: `<ArenaRoot>/<projectId>/design/snapshots/round-N-{desktop,mobile}.png`
- [ ] PathGuard 봉인 — design/snapshots/ 가 ArenaRoot 안에 있는지 junction realpath 검증
- [ ] design-workflow 가 종결 시 captureHtmlSnapshot 호출 → 메시지 INSERT (kind='design_snapshot', payload: { desktopPath, mobilePath, htmlContent, cssContent })
- [ ] DesignSnapshotPreview — PNG 두 개 표시 (desktop / mobile 탭) + "코드 펼치기" 토글 (HTML/CSS source 표시)
- [ ] PNG 클릭 시 lightbox 확대
- [ ] unit test (smoke): 간단한 HTML 렌더 → PNG 파일 존재 + 크기 확인
- [ ] R6 Playwright Electron 인프라 재활용 (electron-builder 의 Playwright 의존 dontDuplicate)

**Verify:** `npx vitest run src/main/design/__tests__/playwright-snapshot-service.test.ts`

**Steps:**

- [ ] **Step 1: PlaywrightSnapshotService** (chromium.launch + page.setContent + screenshot)
- [ ] **Step 2: PathGuard 통합**
- [ ] **Step 3: design-workflow 가 종결 시 호출**
- [ ] **Step 4: DesignSnapshotPreview 컴포넌트** (두 viewport 탭 + 코드 토글)
- [ ] **Step 5: MessageRenderer kind='design_snapshot' 분기**
- [ ] **Step 6: smoke test + 시각 검증**

---

## Task 16: 검토 부서 워크플로우 — OPINION_GATHERING + TALLY → 기획 자동 분류 → 분류 카드 UI

**Goal:** 검토 부서 = 검토 AI 들이 issue list opinion → 시스템 dedup → 기획 부서 자동 분류 (의도/수정) → 사용자에게 1줄 카드 (분류 결과 + 펼쳐 보기) → 수정 group 만 구현 부서 인계.

**Files:**
- Create: `src/main/meetings/workflows/review-workflow.ts`
- Create: `src/main/meetings/workflows/__tests__/review-workflow.test.ts`
- Create: `src/renderer/features/review/ReviewClassificationCard.tsx`
- Modify: `src/main/ipc/handlers/workflow-handler.ts` (workflow.startReview / approveReviewClassification IPC)
- Modify: `src/renderer/i18n/locales/{ko,en}/workflow.json`

**Acceptance Criteria:**
- [ ] `startReviewWorkflow(channelId, codeRef, planningSpec)` — review 능력 보유 멤버에게 prompt → opinion list 수집 → tally
- [ ] 기획 부서 자동 분류 — planning 능력 보유 직원 1명에게 prompt: "다음 검토 의견들이 spec 의도인가? 의도/수정 분류해라. spec 합리화 금지." → JSON `{ classifications: [{opinion_id, group: 'intended' | 'fix', reason}] }` parse
- [ ] 메시지 INSERT (kind='review_classification', payload: { opinions, classifications, intendedCount, fixCount })
- [ ] ReviewClassificationCard — 1줄 요약 ("검토 의견 N개 → 의도 X개 / 수정 Y개. 분류 OK?") + [OK 자동 진행] [상세 보기] (펼쳐 issue list)
- [ ] [OK] → 수정 group 의 issue list 만 구현 부서 entry 메시지 INSERT (handoff)
- [ ] [상세 보기] 시 사용자가 분류 수정 가능 (toggle intended ↔ fix)
- [ ] unit test 6+ (3 멤버 opinion / 분류 parse / 수정 group 만 인계 / 사용자 toggle / spec 합리화 방어)

**Verify:** `npx vitest run src/main/meetings/workflows/__tests__/review-workflow.test.ts`

**Steps:**

- [ ] **Step 1: review-workflow.ts** (gather + tally + planning classify)
- [ ] **Step 2: classify prompt** (방어 로직 명시)
- [ ] **Step 3: IPC + zod + types**
- [ ] **Step 4: ReviewClassificationCard 컴포넌트** (1줄 요약 + 토글 펼침)
- [ ] **Step 5: i18n + unit test + 검증**

---

## Task 17: 구현 부서 워크플로우 — designated 1명 spec 받아 작성 (단순화)

**Goal:** 구현 부서 진입 시 designated worker 1명이 기획 spec 받아 코드 작성. ExecutionService dryRun → 사용자 승인 → atomic apply. 의견 라운드 X (R12-W 까지 보류).

**Files:**
- Create: `src/main/meetings/workflows/implement-workflow.ts`
- Create: `src/main/meetings/workflows/__tests__/implement-workflow.test.ts`
- Modify: `src/main/ipc/handlers/workflow-handler.ts` (workflow.startImplement IPC)

**Acceptance Criteria:**
- [ ] `startImplementWorkflow(channelId, planningSpec, optionalReviewFixes)` — designated worker 1명에게 prompt → diff 응답
- [ ] designated worker = (a) 부서장 핀 (b) 발화 순서 1번
- [ ] diff 응답 → ExecutionService.dryRun → 사용자 승인 모달 → atomic apply
- [ ] 종결 시 implement 산출물 = git commit hash + 변경 파일 list
- [ ] R12-W 미진입 — 의견 라운드 X
- [ ] unit test 4+ (designated 선택 / dryRun / apply / rollback)

**Verify:** `npx vitest run src/main/meetings/workflows/__tests__/implement-workflow.test.ts`

**Steps:**

- [ ] **Step 1: implement-workflow.ts**
- [ ] **Step 2: designated worker 선택 (Task 18 의 디폴트 알고리즘 사용)**
- [ ] **Step 3: ExecutionService 통합**
- [ ] **Step 4: IPC + types**
- [ ] **Step 5: unit test 4+ + 검증**

---

## Task 18: 참여 멤버 드래그 순서 UI + designated worker 디폴트 (드래그 1번 + 부서장 핀)

**Goal:** 채널 우측 사이드 패널에 참여 멤버 list (dnd-kit 드래그). 사용자가 드래그하면 channels.drag_order update. designated worker 디폴트 = (a) StaffEditModal 의 "부서장 핀" (b) 핀 없으면 드래그 순서 1번.

**Files:**
- Create: `src/renderer/features/channel/ChannelMemberOrderPanel.tsx`
- Modify: `src/renderer/features/settings/StaffEditModal.tsx` ("부서장 핀" 토글)
- Create: `src/renderer/hooks/use-channel-members.ts` (drag order + 핀)
- Modify: `src/main/channels/channel-service.ts` (reorderMembers IPC 가 이미 Task 3 에서 작성됨, designated 선택 helper 추가)
- Create: `src/main/meetings/designated-worker-resolver.ts`
- Create: `src/main/meetings/__tests__/designated-worker-resolver.test.ts`

**Acceptance Criteria:**
- [ ] ChannelMemberOrderPanel — dnd-kit 드래그 list, drag 끝나면 channel:reorderMembers IPC
- [ ] StaffEditModal 의 RolesSkillsTab 에 "부서장 핀" 토글 추가 (한 부서당 1명 핀 가능)
- [ ] DB 추가 컬럼: providers.is_department_head TEXT JSON `Record<RoleId, boolean>` (또는 별도 테이블) — 마이그레이션 018 에 합치거나 마이그레이션 019 별도
- [ ] **결정 필요**: 마이그레이션 통합 vs 분리. 권장: 마이그레이션 018 에 합치기 (1 phase 1 마이그레이션 원칙)
- [ ] resolveDesignatedWorker(channelId, role): ProviderId — 핀 우선 → 드래그 순서 1번
- [ ] unit test 6+ (핀 우선 / 핀 없으면 드래그 1번 / 부서 멤버 0명 throw / 핀 다중 throw)

**Verify:** `npx vitest run src/main/meetings/__tests__/designated-worker-resolver.test.ts` + dev 빌드 시각

**Steps:**

- [ ] **Step 1: 마이그레이션 018 갱신** — providers.is_department_head 컬럼 추가
- [ ] **Step 2: ChannelMemberOrderPanel** (dnd-kit)
- [ ] **Step 3: StaffEditModal "부서장 핀" 토글** (RolesSkillsTab 에 통합)
- [ ] **Step 4: designated-worker-resolver**
- [ ] **Step 5: unit test 6+**
- [ ] **Step 6: 시각 검증**

---

## Task 19: handoff_mode auto/check 토글 + 인계 모달 + 디폴트 check

**Goal:** 부서 인계 직전 gate. check (디폴트) = 사용자 confirm 모달 (산출물 미리보기 + "확인하고 인계" / "수정"). auto = 자동 인계.

**Files:**
- Create: `src/renderer/features/handoff/HandoffApprovalModal.tsx`
- Create: `src/renderer/features/channel/HandoffModeToggle.tsx`
- Modify: `src/main/ipc/handlers/workflow-handler.ts` (handoff:approve IPC)
- Modify: `src/main/meetings/workflows/{idea,design,review,implement}-workflow.ts` (인계 직전 handoff_mode 검사)
- Create: `src/renderer/hooks/use-handoff.ts`
- Modify: `src/renderer/i18n/locales/{ko,en}/channel.json`

**Acceptance Criteria:**
- [ ] HandoffApprovalModal — 산출물 미리보기 (kind 별 분기: idea_card_list / design_snapshot / review_classification / implement_diff) + [확인하고 인계] [수정 요청] [이 부서 다음부터 auto 모드 토글]
- [ ] HandoffModeToggle — 채널 설정 패널에 표시, channels.handoff_mode update IPC
- [ ] 워크플로우 종결 → handoff_mode 검사 → 'check' 면 모달 띄움, 'auto' 면 다음 부서 entry 메시지 자동 INSERT
- [ ] 디폴트 = 'check' (사용자 본인 경험 반영)
- [ ] [수정 요청] 시 추가 라운드 (현재 부서로 돌아감) 또는 사용자 직접 수정 입력
- [ ] e2e smoke: 디자인 부서 종결 → 모달 → [확인하고 인계] → 구현 부서 entry

**Verify:** dev 빌드 + e2e smoke

**Steps:**

- [ ] **Step 1: HandoffApprovalModal 컴포넌트** (kind 별 미리보기)
- [ ] **Step 2: HandoffModeToggle 컴포넌트** (채널 설정)
- [ ] **Step 3: workflow 4개 가 인계 직전 mode 검사 + 모달/자동 분기**
- [ ] **Step 4: handoff:approve IPC + use-handoff hook**
- [ ] **Step 5: i18n 추가**
- [ ] **Step 6: e2e smoke**

---

## Task 20: ADR + 구현 현황 + tasks.json + Closeout

**Goal:** ADR 문서 작성 (R12-C 결정 사항 + 트레이드오프), 구현 현황 R12-C 행 추가, tasks.json status='completed' 업데이트, R12-C closeout commit.

**Files:**
- Create: `docs/아키텍처-결정-기록/r12-c-channel-roles.md`
- Modify: `docs/구현-현황.md`
- Modify: `docs/superpowers/plans/2026-05-02-rolestra-phase-r12-c.md.tasks.json`

**Acceptance Criteria:**
- [ ] ADR 본문에 결정 사항 11 항 (사용자 결정 요약 위 11 개) + 트레이드오프 (R12-W 분리, R12-D 보류, 디자인 단순 모드 토글 X 등)
- [ ] 구현 현황에 R12-C 행 추가 — task 20 개 + commit list + 종결일
- [ ] tasks.json 의 모든 task status='completed'
- [ ] vitest 전체 PASS (회귀 없음 — channels/projects/skills/meetings/workflows/design 테스트)
- [ ] typecheck 0 error
- [ ] lint 0 warning (R12-C 신규 파일들)
- [ ] e2e Playwright Electron — R12-C smoke 통과
- [ ] closeout commit message: "docs(rolestra): R12-C 종결 — ADR + 구현현황 + tasks.json sync"

**Verify:** `npm run typecheck && npm run lint && npx vitest run && npx playwright test tests/e2e/r12-c-channel-roles.spec.ts`

**Steps:**

- [ ] **Step 1: ADR 작성**
- [ ] **Step 2: 구현 현황 행 추가**
- [ ] **Step 3: tasks.json sync**
- [ ] **Step 4: 전체 검증** (typecheck + lint + vitest + e2e)
- [ ] **Step 5: closeout commit + main merge + worktree 정리** (worktree-merge-reminder 메모리 준수)

---

## 종결 체크리스트

- [ ] 모든 21 task (T0~T20) 완료
- [ ] vitest 전체 PASS
- [ ] typecheck 0 error
- [ ] lint 0 warning (신규 파일)
- [ ] e2e smoke PASS (Playwright Electron)
- [ ] dev 빌드 시각 검증 — 일반 채널 / 프로젝트 entry / 부서 채널 disabled / 의견 카드 / 디자인 스샷 / 검토 분류 / handoff 모달
- [ ] main merge + origin push
- [ ] worktree 제거 + branch 삭제
- [ ] 메모리 업데이트 — `rolestra-r12-c-completion.md` 작성, `rolestra-phase-status.md` 갱신
- [ ] R12-W 진입 가이드 작성 (다음 phase)
