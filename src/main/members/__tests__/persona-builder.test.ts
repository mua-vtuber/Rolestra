/**
 * Unit tests for the v3 structured PersonaBuilder (R2 Task 9).
 *
 * Coverage:
 *   - Full identity: all four fields present → four lines in [Your Identity].
 *   - Missing fields dropped cleanly: role / personality / expertise skipped
 *     when empty; Name is always emitted.
 *   - Whitespace-only fields count as empty (trim semantics).
 *   - `legacyPersona` appended as its own section when non-empty.
 *   - `legacyPersona` dropped when missing OR empty-after-trim.
 *   - Section order is fixed: Base → Identity → Tool → Legacy (snapshot).
 */

import { describe, expect, it } from 'vitest';
import { buildEffectivePersona } from '../persona-builder';

describe('buildEffectivePersona', () => {
  it('includes all four identity lines when every field is filled', () => {
    const out = buildEffectivePersona({
      displayName: 'Ada',
      role: 'Engineer',
      personality: 'Direct',
      expertise: 'SQLite',
    });

    expect(out).toContain('[Your Identity]');
    expect(out).toContain('Name: Ada');
    expect(out).toContain('Role: Engineer');
    expect(out).toContain('Personality: Direct');
    expect(out).toContain('Expertise: SQLite');
  });

  it('drops empty role/personality/expertise lines cleanly', () => {
    const out = buildEffectivePersona({
      displayName: 'Bob',
      role: '',
      personality: '',
      expertise: '',
    });

    expect(out).toContain('Name: Bob');
    expect(out).not.toContain('Role:');
    expect(out).not.toContain('Personality:');
    expect(out).not.toContain('Expertise:');
    // Also: no stray blank "Role: " (no value) that would indicate a bug.
    expect(out).not.toMatch(/Role:\s*$/m);
  });

  it('treats whitespace-only field values as empty', () => {
    const out = buildEffectivePersona({
      displayName: 'Carol',
      role: '   ',
      personality: '\t\n',
      expertise: '',
    });

    expect(out).not.toContain('Role:');
    expect(out).not.toContain('Personality:');
    expect(out).not.toContain('Expertise:');
  });

  it('appends the [Legacy Persona] section when provided', () => {
    const out = buildEffectivePersona({
      displayName: 'Dan',
      role: 'PM',
      personality: '',
      expertise: '',
      legacyPersona: 'Prefers bullet summaries. Speaks English and Korean.',
    });

    expect(out).toContain('[Legacy Persona]');
    expect(out).toContain('Prefers bullet summaries.');
  });

  it('omits [Legacy Persona] when legacyPersona is undefined', () => {
    const out = buildEffectivePersona({
      displayName: 'Eve',
      role: '',
      personality: '',
      expertise: '',
    });

    expect(out).not.toContain('[Legacy Persona]');
  });

  it('omits [Legacy Persona] when legacyPersona is empty/whitespace', () => {
    const outEmpty = buildEffectivePersona({
      displayName: 'Eve',
      role: '',
      personality: '',
      expertise: '',
      legacyPersona: '',
    });
    const outWs = buildEffectivePersona({
      displayName: 'Eve',
      role: '',
      personality: '',
      expertise: '',
      legacyPersona: '  \n\t',
    });

    expect(outEmpty).not.toContain('[Legacy Persona]');
    expect(outWs).not.toContain('[Legacy Persona]');
  });

  it('produces a stable snapshot with all sections in the documented order', () => {
    const out = buildEffectivePersona({
      displayName: 'Ada',
      role: 'Engineer',
      personality: 'Direct',
      expertise: 'SQLite',
      legacyPersona: 'Prefers bullet summaries.',
    });

    expect(out).toMatchInlineSnapshot(`
      "[Base Conversation Rules]
      You are working in a multi-AI office (Rolestra). Respect channel boundaries. Write outputs to the project cwd only. Consensus documents must be written via the Main IPC bridge, not directly.

      [Your Identity]
      Name: Ada
      Role: Engineer
      Personality: Direct
      Expertise: SQLite

      [Tool Usage Rules]
      Use read/edit/search tools directly on files in the active project cwd. For shell commands, follow the current permission mode.

      [Legacy Persona]
      Prefers bullet summaries."
    `);
  });

  it('produces a snapshot without [Legacy Persona] when omitted', () => {
    const out = buildEffectivePersona({
      displayName: 'Bob',
      role: 'PM',
      personality: '',
      expertise: '',
    });

    expect(out).toMatchInlineSnapshot(`
      "[Base Conversation Rules]
      You are working in a multi-AI office (Rolestra). Respect channel boundaries. Write outputs to the project cwd only. Consensus documents must be written via the Main IPC bridge, not directly.

      [Your Identity]
      Name: Bob
      Role: PM

      [Tool Usage Rules]
      Use read/edit/search tools directly on files in the active project cwd. For shell commands, follow the current permission mode."
    `);
  });
});
