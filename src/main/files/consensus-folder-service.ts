/**
 * ConsensusFolderService manages the shared consensus folder where
 * discussion results and consensus documents are stored.
 *
 * This folder is always accessible (read & write) by all AI participants,
 * regardless of project folder permissions.
 *
 * Default path: ~/Documents/AI_Chat_Arena/
 * Users can customize via settings.consensusFolderPath.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { ConsensusFolderInfo } from '../../shared/file-types';

export class ConsensusFolderService {
  private folderPath: string | null = null;
  private isDefault = true;

  /**
   * Base documents directory used for the default consensus folder path.
   * Injected via constructor; falls back to os.homedir()/Documents.
   *
   * In production, pass Electron's app.getPath('documents') to respect
   * OS-level folder redirects (e.g., OneDrive, custom Documents location).
   */
  private readonly _documentsPath: string;

  constructor(documentsPath?: string) {
    this._documentsPath = documentsPath ?? path.join(os.homedir(), 'Documents');
  }

  /**
   * Platform-appropriate default consensus folder path.
   * Resolves to <documentsPath>/AI_Chat_Arena.
   */
  getDefaultPath(): string {
    return path.join(this._documentsPath, 'AI_Chat_Arena');
  }

  /**
   * Initialize the consensus folder (create if needed).
   *
   * @param customPath - User-specified path, or null/undefined for platform default.
   * @returns ConsensusFolderInfo describing the initialized folder.
   */
  async initFolder(customPath?: string | null): Promise<ConsensusFolderInfo> {
    const useDefault = !customPath;
    const resolved = path.resolve(customPath || this.getDefaultPath());

    await fs.promises.mkdir(resolved, { recursive: true });

    this.folderPath = resolved;
    this.isDefault = useDefault;

    return this.buildInfo();
  }

  /** Return current folder info, or null if not initialized. */
  getInfo(): ConsensusFolderInfo | null {
    if (!this.folderPath) return null;
    return this.buildInfo();
  }

  /** Return the resolved folder path, or null if not initialized. */
  getFolderPath(): string | null {
    return this.folderPath;
  }

  /**
   * Check whether the given path resides inside the consensus folder.
   *
   * @param targetPath - The path to check (will be resolved to absolute).
   * @returns true if targetPath is inside the consensus folder.
   */
  isConsensusPath(targetPath: string): boolean {
    if (!this.folderPath) return false;
    const resolved = path.resolve(targetPath);
    const folderWithSep = this.folderPath + path.sep;
    return resolved === this.folderPath || resolved.startsWith(folderWithSep);
  }

  /** Clean up service state. Does NOT delete files on disk. */
  dispose(): void {
    this.folderPath = null;
    this.isDefault = true;
  }

  private buildInfo(): ConsensusFolderInfo {
    const folderPath = this.folderPath ?? '';
    return {
      folderPath,
      exists: folderPath !== '' && fs.existsSync(folderPath),
      isDefault: this.isDefault,
    };
  }
}
