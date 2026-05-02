/**
 * PromptComposer — R12-S 합성 경로 + R12-C 부서별 스킬 경로 주입.
 *
 * persona (캐릭터) + role skill template (능력) + format (회의 흐름) +
 * R12-C: SKILL.md 경로 단락 (provider 가 .claude/skills/ 또는
 * .agents/skills/ 의 SKILL.md 를 자동 로드하도록 안내) 결합.
 *
 * channelRole 이 RoleId 인 경우: providerRoles 에 그 능력이 있으면 정식
 *   prompt (skill template + 권한 + SKILL.md 경로 + format) 합성. 없으면
 *   fallback — persona + "이 채널은 X 부서입니다" 안내 + format 만 결합
 *   (R12-C round 2 dogfooding #3-3 fix: 사용자가 능력 부여 안 한 신규
 *   직원이 부서 채널에 들어왔을 때 throw 로 회의 침묵하던 회귀 차단).
 * channelRole 이 null 인 경우: 부서 회의 컨텍스트 X — persona +
 * formatInstruction 만 결합 (예: 일반 채널 단순 응답).
 */

import type { RoleId } from '../../shared/role-types';
import type { ChannelRole } from '../../shared/channel-role-types';
import type { SkillService } from './skill-service';
import { SKILL_CATALOG } from '../../shared/skill-catalog';

export interface ComposeInput {
  persona: string;
  providerRoles: RoleId[];
  skillOverrides: Partial<Record<RoleId, string>> | null;
  /**
   * 부서 채널의 role. R12-C: NULL = system 채널 / DM / legacy user —
   * 부서 회의 컨텍스트 없음, persona + format 만 결합.
   */
  channelRole: ChannelRole;
  formatInstruction: string;
}

const TOOL_GRANT_LABEL_KO: Record<string, string> = {
  'file.read': '파일 읽기',
  'file.write': '파일 쓰기',
  'command.exec': '명령 실행',
  'db.read': 'DB 읽기',
  'web.search': '웹 검색',
};

export class PromptComposer {
  constructor(private readonly skills: SkillService) {}

  compose(input: ComposeInput): string {
    const sections: string[] = [];

    if (input.persona.trim().length > 0) {
      sections.push(input.persona.trim());
    }

    if (input.channelRole === null) {
      // R12-C — 부서 회의 컨텍스트 없음 (system 채널 / DM / legacy user).
      // persona + formatInstruction 만 결합. 권한 / SKILL 경로 주입 X.
      if (input.formatInstruction.trim().length > 0) {
        sections.push(input.formatInstruction.trim());
      }
      return sections.join('\n\n');
    }

    const channelLabel = SKILL_CATALOG[input.channelRole].label.ko;

    if (!input.providerRoles.includes(input.channelRole)) {
      // R12-C round 2 fix #3-3 — 사용자가 직원 능력을 명시적으로 부여한
      // 적이 없는 신규 환경에서는 providerRoles 가 빈 배열이다. 이전에는
      // 이 시점에 throw 해서 회의 첫 발화자 prompt 가 만들어지지 못해
      // 회의가 1/12 단계에서 침묵했다 (사용자 dogfooding 보고).
      //
      // Fallback — persona + "이 채널은 X 부서입니다" 안내 + format 만
      // 결합. skill template 본문 / 권한 표 / SKILL.md 경로 단락은 생략
      // 한다 (직원이 그 능력을 갖고 있다는 보증이 없으니 권한 안내가
      // 거짓이 됨). 능력 부여 UI (RolesSkillsTab) 흐름이 사용자에게
      // 정착되면 옵션으로 throw 모드를 다시 강화할 수 있다.
      sections.push(
        `이 채널은 ${channelLabel} 부서입니다. 부서의 일반 업무 맥락으로 응답하세요.`,
      );
      if (input.formatInstruction.trim().length > 0) {
        sections.push(input.formatInstruction.trim());
      }
      return sections.join('\n\n');
    }

    const tpl = this.skills.getSkillForRole(
      input.channelRole,
      input.skillOverrides,
    );

    sections.push(
      `당신은 ${channelLabel} 부서에서 일하고 있습니다.\n${tpl.systemPromptKo}`,
    );

    sections.push(`권한: ${this.summarizeTools(tpl.toolGrants)}`);

    // R12-C — SKILL.md 경로 주입. 3 provider (Claude / Codex / Gemini)
    // 가 각자 .claude/skills/<roleId>/SKILL.md 또는
    // .agents/skills/<roleId>/SKILL.md 를 자동 로드하도록 안내.
    sections.push(this.buildSkillPathSection(input.channelRole, channelLabel));

    if (input.formatInstruction.trim().length > 0) {
      sections.push(input.formatInstruction.trim());
    }

    return sections.join('\n\n');
  }

  private buildSkillPathSection(roleId: RoleId, channelLabel: string): string {
    return [
      `[skill 경로] 이번 부서 = ${roleId} (${channelLabel}).`,
      `- Claude: .claude/skills/${roleId}/SKILL.md`,
      `- Codex/Gemini: .agents/skills/${roleId}/SKILL.md`,
      `해당 파일을 읽고 내용을 그대로 따르라.`,
    ].join('\n');
  }

  private summarizeTools(grants: Record<string, boolean>): string {
    const granted = Object.entries(grants)
      .filter(([, v]) => v)
      .map(([k]) => TOOL_GRANT_LABEL_KO[k] ?? k);
    if (granted.length === 0) return '권한 없음';
    return granted.join(' / ');
  }
}
