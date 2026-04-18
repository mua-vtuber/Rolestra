/**
 * Central barrel export for integration test utilities.
 *
 * Usage: import { createTestDb, makeVote, sseStream } from '../../test-utils';
 */

export { createTmpDir, removeTmpDir, delay, makeIpcMeta } from './integration-helpers';
export type { IpcMetaShape } from './integration-helpers';

export {
  TestStreamingProvider,
  createTestProvider,
} from './test-provider';
export type { TestProviderOptions, StreamCall } from './test-provider';

export { createTestDb, createTestDbUpTo, createTestRepo } from './test-db';

export {
  sseStream,
  mockSSEResponse,
  collectTokens,
  openAiTokenLines,
  anthropicTokenLines,
  googleTokenLines,
} from './mock-sse';

export {
  mockChildProcess,
  simulateCliOutput,
  simulateHang,
  simulateStderr,
} from './mock-cli-process';
export type { MockChildProcess, MockChildProcessOptions } from './mock-cli-process';

export {
  PARTICIPANTS_3AI,
  PARTICIPANTS_2AI,
  API_CONFIG_OPENAI,
  API_CONFIG_ANTHROPIC,
  API_CONFIG_GOOGLE,
  CLI_CONFIG_CLAUDE,
  LOCAL_CONFIG_OLLAMA,
  SAMPLE_MESSAGES,
  makeVote,
  makePatchSet,
  makePatchEntry,
  makeAuditEntry,
  makeMessage,
  makeParticipantsJson,
} from './fixtures';
