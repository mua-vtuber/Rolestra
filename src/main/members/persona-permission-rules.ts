/**
 * persona-permission-rules — Tool/file permission system-prompt block.
 *
 * R11-Task2 promotion from `engine/persona-builder.ts`. The v2 builder
 * file is being deleted along with the rest of the v2 conversation
 * engine; this module lifts the permission-rules helper out so the v3
 * `meeting-turn-executor` can keep appending the same wording to each
 * AI persona without depending on v2 code.
 *
 * Wording is kept identical to the previous v2 helper so AI behaviour
 * does not drift across the swap.
 */

import type { FilePermission } from '../../shared/file-types';

/** Inputs to {@link buildPermissionRules}. */
export interface PermissionRulesInput {
  permission?: FilePermission | null;
  projectFolder?: string | null;
  arenaFolder?: string | null;
}

/**
 * Build the file/command permission system-prompt block appended to a
 * member's persona. Three branches:
 *
 *   1. No project folder configured → conversation-only mode (no I/O).
 *   2. Project folder set but participant has no permissions → deny all.
 *   3. Permissions present → emit one line per read/write/execute flag.
 *
 * The arena workspace is always declared accessible when its path is
 * known.
 */
export function buildPermissionRules(input: PermissionRulesInput): string {
  const { permission, projectFolder, arenaFolder } = input;

  if (!projectFolder) {
    return (
      '\n\n[Tool Usage Rules]\n' +
      '- This is a multi-AI discussion platform.\n' +
      '- Do NOT read, write, or modify any files.\n' +
      '- Do NOT execute any commands or access the file system.\n' +
      '- Focus on conversation, analysis, and providing your perspective.'
    );
  }

  if (!permission) {
    return (
      '\n\n[Tool Usage Rules]\n' +
      `- Project folder: ${projectFolder}\n` +
      '- You have NO file permissions configured. Do NOT access any files.\n' +
      '- Do NOT execute any commands.\n' +
      '- Focus on conversation and discussion only.'
    );
  }

  const rules: string[] = [
    '\n\n[Tool Usage Rules]',
    `- Project folder: ${projectFolder}`,
  ];

  rules.push(
    permission.read
      ? '- File read: ALLOWED (within project folder only)'
      : '- File read: DENIED — do NOT read any files unless the user explicitly asks',
  );

  rules.push(
    permission.write
      ? '- File write: ALLOWED (within project folder only, propose changes before writing)'
      : '- File write: DENIED — do NOT create, modify, or delete any files',
  );

  rules.push(
    permission.execute
      ? '- Command execution: ALLOWED (within project folder only)'
      : '- Command execution: DENIED — do NOT execute any commands',
  );

  if (arenaFolder) {
    rules.push(
      `- Arena workspace (${arenaFolder}): freely accessible for drafts and proposals`,
    );
  }

  rules.push('- Strictly follow these permissions. Do NOT bypass them.');

  return rules.join('\n');
}
