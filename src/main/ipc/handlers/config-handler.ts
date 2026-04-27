/**
 * IPC handlers for config:* channels.
 *
 * Bridges renderer config requests to ConfigServiceImpl.
 */

import type {
  SettingsConfig,
  SettingsCorruptionInfo,
} from '../../../shared/config-types';
import { getConfigService } from '../../config/instance';
import { reconfigureMemoryFacade } from '../../memory/instance';

export function handleConfigGetSettings(): { settings: SettingsConfig } {
  return { settings: getConfigService().getSettings() };
}

export function handleConfigUpdateSettings(
  data: { patch: Partial<SettingsConfig> },
): { settings: SettingsConfig } {
  const svc = getConfigService();
  svc.updateSettings(data.patch);

  // Reconfigure the memory facade when memory settings change
  if (data.patch.memorySettings) {
    try {
      reconfigureMemoryFacade();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Memory reconfiguration failed after settings update: ${message}`);
    }
  }

  return { settings: svc.getSettings() };
}

export function handleConfigSetSecret(data: { key: string; value: string }): { success: true } {
  getConfigService().setSecret(data.key, data.value);
  return { success: true };
}

export function handleConfigDeleteSecret(data: { key: string }): { success: true } {
  getConfigService().deleteSecret(data.key);
  return { success: true };
}

export function handleConfigListSecretKeys(): { keys: string[] } {
  return { keys: getConfigService().listSecretKeys() };
}

/**
 * Returns and clears the most recent settings-file corruption event.
 * The renderer should call this once at startup; if a non-null event
 * comes back it presents a recovery dialog (showing the backup path)
 * to the user.
 */
export function handleConfigTakeStartupDiagnostics(): {
  settingsCorruption: SettingsCorruptionInfo | null;
} {
  return {
    settingsCorruption: getConfigService().takeSettingsCorruption(),
  };
}
