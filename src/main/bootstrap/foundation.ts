import * as path from 'node:path';
import type { App } from 'electron';
import { ArenaRootService } from '../arena/arena-root-service';
import { getConfigService } from '../config/instance';
import { initDatabaseRoot } from '../database/connection';
import { runMigrations } from '../database/migrator';
import { createLogger, LOG_FILE_NAME } from '../log/structured-logger';
import { releaseOrphanApiKeys } from '../providers/orphan-api-keys';
import { loadAllProviders } from '../providers/provider-repository';
import { restoreProvidersFromDb } from '../providers/provider-restore';
import { chatCliInstructionsDir, resetChatCliInstructionsDir } from '../files/chat-cli-instructions';
import type { AbsolutePath } from '../../shared/absolute-path';

/** Log file rotation limits — see `LoggerConfig.file` (shared/log-types.ts). */
const LOG_FILE_MAX_SIZE_MB = 10;
const LOG_FILE_MAX_FILES = 5;

export async function initializeFoundation(app: App): Promise<{
  arenaRoot: ArenaRootService;
  logger: ReturnType<typeof createLogger>;
  chatCliInstructionsDir: AbsolutePath;
}> {
  const config = getConfigService();
  const documentsPath = (() => {
    try {
      return app.getPath('documents');
    } catch {
      return undefined;
    }
  })();

  const arenaRoot = new ArenaRootService(config, documentsPath);
  await arenaRoot.ensure();
  initDatabaseRoot(arenaRoot);

  runMigrations();
  restoreProvidersFromDb();

  const logger = createLogger({
    file: {
      path: path.join(arenaRoot.logsPath(), LOG_FILE_NAME),
      maxSizeMB: LOG_FILE_MAX_SIZE_MB,
      maxFiles: LOG_FILE_MAX_FILES,
    },
  });

  // Chat CLI persona files live in app data, outside every CLI working folder.
  // Each belongs to a live CLI clone, so anything present now was left by a
  // previous run. A failed reset only leaves stale files behind (a chat call
  // that cannot write its own file reports that itself), so it is logged
  // rather than blocking startup.
  const instructionsDir = chatCliInstructionsDir(app.getPath('userData'));
  try {
    resetChatCliInstructionsDir(instructionsDir);
  } catch (error) {
    logger.error({
      component: 'foundation',
      action: 'chat-cli-instructions-reset',
      result: 'failure',
      metadata: { dir: instructionsDir, cause: error instanceof Error ? error.message : String(error) },
    });
  }

  releaseUnusedApiKeys(config, logger);

  return { arenaRoot, logger, chatCliInstructionsDir: instructionsDir };
}

/**
 * Deletes API keys no stored AI uses (`providers/orphan-api-keys.ts`) and
 * logs what was removed and what failed, by ref only. A failure is logged
 * and startup continues: a leftover key is unused, and the next start
 * tries again.
 */
function releaseUnusedApiKeys(
  config: ReturnType<typeof getConfigService>,
  logger: ReturnType<typeof createLogger>,
): void {
  try {
    const { removed, failed } = releaseOrphanApiKeys({
      secretKeys: () => config.listSecretKeys(),
      rows: loadAllProviders,
      deleteSecret: (ref) => config.deleteSecret(ref),
    });
    if (removed.length > 0) {
      logger.info({
        component: 'foundation', action: 'unused-api-key-cleanup', result: 'success', metadata: { removed },
      });
    }
    for (const { ref, message } of failed) {
      logger.error({
        component: 'foundation', action: 'unused-api-key-cleanup', result: 'failure', metadata: { ref, cause: message },
      });
    }
  } catch (error) {
    logger.error({
      component: 'foundation',
      action: 'unused-api-key-cleanup',
      result: 'failure',
      metadata: { cause: error instanceof Error ? error.message : String(error) },
    });
  }
}
