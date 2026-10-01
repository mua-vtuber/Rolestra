/**
 * Lazy accessor for the process-wide StreamBridge instance.
 *
 * Rolestra avoids module-scope singletons for services that need
 * testable construction (see ProjectService / MeetingService pattern).
 * The StreamBridge is constructed in `main/index.ts` after window creation
 * and registered here so IPC handlers / MeetingOrchestrator can reach it
 * without importing from `main/index.ts` (which would be a circular edge).
 *
 * Tests instantiate their own StreamBridge and pass it directly; production
 * code goes through `getStreamBridge()`.
 */

import type { StreamBridge } from './stream-bridge';

let instance: StreamBridge | null = null;

export function setStreamBridgeInstance(bridge: StreamBridge): void {
  instance = bridge;
}

/**
 * Return the registered instance. Throws when called before `setStreamBridgeInstance`
 * — this is a bug (handler asked for the bridge before bootstrap wired it).
 */
export function getStreamBridge(): StreamBridge {
  if (!instance) {
    throw new Error(
      '[stream-bridge] StreamBridge requested before main/index.ts wired it',
    );
  }
  return instance;
}

/**
 * Test-only reset. Called by `afterEach` hooks to isolate suites.
 */
export function __resetStreamBridgeInstanceForTests(): void {
  instance = null;
}
