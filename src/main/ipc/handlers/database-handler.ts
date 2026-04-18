/**
 * Database management IPC handlers.
 *
 * Provides export (VACUUM INTO + save dialog), import (open dialog + validate),
 * and stats (table row counts + file size).
 */

import { dialog } from 'electron';
import type { IpcResponse } from '../../../shared/ipc-types';
import { exportDatabase, importDatabase, getDatabaseStats } from '../../database/database-manager';

/** db:export — VACUUM INTO a user-chosen file. */
export async function handleDbExport(): Promise<IpcResponse<'db:export'>> {
  const result = await dialog.showSaveDialog({
    title: 'Export Database',
    defaultPath: `arena-backup-${Date.now()}.db`,
    filters: [{ name: 'SQLite Database', extensions: ['db'] }],
  });

  if (result.canceled || !result.filePath) {
    return { success: false };
  }

  exportDatabase(result.filePath);
  return { success: true, path: result.filePath };
}

/** db:import — open a file, validate, replace live DB. */
export async function handleDbImport(): Promise<IpcResponse<'db:import'>> {
  const result = await dialog.showOpenDialog({
    title: 'Import Database',
    filters: [{ name: 'SQLite Database', extensions: ['db'] }],
    properties: ['openFile'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, requiresRestart: false };
  }

  importDatabase(result.filePaths[0]);
  return { success: true, requiresRestart: true };
}

/** db:stats — return table row counts and file size. */
export function handleDbStats(): IpcResponse<'db:stats'> {
  return getDatabaseStats();
}
