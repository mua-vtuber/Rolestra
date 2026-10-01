/**
 * CLI Provider base class — abstract foundation for all CLI-based AI providers.
 *
 * Uses child_process.execFile for subprocess management.
 * On Windows, shell mode is enabled to support .cmd/.bat launcher shims.
 * Supports persistent and per-turn session strategies.
 *
 * This is a thin orchestration shell. Actual logic is delegated to:
 * - CliSessionState  — mutable per-session state
 * - CliOutputParser   — stdout parsing (stream-json, jsonl, raw)
 * - CliPromptBuilder  — prompt/payload construction
 * - CliProcessManager — subprocess spawn/kill lifecycle
 * - CliStreamer        — async stdout reading with hang timeout
 *
 * D1 (2026-09-28): removed the legacy CLI "worker" permission-mode path —
 * `respawnWithPermissions()`, the `permissionMode` getter, the
 * `CliPermissionMode` type, `_permissionMode`/`_lastWorkspace` fields, and
 * `buildWorkerAdapterContext()`. Evidence: grepping the whole repo for
 * `respawnWithPermissions(` outside this file and its own definition found
 * only two test files (cli-provider-respawn.test.ts,
 * cli-provider-subprocess.integration.test.ts) — no IPC handler, router
 * entry, or any other production caller ever invoked it, so the CLI
 * provider's permission mode could never leave its 'read-only' default in
 * a running app. `buildCliConfig()` now always calls
 * `adapter.buildReadOnlyArgs()`. `WorkerModeRequiresProjectError` (only
 * ever thrown from the removed `buildWorkerAdapterContext`) is untouched
 * in cli-workspace.ts — its own tests (cli-workspace.test.ts) still
 * exercise it directly. The 5 tests in cli-provider-respawn.test.ts and
 * the worker-mode tests in cli-provider-subprocess.integration.test.ts
 * were removed together with this dead code (see that file's own D1 note
 * for the exact count).
 */

import { BaseProvider, type BaseProviderInit } from '../provider-interface';
import { ProviderUsageLimitError } from '../provider-usage-limit-error';
import type { ConnectionFailure } from '../../../shared/connection-failure-types';
import { probeFailure } from '../connection-failure';
import type {
  ChatCliSessionOptions,
  CliWorkspaceContext,
  Message,
  CompletionOptions,
} from '../../../shared/provider-types';
import type { CliPermissionAdapter } from './permission-adapter';
import {
  asAbsolutePath,
  type AbsolutePath,
} from '../../../shared/absolute-path';
import type { ParsedCliPermissionRequest } from './cli-permission-parser';
import type { CliStreamerCallbacks } from './cli-stream';

import { CliWorkspaceRequiredError } from './cli-workspace';
import {
  applyChannelPermissionFilter,
  createPermissionFilterLogGuard,
  serializePermissionsForKey,
  type PermissionFilterLogGuard,
} from './cli-channel-permissions';
import { CliSessionState } from './cli-session-state';
import { CliOutputParser } from './cli-output-parser';
import { CliPromptBuilder } from './cli-prompt-builder';
import { CliProcessManager } from './cli-process';
import { CliStreamer } from './cli-stream';
import { chatCliInstructionArgs, chatCliIsolationArgs } from './chat-cli-isolation';
import { ChatCliInstructionFile, chatCliInstructionFilePath } from '../../files/chat-cli-instructions';
import { tryGetLogger } from '../../log/logger-accessor';

// Re-export resolveWindowsCommand for any external consumers
export { resolveWindowsCommand } from './windows-command';

