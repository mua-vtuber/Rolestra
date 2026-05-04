/**
 * Shared test fixtures and builder functions.
 *
 * Standard participant configurations, provider configs, message arrays,
 * and builder helpers used across integration test files.
 */

import { randomUUID } from 'node:crypto';
import type { Participant } from '../shared/engine-types';
import type {
  ApiProviderConfig,
  CliProviderConfig,
  LocalProviderConfig,
  Message,
} from '../shared/provider-types';
import type { PatchSet, PatchEntry, AuditEntry } from '../shared/execution-types';
import type { MessageInsert } from '../main/database/conversation-repository';

// ── Participant fixtures ──────────────────────────────────────────────

/** Standard 3-AI + user configuration. */
export const PARTICIPANTS_3AI: Participant[] = [
  { id: 'user', displayName: 'User', isActive: true },
  { id: 'ai-1', displayName: 'Claude', isActive: true, providerId: 'provider-1' },
  { id: 'ai-2', displayName: 'Gemini', isActive: true, providerId: 'provider-2' },
  { id: 'ai-3', displayName: 'GPT', isActive: true, providerId: 'provider-3' },
];

/** Standard 2-AI + user configuration. */
export const PARTICIPANTS_2AI: Participant[] = [
  { id: 'user', displayName: 'User', isActive: true },
  { id: 'ai-1', displayName: 'Claude', isActive: true, providerId: 'provider-1' },
  { id: 'ai-2', displayName: 'Gemini', isActive: true, providerId: 'provider-2' },
];

// ── Provider config fixtures ──────────────────────────────────────────

export const API_CONFIG_OPENAI: ApiProviderConfig = {
  type: 'api',
  endpoint: 'https://api.openai.com/v1',
  apiKeyRef: 'openai-key',
  model: 'gpt-4',
};

export const API_CONFIG_ANTHROPIC: ApiProviderConfig = {
  type: 'api',
  endpoint: 'https://api.anthropic.com/v1',
  apiKeyRef: 'anthropic-key',
  model: 'claude-3-opus',
};

export const API_CONFIG_GOOGLE: ApiProviderConfig = {
  type: 'api',
  endpoint: 'https://generativelanguage.googleapis.com/v1beta',
  apiKeyRef: 'google-key',
  model: 'gemini-pro',
};

export const CLI_CONFIG_CLAUDE: CliProviderConfig = {
  type: 'cli',
  command: 'claude',
  args: [],
  inputFormat: 'pipe',
  outputFormat: 'stream-json',
  sessionStrategy: 'per-turn',
  hangTimeout: { first: 5000, subsequent: 3000 },
  model: 'claude-3-opus',
};

export const LOCAL_CONFIG_OLLAMA: LocalProviderConfig = {
  type: 'local',
  baseUrl: 'http://localhost:11434',
  model: 'llama2',
};

// ── Message fixtures ──────────────────────────────────────────────────

export const SAMPLE_MESSAGES: Message[] = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Hello, how are you?' },
  { role: 'assistant', content: 'I am doing well, thank you!' },
  { role: 'user', content: 'Can you help me with a task?' },
];

// ── Builder functions ─────────────────────────────────────────────────

// R12-C2 T10b: 옛 makeVote (SSM VoteRecord builder) 제거 — 새 의견 모델은
// opinion_vote 테이블을 따로 가지며 빌더는 도메인 안 (`opinion-repository`
// 테스트가 자체 makeVote 헬퍼를 둔다).

/** Build a PatchSet with sensible defaults. */
export function makePatchSet(overrides: Partial<PatchSet> = {}): PatchSet {
  return {
    operationId: `patch-${randomUUID().slice(0, 8)}`,
    aiId: 'ai-1',
    conversationId: 'conv-1',
    entries: [],
    dryRun: false,
    ...overrides,
  };
}

/** Build a single PatchEntry. */
export function makePatchEntry(overrides: Partial<PatchEntry> = {}): PatchEntry {
  return {
    targetPath: '/tmp/test-file.txt',
    operation: 'create',
    newContent: 'test content',
    ...overrides,
  };
}

/** Build a minimal AuditEntry for testing. */
export function makeAuditEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    operationId: `op-${randomUUID().slice(0, 8)}`,
    aiId: 'ai-1',
    action: 'read',
    targetPath: '/tmp/test',
    timestamp: Date.now(),
    result: 'success',
    rollbackable: false,
    ...overrides,
  };
}

/** Build a MessageInsert for the conversation repository. */
export function makeMessage(overrides: Partial<MessageInsert> = {}): MessageInsert {
  return {
    id: randomUUID(),
    conversationId: 'conv-1',
    participantId: 'user',
    participantName: 'User',
    role: 'user',
    content: 'Hello world',
    ...overrides,
  };
}

/** Build a participants JSON string for conversation creation. */
export function makeParticipantsJson(
  participants: Array<{ id: string; displayName: string }> = [
    { id: 'ai-1', displayName: 'Claude' },
    { id: 'ai-2', displayName: 'Gemini' },
    { id: 'user', displayName: 'User' },
  ],
): string {
  return JSON.stringify(participants);
}
