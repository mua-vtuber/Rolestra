/**
 * R11-Task9: 6 provider config capability snapshot — `'summarize'` 정식 도입
 * 검증.
 *
 * 검증 대상 (plan 의 6 provider config 매핑):
 *   1. Anthropic API direct (api-provider via Anthropic endpoint)
 *   2. OpenAI API direct (api-provider via OpenAI endpoint)
 *   3. Google Gemini API direct (api-provider via Google endpoint)
 *   4. Local Ollama (local-provider)
 *   5. Claude Code CLI (cli-provider via factory.ts)
 *   6. Codex CLI (cli-provider via factory.ts)
 *   (Gemini CLI 도 같은 cli-provider 경로 — 별도 case 로 카운트)
 *
 * 각 provider 가 capability snapshot 에 `'summarize'` 를 노출하는지 + 기존
 * `'streaming'` 도 유지되는지 확인한다. R10 의 임시 'streaming' fallback
 * 우회 (R10 Known Concern #7) 가 R11-Task9 로 종결됐음을 코드로 고정한다.
 */
import { describe, it, expect } from 'vitest';

import { ApiProvider } from '../api/api-provider';
import { LocalProvider } from '../local/local-provider';
import { createProvider } from '../factory';
import type {
  ApiProviderConfig,
  CliProviderConfig,
  LocalProviderConfig,
  ProviderCapability,
} from '../../../shared/provider-types';

const RESOLVE_KEY = async (): Promise<string> => 'sk-stub';

function expectSummarize(caps: ReadonlyArray<ProviderCapability> | Set<ProviderCapability>): void {
  const arr = Array.isArray(caps) ? caps : [...caps];
  expect(arr).toContain('summarize');
  expect(arr).toContain('streaming');
}

describe('R11-Task9 — 6 provider config 의 summarize capability snapshot', () => {
  it('1. Anthropic API direct provider — summarize + streaming', () => {
    const config: ApiProviderConfig = {
      type: 'api',
      endpoint: 'https://api.anthropic.com/v1',
      apiKeyRef: 'anthropic-key',
      model: 'claude-sonnet-4-6',
    };
    const provider = new ApiProvider({
      id: 'anthropic-1',
      displayName: 'Claude (API)',
      model: config.model,
      config,
      resolveApiKey: RESOLVE_KEY,
    });
    expectSummarize(provider.capabilities);
    expect(provider.toInfo().capabilities).toContain('summarize');
  });

  it('2. OpenAI API direct provider — summarize + streaming', () => {
    const config: ApiProviderConfig = {
      type: 'api',
      endpoint: 'https://api.openai.com/v1',
      apiKeyRef: 'openai-key',
      model: 'gpt-4o-mini',
    };
    const provider = new ApiProvider({
      id: 'openai-1',
      displayName: 'OpenAI (API)',
      model: config.model,
      config,
      resolveApiKey: RESOLVE_KEY,
    });
    expectSummarize(provider.capabilities);
  });

  it('3. Google Gemini API direct provider — summarize + streaming', () => {
    const config: ApiProviderConfig = {
      type: 'api',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta',
      apiKeyRef: 'gemini-key',
      model: 'gemini-1.5-pro',
    };
    const provider = new ApiProvider({
      id: 'gemini-1',
      displayName: 'Gemini (API)',
      model: config.model,
      config,
      resolveApiKey: RESOLVE_KEY,
    });
    expectSummarize(provider.capabilities);
  });

  it('4. Local Ollama provider — summarize + streaming', () => {
    const config: LocalProviderConfig = {
      type: 'local',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'llama3.2',
    };
    const provider = new LocalProvider({
      id: 'local-1',
      displayName: 'Local Ollama',
      model: config.model,
      config,
    });
    expectSummarize(provider.capabilities);
  });

  it('5. Claude Code CLI provider — summarize + streaming', () => {
    const config: CliProviderConfig = {
      type: 'cli',
      command: 'claude',
      args: [],
      inputFormat: 'stdin-json',
      outputFormat: 'stream-json',
      sessionStrategy: 'persistent',
      hangTimeout: { first: 30_000, subsequent: 10_000 },
      model: 'claude-sonnet-4-6',
    };
    const provider = createProvider({
      id: 'claude-cli-1',
      displayName: 'Claude Code',
      config,
    });
    expectSummarize(provider.capabilities);
  });

  it('6. Codex CLI provider — summarize + streaming', () => {
    const config: CliProviderConfig = {
      type: 'cli',
      command: 'codex',
      args: [],
      inputFormat: 'stdin-json',
      outputFormat: 'jsonl',
      sessionStrategy: 'per-turn',
      hangTimeout: { first: 30_000, subsequent: 10_000 },
      model: 'gpt-5',
    };
    const provider = createProvider({
      id: 'codex-cli-1',
      displayName: 'Codex',
      config,
    });
    expectSummarize(provider.capabilities);
  });

  it('Gemini CLI provider (extra) — same factory path → summarize + streaming', () => {
    const config: CliProviderConfig = {
      type: 'cli',
      command: 'gemini',
      args: [],
      inputFormat: 'stdin-json',
      outputFormat: 'jsonl',
      sessionStrategy: 'per-turn',
      hangTimeout: { first: 30_000, subsequent: 10_000 },
      model: 'gemini-1.5-pro',
    };
    const provider = createProvider({
      id: 'gemini-cli-1',
      displayName: 'Gemini CLI',
      config,
    });
    expectSummarize(provider.capabilities);
  });
});
