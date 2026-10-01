import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLoggerAccessor, setLoggerAccessor } from '../../log/logger-accessor';
import { StructuredLogger } from '../../log/structured-logger';

const mocks = vi.hoisted(() => ({
  createProvider: vi.fn(),
  register: vi.fn(),
  loadAllProviders: vi.fn(() => [{
    id: 'legacy-cli', displayName: 'Legacy CLI', persona: '',
    configJson: JSON.stringify({ type: 'cli', command: 'unknown-helper', args: ['--dangerous'] }),
    roles: '[]', skillOverrides: null, isDepartmentHead: '{}',
  }]),
}));
vi.mock('../factory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../factory')>()),
  createProvider: mocks.createProvider,
}));
vi.mock('../provider-repository', () => ({ loadAllProviders: mocks.loadAllProviders }));
vi.mock('../registry', () => ({ providerRegistry: { register: mocks.register } }));

import { restoreProvidersFromDb } from '../provider-restore';

describe('legacy CLI restore', () => {
  let logger: StructuredLogger;
  let consoleWarn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logger = new StructuredLogger({ console: false, level: 'debug' });
    setLoggerAccessor(() => logger);
    consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    clearLoggerAccessor();
    vi.restoreAllMocks();
  });

  it('keeps an unknown command row inactive without spawning it, and logs through the project logger', () => {
    restoreProvidersFromDb();
    expect(mocks.loadAllProviders).toHaveBeenCalledOnce();
    expect(mocks.createProvider).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    const entries = logger.getEntries({ level: 'warn' })
      .filter((e) => e.component === 'provider-restore' && e.action === 'unsupported-cli-skip');
    expect(entries).toHaveLength(1);
    expect((entries[0]?.metadata as { providerId: string }).providerId).toBe('legacy-cli');
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it('preserves a stored Gemini CLI row without restoring it, and logs through the project logger', () => {
    mocks.loadAllProviders.mockReturnValueOnce([{
      id: 'legacy-gemini', displayName: 'Gemini CLI', persona: '',
      configJson: JSON.stringify({ type: 'cli', command: 'C:\\Tools\\gemini.cmd', args: [] }),
      roles: '[]', skillOverrides: null, isDepartmentHead: '{}',
    }]);
    restoreProvidersFromDb();
    expect(mocks.createProvider).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    const entries = logger.getEntries({ level: 'warn' })
      .filter((e) => e.component === 'provider-restore' && e.action === 'unsupported-cli-skip');
    expect(entries).toHaveLength(1);
    expect((entries[0]?.metadata as { providerId: string }).providerId).toBe('legacy-gemini');
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  // F3 STEP 3b (spec 2026-09-29-ai-setup-and-character.md, QA defect):
  // BaseProvider no longer carries an in-memory legacy persona — restore
  // must NOT copy a stored row's `persona` column value into
  // createProvider's options any more. The DB column itself stays as
  // history (saveProvider's UPDATE never touches it — see
  // provider-repository.test.ts's "persona column preservation" describe
  // block for that half of the proof); this is the restore-side half:
  // even a row with a non-empty legacy persona must not leak it into the
  // live createProvider() call.
  it('never passes a stored row\'s persona column to createProvider, even when it is non-empty', () => {
    mocks.loadAllProviders.mockReturnValueOnce([{
      id: 'legacy-api', displayName: 'Legacy API AI', persona: 'Please be a curious friend.',
      configJson: JSON.stringify({ type: 'api', endpoint: 'https://api.example.com', apiKeyRef: 'ref', model: 'model-a' }),
      roles: '[]', skillOverrides: null, isDepartmentHead: '{}',
    }]);
    mocks.createProvider.mockReturnValueOnce({
      id: 'legacy-api', warmup: vi.fn(async () => undefined),
    });
    restoreProvidersFromDb();
    expect(mocks.createProvider).toHaveBeenCalledOnce();
    const callArgs = mocks.createProvider.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty('persona');
  });
});
