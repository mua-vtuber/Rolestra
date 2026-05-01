/**
 * SkillService — R12-S 카탈로그 lookup + override merge.
 *
 * - getSkillForRole: 카탈로그 default + 사용자 override (systemPromptKo 만)
 * - validateRoles: unknown / system-only role 차단
 * - listAvailableRolesForProvider: 직원 ∩ 채널
 *
 * 본 service 는 stateless — 카탈로그가 build-time constant.
 */

import { getSkillTemplate } from '../../shared/skill-catalog';
import type { RoleId, SkillTemplate } from '../../shared/role-types';
import { ALL_ROLE_IDS, isRoleId } from '../../shared/role-types';

export class SkillService {
  /** 카탈로그 default + override merge. */
  getSkillForRole(
    roleId: RoleId,
    overrides: Partial<Record<RoleId, string>> | null,
  ): SkillTemplate {
    const base = getSkillTemplate(roleId);
    const overridePrompt = overrides?.[roleId];
    if (typeof overridePrompt === 'string' && overridePrompt.length > 0) {
      return { ...base, systemPromptKo: overridePrompt };
    }
    return base;
  }

  /** unknown / 시스템 전용 차단. */
  validateRoles(values: string[]): RoleId[] {
    return values.map((v) => {
      if (v === 'meeting-summary') {
        throw new Error(
          `[SkillService] 'meeting-summary' is a system-only skill — cannot be assigned to a provider.`,
        );
      }
      if (!isRoleId(v)) {
        throw new Error(
          `[SkillService] unknown role id: ${v}. ` +
            `Known: ${ALL_ROLE_IDS.join(', ')}`,
        );
      }
      return v;
    });
  }

  /** 직원 능력 ∩ 채널 역할. */
  listAvailableRolesForProvider(
    providerRoles: RoleId[],
    channelRole: RoleId,
  ): RoleId[] {
    return providerRoles.filter((r) => r === channelRole);
  }

  /** 9 능력 readonly — UI chip. */
  listEmployeeRoleIds(): readonly RoleId[] {
    return ALL_ROLE_IDS;
  }
}
