import { describe, it, expect } from 'vitest';
import { resolveSummaryProvider } from '../summary-model-resolver';
import type { ProviderInfo } from '../../../shared/provider-types';

function info(over: Partial<ProviderInfo>): ProviderInfo {
  return {
    id: 'x',
    type: 'api',
    displayName: 'X',
    model: 'm',
    status: 'ready',
    capabilities: ['streaming', 'summarize'],
    config: { type: 'api', endpoint: 'x', apiKeyRef: 'k', model: 'm' },
    persona: '',
    roles: [],
    skill_overrides: null,
    ...over,
  } as ProviderInfo;
}

describe('resolveSummaryProvider', () => {
  it('returns user-specified provider when settings has explicit id', () => {
    const all = [info({ id: 'manual', model: 'sonnet' })];
    const got = resolveSummaryProvider({ summaryModelProviderId: 'manual' }, all);
    expect(got?.id).toBe('manual');
  });

  it('returns null when explicit id missing from registry', () => {
    const all = [info({ id: 'a' })];
    const got = resolveSummaryProvider({ summaryModelProviderId: 'gone' }, all);
    expect(got).toBeNull();
  });

  it('auto-selects Claude Haiku when present', () => {
    const all = [
      info({
        id: 'gemini',
        type: 'api',
        displayName: 'Gemini API',
        model: 'gemini-2.5-flash',
      }),
      info({
        id: 'haiku',
        type: 'api',
        displayName: 'Anthropic API',
        model: 'claude-haiku-4-5',
      }),
    ];
    const got = resolveSummaryProvider({ summaryModelProviderId: null }, all);
    expect(got?.id).toBe('haiku');
  });

  it('auto-selects Gemini Flash when no Haiku', () => {
    const all = [
      info({
        id: 'g',
        type: 'api',
        displayName: 'Gemini API',
        model: 'gemini-2.5-flash',
      }),
    ];
    const got = resolveSummaryProvider({ summaryModelProviderId: null }, all);
    expect(got?.id).toBe('g');
  });

  it('auto-selects other summarize-capable api/cli when no Haiku/Flash', () => {
    const all = [
      info({
        id: 'codex',
        type: 'cli',
        model: 'gpt-5.4',
        config: {
          type: 'cli',
          command: 'codex',
          args: [],
          inputFormat: 'stdin-json',
          outputFormat: 'stream-json',
          sessionStrategy: 'persistent',
          hangTimeout: { first: 30000, subsequent: 60000 },
          model: 'gpt-5.4',
        },
      }),
    ];
    const got = resolveSummaryProvider({ summaryModelProviderId: null }, all);
    expect(got?.id).toBe('codex');
  });

  it('falls back to Ollama when no api/cli available', () => {
    const all = [
      info({
        id: 'oll',
        type: 'local',
        model: 'qwen2.5:7b',
        config: {
          type: 'local',
          baseUrl: 'http://localhost:11434',
          model: 'qwen2.5:7b',
        },
      }),
    ];
    const got = resolveSummaryProvider({ summaryModelProviderId: null }, all);
    expect(got?.id).toBe('oll');
  });

  it('returns null when registry is empty', () => {
    const got = resolveSummaryProvider({ summaryModelProviderId: null }, []);
    expect(got).toBeNull();
  });

  it('skips providers without summarize capability', () => {
    const all = [
      info({
        id: 'no-summarize',
        type: 'api',
        model: 'claude-haiku-4-5',
        capabilities: ['streaming'],
      }),
    ];
    const got = resolveSummaryProvider({ summaryModelProviderId: null }, all);
    expect(got).toBeNull();
  });
});
