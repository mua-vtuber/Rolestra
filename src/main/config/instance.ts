/**
 * Singleton accessor for ConfigServiceImpl.
 *
 * Separated from config-handler.ts to avoid circular imports
 * (config-handler needs memory/instance for reconfiguration,
 *  and memory/instance needs the config service for settings).
 *
 * Uses Electron's safeStorage for OS-level encryption of secrets.
 * Must be called after app.whenReady() (safeStorage requires it).
 */

import { app, safeStorage } from 'electron';
import { join } from 'path';
import { ConfigServiceImpl } from './config-service';

let configService: ConfigServiceImpl | null = null;

/**
 * Get (or lazily create) the singleton ConfigServiceImpl.
 *
 * @throws {Error} If called before app is ready.
 */
export function getConfigService(): ConfigServiceImpl {
  if (configService) return configService;

  const userData = app.getPath('userData');
  configService = new ConfigServiceImpl({
    settingsDir: join(userData, 'config'),
    secretsDir: join(userData, 'config'),
    safeStorageAdapter: {
      encryptString: (value: string) => safeStorage.encryptString(value),
      decryptString: (buffer: Buffer) => safeStorage.decryptString(buffer),
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    },
  });
  return configService;
}
