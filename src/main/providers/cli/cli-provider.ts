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
 * - CliSanitizer      — prompt-echo artifact removal
 * - CliPromptBuilder  — prompt/payload construction
 * - CliProcessManager — subprocess spawn/kill lifecycle
 * - CliStreamer        — async stdout reading with hang timeout
 */

import { BaseProvider, type BaseProviderInit } from '../provider-interface';
import type {
  Message,
  CompletionOptions,
} from '../../../shared/provider-types';
import type { CliPermissionAdapter } from './permission-adapter';
// NOTE: v3 CliPermissionAdapter (R2 Task 7) no longer exposes
// buildReadOnlyArgs(projectPath, consensusPath) / buildWorkerArgs(...).
// The call sites below that use the v2 shape are marked @ts-expect-error
// R2-Task21 until the wiring is migrated in Task 21.
import { consensusFolderService } from '../../ipc/handlers/workspace-handler';
import type { ParsedCliPermissionRequest } from './cli-permission-parser';
import type { CliStreamerCallbacks } from './cli-stream';

import { CliSessionState } from './cli-session-state';
import { CliOutputParser } from './cli-output-parser';
import { CliSanitizer } from './cli-sanitizer';
import { CliPromptBuilder } from './cli-prompt-builder';
import { CliProcessManager } from './cli-process';
import { CliStreamer } from './cli-stream';

// Re-export resolveWindowsCommand for any external consumers
export { resolveWindowsCommand } from './cli-process';

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
}

/** Init params for CliProvider, extending BaseProviderInit with CLI runtime config. */
export interface CliProviderInit extends BaseProviderInit {
  cliConfig: CliRuntimeConfig;
}

