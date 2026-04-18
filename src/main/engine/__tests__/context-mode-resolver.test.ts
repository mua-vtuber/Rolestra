import { describe, it, expect } from 'vitest';
import { ContextModeResolver, type ParticipantCapability } from '../context-mode-resolver';

describe('ContextModeResolver', () => {
  it('returns folder mode when CLI participant exists', () => {
    const participants: ParticipantCapability[] = [
      { id: 'ai-1', providerType: 'cli', hasToolSupport: false },
      { id: 'ai-2', providerType: 'api', hasToolSupport: false },
    ];
    expect(ContextModeResolver.resolve(participants)).toBe('folder');
  });

  it('returns folder mode when local with tool support exists', () => {
    const participants: ParticipantCapability[] = [
      { id: 'ai-1', providerType: 'local', hasToolSupport: true },
      { id: 'ai-2', providerType: 'api', hasToolSupport: false },
    ];
    expect(ContextModeResolver.resolve(participants)).toBe('folder');
  });

  it('returns file mode when only API providers', () => {
    const participants: ParticipantCapability[] = [
      { id: 'ai-1', providerType: 'api', hasToolSupport: false },
      { id: 'ai-2', providerType: 'api', hasToolSupport: false },
    ];
    expect(ContextModeResolver.resolve(participants)).toBe('file');
  });

  it('returns file mode when only local without tool support', () => {
    const participants: ParticipantCapability[] = [
      { id: 'ai-1', providerType: 'local', hasToolSupport: false },
    ];
    expect(ContextModeResolver.resolve(participants)).toBe('file');
  });

  it('returns folder mode when API with tool use is present', () => {
    const participants: ParticipantCapability[] = [
      { id: 'ai-1', providerType: 'api', hasToolSupport: true },
    ];
    expect(ContextModeResolver.resolve(participants)).toBe('folder');
  });

  it('re-resolves on participant change', () => {
    const before: ParticipantCapability[] = [
      { id: 'ai-1', providerType: 'api', hasToolSupport: false },
    ];
    expect(ContextModeResolver.resolve(before)).toBe('file');

    const after: ParticipantCapability[] = [
      ...before,
      { id: 'ai-2', providerType: 'cli', hasToolSupport: false },
    ];
    expect(ContextModeResolver.resolve(after)).toBe('folder');
  });
});
