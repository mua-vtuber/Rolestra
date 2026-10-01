/**
 * IPC handlers for config:* channels.
 *
 * Bridges renderer config requests to ConfigServiceImpl.
 */

import type {
  SettingsConfig,
  SettingsCorruptionInfo,
} from '../../../shared/config-types';
import type { ChatSettingsPatch } from '../../../shared/ipc-types';
import { getConfigService } from '../../config/instance';

/** Only the renderer-writable settings (`ChatSettingsPatch`: the language). */
export function handleConfigUpdateSettings(
  data: { patch: ChatSettingsPatch },
): { settings: SettingsConfig } {
  const svc = getConfigService();
  svc.updateSettings(data.patch);

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
