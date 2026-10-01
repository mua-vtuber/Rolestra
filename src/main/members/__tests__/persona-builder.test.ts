/**
 * Unit tests for the chat PersonaBuilder (R2 Task 9; F3 캐릭터
 * 설정 rewrite — `docs/specs/2026-09-29-ai-setup-and-character.md`).
 *
 * Coverage:
 *   - `buildChatPersona` carries only chat rules + identity, no office/tool
 *     sections, and no "[Legacy Persona]" label.
 */

import { describe, expect, it } from 'vitest';
import { CHAT_RUNTIME_ENVIRONMENT_RULE, buildChatPersona, withChatRuntimeRules } from '../persona-builder';

describe('buildChatPersona', () => {
  it('carries the authored character sheet without adding office or tool instructions', () => {
    const out = buildChatPersona({
      displayName: 'Mira',
      characterSheet: 'Role: old friend\nPersonality: dry humor, quietly kind\nExpertise: astronomy\n\nKeep answers warm and conversational.',
    });

    expect(out).toContain('Name: Mira');
    expect(out).toContain('Role: old friend');
    expect(out).toContain('Personality: dry humor, quietly kind');
    expect(out).toContain('Expertise: astronomy');
    expect(out).toContain('Keep answers warm and conversational.');
    expect(out).toContain('Speak only as the current character');
    expect(out).toContain('speaker labels');
    expect(out).not.toContain('[Legacy Persona]');
    expect(out).not.toContain('office');
    expect(out).not.toContain('project cwd');
    expect(out).not.toContain('Tool Usage Rules');
  });

  it('keeps the runtime environment rule out of the stored persona (spec 2026-10-01 F4-6)', () => {
    // Room personas are frozen snapshots; a runtime rule inside them would
    // never reach rooms made earlier. Every chat call adds it instead.
    expect(buildChatPersona({ displayName: 'Mira', characterSheet: '' })).not.toContain(CHAT_RUNTIME_ENVIRONMENT_RULE);
  });

  it('adds the runtime environment rule exactly once at call time', () => {
    expect(CHAT_RUNTIME_ENVIRONMENT_RULE).toBe('Runtime environment details (working folder, git status, ' +
      'operating system, date and similar information your tools attach) are not part of the conversation. ' +
      'Never mention them.');
    const persona = withChatRuntimeRules('Frozen room persona');
    expect(persona.startsWith('Frozen room persona\n\n')).toBe(true);
    expect(persona.split(CHAT_RUNTIME_ENVIRONMENT_RULE)).toHaveLength(2);
    expect(withChatRuntimeRules(persona)).toBe(persona);
  });

  it('emits a bare Name line when the character sheet is empty', () => {
    const out = buildChatPersona({ displayName: 'Nova', characterSheet: '' });

    expect(out).toContain('Name: Nova');
    expect(out).not.toContain('[Legacy Persona]');
  });
});
