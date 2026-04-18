/**
 * Settings file manager for persistent user preferences.
 *
 * Loads and saves SettingsConfig from a JSON file on disk.
 * Handles missing or corrupt files gracefully by falling back to defaults.
 * All file operations are synchronous (project convention).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SettingsConfig } from '../../shared/config-types';
import { DEFAULT_SETTINGS } from '../../shared/config-types';

const SETTINGS_FILENAME = 'settings.json';

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
   * Falls back to defaults if the file is missing or corrupt.
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

  /** Attempts to load settings from disk. Returns empty object on failure. */
  private loadFromDisk(): Partial<SettingsConfig> {
    try {
      if (!fs.existsSync(this.filePath)) {
        return {};
      }
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);

      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return {};
      }

      return parsed as Partial<SettingsConfig>;
    } catch (err) {
      console.error('[SettingsStore] Failed to load settings from disk, using defaults:', err);
      return {};
    }
  }

  /** Writes the current settings to disk, creating directories as needed. */
  private saveToDisk(settings: SettingsConfig): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(settings, null, 2), 'utf-8');
  }
}
