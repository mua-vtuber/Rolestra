import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../providers/registry', () => ({
  providerRegistry: {
    listAll: vi.fn(() => []),
  },
}));

vi.mock('../../../memory/instance', () => ({
  getMemoryFacade: vi.fn(() => null),
}));

vi.mock('../../../config/instance', async () => {
  const configTypes = await import('../../../../shared/config-types');
  return {
    getConfigService: vi.fn(() => ({
      getSettings: () => ({ ...configTypes.DEFAULT_SETTINGS }),
    })),
  };
});

vi.mock('../execution-handler', () => ({
  submitPatchForReview: vi.fn(),
  clearPendingPatches: vi.fn(),
}));

vi.mock('../../../database/connection', () => ({
  getDatabase: vi.fn(() => null),
}));

async function loadHandlers() {
  vi.resetModules();
  return import('../chat-handler');
}

describe('chat-handler rounds persistence', () => {
  beforeEach(async () => {
    const mod = await loadHandlers();
    mod.setActiveSession(null);
    mod.setMainWindow(null);
  });

  it('preserves round settings across sends', async () => {
    const mod = await loadHandlers();

    mod.handleChatSetRounds({ rounds: 3 });
    mod.handleChatSend({ content: 'hello', activeProviderIds: [] });

    const session = mod.getActiveSession();
    expect(session).not.toBeNull();
    expect(session?.turnManager.roundSetting).toBe(3);
    // consensus getter is deprecated (returns null); SSM replaced it
  });
});

describe('chat-handler edge cases', () => {
  beforeEach(async () => {
    const mod = await loadHandlers();
    mod.setActiveSession(null);
    mod.setMainWindow(null);
  });

  it('double send creates only one session (isBusy guard)', async () => {
    const mod = await loadHandlers();

    mod.handleChatSend({ content: 'first', activeProviderIds: [] });
    const session1 = mod.getActiveSession();

    // Second send reuses same session (no mainWindow, so no orchestrator)
    mod.handleChatSend({ content: 'second', activeProviderIds: [] });
    const session2 = mod.getActiveSession();

    expect(session1).toBe(session2);
    // Both messages should be in the same session
    expect(session2!.messages.length).toBeGreaterThanOrEqual(2);
  });

  it('requestedRoundSetting resets on setActiveSession(null)', async () => {
    const mod = await loadHandlers();

    // Set rounds to 5
    mod.handleChatSetRounds({ rounds: 5 });
    mod.handleChatSend({ content: 'hello', activeProviderIds: [] });
    expect(mod.getActiveSession()?.turnManager.roundSetting).toBe(5);

    // Clear session (simulates starting a new conversation)
    // setActiveSession(null) resets requestedRoundSetting to 'unlimited'
    mod.setActiveSession(null);

    // Send again — should create new session with default 'unlimited' round setting
    mod.handleChatSend({ content: 'new session', activeProviderIds: [] });
    const newSession = mod.getActiveSession();
    expect(newSession).not.toBeNull();
    expect(newSession!.turnManager.roundSetting).toBe('unlimited');
  });

  it('handleChatPause throws when no active orchestrator', async () => {
    const mod = await loadHandlers();

    expect(() => mod.handleChatPause()).toThrow('No active conversation to pause');
  });

  it('handleChatResume throws when no active orchestrator', async () => {
    const mod = await loadHandlers();

    expect(() => mod.handleChatResume()).toThrow('No active conversation to resume');
  });

  it('handleChatStop throws when no active orchestrator', async () => {
    const mod = await loadHandlers();

    expect(() => mod.handleChatStop()).toThrow('No active conversation to stop');
  });
});
