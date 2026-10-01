// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageSearchView } from '../MessageSearchView';
import { i18next } from '../../../i18n';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => { void i18next.changeLanguage('ko'); });

function stubBridge() {
  const invoke = vi.fn(async (channel: string) => {
    if (channel !== 'message:search') throw new Error(`unexpected IPC: ${channel}`);
    return { hits: [{
      id: 'msg-1', channelId: 'c1', meetingId: null,
      authorId: 'user', authorKind: 'user', role: 'user',
      content: 'hello', meta: null, createdAt: 1, rank: -1,
      snippet: '<mark>hello</mark>', channelName: 'general', projectName: null,
    }] };
  });
  vi.stubGlobal('arena', { platform: 'linux', invoke });
  return invoke;
}

const CHANNEL_SCOPE = { kind: 'channel', channelId: 'c1', channelName: 'general' } as const;

async function settleDebounce(): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
}

describe('channel search', () => {
  it('shows the current conversation and has no project scope control', () => {
    stubBridge();
    render(<MessageSearchView open onOpenChange={() => {}} scope={CHANNEL_SCOPE} onNavigate={() => {}} />);
    expect((screen.getByTestId('message-search-input') as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByTestId('message-search-dialog').getAttribute('data-scope')).toBe('channel');
    expect(screen.getByTestId('message-search-channel-label').textContent).toContain('general');
    expect(screen.queryByTestId('message-search-scope-toggle')).toBeNull();
  });

  it('searches only the selected channel and navigates to its result', async () => {
    const invoke = stubBridge();
    const onNavigate = vi.fn();
    const onOpenChange = vi.fn();
    render(<MessageSearchView open onOpenChange={onOpenChange} scope={CHANNEL_SCOPE} onNavigate={onNavigate} />);
    fireEvent.change(screen.getByTestId('message-search-input'), { target: { value: 'hello' } });
    await settleDebounce();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('message:search',
      expect.objectContaining({ query: 'hello*', scope: { kind: 'channel', channelId: 'c1' } })));
    fireEvent.click(await screen.findByTestId('search-result-row'));
    expect(onNavigate).toHaveBeenCalledWith('c1', 'msg-1');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('waits for IME composition to finish before sending a query', async () => {
    const invoke = stubBridge();
    render(<MessageSearchView open onOpenChange={() => {}} scope={CHANNEL_SCOPE} onNavigate={() => {}} />);
    const input = screen.getByTestId('message-search-input');
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '안' } });
    await settleDebounce();
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input, { target: { value: '안녕' } });
    await settleDebounce();
    expect(invoke).toHaveBeenCalledWith('message:search',
      expect.objectContaining({ query: '안녕*', scope: { kind: 'channel', channelId: 'c1' } }));
  });
});

describe('search across every conversation (chat list search, R2-2)', () => {
  it('starts with the query typed in the chat list and searches the chats scope', async () => {
    const invoke = stubBridge();
    render(<MessageSearchView open onOpenChange={() => {}} scope={{ kind: 'chats' }} initialQuery="hello"
      channelLabel={(channelId) => (channelId === 'c1' ? '일반 채널' : null)} onNavigate={() => {}} />);
    expect(screen.getByTestId('message-search-dialog').getAttribute('data-scope')).toBe('chats');
    expect(screen.getByTestId('message-search-channel-label').textContent).toBe('모든 대화');
    expect((screen.getByTestId('message-search-input') as HTMLInputElement).value).toBe('hello');
    await settleDebounce();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('message:search',
      expect.objectContaining({ query: 'hello*', scope: { kind: 'chats' } })));
    expect((await screen.findByTestId('search-result-channel')).textContent).toBe('일반 채널');
  });
});
