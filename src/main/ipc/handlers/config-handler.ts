/**
 * IPC handlers for config:* channels.
 *
 * Bridges renderer config requests to ConfigServiceImpl.
 */

import type {
  SettingsConfig,
  SettingsCorruptionInfo,
} from '../../../shared/config-types';
import type { ProviderInfo } from '../../../shared/provider-types';
import { getConfigService } from '../../config/instance';
import { reconfigureMemoryFacade } from '../../memory/instance';
import { providerRegistry } from '../../providers/registry';
import { resolveSummaryProvider } from '../../llm/summary-model-resolver';

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

/**
 * settings:setSummaryModel — R12-S Task 9.
 *
 * 회의록 자동 정리 모델 명시 갱신. providerId=null = 자동 선택 (resolver
 * 가 Haiku → Flash → 기타 → Ollama 순으로 결정). 그 외 = 사용자가
 * 특정 provider 명시. 본 IPC 는 settings.summaryModelProviderId 만
 * 갱신하는 얇은 래퍼 — config:update-settings 에 patch 만 전달.
 */
export function handleSettingsSetSummaryModel(
  data: { providerId: string | null },
): { settings: SettingsConfig } {
  const svc = getConfigService();
  svc.updateSettings({ summaryModelProviderId: data.providerId });
  return { settings: svc.getSettings() };
}

/**
 * settings:getResolvedSummaryModel — R12-S Task 11.
 *
 * UI 카드가 "현재 자동 선택 결과는 무엇인지" 보여주기 위한 read-only IPC.
 * 사용자 명시 시점에는 그 provider 그대로, null 이면 4단계 resolver 결과
 * (Haiku → Flash → 기타 → Ollama). 모두 부재면 null.
 */
export function handleSettingsGetResolvedSummaryModel(): {
  provider: ProviderInfo | null;
} {
  const settings = getConfigService().getSettings();
  const all = providerRegistry.listAll();
  const resolved = resolveSummaryProvider(
    { summaryModelProviderId: settings.summaryModelProviderId },
    all,
  );
  return { provider: resolved };
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
