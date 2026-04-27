/**
 * Configuration system type definitions.
 *
 * Three-layer config architecture:
 * 1. settings — persistent user preferences (JSON file)
 * 2. secrets  — API keys stored via Electron safeStorage
 * 3. runtime  — in-memory overrides (lost on restart)
 */

// ── Settings Layer ─────────────────────────────────────────────────

/** User-facing memory system settings (Phase 3-b). */
export interface MemorySettings {
  /** Whether the memory system is active. */
  enabled: boolean;
  /** Provider ID to use for embedding generation (Phase 3-b). null = disabled. */
  embeddingProviderId: string | null;
  /** Provider ID to use for reflection/insight generation (Phase 3-b). null = disabled. */
  reflectionProviderId: string | null;
  /** Enable vector search (requires embeddingProviderId). */
  vectorSearchEnabled: boolean;
  /** Enable knowledge graph expansion. */
  graphEnabled: boolean;
  /** Total token budget for memory context assembly. */
  contextBudget: number;
  /** Maximum retrieval results per query. */
  retrievalLimit: number;
  /** Minimum new nodes before triggering reflection. */
  reflectionThreshold: number;
  /** Embedding model identifier (e.g. 'text-embedding-3-small'). */
  embeddingModel: string;
}

/** Default memory settings. */
export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  enabled: true,
  embeddingProviderId: null,
  reflectionProviderId: null,
  vectorSearchEnabled: false,
  graphEnabled: false,
  contextBudget: 4096,
  retrievalLimit: 10,
  reflectionThreshold: 10,
  embeddingModel: 'text-embedding-3-small',
};

/** Conversation/task-mode behavior settings (final agreement model). */
export interface ConversationTaskSettings {
  /** Maximum turns allowed in deep debate mode. */
  deepDebateTurnBudget: number;
  /** Parse retries before forcing ABSTAIN for malformed AI decision payloads. */
  aiDecisionParseRetryLimit: number;
  /** Whether two-participant sessions require unanimity. */
  twoParticipantUnanimousRequired: boolean;
  /** Participant count where majority voting is allowed. */
  majorityAllowedFromParticipants: number;
  /** Hard-block reason types that stop execution immediately. */
  hardBlockReasonTypes: Array<'security' | 'data_loss'>;
  /** Soft-block reason types that require explicit user confirmation. */
  softBlockReasonTypes: Array<'spec_conflict' | 'unknown'>;
  /** Behavior when execute/review fails and user decision is required. */
  failureResolutionOptions: Array<'retry' | 'stop' | 'reassign'>;
}

export const DEFAULT_CONVERSATION_TASK_SETTINGS: ConversationTaskSettings = {
  deepDebateTurnBudget: 30,
  aiDecisionParseRetryLimit: 2,
  twoParticipantUnanimousRequired: true,
  majorityAllowedFromParticipants: 3,
  hardBlockReasonTypes: ['security', 'data_loss'],
  softBlockReasonTypes: ['spec_conflict', 'unknown'],
  failureResolutionOptions: ['retry', 'stop', 'reassign'],
};

/** Persistent user-facing settings. Stored as JSON. */
export interface SettingsConfig {
  /** Schema version for settings migration. */
  version: number;
  /** UI theme. */
  uiTheme: 'light' | 'dark';
  /** UI language code. */
  language: string;
  /** Default round count for conversations. */
  defaultRounds: number | 'unlimited';
  /** Soft token limit per turn. */
  softTokenLimit: number;
  /** Hard token limit per turn. */
  hardTokenLimit: number;
  /** Maximum retries for consensus failure. */
  maxRetries: number;
  /** Phase timeout in milliseconds. */
  phaseTimeoutMs: number;
  /** Default aggregator strategy for consensus. */
  aggregatorStrategy: 'strongest' | 'last-speaker' | 'designated' | 'round-robin';
  /** Designated aggregator/facilitator ID for consensus (empty = auto). */
  designatedAggregatorId: string;
  /** Whether .arena git management is enabled. */
  arenaGitManagementEnabled: boolean;
  /** Memory system settings (Phase 3-b). */
  memorySettings: MemorySettings;
  /** Conversation/task mode policy settings. */
  conversationTask: ConversationTaskSettings;
  /** Custom path for consensus folder. Empty string = platform default (~/Documents/AI_Chat_Arena). */
  consensusFolderPath: string;
  /** Custom path for ArenaRoot directory. Empty string = platform default (~/Documents/arena). */
  arenaRoot: string;
  /**
   * F4-Task1: user-configurable Ollama HTTP endpoint for the local
   * provider catalog probe + warmup. Empty string defers to the
   * `OLLAMA_HOST` env var, then to `http://localhost:11434`. See
   * `src/main/providers/ollama-endpoint-resolver.ts` for the priority
   * chain (settings → env → fallback). The empty default avoids a
   * silent override of an existing per-provider `LocalProviderConfig.baseUrl`
   * — only the catalog probe + new-provider default reads this key.
   */
  ollamaEndpoint: string;
  /**
   * R11-Task8 (D5): per-provider USD unit price for the LLM 사용량 카드.
   * Keys are `providerId` (registry id), values are USD per 1,000,000
   * tokens — the unit every major provider publishes their pricing in.
   * The default empty record makes `estimatedUsd` null in the Settings
   * card so untouched installs surface "단가 미설정" instead of $0.
   * Updates flow through `config:update-settings` like any other key.
   */
  llmCostUsdPerMillionTokens: Record<string, number>;
}

