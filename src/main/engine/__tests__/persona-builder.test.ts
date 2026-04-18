import { describe, it, expect } from 'vitest';
import type { BaseProviderInit } from '../../providers/provider-interface';
import { BaseProvider } from '../../providers/provider-interface';
import type { Message, CompletionOptions } from '../../../shared/provider-types';
import { buildEffectivePersona } from '../persona-builder';

/** Minimal concrete implementation for testing. */
class TestProvider extends BaseProvider {
  async warmup(): Promise<void> {
    this.setStatus('ready');
  }
  async cooldown(): Promise<void> {
    this.setStatus('not-installed');
  }
  async validateConnection(): Promise<boolean> {
    return true;
  }
  async ping(): Promise<boolean> {
    return true;
  }
  async *streamCompletion(
    messages: Message[],
    persona: string,
    options?: CompletionOptions,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    void messages;
    void persona;
    void options;
    void signal;
    yield 'test';
  }
}

function createProvider(overrides?: Partial<BaseProviderInit>): TestProvider {
  return new TestProvider({
    id: 'test-1',
    type: 'cli',
    displayName: 'Test CLI',
    model: 'test-model',
    capabilities: ['streaming'],
    config: {
      type: 'cli',
      command: 'test',
      args: [],
      inputFormat: 'args',
      outputFormat: 'raw-stdout',
      sessionStrategy: 'per-turn',
      hangTimeout: { first: 10000, subsequent: 5000 },
      model: 'test-model',
    },
    ...overrides,
  });
}

describe('buildEffectivePersona', () => {
  it('always includes base conversation rules', () => {
    const provider = createProvider({ persona: '' });
    const result = buildEffectivePersona(provider, {});
    expect(result).toContain('[Base Conversation Rules]');
    expect(result).toContain('Do not simply agree with others.');
  });

  it('includes custom persona text', () => {
    const provider = createProvider({
      persona: 'You are helpful.',
    });
    const result = buildEffectivePersona(provider, {});
    expect(result).toContain('You are helpful.');
    expect(result).toContain('[Base Conversation Rules]');
  });

  // ── Permission-based rules ──────────────────────────────

  it('adds no-file-access rules when no project folder is set', () => {
    const provider = createProvider();
    const result = buildEffectivePersona(provider, {});
    expect(result).toContain('[Tool Usage Rules]');
    expect(result).toContain('Do NOT read, write, or modify any files');
  });

  it('adds no-permission rules when project folder set but no participant permission', () => {
    const provider = createProvider();
    const result = buildEffectivePersona(provider, {
      projectFolder: '/project',
      permission: null,
    });
    expect(result).toContain('You have NO file permissions configured');
  });

  it('adds read-only rules from permission', () => {
    const provider = createProvider();
    const result = buildEffectivePersona(provider, {
      projectFolder: '/project',
      permission: {
        participantId: 'test-1',
        folderPath: '/project',
        read: true,
        write: false,
        execute: false,
      },
    });
    expect(result).toContain('File read: ALLOWED');
    expect(result).toContain('File write: DENIED');
    expect(result).toContain('Command execution: DENIED');
  });

  it('adds full-access rules from permission', () => {
    const provider = createProvider();
    const result = buildEffectivePersona(provider, {
      projectFolder: '/project',
      permission: {
        participantId: 'test-1',
        folderPath: '/project',
        read: true,
        write: true,
        execute: true,
      },
    });
    expect(result).toContain('File read: ALLOWED');
    expect(result).toContain('File write: ALLOWED');
    expect(result).toContain('Command execution: ALLOWED');
  });

  it('includes arena workspace info when arenaFolder is provided', () => {
    const provider = createProvider();
    const result = buildEffectivePersona(provider, {
      projectFolder: '/project',
      arenaFolder: '/project/.arena/workspace',
      permission: {
        participantId: 'test-1',
        folderPath: '/project',
        read: true,
        write: false,
        execute: false,
      },
    });
    expect(result).toContain('Arena workspace');
    expect(result).toContain('/project/.arena/workspace');
  });
});
