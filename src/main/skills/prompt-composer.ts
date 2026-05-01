/**
 * PromptComposer — R12-S 합성 경로.
 *
 * persona (캐릭터) + role skill template (능력) + format (회의 흐름) 결합.
 * channelRole 이 providerRoles 에 없으면 throw — 직원 ∩ 부서 매칭 사전 검증.
 *
 * R12-S 는 R12-C 채널 wire 전 — channelRole 은 임시 호출 (예: legacy
 * #일반 → 'general' 매핑) 으로 검증, 본격 wire 는 R12-C.
 */

import type { RoleId } from '../../shared/role-types';
import type { SkillService } from './skill-service';
import { SKILL_CATALOG } from '../../shared/skill-catalog';

export interface ComposeInput {
  persona: string;
  providerRoles: RoleId[];
  skillOverrides: Partial<Record<RoleId, string>> | null;
  channelRole: RoleId;
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
    if (!input.providerRoles.includes(input.channelRole)) {
      throw new Error(
        `[PromptComposer] provider roles [${input.providerRoles.join(', ')}] ` +
          `does not include channel role '${input.channelRole}'. ` +
          `Cannot compose — provider should not enter this channel.`,
      );
    }

    const tpl = this.skills.getSkillForRole(input.channelRole, input.skillOverrides);
    const channelLabel = SKILL_CATALOG[input.channelRole].label.ko;

    const sections: string[] = [];

    if (input.persona.trim().length > 0) {
      sections.push(input.persona.trim());
    }

    sections.push(
      `당신은 ${channelLabel} 부서에서 일하고 있습니다.\n${tpl.systemPromptKo}`,
    );

    sections.push(`권한: ${this.summarizeTools(tpl.toolGrants)}`);

    if (input.formatInstruction.trim().length > 0) {
      sections.push(input.formatInstruction.trim());
    }

    return sections.join('\n\n');
  }

  private summarizeTools(grants: Record<string, boolean>): string {
    const granted = Object.entries(grants)
      .filter(([, v]) => v)
      .map(([k]) => TOOL_GRANT_LABEL_KO[k] ?? k);
    if (granted.length === 0) return '권한 없음';
    return granted.join(' / ');
  }
}