/** Parsed CLI-specific config extracted from CliProviderConfig. */
export interface CliRuntimeConfig {
  command: string;
  args: string[];
  inputFormat: 'stdin-json' | 'args' | 'pipe';
  outputFormat: 'stream-json' | 'jsonl' | 'raw-stdout';
  sessionStrategy: 'persistent' | 'per-turn';
  hangTimeout: { first: number; subsequent: number };
  outputParser?: (raw: string) => string;
  /** CLI flag for passing session ID on respawn (e.g., '--session-id'). */
  sessionIdFlag?: string;
  /** Check if a stdout line signals response complete for persistent sessions. */
  responseBoundary?: (line: string) => boolean;
  /** Extract session ID from a stdout line. */
  extractSessionId?: (line: string) => string | null;
  /** Detect rate-limit from a stderr line (e.g., 429). When detected, hang timeout extends to rateLimitTimeout. */
  detectRateLimit?: (stderrLine: string) => boolean;
  /** Extended hang timeout when rate-limited (ms). */
  rateLimitTimeout?: number;
  /** Delay before the very first API call to reduce rate-limit risk (ms). */
  warmupDelay?: number;
  /** Custom arg builder for session resume (e.g., Codex uses subcommand instead of flag). */
  buildResumeArgs?: (sessionId: string, baseArgs: string[]) => string[];
  /** WSL distro name when the CLI is installed inside WSL (undefined = native). */
  wslDistro?: string;
  /** Permission adapter for state-based CLI permission control. */
  permissionAdapter?: CliPermissionAdapter;
  /** Native host cwd passed to child_process for this request. */
  cwd?: AbsolutePath;
  /** Workspace identity used to isolate persistent CLI sessions. */
  workspaceKey?: string;
}

/** Init params for CliProvider, extending BaseProviderInit with CLI runtime config. */
export interface CliProviderInit extends BaseProviderInit {
  cliConfig: CliRuntimeConfig;
}

export class ChatCliSessionMissingError extends Error {
  constructor(cause: string) {
    super(`Chat CLI session no longer exists: ${cause}`);
    this.name = 'ChatCliSessionMissingError';
  }
}

function isMissingChatSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no conversation found|no rollout found for thread id|(?:session|thread|conversation).*(?:not found|does not exist|unknown)|(?:not found|does not exist).*(?:session|thread|conversation)|failed to (?:load|find) rollout/i.test(message);
}

/**
 * Callback type for CLI native permission requests.
 *
 * Implementations should display an approval UI and return a Promise that
 * resolves to true (approved) or false (rejected).
 *
 * @param participantId - The provider/participant ID that owns the CLI process.
 * @param req - Parsed permission request data from the CLI.
 */
export type CliPermissionRequestCallback = (
  participantId: string,
  req: ParsedCliPermissionRequest,
) => Promise<boolean>;

export class CliProvider extends BaseProvider {
  protected readonly cliConfig: CliRuntimeConfig;

  // Delegated modules
  private readonly sessionState = new CliSessionState();
  private readonly outputParser = new CliOutputParser();
  private readonly promptBuilder = new CliPromptBuilder();
  private readonly processManager = new CliProcessManager();
  private readonly streamer = new CliStreamer(
    this.outputParser,
    this.sessionState,
  );

  /** Workspace currently associated with the cached CLI conversation. */
  private _activeWorkspaceKey: string | null = null;
  /**
   * WP11c 항목 8 — 채널 권한 사유 로그를 workspace 당 한 번만 남기기 위한
   * 기록장. filter 는 매 turn 도는데 사유는 workspace 가 바뀔 때만 달라진다.
   */
  private readonly permissionFilterLogGuard: PermissionFilterLogGuard =
    createPermissionFilterLogGuard();

  /** Callback for CLI-native permission requests. Set by TurnExecutor before each turn. */
  private _permissionRequestCallback: CliPermissionRequestCallback | null = null;

  /** Chat/vote only: the persona file that replaces the CLI's default system prompt. */
  private readonly chatInstructionFile = new ChatCliInstructionFile();

  constructor(init: CliProviderInit) {
    super(init);
    this.cliConfig = init.cliConfig;
  }

  /** Get the permission adapter, if configured. */
  getPermissionAdapter(): CliPermissionAdapter | null {
    return this.cliConfig.permissionAdapter ?? null;
  }

  /**
   * Register a callback to handle CLI-native permission requests.
   *
   * The callback is invoked when the CLI emits a permission_request event.
   * It should display an approval UI and return true (approved) or false (rejected).
   * Pass null to clear the callback (e.g. after the turn ends).
   */
  setPermissionRequestCallback(cb: CliPermissionRequestCallback | null): void {
    this._permissionRequestCallback = cb;
  }

  /** Build CliStreamerCallbacks from the current permission request callback. */
  private buildStreamerCallbacks(): CliStreamerCallbacks | undefined {
    if (!this._permissionRequestCallback) return undefined;
    const cb = this._permissionRequestCallback;
    return {
      onPermissionRequest: (req) => cb(this.id, req),
    };
  }

