/**
 * Provider type definitions shared between main and renderer.
 *
 * These types define the contract for all AI providers (API, CLI, Local).
 * The renderer uses ProviderInfo (serializable) for display;
 * the main process uses these types plus BaseProvider (non-serializable).
 */

import type { RoleId } from './role-types';

/** Provider capability flags for runtime feature detection. */
export type ProviderCapability =
  | 'streaming'
  | 'resume'
  | 'tools'
  | 'json-mode'
  | 'multimodal'
  | 'code-execution'
  // R11-Task5: 회의록 요약 / 메모 압축에 안정적인 1-shot 응답을 낼 수 있는
  // provider 임을 표시한다. R11-Task9 가 6 provider config 갱신 + meeting
  // -summary-service 의 'streaming' 임시 우회를 'summarize' fallback chain 으로
  // 교체한다.
  | 'summarize';

/** Provider type discriminator. */
export type ProviderType = 'api' | 'cli' | 'local';

/** Runtime provider status. */
export type ProviderStatus =
  | 'ready'
  | 'warming-up'
  | 'busy'
  | 'error'
  | 'not-installed';

/**
 * Discriminated union for provider configuration.
 * The `type` field determines which additional fields are present.
 */
export type ProviderConfig =
  | ApiProviderConfig
  | CliProviderConfig
  | LocalProviderConfig;

export interface ApiProviderConfig {
  type: 'api';
  endpoint: string;
  /** Reference key for safeStorage — never a raw API key. */
  apiKeyRef: string;
  model: string;
}

export interface CliProviderConfig {
  type: 'cli';
  command: string;
  args: string[];
  inputFormat: 'stdin-json' | 'args' | 'pipe';
  outputFormat: 'stream-json' | 'jsonl' | 'raw-stdout';
  sessionStrategy: 'persistent' | 'per-turn';
  hangTimeout: { first: number; subsequent: number };
  model: string;
  /** WSL distro name when the CLI is installed inside WSL (undefined = native). */
  wslDistro?: string;
}

export interface LocalProviderConfig {
  type: 'local';
  baseUrl: string;
  model: string;
}

/** Chat message for provider communication. */
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentBlock[];
  /** Speaker name in multi-party conversations. */
  name?: string;
  metadata?: Record<string, unknown>;
}

/** Content block for multimodal messages. */
export interface ContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result';
  data: unknown;
}

/** Options for completion requests. */
export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  [key: string]: unknown;
}

/** Tool definition for tool-capable providers. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * Serializable provider info for IPC transport.
 * Unlike BaseProvider, this contains no methods — safe for contextBridge.
 */
export interface ProviderInfo {
  id: string;
  type: ProviderType;
  displayName: string;
  model: string;
  capabilities: ProviderCapability[];
  status: ProviderStatus;
  config: ProviderConfig;
  persona?: string;
  /** R12-S: 직원에게 부여된 능력 (다중 가능, 빈 배열 = 어떤 부서도 못 들어감). */
  roles: RoleId[];
  /** R12-S: 능력별 사용자 customize prompt — null = 카탈로그 default. */
  skill_overrides: Record<RoleId, string> | null;
}
