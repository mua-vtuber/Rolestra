import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import en from '../locales/en.json';
import ko from '../locales/ko.json';

function lookup(catalogue: unknown, key: string): unknown {
  let value: unknown = catalogue;
  for (const part of key.split('.')) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

const LIVE_CHAT_KEYS = [
  'chat.nav',
  'chatList.title',
  'chatList.search.placeholder',
  'settings.title',
  'room.header.observing',
  'chat.emptyProviders',
  'providerConnect.title',
  'providerConnect.add',
  'providerConnect.invalidEndpoint',
  'providerConnect.error.keyCleanupFailed',
  'message.search.filter.allChats',
  'messenger.thread.empty',
  'messenger.memberPanel.participantsTitle',
] as const;

describe('chat catalogue parity', () => {
  it.each(LIVE_CHAT_KEYS)('%s exists in ko and en', (key) => {
    expect(typeof lookup(ko, key)).toBe('string');
    expect(typeof lookup(en, key)).toBe('string');
  });

  it('translates chat labels instead of copying Korean into English', () => {
    expect(LIVE_CHAT_KEYS.filter((key) => lookup(ko, key) === lookup(en, key))).toEqual([]);
  });

  it.each([
    'src/renderer/App.tsx',
    'src/renderer/features/messenger/Thread.tsx',
    'src/renderer/features/messenger/MemberPanel.tsx',
    'src/renderer/features/settings/ProviderConnect.tsx',
  ])('%s has no user-facing defaultValue literal', (file) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf-8');
    expect(source).not.toContain('defaultValue');
  });
});
