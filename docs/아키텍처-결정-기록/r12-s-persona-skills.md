# ADR — R12-S 페르소나 / 스킬 분리

작성일: 2026-05-02
상태: 채택

## Context

R11 까지 `providers.persona` 단일 텍스트가 캐릭터 + 능력 + 도구 권한 / 형식 instruction 까지 모두 담당. D-A batch 2 dogfooding 에서 다음 한계가 드러났다:

1. 사용자가 "신중한 PM Sarah" 같이 캐릭터를 작성하려는데 그 안에 tool 권한 / 스킬까지 섞여 있음.
2. 한 AI 가 기획·디자인·구현·검토 전부 — 역할 분화 결여.
3. 회의록 정리 시 *어떤* 직원이 정리하느냐에 따라 톤이 바뀜.

R12-S 가 데이터 모델을 분리해서 후속 phase (R12-C 채널 역할 / D-B 구현 부서 / R12-H 부서 간 인계) 의 기반을 마련했다.

## Decision

### 1. 능력 카탈로그 10개 (직원 9 + 시스템 1)

- 직원 부여 가능 능력: `idea` / `planning` / `design.ui` / `design.ux` / `design.character` / `design.background` / `implement` / `review` / `general`
- 시스템 전용 능력: `meeting-summary` (직원에게 부여 X — `SkillService.validateRoles` 가 차단)
- 카탈로그 본문 = `src/shared/skill-catalog.ts` `SKILL_CATALOG`. 한국어 system prompt + tool 권한 matrix + 외부 endpoint slot.
- agestra plugin (4.13.0) 의 agent system prompt reference, 한국어 + Rolestra 메타포 (회사 / 부서 / 직원) 로 재작성.

### 2. 부서 템플릿 8개 (디폴트 6 + 옵션 2)

- 디폴트: 아이디어 / 기획 / 디자인 / 구현 / 검토 / 일반
- 옵션 (사용자 추가): 캐릭터 디자인 / 배경 디자인 — 게임 / 비주얼 노벨 프로젝트 한정
- 디자인 부서 = `[design.ui, design.ux]` 통합. UI/UX 의논이 잦으니 분리하지 않음. 캐릭터 / 배경은 별도 옵션 부서로 따로.

### 3. providers.roles + skill_overrides 컬럼 (migration 017)

- `roles TEXT NOT NULL DEFAULT '[]'` — JSON-serialized RoleId[]
- `skill_overrides TEXT NULL` — JSON-serialized `Partial<Record<RoleId, string>>` 또는 NULL = 카탈로그 default
- `Partial` 타입 — 일부 role 만 override 한 경우 나머지는 카탈로그 default 사용
- persona 의미는 "캐릭터 only" 로 *문서 수준* 변경 (데이터 보존 — migration 없음)
- `provider-restore` 가 JSON 파싱 실패 시 providerId + 원본 문자열 포함한 loud throw (silent fallback 금지 — CLAUDE.md 절대 규칙)

### 4. 회의록 정리 모델 별도 + 자동 선택 4단계

- `settings.summaryModelProviderId: string | null` (default null = 자동)
- `resolveSummaryProvider` 우선순위:
  1. 사용자 명시 (`summaryModelProviderId !== null`) — registry lookup
  2. Anthropic API + Haiku (`/haiku/i` model match)
  3. Gemini API + Flash (`/flash/i` model match)
  4. summarize capability 있는 기타 api/cli
  5. Local Ollama
- 사용자 명시 + (미등록 / not-ready / capability 없음) = `MeetingSummaryService` 가 throw with provider id (silent fallback 금지)
- 자동 모드 + 모든 후보 부재 = silent skip (회의록은 결정문만 저장)
- system prompt = `SKILL_CATALOG['meeting-summary'].systemPromptKo` — 카탈로그 한 곳에서 관리

### 5. PromptComposer 합성 경로

- `compose({persona, providerRoles, skillOverrides, channelRole, formatInstruction})` →
  `{persona}\n\n당신은 {channelRole 부서명} 부서에서 일하고 있습니다.\n{skillTemplate.systemPromptKo}\n\n권한: {tool grants 한국어 라벨}\n\n{formatInstruction}`
- `providerRoles ∩ channelRole` 검증 — 직원이 보유한 능력 안에 채널 역할이 없으면 throw (직원 자격 없는 부서 진입 차단)
- 빈 persona / formatInstruction 단락 생략

## Consequences

(+) 캐릭터 일관 / 능력 채널별 갈아입음 — 메타포 명확
(+) 회의록 정리 톤 객관화 (시스템 능력 분리)
(+) R12-C 채널 역할 기반 마련 — 카탈로그 + 합성기 wire 만 남음
(+) 능력 다중 선택 — 한 직원이 여러 부서 동시 멤버
(+) 사용자 명시 모델이 깨졌을 때 loud throw — 사용자가 즉시 인지 가능

(-) 기존 persona 데이터 사용자가 직접 정리해야 (캐릭터 / 능력 분리)
(-) 카탈로그 prompt 한국어 hardcoded — 영어 사용자는 R11 D9 같은 locale 분기 추후 필요 (R12-S 범위 외)
(-) renderer 직원 편집 모달이 IPC 두 개 (`provider:update` + `provider:updateRoles`) 분리 호출 — UI 복잡도 약간 증가

## Related

- spec: `docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md` §3 / §11.5 / §11.7
- plan: `docs/superpowers/plans/2026-05-01-rolestra-r12-s-persona-skills.md`
- 의존 phase: R12-C (채널 역할), D-B (구현 부서), R12-H (부서 간 인계) 가 본 ADR 결과 사용
- 카탈로그 reference: `~/.claude/plugins/cache/agestra/agestra/4.13.0/agents/`