/** Default settings values. */
export const DEFAULT_SETTINGS: SettingsConfig = {
  version: 1,
  uiTheme: 'dark',
  language: 'ko',
  defaultRounds: 3,
  softTokenLimit: 3000,
  hardTokenLimit: 4000,
  maxRetries: 3,
  phaseTimeoutMs: 60_000,
  aggregatorStrategy: 'strongest',
  designatedAggregatorId: '',
  arenaGitManagementEnabled: false,
  memorySettings: DEFAULT_MEMORY_SETTINGS,
  conversationTask: DEFAULT_CONVERSATION_TASK_SETTINGS,
  consensusFolderPath: '',
  arenaRoot: '',
  ollamaEndpoint: '',
  llmCostUsdPerMillionTokens: {},
};

// ── Secrets Layer ──────────────────────────────────────────────────

/**
 * A reference to a secret stored in OS keychain via safeStorage.
 * The actual value is never stored in config files or DB.
 */
export interface SecretRef {
  /** Human-readable label. */
  label: string;
  /** Keychain key used with safeStorage. */
  keychainKey: string;
  /** Provider ID this secret belongs to. */
  providerId?: string;
  /** When the secret was last updated. */
  updatedAt: string;
}

/** Secrets registry: maps logical key names to keychain references. */
export interface SecretsRegistry {
  /** Provider API key references. Key = providerId. */
  providers: Record<string, SecretRef>;
}

// ── Startup Diagnostics ────────────────────────────────────────────

/** Why the on-disk settings file could not be read as a SettingsConfig. */
export type SettingsCorruptionReason =
  | 'read-error'
  | 'invalid-json'
  | 'non-object';

/**
 * Diagnostic emitted when the on-disk settings file is unreadable or
 * malformed. Surfaced to the renderer via
 * `config:take-startup-diagnostics` so a recovery prompt can show
 * the user where their original file was backed up.
 */
export interface SettingsCorruptionInfo {
  reason: SettingsCorruptionReason;
  /** Absolute path of the timestamped backup, or null if backup failed. */
  backupPath: string | null;
  /** Original file path that was corrupt. */
  filePath: string;
  /** Underlying error message. */
  detail: string;
  /** Unix epoch ms. */
  timestamp: number;
}

// ── Runtime Overrides Layer ────────────────────────────────────────

/** Ephemeral in-memory overrides. Lost on app restart. */
export interface RuntimeOverrides {
  debugMode?: boolean;
  /** Temporary API endpoint overrides. Key = providerId. */
  temporaryEndpoints?: Record<string, string>;
  /** Temporary log level override. */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

// ── Secret Scanner ─────────────────────────────────────────────────

/** Pattern for detecting leaked secrets in text. */
export interface SecretPattern {
  /** Provider or service name. */
  name: string;
  /** Regex patterns to match the secret format. */
  patterns: RegExp[];
  /** Replacement string for masking. */
  replacement: string;
}

/** Result of scanning text for secrets. */
export interface SecretScanResult {
  /** Whether any secrets were detected. */
  detected: boolean;
  /** The masked version of the text. */
  masked: string;
  /** Warnings about detected secrets. */
  warnings: string[];
}

