/**
 * Unit tests for `member:rename` (F2, spec
 * `docs/specs/2026-09-29-ai-setup-and-character.md`).
 *
 * Coverage:
 *   - happy path: updates BOTH the live registry instance's `displayName`
 *     and persists via `saveProvider` with the CURRENT roles/skill_overrides
 *     /isDepartmentHead carried forward unchanged.
 *   - unknown providerId → a clear "not found" error, no persistence.
 *   - duplicate name (case-insensitive) against another registered
 *     provider → DuplicateDisplayNameError, no mutation, no persistence.
 *   - same-provider case-only rename ("Ada" → "ada") is ALLOWED — the
 *     uniqueness check excludes the provider's own current name.
 *   - the handler trims the display name before both the uniqueness check
 *     and persistence (router.ts discards every zod `.parse()` return
 *     value, so trimming must happen here, not rely on the schema).
 *
 * `providerRegistry` is the REAL singleton (not vi.mock'd) — tests seed it
 * via `register()` in beforeEach and clear it in afterEach, mirroring the
 * existing pattern in handlers-v3.test.ts (which spies on `listAll` rather
 * than mocking the whole module). `saveProvider` (a DB write) IS mocked so
 * these tests never touch better-sqlite3.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSaveProvider } = vi.hoisted(() => ({
  mockSaveProvider: vi.fn(),
}));

vi.mock('../../../providers/provider-repository', () => ({
  saveProvider: mockSaveProvider,
}));

import { providerRegistry } from '../../../providers/registry';
import { handleMemberRename } from '../member-handler';
import type { BaseProvider } from '../../../providers/provider-interface';

function makeProvider(id: string, displayName: string): BaseProvider {
  return {
    id,
    type: 'api',
    displayName,
    model: 'model-a',
    config: { type: 'api', endpoint: 'https://api.example.com', apiKeyRef: 'ref', model: 'model-a' },
    roles: ['implement'],
    skill_overrides: null,
    isDepartmentHead: { implement: true },
    toInfo: vi.fn(function toInfo(this: BaseProvider) {
      return {
        id: this.id, type: this.type, displayName: this.displayName, model: this.model,
        capabilities: [], status: 'ready', config: this.config,
        roles: this.roles, skill_overrides: this.skill_overrides, isDepartmentHead: this.isDepartmentHead,
      };
    }),
  } as unknown as BaseProvider;
}

describe('handleMemberRename (F2)', () => {
  beforeEach(() => {
    mockSaveProvider.mockClear();
  });

  afterEach(async () => {
    // Drain whatever this test registered so state never leaks across tests.
    for (const provider of providerRegistry.listInstances()) {
      providerRegistry.discardUnstarted(provider.id);
    }
  });

  it('renames: updates the live registry instance AND persists with existing roles/skills/department-head carried forward', () => {
    const provider = makeProvider('p1', 'Ada');
    providerRegistry.register(provider);

    const result = handleMemberRename({ providerId: 'p1', displayName: 'Ada Lovelace' });

    expect(provider.displayName).toBe('Ada Lovelace');
    expect(result.provider.displayName).toBe('Ada Lovelace');
    expect(mockSaveProvider).toHaveBeenCalledWith(
      'p1', 'api', 'Ada Lovelace',
      provider.config, ['implement'], null, { implement: true },
    );
  });

  it('throws a clear error for an unknown providerId, without persisting', () => {
    expect(() => handleMemberRename({ providerId: 'ghost', displayName: 'New Name' }))
      .toThrow('Provider not found: ghost');
    expect(mockSaveProvider).not.toHaveBeenCalled();
  });

  it('rejects a name that collides case-insensitively with another registered provider', () => {
    const ada = makeProvider('p1', 'Ada');
    const bob = makeProvider('p2', 'Bob');
    providerRegistry.register(ada);
    providerRegistry.register(bob);

    expect(() => handleMemberRename({ providerId: 'p2', displayName: 'ada' }))
      .toThrow('Display name already in use: ada');
    expect(bob.displayName).toBe('Bob'); // unmutated
    expect(mockSaveProvider).not.toHaveBeenCalled();
  });

  it('rejection is a DuplicateDisplayNameError for renderer discrimination', () => {
    const ada = makeProvider('p1', 'Ada');
    const bob = makeProvider('p2', 'Bob');
    providerRegistry.register(ada);
    providerRegistry.register(bob);

    expect(() => handleMemberRename({ providerId: 'p2', displayName: 'Ada' }))
      .toThrow(expect.objectContaining({ name: 'DuplicateDisplayNameError' }));
  });

  it('allows a same-provider case-only rename ("Ada" → "ada") — not a self-collision', () => {
    const provider = makeProvider('p1', 'Ada');
    providerRegistry.register(provider);

    const result = handleMemberRename({ providerId: 'p1', displayName: 'ada' });

    expect(provider.displayName).toBe('ada');
    expect(result.provider.displayName).toBe('ada');
    expect(mockSaveProvider).toHaveBeenCalled();
  });

  it('trims the display name before the uniqueness check and persistence', () => {
    const provider = makeProvider('p1', 'Ada');
    providerRegistry.register(provider);

    const result = handleMemberRename({ providerId: 'p1', displayName: '  Padded Name  ' });

    expect(provider.displayName).toBe('Padded Name');
    expect(result.provider.displayName).toBe('Padded Name');
    expect(mockSaveProvider).toHaveBeenCalledWith(
      'p1', 'api', 'Padded Name',
      provider.config, ['implement'], null, { implement: true },
    );
  });
});
