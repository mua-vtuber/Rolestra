/**
 * SKILL.md template renderer — R12-C Task 5.
 *
 * Renders a SKILL.md file body for a given RoleId, used by
 * `ProjectSkillSyncService` (Task 6) to write to:
 *   - `<projectRoot>/.claude/skills/<roleId>/SKILL.md` (Claude Code)
 *   - `<projectRoot>/.agents/skills/<roleId>/SKILL.md` (Codex / Gemini alias)
 *
 * Format constraints (3 provider 공통):
 *   - First line MUST be `---` (frontmatter open)
 *   - Frontmatter MUST include `name` and `description` (Gemini silent
 *     skip otherwise)
 *   - Closing `---` followed by a blank line then body
 *
 * Body sections:
 *   1. `# {부서명} 부서` heading
 *   2. systemPromptKo from skill-catalog.ts
 *   3. `## 자기 spec 합리화 방어 (필수 준수)` — fixed defensive guidance
 *      (사용자 결정: 본문은 후에 천천히 다듬되 방어 로직은 필수)
 *
 * Skill content evolves — this renderer guarantees only the structural
 * contract. systemPromptKo polish happens in skill-catalog.ts (R13+
 * sweep) without renderer changes.
 */

import { isRoleId, type RoleId } from '../../shared/role-types';
import { SKILL_CATALOG } from '../../shared/skill-catalog';

/**
 * Fixed defensive section appended to every SKILL.md. Blocks the AI from
 * rationalising its own output during cross-department review (e.g.
 * planning AI auto-classifying review feedback as "intended" because it
 * wrote the spec it is now reviewing).
 */
const SELF_RATIONALIZATION_DEFENSE = `## 자기 spec 합리화 방어 (필수 준수)

- 본인이 작성한 산출물에 대한 검토 의견을 받았을 때, 무조건 "의도임" 으로 분류 금지.
- 검토 의견의 근거 (코드 / 행동 / 사용자 영향) 를 spec 텍스트와 직접 대조 후 판단.
- 의도 vs 검토 의견 충돌 시 객관적으로 검토 의견 우선 인정.
- 의심스러우면 "수정 group" 으로 분류 (false negative 비용 < false positive 비용).`;

/**
 * Builds a 1-line description for the frontmatter — first sentence of
 * systemPromptKo, trimmed and de-newlined. Frontmatter description is
 * what loaders show in skill discovery; concise + descriptive wins.
 */
function buildDescription(roleId: RoleId, koLabel: string): string {
  const tpl = SKILL_CATALOG[roleId];
  if (!tpl) {
    throw new Error(`skill-md-template: unknown roleId '${roleId}'`);
  }
  // First sentence (split on first period or first newline).
  const firstLine = tpl.systemPromptKo.split('\n')[0]?.trim() ?? '';
  // Strip the "당신은 ~ 담당입니다." preamble for a cleaner description.
  const cleaned = firstLine
    .replace(/^당신은\s*/, '')
    .replace(/[입.\s]*$/, '')
    .trim();
  return cleaned ? `Rolestra ${koLabel} 부서 — ${cleaned}` : `Rolestra ${koLabel} 부서`;
}

/**
 * Renders the SKILL.md body for the given employee RoleId.
 *
 * Throws when `roleId` is not in SKILL_CATALOG (defensive — prevents
 * silently writing an empty skill file for an unknown role).
 */
export function renderSkillMd(roleId: RoleId): string {
  // Defensive: reject non-RoleId values (e.g. 'meeting-summary' which is
  // SystemSkillId — system 전용, 직원 부여 X) and unknown strings coerced
  // at the JSON / IPC boundary.
  if (!isRoleId(roleId)) {
    throw new Error(`skill-md-template: unknown roleId '${roleId}'`);
  }
  const tpl = SKILL_CATALOG[roleId];
  if (!tpl) {
    throw new Error(`skill-md-template: unknown roleId '${roleId}'`);
  }
  const koLabel = tpl.label.ko;
  const description = buildDescription(roleId, koLabel);

  return [
    '---',
    `name: ${roleId}`,
    `description: ${description}`,
    '---',
    '',
    `# ${koLabel} 부서`,
    '',
    tpl.systemPromptKo.trim(),
    '',
    SELF_RATIONALIZATION_DEFENSE,
    '',
  ].join('\n');
}
