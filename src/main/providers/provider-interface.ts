/**
 * Abstract base class for all AI providers.
 *
 * Subclasses (ApiProvider, CliProvider, LocalProvider) implement
 * the abstract methods for their specific transport mechanism.
 *
 * Design: capability-based branching, not type-based.
 * Use provider.capabilities.has('streaming') instead of provider.type === 'api'.
 */

import type {
  ProviderType,
  ProviderCapability,
  ProviderConfig,
  ProviderStatus,
  ProviderInfo,
  Message,
  CompletionOptions,
} from '../../shared/provider-types';
import type { RoleId } from '../../shared/role-types';

export interface BaseProviderInit {
  id: string;
  type: ProviderType;
  displayName: string;
  model: string;
  persona?: string;
  capabilities: ProviderCapability[];
  config: ProviderConfig;
  /** R12-S: 직원에게 부여된 능력 (다중 가능). 미지정 시 빈 배열. */
  roles?: RoleId[];
  /** R12-S: 능력별 사용자 customize prompt. null = 카탈로그 default. */
  skill_overrides?: Partial<Record<RoleId, string>> | null;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export abstract class BaseProvider {
  readonly id: string;
  readonly type: ProviderType;
  displayName: string;
  model: string;
  persona: string;
  readonly capabilities: Set<ProviderCapability>;
  config: ProviderConfig;
  /** R12-S: 직원 부여 능력. provider:updateRoles 로 갱신. */
  roles: RoleId[];
  /** R12-S: 능력별 customize prompt. null = 카탈로그 default. */
  skill_overrides: Partial<Record<RoleId, string>> | null;

  protected status: ProviderStatus = 'not-installed';
  private statusListeners: Array<(status: ProviderStatus) => void> = [];
  private lastTokenUsage: TokenUsage | null = null;

  constructor(init: BaseProviderInit) {
    this.id = init.id;
    this.type = init.type;
    this.displayName = init.displayName;
    this.model = init.model;
    this.persona = init.persona ?? '';
    this.capabilities = new Set(init.capabilities);
    this.config = init.config;
    this.roles = init.roles ?? [];
    this.skill_overrides = init.skill_overrides ?? null;
  }

  /** Prepare provider for use (pre-connect, load model, etc.). */
  abstract warmup(): Promise<void>;

  /** Release resources when provider is no longer active. */
  abstract cooldown(): Promise<void>;

  /** Full connection validation (may be slow). */
  abstract validateConnection(): Promise<boolean>;

  /** Lightweight health check between turns. */
  abstract ping(): Promise<boolean>;

  /**
   * Generate a streaming completion.
   * Yields text tokens as they arrive.
   */
  abstract streamCompletion(
    messages: Message[],
    persona: string,
    options?: CompletionOptions,
    signal?: AbortSignal,
  ): AsyncGenerator<string>;

  /**
   * Drop any cached conversation context so the next `streamCompletion`
   * call starts a fresh exchange. CLI providers persist a `sessionId`
   * across calls (Claude Code `--resume`, etc.) so once a meeting puts
   * the CLI into "format JSON with mode_judgment" mode, every later
   * call inherits the format instruction — including DM. Default is a
   * no-op for stateless providers (API).
   *
   * D-A T6 dogfooding (#7): without this, opening a DM with a CLI
   * provider after a meeting produces raw JSON `mode_judgment` output
   * because the CLI session is still in meeting mode.
   */
  resetConversationContext(): void {
    // default: no-op for stateless providers (API)
  }

  isReady(): boolean {
    return this.status === 'ready';
  }

  getStatus(): ProviderStatus {
    return this.status;
  }

  protected setStatus(newStatus: ProviderStatus): void {
    if (this.status === newStatus) return;
    this.status = newStatus;
    for (const listener of this.statusListeners) {
      listener(newStatus);
    }
  }

  onStatusChange(callback: (status: ProviderStatus) => void): () => void {
    this.statusListeners.push(callback);
    return () => {
      this.statusListeners = this.statusListeners.filter(l => l !== callback);
    };
  }

  clearLastTokenUsage(): void {
    this.lastTokenUsage = null;
  }

  consumeLastTokenUsage(): TokenUsage | null {
    const usage = this.lastTokenUsage;
    this.lastTokenUsage = null;
    return usage;
  }

  getLastTokenUsage(): TokenUsage | null {
    return this.lastTokenUsage;
  }

  protected setLastTokenUsage(usage: TokenUsage): void {
    this.lastTokenUsage = usage;
  }

  /** Serialize to IPC-safe ProviderInfo (no methods). */
  toInfo(): ProviderInfo {
    return {
      id: this.id,
      type: this.type,
      displayName: this.displayName,
      model: this.model,
      capabilities: [...this.capabilities],
      status: this.status,
      config: this.config,
      persona: this.persona || undefined,
      roles: [...this.roles],
      skill_overrides:
        this.skill_overrides === null ? null : { ...this.skill_overrides },
    };
  }
}