  // ── Lifecycle ─────────────────────────────────────────────

  async warmup(): Promise<void> {
    const cmd = this.cliConfig.command;
    console.log(`[cli:warmup] starting: command=${cmd}, strategy=${this.cliConfig.sessionStrategy}`);
    this.setStatus('warming-up');
    const failure = await this.checkConnection();
    console.log(`[cli:warmup] check result: ${failure === null ? 'ok' : failure.code}, command=${cmd}`);
    this.recordConnectionCheck(failure);
    this.setStatus(failure === null ? 'ready' : 'not-installed');
  }

  async cooldown(): Promise<void> {
    this.processManager.kill();
    try {
      this.chatInstructionFile.discard();
    } catch (error) {
      // Cleanup must not stop the caller from cooling down other clones; the
      // leftover file is logged here and removed at the next app start.
      const cause = error instanceof Error ? error.message : String(error);
      const logger = tryGetLogger();
      if (logger) {
        logger.error({ component: 'cli-provider', action: 'chat-instructions-discard',
          result: 'failure', metadata: { providerId: this.id, cause } });
      } else {
        console.error(`[cli-provider] chat instruction file cleanup failed (${this.id}): ${cause}`);
      }
    }
    this.setStatus('not-installed');
  }

  async validateConnection(): Promise<boolean> {
    return (await this.checkConnection()) === null;
  }

  async ping(): Promise<boolean> {
    return (await this.checkConnection()) === null;
  }

  /**
   * `<command> --version` only — no permission argv and no cwd, so the base
   * config goes in as is. Names why the CLI could not run (QA Medium-1).
   */
  async checkConnection(): Promise<ConnectionFailure | null> {
    try {
      return await this.processManager.check(this.cliConfig);
    } catch (error) {
      return probeFailure(error);
    }
  }

  /**
   * D-A T6 / dogfooding (#7) — drop any cached conversation context so
   * the next `streamCompletion` invocation starts fresh. Used by
   * `DmAutoResponder` before each DM turn so CLI history from prior
   * meetings does not leak its JSON format instructions into the DM
   * reply.
   *
   * Per-turn providers (Codex): clearing `sessionState` is
   * enough — the next call spawns a brand-new subprocess.
   *
   * Persistent providers (Claude Code): the long-running subprocess
   * keeps its own conversation memory in-process, so clearing our
   * `sessionState.sessionId` alone is insufficient — the next payload
   * still lands in a subprocess that already saw the meeting's
   * `mode_judgment` / format-instruction exchange. Kill the subprocess
   * here so `streamPersistent` respawns a fresh one on the next call.
   * Dogfooding round 2 verified that without this kill, Claude DM
   * still echoed `{name, content, mode_judgment, judgment_reason}` JSON
   * even after the wrapper sessionId was cleared.
   */
  override resetConversationContext(): void {
    this.sessionState.clearSession();
    this.sessionState.resetForTurn();
    if (this.cliConfig.sessionStrategy === 'persistent') {
      this.processManager.kill();
    }
  }

  /** Captured after a completed room turn; never exposes meeting state to the room. */
  getChatSessionId(): string | null {
    return this.sessionState.sessionId;
  }

  // ── Streaming ─────────────────────────────────────────────

