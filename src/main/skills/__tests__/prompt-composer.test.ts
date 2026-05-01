import { describe, it, expect } from 'vitest';
import { PromptComposer } from '../prompt-composer';
import { SkillService } from '../skill-service';

describe('PromptComposer.compose', () => {
  const composer = new PromptComposer(new SkillService());

  it('composes persona + role skill + format', () => {
    const out = composer.compose({
      persona: '신중한 PM Sarah',
      providerRoles: ['planning'],
      skillOverrides: null,
      channelRole: 'planning',
      formatInstruction: '응답은 JSON 으로.',
    });
    expect(out).toContain('신중한 PM Sarah');
    expect(out).toContain('기획 부서에서 일하고');
    expect(out).toContain('spec 작성');
    expect(out).toContain('응답은 JSON 으로.');
  });

  it('omits persona paragraph when empty', () => {
    const out = composer.compose({
      persona: '',
      providerRoles: ['idea'],
      skillOverrides: null,
      channelRole: 'idea',
      formatInstruction: '',
    });
    expect(out).not.toMatch(/^\n/);
    expect(out).toContain('아이디어 부서');
  });

  it('applies override prompt when present', () => {
    const out = composer.compose({
      persona: '',
      providerRoles: ['planning'],
      skillOverrides: { planning: '나만의 PM 가이드' },
      channelRole: 'planning',
      formatInstruction: '',
    });
    expect(out).toContain('나만의 PM 가이드');
    expect(out).not.toContain('spec 작성');
  });

  it('throws when provider lacks channel role', () => {
    expect(() =>
      composer.compose({
        persona: '',
        providerRoles: ['idea'],
        skillOverrides: null,
        channelRole: 'implement',
        formatInstruction: '',
      }),
    ).toThrow(/idea.*implement/);
  });

  it('summarizes tool grants for implement', () => {
    const out = composer.compose({
      persona: '',
      providerRoles: ['implement'],
      skillOverrides: null,
      channelRole: 'implement',
      formatInstruction: '',
    });
    expect(out).toMatch(/file\.write|파일 쓰기/);
    expect(out).toMatch(/command\.exec|명령 실행/);
  });

  it('summarizes "권한 없음" for general', () => {
    const out = composer.compose({
      persona: '',
      providerRoles: ['general'],
      skillOverrides: null,
      channelRole: 'general',
      formatInstruction: '',
    });
    expect(out).toContain('권한 없음');
  });

  // ── R12-C: SKILL.md 경로 주입 + null channelRole ──────────────────

  describe('R12-C: SKILL.md path injection', () => {
    it('injects skill path for both .claude and .agents roots', () => {
      const out = composer.compose({
        persona: '',
        providerRoles: ['planning'],
        skillOverrides: null,
        channelRole: 'planning',
        formatInstruction: '',
      });
      expect(out).toContain('[skill 경로]');
      expect(out).toContain('.claude/skills/planning/SKILL.md');
      expect(out).toContain('.agents/skills/planning/SKILL.md');
      expect(out).toContain('이번 부서 = planning');
    });

    it('uses dotted role id verbatim for design.ux', () => {
      const out = composer.compose({
        persona: '',
        providerRoles: ['design.ux'],
        skillOverrides: null,
        channelRole: 'design.ux',
        formatInstruction: '',
      });
      expect(out).toContain('.claude/skills/design.ux/SKILL.md');
      expect(out).toContain('.agents/skills/design.ux/SKILL.md');
    });
  });

  describe('R12-C: null channelRole (system 채널 / DM / legacy user)', () => {
    it('omits department / skill / 권한 sections, keeps persona + format only', () => {
      const out = composer.compose({
        persona: 'Friendly DM responder',
        providerRoles: ['general'],
        skillOverrides: null,
        channelRole: null,
        formatInstruction: '한 문단으로 답하세요.',
      });
      expect(out).toContain('Friendly DM responder');
      expect(out).toContain('한 문단으로 답하세요');
      expect(out).not.toContain('부서에서 일하고');
      expect(out).not.toContain('[skill 경로]');
      expect(out).not.toContain('권한:');
    });

    it('does NOT throw on providerRoles mismatch when channelRole is null', () => {
      // null channelRole = no membership check
      expect(() =>
        composer.compose({
          persona: '',
          providerRoles: [],
          skillOverrides: null,
          channelRole: null,
          formatInstruction: '',
        }),
      ).not.toThrow();
    });
  });
});
