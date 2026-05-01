/**
 * Unit tests for skill-md-template (R12-C Task 5).
 *
 * Coverage:
 *   - Frontmatter shape (--- name --- description --- blank line — Gemini
 *     silent-skip prevention).
 *   - All 9 employee roles render without throwing.
 *   - meeting-summary (system-only) is rejected (system 전용, 직원 부여 X).
 *   - Body contains systemPromptKo + 자기 spec 합리화 방어 4-항.
 *   - Description includes the Korean label.
 */

import { describe, expect, it } from 'vitest';
import { ALL_ROLE_IDS, type RoleId } from '../../../shared/role-types';
import { renderSkillMd } from '../skill-md-template';

describe('renderSkillMd', () => {
  describe('frontmatter contract (Gemini silent-skip prevention)', () => {
    it('starts with --- on the very first line', () => {
      const md = renderSkillMd('idea');
      expect(md.split('\n')[0]).toBe('---');
    });

    it('includes name: <roleId>', () => {
      const md = renderSkillMd('planning');
      expect(md).toMatch(/^name:\s*planning$/m);
    });

    it('includes description: line', () => {
      const md = renderSkillMd('implement');
      expect(md).toMatch(/^description:\s*Rolestra .+/m);
    });

    it('closes the frontmatter with --- followed by a blank line', () => {
      const md = renderSkillMd('review');
      const lines = md.split('\n');
      // expect a closing --- somewhere in the first 6 lines, then blank.
      const closeIdx = lines.findIndex(
        (line, idx) => idx > 0 && line === '---',
      );
      expect(closeIdx).toBeGreaterThan(0);
      expect(lines[closeIdx + 1]).toBe('');
    });
  });

  describe('all 9 employee roles', () => {
    const employeeRoles: RoleId[] = ALL_ROLE_IDS.filter(
      (r) => r !== 'general',
    ) as RoleId[];
    employeeRoles.push('general');

    for (const role of employeeRoles) {
      it(`renders without throwing for role='${role}'`, () => {
        expect(() => renderSkillMd(role)).not.toThrow();
        const md = renderSkillMd(role);
        expect(md.length).toBeGreaterThan(100);
      });
    }
  });

  describe('body structure', () => {
    it('contains the Korean department heading', () => {
      const md = renderSkillMd('idea');
      expect(md).toContain('# 아이디어 부서');
    });

    it('embeds the systemPromptKo body (key phrase from idea catalog)', () => {
      const md = renderSkillMd('idea');
      expect(md).toContain('자유 발산');
    });

    it('appends the self-rationalization defense section with 4 bullets', () => {
      const md = renderSkillMd('planning');
      expect(md).toContain('## 자기 spec 합리화 방어 (필수 준수)');
      // 4 bullets — count `\n- ` occurrences inside the defense block.
      const defenseStart = md.indexOf('## 자기 spec 합리화 방어');
      const defenseSection = md.slice(defenseStart);
      const bulletCount = (defenseSection.match(/\n- /g) ?? []).length;
      expect(bulletCount).toBe(4);
    });

    it('builds description with Korean label prefix', () => {
      const md = renderSkillMd('design.ui');
      expect(md).toMatch(/description:\s*Rolestra 디자인 \(UI\) 부서/);
    });
  });

  describe('rejection of unknown / system-only ids', () => {
    it('throws for an unknown roleId', () => {
      expect(() => renderSkillMd('not-a-role' as RoleId)).toThrow(
        /unknown roleId/,
      );
    });

    // meeting-summary is a SystemSkillId, not RoleId — TypeScript prevents
    // direct call, so we cast at the boundary to simulate a runtime
    // misuse (e.g. coerced from JSON).
    it('throws when called with the system-only meeting-summary id', () => {
      expect(() => renderSkillMd('meeting-summary' as unknown as RoleId)).toThrow(
        /unknown roleId/,
      );
    });
  });
});
