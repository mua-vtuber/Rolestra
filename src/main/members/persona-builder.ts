/**
 * Chat PersonaBuilder — spec §7.1, F3 캐릭터 설정
 * (`docs/specs/2026-09-29-ai-setup-and-character.md`).
 *
 * Produces the system-prompt string injected into every chat turn.
 *
 * F3 (migration 034) replaced the old three structured fields (role /
 * personality / expertise) plus the separately-labelled "[Legacy Persona]"
 * block with a single free-text "캐릭터 설정" field. `buildIdentity` does
 * not emit `Role:` / `Personality:` / `Expertise:` lines itself — the
 * migration backfilled those lines VERBATIM into `characterSheet` for
 * existing members, so the prompt text a model receives is unchanged for
 * anyone who has not yet re-edited their profile. The builder's job is just
 * "append the character sheet body under the identity header, if any".
 *
 * Section headers are load-bearing — downstream tests snapshot them and
 * the spec documents them verbatim. Do not rename without updating both.
 */

/**
 * Input for {@link buildChatPersona}.
 *
 * `displayName` is required (every member has a name). `characterSheet` is
 * the free-text F3 field — omit or pass empty to emit only the bare `Name:`
 * line (no character-sheet body at all).
 */
export interface PersonaParts {
  displayName: string;
  characterSheet: string;
}

/**
 * Spec 2026-10-01 F4-6: a CLI may attach its own environment message
 * (Claude CLI adds "# Environment" and has no supported switch to drop it
 * under a subscription login), so every chat — DMs included — is told that
 * this information is not part of the conversation.
 */
export const CHAT_RUNTIME_ENVIRONMENT_RULE = 'Runtime environment details (working folder, git status, ' +
  'operating system, date and similar information your tools attach) are not part of the conversation. ' +
  'Never mention them.';

/**
 * Adds the runtime chat rules to the persona a chat call sends. These rules
 * are about the app, not the character, so they are never stored: a room's
 * persona is a snapshot frozen at creation (`chat-room-service.ts`), and a
 * rule inside it would never reach rooms made earlier. Every chat path —
 * room and general-channel turns, DMs and votes — calls this once, right
 * before the provider call. A snapshot frozen while the rule briefly lived
 * inside `buildChatPersona` already carries it and is returned unchanged.
 */
export function withChatRuntimeRules(persona: string): string {
  if (persona.includes(CHAT_RUNTIME_ENVIRONMENT_RULE)) return persona;
  return `${persona}\n\n[Chat Runtime Rules]\n${CHAT_RUNTIME_ENVIRONMENT_RULE}`;
}

/** Build a chat identity prompt without meeting, workspace, or tool rules. */
export function buildChatPersona(parts: PersonaParts): string {
  const sections = [
    `[Chat Conversation Rules]\nSpeak only as the current character named below. Use speaker labels in prior messages to distinguish participants. Do not claim to be another participant.`,
    buildIdentity(parts),
  ];
  return sections.join('\n\n');
}

function buildIdentity(parts: PersonaParts): string {
  const identityLines: string[] = ['[Your Identity]', `Name: ${parts.displayName}`];
  if (parts.characterSheet.trim() !== '') {
    identityLines.push(parts.characterSheet);
  }
  return identityLines.join('\n');
}
