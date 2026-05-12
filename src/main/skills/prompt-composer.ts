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

import type { RoleId, ToolGrant } from '../../shared/role-types';
import type { ChannelRole } from '../../shared/channel-role-types';
import type { SkillService } from './skill-service';
import { SKILL_CATALOG } from '../../shared/skill-catalog';
import type { PermissionSet } from '../../shared/permission-set-types';
import { permissionSetToToolGrants } from '../../shared/permission-set-types';

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
  /**
   * R12-W T9 — 채널 단위 권한 snapshot. 활성 분기 (능력 부여 직원 + 부서 채널)
   * 의 권한 단락 합성 시 카탈로그 toolGrants 대신 본 snapshot 을 우선 사용.
   *
   * 미제공 시 (undefined) 카탈로그 default 그대로 — 회귀 invariant (R12-C round 2
   * fix 시점의 기존 행동). T9 wire-up 이 완료된 후 MeetingTurnExecutor 는 *항상*
   * 본 인자를 채워 호출하지만, 다른 호출 경로 (예: 단위 테스트) 의 시그니처 호환
   * 위해 optional 로 둔다.
   */
  permissionSnapshot?: PermissionSet;
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
      // R12-W T1 — fallback 분기에서도 D2 (미설정 시 읽기 허용) 안내와
      // 회의록 권한 무관성을 명시. 능력 미부여 직원이 채널 회의에 들어와도
      // "권한이 전혀 없으니 어떤 파일도 못 본다" 로 오해해 회의 본질 (문서
      // 읽고 의견 내기) 을 자기검열하던 회귀를 차단한다. 정식 경로 (line
      // 92 의 `권한: …`) 는 카탈로그 toolGrants 를 그대로 노출하므로 이
      // fallback 단락만 추가 안내 책임이 있다.
      sections.push(
        `이 채널은 ${channelLabel} 부서입니다. 부서의 일반 업무 맥락으로 응답하세요.\n` +
          `권한: 작업장 폴더 안 파일 읽기 (쓰기 / 명령 실행은 사용자가 명시적으로 지시한 경우에만).\n` +
          `참고: 회의록(#회의록 채널)은 시스템 기록이므로 파일 권한과 무관합니다.`,
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

    // R12-W T9 — 채널 단위 permissionSnapshot 이 카탈로그 toolGrants 보다 우선.
    // 사용자가 채널 설정 모달에서 부서 default 를 미세조정한 결과가 즉시 AI
    // 권한 안내에 반영. snapshot 미제공 시 (R12-W 이전 호출 경로 / 단위 테스트)
    // 카탈로그 그대로.
    const grantsForPrompt: Record<ToolGrant, boolean> = input.permissionSnapshot
      ? permissionSetToToolGrants(input.permissionSnapshot)
      : tpl.toolGrants;
    sections.push(`권한: ${this.summarizeTools(grantsForPrompt)}`);

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
