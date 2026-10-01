/**
 * Central barrel export for integration test utilities.
 *
 * Usage: import { createTestDb, sseStream } from '../../test-utils';
 */

export { createTmpDir, removeTmpDir, delay, makeIpcMeta } from './integration-helpers';
export { absolutePathForTest } from './absolute-path-helpers';
export type { IpcMetaShape } from './integration-helpers';

export {
  TestStreamingProvider,
  createTestProvider,
} from './test-provider';
export type { TestProviderOptions, StreamCall } from './test-provider';

export {
  sseStream,
  mockSSEResponse,
  collectTokens,
  openAiTokenLines,
  anthropicTokenLines,
  googleTokenLines,
} from './mock-sse';
