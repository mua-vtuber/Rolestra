/**
 * Persona builder utilities for the conversation engine.
 *
 * Builds system prompt with:
 * 1. Base dialogue rules (anti-sycophancy, conciseness)
 * 2. User-defined custom persona
 * 3. File permission rules (from PermissionService settings)
 */

import type { BaseProvider } from '../providers/provider-interface';
import type { FilePermission } from '../../shared/file-types';

/**
 * Extra guardrails for Gemini models which tend to echo/repeat
 * prior conversation messages in their responses.
 */
const GEMINI_GUARDRAILS =
  '\n\n[Provider Guardrails]\n' +
  '- Unmistakably do NOT repeat or echo any prior messages in your response.\n' +
  '- Do NOT paraphrase or summarize what other participants said.\n' +
  '- Respond ONLY with your own new content.';

const BASE_DIALOGUE_RULES =
  '[Base Conversation Rules]\n' +
  '- Do not simply agree with others.\n' +
  '- Avoid empty agreement phrases (for example: "Great point", "I agree") unless you truly agree.\n' +
  '- Be concise, specific, and technically grounded.\n' +
  '- If something is unclear or likely wrong, challenge it with reasons and alternatives.\n' +
  '- NEVER dump full file contents, file paths being read, or tool operation details in responses.\n' +
  '- Do NOT narrate file reading steps (e.g., "Let me read file X", "Here is the content of...").\n' +
  '- When code changes are proposed, show ONLY the modified parts as minimal diff-style snippets in fenced code blocks.\n' +
  '- Skip intermediate analysis and go straight to actionable results.';

/** Options for building the effective persona. */
export interface PersonaBuildOptions {
  permission?: FilePermission | null;
  projectFolder?: string | null;
  arenaFolder?: string | null;
}

/**
 * Build file permission rules as a system prompt block.
 *
 * Translates the PermissionService settings into natural-language
 * instructions that CLI providers can follow.
 */
function buildPermissionRules(options: PersonaBuildOptions): string {
  const { permission, projectFolder, arenaFolder } = options;

  // No project folder configured → pure conversation mode
  if (!projectFolder) {
    return (
      '\n\n[Tool Usage Rules]\n' +
      '- This is a multi-AI discussion platform.\n' +
      '- Do NOT read, write, or modify any files.\n' +
      '- Do NOT execute any commands or access the file system.\n' +
      '- Focus on conversation, analysis, and providing your perspective.'
    );
  }

  // Project folder set but no permissions for this participant
  if (!permission) {
    return (
      '\n\n[Tool Usage Rules]\n' +
      `- Project folder: ${projectFolder}\n` +
      '- You have NO file permissions configured. Do NOT access any files.\n' +
      '- Do NOT execute any commands.\n' +
      '- Focus on conversation and discussion only.'
    );
  }

  // Build rules from actual permission flags
  const rules: string[] = [
    '\n\n[Tool Usage Rules]',
    `- Project folder: ${projectFolder}`,
  ];

  if (permission.read) {
    rules.push('- File read: ALLOWED (within project folder only)');
  } else {
    rules.push('- File read: DENIED — do NOT read any files unless the user explicitly asks');
  }

  if (permission.write) {
    rules.push('- File write: ALLOWED (within project folder only, propose changes before writing)');
  } else {
    rules.push('- File write: DENIED — do NOT create, modify, or delete any files');
  }

  if (permission.execute) {
    rules.push('- Command execution: ALLOWED (within project folder only)');
  } else {
    rules.push('- Command execution: DENIED — do NOT execute any commands');
  }

  // .arena/workspace/ is always available for all participants
  if (arenaFolder) {
    rules.push(`- Arena workspace (${arenaFolder}): freely accessible for drafts and proposals`);
  }

  rules.push('- Strictly follow these permissions. Do NOT bypass them.');

  return rules.join('\n');
}

/**
 * Build the effective persona for a provider, augmented with
 * permission rules.
 *
 * @param provider - The provider instance.
 * @param options - Build options including permissions.
 * @returns The persona string to pass to streamCompletion.
 */
export function buildEffectivePersona(
  provider: BaseProvider,
  options: PersonaBuildOptions,
): string {
  const custom = provider.persona.trim();
  const base = custom ? `${BASE_DIALOGUE_RULES}\n\n${custom}` : BASE_DIALOGUE_RULES;

  const guardrails = isGeminiProvider(provider) ? GEMINI_GUARDRAILS : '';

  return base + guardrails + buildPermissionRules(options);
}

/**
 * Detect whether a provider is a Gemini model (API or CLI).
 * Checks endpoint URL for Google API, or CLI command for gemini.
 */
function isGeminiProvider(provider: BaseProvider): boolean {
  const config = provider.config;
  if (config.type === 'api') {
    return config.endpoint.includes('generativelanguage.googleapis.com');
  }
  if (config.type === 'cli') {
    return config.command.toLowerCase().includes('gemini');
  }
  // Local providers using Gemini models
  if (config.type === 'local') {
    return provider.model.toLowerCase().includes('gemini');
  }
  return false;
}