  async *streamCompletion(
    messages: Message[],
    persona: string,
    options?: CompletionOptions,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    if (signal?.aborted) {
      return;
    }

    // Optional warmup delay on first call.
    const workspace = this.resolveWorkspace(options);
    const config = this.buildCliConfig(workspace, options?.chatSession, persona);
    this.ensureWorkspaceIsolation(config);
    // Scoped chat: the persona is the CLI system prompt (instruction file), never input.
    const inputPersona = options?.chatSession ? '' : persona;
    if (options?.chatSession) {
      const desired = options.chatSession.resumeSessionId;
      if (this.sessionState.sessionId !== desired) {
        this.processManager.kill();
        this.sessionState.sessionId = desired;
      }
      // Claude uses --session-id to choose a new ID; saved rooms require --resume.
      if (config.sessionStrategy === 'persistent') config.sessionIdFlag = '--resume';
    }
    if (!this.sessionState.warmedUp && config.warmupDelay) {
      this.sessionState.warmedUp = true;
      await new Promise<void>((r) => setTimeout(r, config.warmupDelay ?? 0));
      if (signal?.aborted) return;
    }

    this.setStatus('busy');
    this.sessionState.isFirstResponse = true;

    let emittedText = false;
    try {
      const stream = this.cliConfig.sessionStrategy === 'per-turn'
        ? this.streamPerTurn(config, messages, inputPersona, options, signal)
        : this.streamPersistent(config, messages, inputPersona, options, signal);
      for await (const token of stream) {
        emittedText = true;
        yield token;
      }
    } catch (error) {
      if (options?.chatSession) {
        this.processManager.kill();
        this.sessionState.clearSession();
      }
      if (options?.chatSession?.resumeSessionId && !emittedText && isMissingChatSessionError(error)) {
        throw new ChatCliSessionMissingError(error instanceof Error ? error.message : String(error));
      }
      throw error;
    } finally {
      if (this.status === 'busy') {
        this.setStatus('ready');
      }
    }
  }

  // ── Protected helpers ─────────────────────────────────────

  private buildCliConfig(workspace: CliWorkspaceContext, chat: ChatCliSessionOptions | undefined,
    persona: string): CliRuntimeConfig {
    if (chat !== undefined && !chat.scopeKey.trim()) {
      throw new Error('Scoped chat CLI requires a nonempty scope key');
    }
    // The instruction file is part of the key: a different persona respawns
    // a persistent CLI instead of reusing one started with the old prompt.
    const instructionFile = chat
      ? chatCliInstructionFilePath(chat.instructionsDir, chat.scopeKey, persona) : null;
    const workspaceKey = this.workspaceKey(workspace) +
      (chat ? `|chat:${chat.scopeKey}|${instructionFile}` : '');
    const adapter = this.cliConfig.permissionAdapter;
    if (!adapter) {
      if (chat) throw new Error('Scoped chat CLI requires a permission adapter');
      return { ...this.cliConfig, cwd: workspace.cwd, workspaceKey };
    }

    // 읽기 전용 argv 는 cwd + consensusPath 만 쓴다 (`buildReadOnlyPermissionFlags`).
    // D1 (2026-09-28): worker-mode argv (`adapter.buildArgs` +
    // `buildWorkerAdapterContext`) was removed here — no production caller
    // ever set the CLI provider's permission mode to 'worker' (that switch
    // only ever happened via `respawnWithPermissions()`, which itself had
    // no IPC channel or other production caller; see the file header).
    // Read-only argv is now unconditional.
    const readOnlyCtx: import('./permission-adapter').ReadOnlyAdapterContext = {
      cwd: this.toCliVisiblePath(workspace.cwd),
      consensusPath: this.toCliVisiblePath(workspace.consensusPath),
    };
    const baseArgs = adapter.buildReadOnlyArgs(readOnlyCtx);
    const permArgs = applyChannelPermissionFilter({
      workspace,
      baseArgs,
      adapter,
      providerId: this.id,
      workspaceKey,
      logGuard: this.permissionFilterLogGuard,
    });
    const isolationArgs = chat && instructionFile ? [
      ...chatCliIsolationArgs(adapter, readOnlyCtx.cwd),
      ...chatCliInstructionArgs(adapter,
        this.toCliVisiblePath(this.chatInstructionFile.prepare(instructionFile, workspace.cwd, persona))),
    ] : [];

    if (permArgs.length === 0 && isolationArgs.length === 0) {
      return { ...this.cliConfig, cwd: workspace.cwd, workspaceKey };
    }

    return {
      ...this.cliConfig,
      args: [...this.cliConfig.args, ...permArgs, ...isolationArgs],
      cwd: workspace.cwd,
      workspaceKey,
    };
  }

  /**
   * R12-X T4 — workspace 는 호출자가 반드시 넘긴다.
   *
   * 옛 구조는 workspace 가 없으면 합의 폴더나 `process.cwd()` 를 스스로
   * 골랐고, 그래서 DM 응답 / 회의록 요약 / 메모리 reflection 이 앱 실행
   * 폴더에서 CLI 를 띄웠다. 이제는 빠진 즉시 멈춘다.
   */
  private resolveWorkspace(options?: CompletionOptions): CliWorkspaceContext {
    const explicit = options?.cliWorkspace;
    if (!explicit) {
      throw new CliWorkspaceRequiredError(this.id);
    }
    return explicit;
  }

