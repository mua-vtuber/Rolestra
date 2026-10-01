import { describe, expect, it } from 'vitest';

import { createProvider, isSupportedChatCliCommand } from '../factory';
import { resolveApiCapabilities, resolveCliCapabilities } from '../capability-resolver';

describe('Gemini CLI retirement', () => {
  it('rejects Gemini command names and paths while retaining Claude and Codex', () => {
    expect(isSupportedChatCliCommand('gemini')).toBe(false);
    expect(isSupportedChatCliCommand('C:\\Tools\\gemini.cmd')).toBe(false);
    expect(isSupportedChatCliCommand('/usr/local/bin/gemini')).toBe(false);
    expect(isSupportedChatCliCommand('claude')).toBe(true);
    expect(isSupportedChatCliCommand('codex')).toBe(true);
  });

  it('keeps Google API capabilities without advertising Gemini CLI capabilities', () => {
    expect(resolveApiCapabilities('https://generativelanguage.googleapis.com/v1beta'))
      .toEqual(['streaming', 'summarize', 'tools', 'multimodal']);
    expect(resolveCliCapabilities('gemini')).toEqual(['streaming', 'summarize']);
  });

  it('refuses direct factory construction for a retired Gemini CLI', () => {
    expect(() => createProvider({
      displayName: 'Gemini CLI',
      config: {
        type: 'cli', command: 'gemini', args: [], inputFormat: 'pipe',
        outputFormat: 'stream-json', sessionStrategy: 'per-turn',
        hangTimeout: { first: 30_000, subsequent: 30_000 }, model: 'gemini-2.5-pro',
      },
    })).toThrow('Unsupported chat CLI command');
  });
});
