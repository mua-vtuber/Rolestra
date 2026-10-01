/**
 * Chat CLI instruction files (spec 2026-09-29 §B2).
 *
 * Chat and vote CLI calls replace the CLI's own default system prompt — a
 * coding assistant plus working-folder / git / environment context — with the
 * chat persona. Both supported CLIs take the replacement as a file
 * (`providers/cli/chat-cli-isolation.ts` `chatCliInstructionArgs`): a file rather than an
 * argument because Codex runs through the `codex.cmd` shim, and cmd.exe
 * cannot carry a multi-line argument (`windows-command.ts`).
 *
 * Location: `<userData>/chat-cli-instructions/` — app-managed and outside the
 * CLI working folder. The chat CLI runs in `<ArenaRoot>/consensus`, so the
 * file must not live under that folder. A call whose instructions folder
 * sits inside its CLI working folder (an app folder layout where the
 * ArenaRoot, e.g. via `ROLESTRA_ARENA_ROOT`, contains the app data folder)
 * is refused — an internal layout invariant, not a user setting.
 *
 * Naming: one file per chat session and persona,
 * `<sha256(scopeKey NUL persona) prefix>.md`. The scope key is unique per
 * room × provider (or vote × provider), so two live CLI clones never share a
 * file, and a persona change produces a new name.
 *
 * Lifecycle: the owning CliProvider writes the file before the spawn that
 * needs it (again only if it went missing), and deletes it in `cooldown()`,
 * which the session coordinator calls when a clone is evicted, its room is
 * archived or deleted, or the app shuts down, and which the vote service
 * calls after each participant. Nothing is written per turn. Files left by a
 * crashed run are removed at the next start ({@link resetChatCliInstructionsDir}).
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { asAbsolutePath, type AbsolutePath } from '../../shared/absolute-path';
import { joinAbsolute } from './absolute-path-node';
import { isPathWithin } from './path-within';

/** Folder name under Electron `userData`. */
export const CHAT_CLI_INSTRUCTIONS_DIR_NAME = 'chat-cli-instructions';
const CHAT_CLI_INSTRUCTION_FILE_EXTENSION = '.md';
const CHAT_CLI_INSTRUCTION_FILE_HASH_LENGTH = 32;

/** The instruction folder for an app data folder (`app.getPath('userData')`). */
export function chatCliInstructionsDir(userDataPath: string): AbsolutePath {
  return joinAbsolute(asAbsolutePath(userDataPath, 'chatCliInstructionsDir.userData'),
    CHAT_CLI_INSTRUCTIONS_DIR_NAME);
}

/** Deterministic file for one chat session scope and persona text. */
export function chatCliInstructionFilePath(dir: AbsolutePath, scopeKey: string, persona: string): AbsolutePath {
  const digest = createHash('sha256').update(`${scopeKey}\0${persona}`).digest('hex');
  return joinAbsolute(dir, `${digest.slice(0, CHAT_CLI_INSTRUCTION_FILE_HASH_LENGTH)}${CHAT_CLI_INSTRUCTION_FILE_EXTENSION}`);
}

/**
 * The app folder layout puts the persona file inside the CLI working folder,
 * where the CLI could read or change it. The message names both paths for
 * the log; the user sees the translated `consensus_folder_contains_app_data`
 * notice instead.
 */
export class ChatCliInstructionsInsideWorkspaceError extends Error {
  constructor(readonly instructionsDir: string, readonly cwd: string) {
    super(`[chat-cli] app folder layout is invalid: the instructions folder ${instructionsDir} ` +
      `is inside the CLI working folder ${cwd}`);
    this.name = 'ChatCliInstructionsInsideWorkspaceError';
  }
}

/** Exactly the names {@link chatCliInstructionFilePath} creates. */
const CHAT_CLI_INSTRUCTION_FILE_NAME = new RegExp(
  `^[0-9a-f]{${CHAT_CLI_INSTRUCTION_FILE_HASH_LENGTH}}${CHAT_CLI_INSTRUCTION_FILE_EXTENSION.replace('.', '\\.')}$`);

/**
 * Removes instruction files left by an earlier run (each file belongs to a
 * live CLI clone, so none can be in use at startup) and creates the folder if
 * it is missing. Only regular files named exactly like the ones this module
 * writes are deleted — never a folder, a link or any other file — so an app
 * folder layout that points user data into this folder cannot lose anything
 * here.
 */
export function resetChatCliInstructionsDir(dir: AbsolutePath): void {
  fs.mkdirSync(dir, { recursive: true });
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && CHAT_CLI_INSTRUCTION_FILE_NAME.test(entry.name)) {
      fs.unlinkSync(path.join(dir, entry.name));
    }
  }
}

/** The one instruction file a CLI provider instance owns at a time. */
export class ChatCliInstructionFile {
  private current: AbsolutePath | null = null;

  /**
   * Makes sure `file` holds `persona` before a spawn. Writes only when the
   * file is new for this owner or went missing; a different file replaces
   * (and deletes) the previous one.
   */
  prepare(file: AbsolutePath, cwd: AbsolutePath, persona: string): AbsolutePath {
    if (!persona.trim()) throw new Error('Scoped chat CLI requires a nonempty persona');
    const dir = path.dirname(file);
    if (isPathWithin(cwd, dir)) throw new ChatCliInstructionsInsideWorkspaceError(dir, cwd);
    if (this.current !== null && this.current !== file) this.discard();
    if (this.current !== file || !fs.existsSync(file)) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, persona, 'utf8');
      this.current = file;
    }
    return file;
  }

  /** Deletes the owned file. A failed delete throws; the next start's reset removes it. */
  discard(): void {
    const file = this.current;
    if (file === null) return;
    this.current = null;
    fs.rmSync(file, { force: true });
  }
}
