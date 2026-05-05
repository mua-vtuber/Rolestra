import { describe, it, expect } from 'vitest';
import {
  handleSkillList,
  handleSkillGetTemplate,
} from '../skill-handler';

describe('skill IPC handlers — R12-S 능력 카탈로그 read-only', () => {
  it('skill:list returns 10 employee roles (excludes meeting-summary)', () => {
    // R12-C2 P3 T17: 'audit' 추가 — review (주관 평가) 와 분리.
    const { skills } = handleSkillList();
    expect(skills).toHaveLength(10);
    expect(skills.find((s) => s.id === 'meeting-summary')).toBeUndefined();
  });

  it('skill:getTemplate returns the requested employee skill', () => {
    const { skill } = handleSkillGetTemplate({ id: 'planning' });
    expect(skill.id).toBe('planning');
    expect(skill.systemPromptKo).toContain('기획 부서');
  });

  it('skill:getTemplate returns the system meeting-summary skill', () => {
    const { skill } = handleSkillGetTemplate({ id: 'meeting-summary' });
    expect(skill.id).toBe('meeting-summary');
    expect(skill.systemPromptKo).toContain('회의 내용');
  });

  it('skill:getTemplate throws on unknown id with specific id in message', () => {
    expect(() =>
      handleSkillGetTemplate({ id: 'wat' as never }),
    ).toThrow(/wat/);
  });
});
