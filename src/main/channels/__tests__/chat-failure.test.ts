import { describe, expect, it } from 'vitest';
import type { ProviderConfig } from '../../../shared/provider-types';
import { ProviderCallError } from '../../providers/provider-call-error';
import { ProviderUsageLimitError } from '../../providers/provider-usage-limit-error';
import { describeChatFailure } from '../chat-failure';
import { InvalidChatOutputError } from '../chat-whisper-output';

const cli = (command: string): ProviderConfig => ({ type: 'cli', command } as ProviderConfig);
const api = { type: 'api' } as ProviderConfig;

describe('describeChatFailure (spec 2026-10-08 F3)', () => {
  it('reports a timeout before any cause', () => {
    expect(describeChatFailure(new ProviderCallError('x', 'service-busy', 'HTTP 503'), true, api))
      .toEqual({ code: 'timeout', cause: null, causeDetail: null });
  });

  it('attaches a cause only to provider_error from a ProviderCallError', () => {
    expect(describeChatFailure(new ProviderCallError('x', 'service-busy', 'HTTP 503'), false, api))
      .toEqual({ code: 'provider_error', cause: 'service-busy', causeDetail: 'HTTP 503' });
    expect(describeChatFailure(new Error('plain'), false, api))
      .toEqual({ code: 'provider_error', cause: null, causeDetail: null });
    expect(describeChatFailure(new ProviderUsageLimitError('limit'), false, api))
      .toEqual({ code: 'usage_limit', cause: null, causeDetail: null });
    expect(describeChatFailure(new InvalidChatOutputError(), false, api))
      .toEqual({ code: 'invalid_response', cause: null, causeDetail: null });
  });

  it('names a CLI cause by the configured CLI key, never by the error', () => {
    const error = new ProviderCallError('x', 'cli-login-required', 'from-error');
    expect(describeChatFailure(error, false, cli('C:\\tools\\Claude.cmd')).causeDetail).toBe('claude');
    expect(describeChatFailure(error, false, cli('codex')).causeDetail).toBe('codex');
    expect(describeChatFailure(error, false, cli('gemini')).causeDetail).toBeNull();
    expect(describeChatFailure(error, false, null)).toEqual({
      code: 'provider_error', cause: 'cli-login-required', causeDetail: null,
    });
  });
});
