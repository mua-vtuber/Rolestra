/**
 * v3 Structured PersonaBuilder — spec §7.1.
 *
 * Produces the system-prompt string injected into every provider turn. The
 * v3 format is FIXED sections in this order:
 *
 *   [Base Conversation Rules]
 *   <static text — multi-AI office rules>
 *
 *   [Your Identity]
 *   Name: {displayName}
 *   Role: {role}               (optional — skipped when empty)
 *   Personality: {personality} (optional — skipped when empty)
 *   Expertise: {expertise}     (optional — skipped when empty)
 *
 *   [Tool Usage Rules]
 *   <static text — cwd + permission-mode reminder>
 *
 *   [Legacy Persona]           (optional — only when providers.persona is set)
 *   <verbatim legacy persona text>
 *
 * The legacy block is a migration escape hatch: v2 profiles stored a single
 * free-text `persona` field which we ported to `providers.persona`. Rather
 * than force users to rewrite those blobs into structured fields immediately,
 * we append them under "[Legacy Persona]" so the AI still sees the context
 * while the user migrates at their own pace.
 *
 * This file is deliberately DISTINCT from `src/main/engine/persona-builder.ts`
 * (the v2 version). The v2 builder remains in-tree for the v2 conversation
 * engine until R5 replaces the engine wholesale — do NOT modify it here.
 *
 * Section headers are load-bearing — downstream tests snapshot them and
 * the spec documents them verbatim. Do not rename without updating both.
 */

/** Static multi-AI office rules. First section of every persona. */
const BASE_RULES = `[Base Conversation Rules]
You are working in a multi-AI office (Rolestra). Respect channel boundaries. Write outputs to the project cwd only. Consensus documents must be written via the Main IPC bridge, not directly.`;

/** Static tool-usage reminder. Third section of every persona. */
const TOOL_RULES = `[Tool Usage Rules]
Use read/edit/search tools directly on files in the active project cwd. For shell commands, follow the current permission mode.`;

/**
 * Input for {@link buildEffectivePersona}.
 *
 * `displayName` is required (every member has a name). The three identity
 * fields (`role`, `personality`, `expertise`) are always passed — callers
 * hand us whatever the profile holds, possibly empty strings — and the
 * builder silently drops empties so the output never contains bare
 * `Role:` / `Personality:` / `Expertise:` lines.
 *
 * `legacyPersona` is optional: omit or pass empty to skip the [Legacy
 * Persona] section entirely.
 */
export interface PersonaParts {
  displayName: string;
  role: string;
  personality: string;
  expertise: string;
  legacyPersona?: string;
}

/**
 * Build the system-prompt string for a member.
 *
 * Rules:
 *   - `displayName` always emits (`Name: ...`).
 *   - Each of role/personality/expertise is skipped when its trimmed value
 *     is empty. We trim instead of raw-check because profile fields can be
 *     whitespace-only after a careless edit; treating `"  "` as "present"
 *     would leak a bare header into the prompt.
 *   - Sections are joined by a blank line (`\n\n`) so the output renders
 *     cleanly in the provider UI and the CLI transcripts.
 *   - [Legacy Persona] appears only when `legacyPersona` has non-empty
 *     trimmed content. An empty/missing legacy field drops the section
 *     entirely (the bare header would confuse the AI).
 *
 * Pure function — no side effects, no I/O, deterministic. The unit test
 * snapshots the output so any section/header drift is caught.
 */
export function buildEffectivePersona(parts: PersonaParts): string {
  const identityLines: string[] = ['[Your Identity]', `Name: ${parts.displayName}`];
  if (parts.role.trim() !== '')        identityLines.push(`Role: ${parts.role}`);
  if (parts.personality.trim() !== '') identityLines.push(`Personality: ${parts.personality}`);
  if (parts.expertise.trim() !== '')   identityLines.push(`Expertise: ${parts.expertise}`);
  const identity = identityLines.join('\n');

  const sections: string[] = [BASE_RULES, identity, TOOL_RULES];

  if (parts.legacyPersona !== undefined && parts.legacyPersona.trim() !== '') {
    sections.push(`[Legacy Persona]\n${parts.legacyPersona}`);
  }

  return sections.join('\n\n');
}