  /**
   * 세션 격리 키 — 값이 바뀌면 캐시된 CLI 대화를 버린다.
   *
   * 프로젝트 workspace 와 consensus-only workspace 는 cwd 가 같아도 서로
   * 다른 키를 갖는다 (scope 접두사). 권한 플래그 계산 근거가 다르므로
   * 같은 세션을 이어 쓰면 안 된다.
   */
  private workspaceKey(workspace: CliWorkspaceContext): string {
    if (workspace.scope === 'consensus-only') {
      return ['consensus-only', workspace.cwd, workspace.consensusPath].join(
        '|',
      );
    }
    return [
      'project',
      workspace.projectId,
      workspace.cwd,
      workspace.consensusPath,
      workspace.projectKind,
      workspace.permissionMode,
      workspace.dangerousAutonomyOptIn === true ? 'dangerous' : 'normal',
      // R12-W T12 — 채널 권한이 바뀌면 argv 도 바뀐다. 키에 넣지 않으면
      // 이미 떠 있는 persistent 프로세스가 옛 권한으로 계속 돌아
      // (R12-W D4) 권한 변경이 CLI 까지 닿지 못한다.
      serializePermissionsForKey(workspace.permissions),
    ].join('|');
  }

  private ensureWorkspaceIsolation(config: CliRuntimeConfig): void {
    const nextKey = config.workspaceKey ?? null;
    if (
      nextKey &&
      this._activeWorkspaceKey &&
      this._activeWorkspaceKey !== nextKey
    ) {
      this.sessionState.clearSession();
      this.sessionState.resetForTurn();
      this.processManager.kill();
    }
    this._activeWorkspaceKey = nextKey;
  }

