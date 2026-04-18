/**
 * Shared integration test helpers.
 *
 * Provides common utilities used across all integration test files:
 * - Temp directory management
 * - Async helpers
 * - IPC meta generation
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Create a unique temp directory for test isolation. */
export function createTmpDir(prefix = 'integration-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Recursively remove a directory and all contents. */
export function removeTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Promise-based delay. */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Build a valid IpcMeta object with sensible defaults. */
export function makeIpcMeta(overrides: Partial<IpcMetaShape> = {}): IpcMetaShape {
  return {
    requestId: randomUUID(),
    schemaVersion: 1,
    timestamp: Date.now(),
    ...overrides,
  };
}

/**
 * Local shape mirroring shared/ipc-types IpcMeta.
 * Import from @shared/ipc-types when available; this provides a
 * standalone fallback so test-utils has zero coupling to app code.
 */
export interface IpcMetaShape {
  requestId: string;
  conversationId?: string;
  sequence?: number;
  schemaVersion: number;
  timestamp: number;
}