/** Permission mode for CLI providers. */
export type CliPermissionMode = 'read-only' | 'worker';

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
  private readonly sanitizer = new CliSanitizer();
  private readonly promptBuilder = new CliPromptBuilder();
  private readonly processManager = new CliProcessManager();
  private readonly streamer = new CliStreamer(
    this.outputParser,
    this.sanitizer,
    this.sessionState,
  );

  /** Current permission mode (read-only by default). */
  private _permissionMode: CliPermissionMode = 'read-only';

  /** Project path used by permission adapter to scope permissions. */
  private _projectPath = '.';

  /** Callback for CLI-native permission requests. Set by TurnExecutor before each turn. */
  private _permissionRequestCallback: CliPermissionRequestCallback | null = null;

  constructor(init: CliProviderInit) {
    super(init);
    this.cliConfig = init.cliConfig;
  }

  /** Current permission mode of this CLI provider. */
  get permissionMode(): CliPermissionMode {
    return this._permissionMode;
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
    try {
      if (this.cliConfig.sessionStrategy === 'persistent') {
        await this.processManager.spawnPersistent(this.getCliConfig(), this.sessionState);
      }
      const valid = await this.validateConnection();
      console.log(`[cli:warmup] ping result: valid=${valid}, command=${cmd}`);
      this.setStatus(valid ? 'ready' : 'not-installed');
    } catch (err) {
      console.warn(`[cli:warmup] failed: command=${cmd}`, err);
      this.setStatus('not-installed');
    }
  }

  async cooldown(): Promise<void> {
    this.processManager.kill();
    this.setStatus('not-installed');
  }

  /**
   * Change the CLI permission mode and respawn if persistent.
   *
   * For per-turn providers, the new permission args are applied on
   * the next call to streamCompletion via getCliConfig().
   * For persistent providers, the subprocess is killed and respawned
   * with the updated args to take effect immediately.
   *
   * If no permission adapter is configured, this is a no-op.
   */
  async respawnWithPermissions(mode: CliPermissionMode): Promise<void> {
    const adapter = this.cliConfig.permissionAdapter;
    if (!adapter) {
      console.warn(`[cli:${this.id}] No permission adapter, skipping respawnWithPermissions`);
      return;
    }

    this._permissionMode = mode;

    // For persistent sessions, kill and respawn so new args take effect
    if (this.cliConfig.sessionStrategy === 'persistent') {
      const prevSessionId = this.sessionState.sessionId;
      this.processManager.kill();
      await this.processManager.spawnPersistent(this.getCliConfig(), this.sessionState);
      // Restore session ID if it was cleared by kill
      if (prevSessionId && !this.sessionState.sessionId) {
        this.sessionState.sessionId = prevSessionId;
      }
      this.setStatus('ready');
    }

    console.info(`[cli:${this.id}] permission mode → ${mode}`);
  }

  /**
   * Set the project path used by the permission adapter to scope permissions.
   * Call this before respawnWithPermissions for accurate permission scoping.
   */
  setProjectPath(projectPath: string): void {
    this._projectPath = projectPath;
  }

  async validateConnection(): Promise<boolean> {
    try {
      return await this.ping();
    } catch {
      return false;
    }
  }

  async ping(): Promise<boolean> {
    return this.processManager.ping(this.getCliConfig());
  }

  /**
   * D-A T6 / dogfooding (#7) — drop the persistent session id so the
   * next `streamCompletion` invocation does not `--resume` an earlier
   * meeting-mode exchange. Used by `DmAutoResponder` before each DM
   * turn so CLI conversation history from prior meetings does not
   * leak its JSON format instructions into the DM reply.
   */
  override resetConversationContext(): void {
    this.sessionState.clearSession();
    this.sessionState.resetForTurn();
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

    // Warmup delay on first call (e.g., Gemini 429 avoidance)
    const config = this.getCliConfig();
    if (!this.sessionState.warmedUp && config.warmupDelay) {
      this.sessionState.warmedUp = true;
      await new Promise<void>((r) => setTimeout(r, config.warmupDelay ?? 0));
      if (signal?.aborted) return;
    }

    this.setStatus('busy');
    this.sessionState.isFirstResponse = true;
    this.sanitizer.enable(config, this.sessionState.sessionId);

    try {
      if (this.cliConfig.sessionStrategy === 'per-turn') {
        yield* this.streamPerTurn(messages, persona, options, signal);
      } else {
        yield* this.streamPersistent(messages, persona, options, signal);
      }
    } finally {
      this.sanitizer.reset();
      if (this.status === 'busy') {
        this.setStatus('ready');
      }
    }
  }

  // ── Protected helpers ─────────────────────────────────────

  /**
   * Get the CLI runtime config with permission args injected.
   * Subclasses may override for additional dynamic config.
   */
  protected getCliConfig(): CliRuntimeConfig {
    const adapter = this.cliConfig.permissionAdapter;
    if (!adapter) return this.cliConfig;

    const consensusPath = consensusFolderService.getFolderPath() ?? '';

    // R2-Task21 cleanup (dogfooding 2026-04-30 #5 root cause): the v2
    // adapter signature `buildReadOnlyArgs(projectPath, consensusPath)`
    // was removed when permission-flag-builder consolidated to a single
    // `AdapterContext` object. The two `@ts-expect-error` casts that
    // were holding the old call shape silently produced
    // `ctx.cwd === undefined`, which spawned Codex with literal `-C
    // undefined` and triggered "지정된 파일을 찾을 수 없습니다". Read-only
    // path only consumes `cwd` + `consensusPath` (`buildReadOnlyPermissionFlags`),
    // so safe defaults for `permissionMode` / `projectKind` are
    // sufficient here — the worker path's full permission resolution
    // belongs to the higher-level caller that knows the project, not
    // the provider.
    const ctx: import('./permission-adapter').AdapterContext = {
      permissionMode: 'approval',
      projectKind: 'new',
      cwd: this._projectPath,
      consensusPath,
      dangerousAutonomyOptIn: false,
    };
    const permArgs = this._permissionMode === 'worker'
      ? adapter.buildArgs(ctx)
      : adapter.buildReadOnlyArgs(ctx);

    if (permArgs.length === 0) return this.cliConfig;

    return { ...this.cliConfig, args: [...this.cliConfig.args, ...permArgs] };
  }

  // ── Private streaming strategies ──────────────────────────

  private async *streamPerTurn(
    messages: Message[],
    persona: string,
    options?: CompletionOptions,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const config = this.getCliConfig();
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

      // Extract session ID from stdout (for per-turn providers like Gemini)
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
      if (exitCode !== 0 || exitSignal) {
        const detail = stderrText || `exit code ${String(exitCode)}${exitSignal ? ` (${exitSignal})` : ''}`;
        throw new Error(`CLI command failed: ${detail}`);
      }

      const structuredError = this.outputParser.extractStructuredError(stdoutText);
      if (!yieldedAny && structuredError) {
        throw new Error(`CLI command failed: ${structuredError}`);
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
    messages: Message[],
    persona: string,
    options?: CompletionOptions,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const config = this.getCliConfig();

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

      // Build payload: JSON protocol for stdin-json, text for others
      const payload = config.inputFormat === 'stdin-json'
        ? this.promptBuilder.buildPersistentJsonPayload(messages, persona, this.sessionState.sessionId)
        : this.promptBuilder.buildStdinPayload(messages, persona, options, config, this.sessionState.sessionId);

      // Write to stdin (don't close -- process stays alive)
      try {
        proc.stdin.write(payload + '\n', (err) => {
          if (err) console.warn('[cli-provider] stdin write failed:', err.message);
        });
      } catch {
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
        const message = err instanceof Error ? err.message : String(err);
        const isHang = message.includes('hang timeout');

        if (isHang) {
          console.warn(`[cli:${config.command}] persistent hang, attempt ${attempt + 1}/2`);
          this.processManager.kill();
          if (!yieldedAny) continue; // retry once
        }

        // Partial response or non-hang error -- stop retrying
        break;
      }
    }

    // Persistent failed -- fallback to per-turn --print mode
    console.warn(`[cli:${config.command}] persistent failed, falling back to per-turn`);
    yield* this.streamFallbackPerTurn(messages, persona, options, signal);
  }

  /**
   * Fallback: spawn a disposable per-turn process with --print flag.
   * Used when the persistent process hangs or fails repeatedly.
   */
  private async *streamFallbackPerTurn(
    messages: Message[],
    persona: string,
    _options?: CompletionOptions,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const config = this.getCliConfig();
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
