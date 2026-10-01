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
import { absolutePathForTest } from './absolute-path-helpers';
import type { AbsolutePath } from '../shared/absolute-path';

/**
 * Create a unique temp directory for test isolation.
 *
 * R12-X T2: 반환 타입이 `AbsolutePath` 다. 테스트가 만드는 임시 폴더는
 * `workspaceRoot` / `arenaRoot` 처럼 브랜드가 필요한 자리로 바로 들어가는데,
 * 여기서 `string` 을 돌려주면 각 테스트가 cast 를 하나씩 쓰게 되고 그 cast
 * 들이 brand 를 무력화한다.
 */
export function createTmpDir(prefix = 'integration-test-'): AbsolutePath {
  return absolutePathForTest(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
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
