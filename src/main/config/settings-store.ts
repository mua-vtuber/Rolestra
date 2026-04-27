/**
 * Settings file manager for persistent user preferences.
 *
 * Loads and saves SettingsConfig from a JSON file on disk.
 *
 * File-missing is treated as a legitimate fresh-install state and
 * defaults are returned silently. Corruption (read error, invalid
 * JSON, non-object root) is treated as a user-visible event:
 *
 *   1. The corrupt file is copied to a timestamped sidecar
 *      (`settings.json.corrupt-<iso>.json`) before defaults take over.
 *   2. A {@link SettingsCorruptionEvent} is recorded on the store and
 *      surfaced through {@link SettingsStore.takeCorruptionEvent},
 *      letting callers prompt the user to recover from the backup.
 *
 * All file operations are synchronous (project convention).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  SettingsConfig,
  SettingsCorruptionInfo,
  SettingsCorruptionReason,
} from '../../shared/config-types';
import { DEFAULT_SETTINGS } from '../../shared/config-types';

const SETTINGS_FILENAME = 'settings.json';

/**
 * Diagnostic emitted when the on-disk settings file is unreadable or
 * malformed. Callers (typically a startup orchestrator) read this via
 * {@link SettingsStore.takeCorruptionEvent} and present a recovery
 * prompt to the user.
 *
 * Re-exported from `shared/config-types` as the renderer-visible
 * shape — main and renderer use the same payload across IPC.
 */
export type SettingsCorruptionEvent = SettingsCorruptionInfo;
export type { SettingsCorruptionReason };

/**
 * Deep-merges source into target, returning a new object.
 * Only merges plain objects; arrays and primitives are overwritten.
 */
function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>,
): T {
  const result = { ...target };

  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceVal = source[key];
    const targetVal = target[key];

    if (
      sourceVal !== undefined &&
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      typeof targetVal === 'object' &&
      targetVal !== null &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      ) as T[keyof T];
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal as T[keyof T];
    }
  }

  return result;
}

/**
 * Manages persistent user settings stored as a JSON file.
 *
 * Settings are always returned as a complete SettingsConfig by
 * merging saved values over defaults. This ensures forward
 * compatibility when new settings keys are added.
 */
export class SettingsStore {
  private readonly filePath: string;
  private cache: SettingsConfig | null = null;
  private corruptionEvent: SettingsCorruptionEvent | null = null;

  /**
   * @param settingsDir - Directory where settings.json will be stored.
   *   Typically `app.getPath('userData')` in production, or a temp
   *   directory for testing.
   */
  constructor(settingsDir: string) {
    this.filePath = path.join(settingsDir, SETTINGS_FILENAME);
  }

  /**
   * Returns the current settings, merged with defaults.
   * Reads from disk on first call, then uses an in-memory cache.
   *
   * If the settings file is missing, defaults are used silently
   * (legitimate fresh-install). If the file is unreadable / malformed
   * a {@link SettingsCorruptionEvent} is recorded and the corrupt
   * file is backed up before defaults take over — call
   * {@link takeCorruptionEvent} after construction to surface it.
   */
  getSettings(): SettingsConfig {
    if (this.cache !== null) {
      return { ...this.cache };
    }

    const loaded = this.loadFromDisk();
    this.cache = deepMerge(
      DEFAULT_SETTINGS as unknown as Record<string, unknown>,
      loaded as unknown as Record<string, unknown>,
    ) as unknown as SettingsConfig;

    return { ...this.cache };
  }

  /**
   * Deep-merges a partial update into the current settings and saves to disk.
   *
   * @param patch - Partial settings to merge. Only provided keys are updated.
   */
  updateSettings(patch: Partial<SettingsConfig>): void {
    const current = this.getSettings();
    this.cache = deepMerge(
      current as unknown as Record<string, unknown>,
      patch as unknown as Record<string, unknown>,
    ) as unknown as SettingsConfig;
    this.saveToDisk(this.cache);
  }

  /**
   * Returns the path to the settings file on disk.
   */
  getFilePath(): string {
    return this.filePath;
  }

  /**
   * Returns the most recent corruption event without clearing it. Use
   * during diagnostics; production prompt flow should call
   * {@link takeCorruptionEvent} so the event fires once per recovery.
   */
  peekCorruptionEvent(): SettingsCorruptionEvent | null {
    return this.corruptionEvent;
  }

  /**
   * Returns and clears the most recent corruption event. Intended for
   * the startup orchestrator that prompts the user once per session.
   */
  takeCorruptionEvent(): SettingsCorruptionEvent | null {
    const event = this.corruptionEvent;
    this.corruptionEvent = null;
    return event;
  }

  /**
   * Attempts to load settings from disk. File missing → empty object
   * (silent default). Read failure / invalid JSON / non-object root
   * → empty object PLUS a recorded corruption event (with backup).
   */
  private loadFromDisk(): Partial<SettingsConfig> {
    if (!fs.existsSync(this.filePath)) {
      return {};
    }

    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, 'utf-8');
    } catch (err) {
      this.recordCorruption('read-error', err);
      return {};
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      this.recordCorruption('invalid-json', err);
      return {};
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      const got = Array.isArray(parsed) ? 'array' : parsed === null ? 'null' : typeof parsed;
      this.recordCorruption(
        'non-object',
        new Error(`expected JSON object at root, got ${got}`),
      );
      return {};
    }

    return parsed as Partial<SettingsConfig>;
  }

  private recordCorruption(reason: SettingsCorruptionReason, err: unknown): void {
    const backupPath = this.backupCorruptFile();
    const detail = err instanceof Error ? err.message : String(err);
    this.corruptionEvent = {
      reason,
      backupPath,
      filePath: this.filePath,
      detail,
      timestamp: Date.now(),
    };
    const backupNote = backupPath !== null
      ? `Backed up to ${backupPath}.`
      : 'Backup itself failed; corrupt file left in place.';
    console.error(
      `[SettingsStore] settings file unusable (${reason}): ${detail}. ` +
      `${backupNote} Continuing with defaults.`,
    );
  }

  /**
   * Copy the corrupt settings file to a timestamped sidecar so the
   * user can inspect / restore it manually. Returns the backup path,
   * or null if the backup itself failed (in which case the corrupt
   * file is left in place — we never destroy user data).
   */
  private backupCorruptFile(): string | null {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${this.filePath}.corrupt-${stamp}.json`;
      fs.copyFileSync(this.filePath, backupPath);
      return backupPath;
    } catch (err) {
      console.error('[SettingsStore] Failed to backup corrupt settings file:', err);
      return null;
    }
  }

  /** Writes the current settings to disk, creating directories as needed. */
  private saveToDisk(settings: SettingsConfig): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(settings, null, 2), 'utf-8');
  }
}