  /**
   * Windows 네이티브 경로를 WSL 안에서 보이는 `/mnt/<drive>/...` 형태로 옮긴다.
   *
   * 반환값도 절대경로다 — 입력이 이미 `AbsolutePath` 이고, 변환 결과는 항상
   * `/mnt/` 로 시작하거나 (WSL 이 아니면) 입력 그대로다. 드라이브 문자를
   * 뽑지 못하면 변환하지 않고 throw 한다.
   */
  private toCliVisiblePath(nativePath: AbsolutePath): AbsolutePath {
    if (!this.cliConfig.wslDistro || process.platform !== 'win32') {
      return nativePath;
    }
    if (nativePath.startsWith('/')) return nativePath;

    const normalized = nativePath.replace(/\//g, '\\');
    const drive = /^([A-Za-z]):\\?(.*)$/.exec(normalized);
    if (!drive) {
      throw new Error(
        `WSL CLI workspace path must be a drive path or WSL path: ${nativePath}`,
      );
    }
    const driveLetter = drive[1];
    if (!driveLetter) {
      throw new Error(
        `WSL CLI workspace path is missing a drive letter: ${nativePath}`,
      );
    }
    const tail = drive[2]?.replace(/\\/g, '/') ?? '';
    return asAbsolutePath(
      `/mnt/${driveLetter.toLowerCase()}${tail ? `/${tail}` : ''}`,
      'CliProvider.toCliVisiblePath',
    );
  }

  // ── Private streaming strategies ──────────────────────────

  private async *streamPerTurn(
    config: CliRuntimeConfig,
    messages: Message[],
    persona: string,
    options?: CompletionOptions,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const args = this.promptBuilder.buildArgs(messages, persona, options, config, this.sessionState.sessionId);
    const child = this.processManager.spawnPerTurn(config, args);

    const stderrChunks: string[] = [];
    const stdoutChunks: string[] = [];
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;

    this.sessionState.rateLimited = false;

    if (child.stdout) {
      child.stdout.on('data', (chunk: Buffer | string) => {
        stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf-8'));
      });
    }

    if (child.stderr) {
      child.stderr.setEncoding('utf-8');
      child.stderr.on('data', (chunk: string) => {
        stderrChunks.push(chunk);
        // Detect rate-limit (e.g., 429) to extend hang timeout
        if (config.detectRateLimit) {
          for (const line of chunk.split('\n')) {
            if (config.detectRateLimit(line.trim())) {
              this.sessionState.rateLimited = true;
            }
          }
        }
      });
    }

    const exitPromise = new Promise<void>((resolve) => {
      child.on('exit', (code, sig) => {
        exitCode = code;
        exitSignal = sig;
        resolve();
      });
    });

    // Wire up abort signal
    const onAbort = (): void => {
      if (child && !child.killed) {
        child.kill('SIGTERM');
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      let yieldedAny = false;

      // Send stdin if needed
      if (
        (config.inputFormat === 'stdin-json' || config.inputFormat === 'pipe')
        && child.stdin
      ) {
        const payload = this.promptBuilder.buildStdinPayload(messages, persona, options, config, this.sessionState.sessionId);
        child.stdin.write(payload);
        child.stdin.end();
      }

      // Stream stdout (with permission request interception if callback is registered)
      for await (const token of this.streamer.readStdout(child, config, signal, this.buildStreamerCallbacks())) {
        yieldedAny = true;
        yield token;
      }

      await exitPromise;

      // Extract session ID from stdout for per-turn providers.
      if (config.extractSessionId) {
        for (const chunk of stdoutChunks) {
          for (const line of chunk.split('\n')) {
            const sid = config.extractSessionId(line.trim());
            if (sid) { this.sessionState.sessionId = sid; break; }
          }
          if (this.sessionState.sessionId) break;
        }
      }

      // Resume produced no output -> clear session so next turn sends full history
      if (config.sessionIdFlag && this.sessionState.sessionId && !yieldedAny) {
        console.warn(`[cli:${config.command}] resume produced no output, clearing session`);
        this.sessionState.clearSession();
      }

      if (signal?.aborted) {
        return;
      }

      const stderrText = stderrChunks.join('').trim();
      const stdoutText = stdoutChunks.join('').trim();
      const structuredError = this.outputParser.extractStructuredError(stdoutText);
      if (exitCode !== 0 || exitSignal) {
        if (structuredError) throw structuredError;
        const detail = stderrText || `exit code ${String(exitCode)}${exitSignal ? ` (${exitSignal})` : ''}`;
        throw this.outputParser.createProviderError(detail);
      }

      if (!yieldedAny && structuredError) {
        throw structuredError;
      }

      if (!yieldedAny && stderrText) {
        throw new Error(`CLI returned no output: ${stderrText}`);
      }

      if (!yieldedAny) {
        const sample = this.outputParser.buildOutputSample(stdoutText);
        if (sample) {
          throw new Error(`CLI returned no output: ${sample}`);
        }
        throw new Error('CLI returned no output');
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
      if (child && !child.killed) {
        child.kill('SIGTERM');
      }
    }
  }

  private async *streamPersistent(
    config: CliRuntimeConfig,
    messages: Message[],
    persona: string,
    options?: CompletionOptions,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    for (let attempt = 0; attempt < 2; attempt++) {
      // Ensure persistent process is alive
      if (!this.processManager.process || this.processManager.process.killed) {
        await this.processManager.spawnPersistent(config, this.sessionState);
      }

      const proc = this.processManager.process;
      if (!proc?.stdin || !proc?.stdout) {
        console.warn(`[cli:${config.command}] persistent process missing stdin/stdout, attempt ${attempt + 1}/2`);
        this.processManager.kill();
        continue;
      }

      let stderrTail = '';
      const onStderr = (chunk: Buffer | string): void => {
        stderrTail = (stderrTail + chunk.toString()).slice(-1024);
      };
      proc.stderr?.on('data', onStderr);

      // Build payload: JSON protocol for stdin-json, text for others
      const payload = config.inputFormat === 'stdin-json'
        ? this.promptBuilder.buildPersistentJsonPayload(messages, persona, this.sessionState.sessionId, options?.chatSession)
        : this.promptBuilder.buildStdinPayload(messages, persona, options, config, this.sessionState.sessionId);

      // Write to stdin (don't close -- process stays alive)
      try {
        proc.stdin.write(payload + '\n', (err) => {
          if (err) console.warn('[cli-provider] stdin write failed:', err.message);
        });
      } catch {
        proc.stderr?.removeListener('data', onStderr);
        this.processManager.kill();
        continue; // retry with new process
      }

      let yieldedAny = false;
      try {
        // Use line-buffered reader with boundary detection when available
        // Pass permission request callbacks for stream-json format interception
        const streamerCallbacks = this.buildStreamerCallbacks();
        const reader = config.responseBoundary
          ? this.streamer.readPersistentResponse(proc, config, signal, streamerCallbacks)
          : this.streamer.readStdout(proc, config, signal, streamerCallbacks);

        for await (const token of reader) {
          yieldedAny = true;
          yield token;
        }
        return; // success
      } catch (err) {
        if (err instanceof ProviderUsageLimitError) throw err;
        if (options?.chatSession) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes('error_during_execution') && !stderrTail) {
            await new Promise<void>((resolve) => setTimeout(resolve, 100));
          }
          throw new Error(`${message}${stderrTail ? `: ${stderrTail.trim()}` : ''}`);
        }
        const message = err instanceof Error ? err.message : String(err);
        const isHang = message.includes('hang timeout');

        if (isHang) {
          console.warn(`[cli:${config.command}] persistent hang, attempt ${attempt + 1}/2`);
          this.processManager.kill();
          if (!yieldedAny) continue; // retry once
        }

        // Partial response or non-hang error -- stop retrying
        break;
      } finally {
        proc.stderr?.removeListener('data', onStderr);
      }
    }

    if (options?.chatSession) throw new Error('Scoped chat CLI session failed before producing a response');

    // Persistent failed -- fallback to per-turn --print mode
    console.warn(`[cli:${config.command}] persistent failed, falling back to per-turn`);
    yield* this.streamFallbackPerTurn(config, messages, persona, options, signal);
  }

  /**
   * Fallback: spawn a disposable per-turn process with --print flag.
   * Used when the persistent process hangs or fails repeatedly.
   */
  private async *streamFallbackPerTurn(
    config: CliRuntimeConfig,
    messages: Message[],
    persona: string,
    _options?: CompletionOptions,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    // Strip --input-format and its value: --print takes plain text input, not stream-json
    const filteredArgs = config.args.filter(
      (arg, i, arr) => arg !== '--input-format' && !(i > 0 && arr[i - 1] === '--input-format'),
    );
    const args = ['--print', ...filteredArgs];

    // Add session ID for conversation continuity
    if (config.sessionIdFlag && this.sessionState.sessionId) {
      args.push(config.sessionIdFlag, this.sessionState.sessionId);
    }

    const child = this.processManager.spawnPerTurn(config, args);

    if (child.stdin) {
      // With session: latest message only. Without: full history.
      let prompt: string;
      if (this.sessionState.sessionId && messages.length > 0) {
        const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
        prompt = lastUserMsg
          ? (typeof lastUserMsg.content === 'string'
              ? lastUserMsg.content
              : lastUserMsg.content
                  .map(b => (b.type === 'text' ? String(b.data) : ''))
                  .join(''))
          : this.promptBuilder.buildTextPrompt(messages, persona);
      } else {
        prompt =
          this.promptBuilder.buildTextPrompt(messages, persona) +
          '\n\nRespond now. Do NOT repeat or echo any text from the history above.\n\n[[[START_OF_RESPONSE]]]\nAssistant:';
      }
      child.stdin.write(prompt);
      child.stdin.end(); // EOF triggers --print processing
    }

    const stderrChunks: string[] = [];
    child.stderr?.setEncoding('utf-8');
    child.stderr?.on('data', (chunk: string) => stderrChunks.push(chunk));

    let yieldedAny = false;
    for await (const token of this.streamer.readStdout(child, config, signal)) {
      yieldedAny = true;

      // Also extract session ID from fallback output
      if (config.extractSessionId) {
        const sid = config.extractSessionId(token);
        if (sid) this.sessionState.sessionId = sid;
      }

      yield token;
    }

    await new Promise<void>((resolve) => { child.on('exit', () => resolve()); });

    if (!yieldedAny) {
      const stderr = stderrChunks.join('').trim();
      throw new Error(`CLI fallback returned no output${stderr ? `: ${stderr}` : ''}`);
    }
  }
}
