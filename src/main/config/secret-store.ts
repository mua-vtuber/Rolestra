/**
 * safeStorage-based secret management.
 *
 * Stores encrypted secrets in a JSON file with values encoded as base64.
 * Uses a SafeStorageAdapter interface so the real Electron safeStorage
 * can be swapped with a mock for testing.
 *
 * All file operations are synchronous (project convention).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const SECRETS_FILENAME = 'secrets.enc.json';

/**
 * Abstraction over Electron's safeStorage module.
 * Allows dependency injection for testability.
 */
export interface SafeStorageAdapter {
  /** Whether OS-level encryption is available. */
  isEncryptionAvailable(): boolean;
  /** Encrypts a plaintext string into a Buffer. */
  encryptString(plaintext: string): Buffer;
  /** Decrypts an encrypted Buffer back to a plaintext string. */
  decryptString(encrypted: Buffer): string;
}

/** On-disk shape: key -> base64-encoded encrypted value. */
interface SecretsFile {
  [key: string]: string;
}

/**
 * Manages encrypted secrets persisted to a JSON file.
 *
 * Each secret value is encrypted via SafeStorageAdapter before storage
 * and stored as a base64 string. When encryption is unavailable,
 * set/get operations throw rather than storing plaintext.
 */
export class SecretStore {
  /** Valid key name pattern: alphanumeric, underscore, hyphen, 1-64 chars. */
  private static readonly KEY_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

  private readonly filePath: string;
  private readonly adapter: SafeStorageAdapter;
  private cache: SecretsFile | null = null;

  /**
   * @param secretsDir - Directory where secrets.enc.json will be stored.
   * @param adapter - SafeStorageAdapter implementation (real or mock).
   */
  constructor(secretsDir: string, adapter: SafeStorageAdapter) {
    this.filePath = path.join(secretsDir, SECRETS_FILENAME);
    this.adapter = adapter;
  }

  /**
   * Stores an encrypted secret.
   *
   * @param key - Logical key name (e.g., provider ID).
   * @param value - Plaintext secret value to encrypt and store.
   * @throws {Error} If encryption is not available.
   */
  setSecret(key: string, value: string): void {
    this.validateKeyName(key);
    this.ensureEncryptionAvailable();
    const data = this.loadFromDisk();
    const encrypted = this.adapter.encryptString(value);
    data[key] = encrypted.toString('base64');
    this.cache = data;
    this.saveToDisk(data);
  }

  /**
   * Retrieves and decrypts a secret by key.
   *
   * @param key - Logical key name.
   * @returns The decrypted plaintext, or null if not found.
   * @throws {Error} If encryption is not available.
   */
  getSecret(key: string): string | null {
    this.validateKeyName(key);
    this.ensureEncryptionAvailable();
    const data = this.loadFromDisk();
    const base64Value = data[key];

    if (base64Value === undefined) {
      return null;
    }

    const encrypted = Buffer.from(base64Value, 'base64');
    return this.adapter.decryptString(encrypted);
  }

  /**
   * Removes a secret by key.
   *
   * @param key - Logical key name to delete.
   */
  deleteSecret(key: string): void {
    this.validateKeyName(key);
    const data = this.loadFromDisk();

    if (!(key in data)) {
      return;
    }

    const filtered: SecretsFile = {};
    for (const [k, v] of Object.entries(data)) {
      if (k !== key) {
        filtered[k] = v;
      }
    }
    this.cache = filtered;
    this.saveToDisk(filtered);
  }

  /**
   * Returns all stored secret keys (without decrypting values).
   */
  listKeys(): string[] {
    const data = this.loadFromDisk();
    return Object.keys(data);
  }

  /**
   * Returns whether the underlying encryption is available.
   */
  isAvailable(): boolean {
    return this.adapter.isEncryptionAvailable();
  }

  /**
   * Returns the path to the secrets file on disk.
   */
  getFilePath(): string {
    return this.filePath;
  }

  /** Keys that could cause prototype pollution and must be blocked. */
  private static readonly BLOCKED_KEYS: ReadonlySet<string> = new Set([
    '__proto__',
    'constructor',
    'prototype',
    '__defineGetter__',
    '__defineSetter__',
    '__lookupGetter__',
    '__lookupSetter__',
  ]);

  /** Throws if the key name is invalid or could cause prototype pollution. */
  private validateKeyName(key: string): void {
    if (!SecretStore.KEY_PATTERN.test(key) || SecretStore.BLOCKED_KEYS.has(key)) {
      throw new Error(`Invalid secret key name: "${key}". Must match /^[a-zA-Z0-9_-]{1,64}$/ and not be a reserved name.`);
    }
  }

  /** Throws if encryption is not available. */
  private ensureEncryptionAvailable(): void {
    if (!this.adapter.isEncryptionAvailable()) {
      throw new Error(
        'Encryption is not available. Cannot store secrets without OS-level encryption.',
      );
    }
  }

  /** Loads the secrets file from disk. Returns empty object on failure. */
  private loadFromDisk(): SecretsFile {
    if (this.cache !== null) {
      return { ...this.cache };
    }

    try {
      if (!fs.existsSync(this.filePath)) {
        const empty = Object.create(null) as SecretsFile;
        this.cache = empty;
        return Object.create(null) as SecretsFile;
      }

      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);

      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        const empty = Object.create(null) as SecretsFile;
        this.cache = empty;
        return Object.create(null) as SecretsFile;
      }

      const safe = Object.create(null) as SecretsFile;
      Object.assign(safe, parsed);
      this.cache = safe;
      return { ...safe };
    } catch (err) {
      console.error('[SecretStore] Failed to load secrets from disk, using empty store:', err);
      const empty = Object.create(null) as SecretsFile;
      this.cache = empty;
      return Object.create(null) as SecretsFile;
    }
  }

  /** Writes the secrets file to disk, creating directories as needed. */
  private saveToDisk(data: SecretsFile): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
  }
}
