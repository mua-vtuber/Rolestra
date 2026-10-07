import type { Migration } from '../migrator';

/**
 * Chat CLI AIs used to store the path `provider:detect-cli` found
 * (`C:\...\OpenAI\Codex\bin\<version hash>\codex.exe`). That path goes stale
 * when the CLI moves — the Codex desktop app deletes the old per-version
 * folder on update — and every check then fails with ENOENT. A CLI AI now
 * stores the bare command name and every spawn looks it up on PATH.
 *
 * This rewrites an existing row whose command's last path segment is
 * claude / codex (any case, optionally with .exe / .cmd / .bat) to the bare
 * lower-case name, the same reading as `cliCommandKey`. The names are spelled
 * out here rather than imported so this migration keeps meaning the same thing
 * if the supported list changes later. Other CLI rows (the retired Gemini CLI)
 * are left as they are. Idempotent: a bare name matches nothing.
 */
const LAUNCHER_SUFFIXES = ['', '.exe', '.cmd', '.bat'];

function rewriteToName(name: string): string {
  const command = "json_extract(config_json, '$.command')";
  const slashed = `lower(replace(${command}, '\\', '/'))`;
  const bare = LAUNCHER_SUFFIXES.map((suffix) => `'${name}${suffix}'`).join(', ');
  const nested = LAUNCHER_SUFFIXES.map((suffix) => `${slashed} LIKE '%/${name}${suffix}'`).join('\n    OR ');
  return `
UPDATE providers
SET config_json = json_set(config_json, '$.command', '${name}')
WHERE kind = 'cli'
  AND json_valid(config_json)
  AND json_type(config_json, '$.command') = 'text'
  AND ${command} <> '${name}'
  AND (
    ${slashed} IN (${bare})
    OR ${nested}
  );
`;
}

export const migration: Migration = {
  id: '038-cli-command-name',
  sql: rewriteToName('claude') + rewriteToName('codex'),
};
