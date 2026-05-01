import { describe, it, expect } from 'vitest';
import { SkillService } from '../skill-service';
import type { RoleId } from '../../../shared/role-types';

describe('SkillService.getSkillForRole', () => {
  const svc = new SkillService();

  it('returns catalog default when no overrides', () => {
    const tpl = svc.getSkillForRole('planning', null);
    expect(tpl.id).toBe('planning');
    expect(tpl.systemPromptKo).toContain('기획 부서');
    expect(tpl.toolGrants['web.search']).toBe(true);
  });

  it('applies user override prompt while keeping toolGrants', () => {
    const overrides = { planning: '커스텀 PM 프롬프트' } as Record<RoleId, string>;
    const tpl = svc.getSkillForRole('planning', overrides);
    expect(tpl.systemPromptKo).toBe('커스텀 PM 프롬프트');
    expect(tpl.toolGrants['web.search']).toBe(true);
  });

  it('implement skill grants file.write + command.exec', () => {
    const tpl = svc.getSkillForRole('implement', null);
    expect(tpl.toolGrants['file.write']).toBe(true);
    expect(tpl.toolGrants['command.exec']).toBe(true);
  });

  it('general skill grants nothing', () => {
    const tpl = svc.getSkillForRole('general', null);
    Object.values(tpl.toolGrants).forEach((v) => expect(v).toBe(false));
  });

  it('review skill grants command.exec but not file.write', () => {
    const tpl = svc.getSkillForRole('review', null);
    expect(tpl.toolGrants['command.exec']).toBe(true);
    expect(tpl.toolGrants['file.write']).toBe(false);
  });

  it('overrides for unknown role are ignored', () => {
    const overrides = { unknown: 'x' } as unknown as Record<RoleId, string>;
    const tpl = svc.getSkillForRole('idea', overrides);
    expect(tpl.systemPromptKo).toContain('아이디어 부서');
  });
});

describe('SkillService.validateRoles', () => {
  const svc = new SkillService();

  it('accepts valid RoleIds', () => {
    expect(svc.validateRoles(['planning', 'design.ui'])).toEqual([
      'planning',
      'design.ui',
    ]);
  });

  it('throws on unknown role with specific id', () => {
    expect(() => svc.validateRoles(['planning', 'wat'])).toThrow(/wat/);
  });

  it('throws on meeting-summary (system only)', () => {
    expect(() => svc.validateRoles(['meeting-summary'])).toThrow(/system/i);
  });
});

describe('SkillService.listAvailableRolesForProvider', () => {
  const svc = new SkillService();

  it('returns intersection of provider roles and channel role', () => {
    expect(
      svc.listAvailableRolesForProvider(['planning', 'design.ui'], 'design.ui'),
    ).toEqual(['design.ui']);
  });

  it('returns empty when provider lacks channel role', () => {
    expect(svc.listAvailableRolesForProvider(['idea'], 'implement')).toEqual([]);
  });
});
