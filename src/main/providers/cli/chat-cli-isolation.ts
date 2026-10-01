import {
  ClaudePermissionAdapter,
  CodexPermissionAdapter,
  type CliPermissionAdapter,
} from './permission-adapter';

/**
 * Chat/vote model calls need language generation, not local tools or extensions.
 *
 * Codex: every `-c` override must come after `exec` (these args are appended
 * after the read-only `exec ... --json` args). codex-cli 0.153.4 drops the
 * root-level `-c` list once `exec` has its own (measured 2026-10-01).
 */
export function chatCliIsolationArgs(adapter: CliPermissionAdapter, cliVisibleCwd: string): string[] {
  if (adapter instanceof ClaudePermissionAdapter) {
    return ['--safe-mode', '--tools', '', '--strict-mcp-config'];
  }
  if (adapter instanceof CodexPermissionAdapter) {
    const disabledFeatures = [
      'shell_tool', 'unified_exec', 'apps', 'plugins', 'hooks',
      'browser_use', 'browser_use_external', 'browser_use_full_cdp_access',
      'computer_use', 'multi_agent', 'view_image', 'code_mode_host',
      'in_app_browser', 'skill_search', 'shell_snapshot',
      'image_generation', 'remote_plugin', 'tool_call_mcp_elicitation',
      'workspace_dependencies',
      // Spec 2026-09-29 §B2 capture: without this, codex-cli 0.153.4 still
      // offers the get_goal / create_goal / update_goal agent tools.
      'goals',
    ];
    return [
      '--ignore-user-config', '--ignore-rules',
      ...disabledFeatures.flatMap((feature) => ['-c', `features.${feature}=false`]),
      '-c', 'web_search="disabled"',
      '-c', 'project_doc_max_bytes=0',
      '-c', 'project_root_markers=[]',
      '-c', `projects.${JSON.stringify(cliVisibleCwd)}.trust_level="untrusted"`,
    ];
  }
  throw new Error('Scoped chat CLI requires a supported permission adapter');
}

/**
 * Replaces the CLI's default system prompt with the chat persona file
 * (`files/chat-cli-instructions.ts`, spec 2026-09-29 §B2).
 *
 * Claude Code: `--system-prompt-file` replaces the whole default prompt
 * (official flag). Its prompt snapshot (on by default) keeps the first
 * request's prompt for `--resume`, which matches the session fingerprint
 * rule: a persona change starts a new session.
 *
 * Codex: each key below was confirmed by capturing the request codex-cli
 * 0.153.4 sends to a local fake API (2026-10-01, one key removed at a time):
 * - `model_instructions_file` (official): `instructions` becomes the file.
 * - `include_permissions_instructions=false`: drops the developer message
 *   describing sandbox and approval settings.
 * - `include_environment_context=false`: drops the `<environment_context>`
 *   input (working folder, shell, date, time zone).
 * - `skills.include_instructions=false`: drops the `<skills_instructions>`
 *   developer message (skill list with skill folder paths).
 * `include_apps_instructions` and `include_collaboration_mode_instructions`
 * showed no effect in exec mode, so they are not passed.
 */
export function chatCliInstructionArgs(adapter: CliPermissionAdapter, cliVisibleInstructionFile: string): string[] {
  if (adapter instanceof ClaudePermissionAdapter) {
    return ['--system-prompt-file', cliVisibleInstructionFile];
  }
  if (adapter instanceof CodexPermissionAdapter) {
    return [
      '-c', `model_instructions_file=${JSON.stringify(cliVisibleInstructionFile)}`,
      '-c', 'include_permissions_instructions=false',
      '-c', 'include_environment_context=false',
      '-c', 'skills.include_instructions=false',
    ];
  }
  throw new Error('Scoped chat CLI requires a supported permission adapter');
}
