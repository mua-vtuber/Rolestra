/**
 * Unified config coordinator combining settings, secrets, and runtime layers.
 *
 * Provides a single interface for all configuration needs:
 * - Settings: persistent user preferences from JSON file
 * - Secrets: encrypted API keys via safeStorage
 * - Runtime: ephemeral in-memory overrides
 *
 * Resolution order for get<K>(): runtime override > settings value.
 */

import type { SettingsConfig, RuntimeOverrides } from '../../shared/config-types';
import { SettingsStore, type SettingsCorruptionEvent } from './settings-store';
import { SecretStore, type SafeStorageAdapter } from './secret-store';

/** Options for constructing ConfigServiceImpl. */
export interface ConfigServiceOptions {
  /** Directory for settings.json file. */
  settingsDir: string;
  /** Directory for secrets.enc.json file. */
  secretsDir: string;
  /** SafeStorageAdapter for secret encryption. */
  safeStorageAdapter: SafeStorageAdapter;
}

/**
 * Unified config service combining all three configuration layers.
 *
 * - Settings layer: persistent user preferences (SettingsStore)
 * - Secrets layer: encrypted API keys (SecretStore)
 * - Runtime layer: in-memory overrides (lost on restart)
 *
 * The get() method resolves values with runtime overrides taking
 * precedence over persisted settings.
 */
export class ConfigServiceImpl {
  private readonly settingsStore: SettingsStore;
  private readonly secretStore: SecretStore;
  private runtime: RuntimeOverrides = {};

  constructor(options: ConfigServiceOptions) {
    this.settingsStore = new SettingsStore(options.settingsDir);
    this.secretStore = new SecretStore(options.secretsDir, options.safeStorageAdapter);
  }

  // ── Settings Layer ───────────────────────────────────────────────

  /** Returns the full settings config merged with defaults. */
  getSettings(): SettingsConfig {
    return this.settingsStore.getSettings();
  }

  /** Deep-merges a partial update into the persisted settings. */
  updateSettings(patch: Partial<SettingsConfig>): void {
    this.settingsStore.updateSettings(patch);
  }

  /**
   * Returns and clears the most recent settings-file corruption event.
   * The startup orchestrator calls this once per session to surface a
   * recovery prompt to the user.
   */
  takeSettingsCorruption(): SettingsCorruptionEvent | null {
    return this.settingsStore.takeCorruptionEvent();
  }

  /**
   * Returns the most recent settings-file corruption event without
   * clearing it. Use for diagnostics / read-only checks.
   */
  peekSettingsCorruption(): SettingsCorruptionEvent | null {
    return this.settingsStore.peekCorruptionEvent();
  }

  // ── Secrets Layer ────────────────────────────────────────────────

  /** Stores an encrypted secret. */
  setSecret(key: string, value: string): void {
    this.secretStore.setSecret(key, value);
  }

  /** Retrieves and decrypts a secret, or returns null if not found. */
  getSecret(key: string): string | null {
    return this.secretStore.getSecret(key);
  }

  /** Removes a secret by key. */
  deleteSecret(key: string): void {
    this.secretStore.deleteSecret(key);
  }

  /** Returns all stored secret key names. */
  listSecretKeys(): string[] {
    return this.secretStore.listKeys();
  }

  // ── Runtime Layer ────────────────────────────────────────────────

  /** Returns the current runtime overrides. */
  getRuntime(): RuntimeOverrides {
    return { ...this.runtime };
  }

  /** Merges a partial update into the runtime overrides. */
  setRuntime(patch: Partial<RuntimeOverrides>): void {
    this.runtime = { ...this.runtime, ...patch };
  }

  /** Clears all runtime overrides. */
  clearRuntime(): void {
    this.runtime = {};
  }

  // ── Resolved Values ──────────────────────────────────────────────

  /**
   * Resolves a settings key with runtime override precedence.
   *
   * Resolution order:
   * 1. Runtime override (if the key exists in RuntimeOverrides and is set)
   * 2. Persisted settings value (merged with defaults)
   *
   * @param key - A key from SettingsConfig.
   * @returns The resolved value.
   */
  get<K extends keyof SettingsConfig>(key: K): SettingsConfig[K] {
    // Check if the key exists as a runtime override
    if (key in this.runtime) {
      const runtimeValue = this.runtime[key as keyof RuntimeOverrides];
      if (runtimeValue !== undefined) {
        return runtimeValue as unknown as SettingsConfig[K];
      }
    }

    return this.getSettings()[key];
  }

  // ── Internal Access (for testing) ────────────────────────────────

  /** Returns the underlying SettingsStore instance. */
  getSettingsStore(): SettingsStore {
    return this.settingsStore;
  }

  /** Returns the underlying SecretStore instance. */
  getSecretStore(): SecretStore {
    return this.secretStore;
  }
}
