// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GeneralVariant } from '../SsmBox/GeneralVariant';
import { i18next } from '../../../i18n';
import { ThemeProvider } from '../../../theme/theme-provider';
import { useChatVote } from '../../../hooks/use-chat-vote';
import type { GeneralOpinionCard, Opinion } from '../../../../shared/opinion-types';

function card(id: string, channelId = 'room-a'): GeneralOpinionCard {
  const opinion: Opinion = {
    id, parentId: null, meetingId: null, channelId, kind: 'user-raised',
    authorProviderId: null, authorLabel: 'User', title: `Topic ${id}`,
    content: 'Should we ship?', rationale: null, status: 'pending',
    exclusionReason: null, round: 0, createdAt: 1, updatedAt: 1,
  };
  return { opinion, agreeCount: 2, opposeCount: 1, userVote: null };
}

const completedVote = {
  id: 'vote-a', opinionId: 'op-a', channelId: 'room-a', status: 'completed',
  createdAt: 1, completedAt: 2, resultMessageId: null,
  participants: [
    { providerId: 'ai-1', displayName: 'Alpha', status: 'submitted', opinion: 'Ship it', vote: 'agree', error: null },
    { providerId: 'ai-2', displayName: 'Beta', status: 'submitted', opinion: 'Wait for QA', vote: 'oppose', error: null },
    { providerId: 'ai-3', displayName: 'Gamma', status: 'submitted', opinion: 'Need more data', vote: 'abstain', error: null },
    { providerId: 'ai-4', displayName: 'Delta', status: 'failed', opinion: null, vote: null, error: 'timeout' },
  ],
  counts: { agree: 1, oppose: 1, abstain: 1, pending: 0, failed: 1, total: 4 },
} as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup(overrides?: {
  listCards?: (channelId: string) => Promise<GeneralOpinionCard[]>;
  getVote?: (opinionId: string) => Promise<unknown>;
  startVote?: (opinionId: string) => Promise<unknown>;
  sendVoteResult?: (opinionId: string) => Promise<unknown>;
}) {
  const invoke = vi.fn(async (channel: string, data: { channelId?: string; opinionId?: string }) => {
    if (channel === 'opinion:listGeneralCards') {
      const cards = await (overrides?.listCards?.(data.channelId!) ?? Promise.resolve([card(data.channelId === 'room-b' ? 'op-b' : 'op-a', data.channelId)]));
      return { result: { channelId: data.channelId, cards } };
    }
    if (channel === 'opinion:getVote') return { result: await (overrides?.getVote?.(data.opinionId!) ?? Promise.resolve(null)) };
    if (channel === 'opinion:startVote') return { result: await (overrides?.startVote?.(data.opinionId!) ?? Promise.resolve(completedVote)) };
    if (channel === 'opinion:sendVoteResult') return { result: await (overrides?.sendVoteResult?.(data.opinionId!) ?? Promise.resolve({ ...completedVote, resultMessageId: 'result-a' })) };
    throw new Error(`Unexpected IPC ${channel}`);
  });
  (window as unknown as { arena: unknown }).arena = { platform: 'linux', invoke, onStream: () => () => {} };
  return invoke;
}

function show(channelId = 'room-a', readOnly = false) {
  return render(<ThemeProvider><GeneralVariant channelId={channelId} readOnly={readOnly} /></ThemeProvider>);
}

beforeEach(() => { void i18next.changeLanguage('en'); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); delete (window as { arena?: unknown }).arena; });

describe('chat opinion AI vote', () => {
  it('coalesces sends before rerender and keeps the next card locked when an older request finishes', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const invoke = setup({
      getVote: async (opinionId) => ({ ...completedVote, opinionId }),
      sendVoteResult: (opinionId) => opinionId === 'op-a' ? first.promise : second.promise,
    });
    const { result, rerender } = renderHook(({ id }) => useChatVote(id), { initialProps: { id: 'op-a' } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => { void result.current.sendResult(); void result.current.sendResult(); });
    expect(invoke.mock.calls.filter(([name]) => name === 'opinion:sendVoteResult')).toHaveLength(1);

    rerender({ id: 'op-b' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => { void result.current.sendResult(); });
    await act(async () => { first.resolve({ ...completedVote, resultMessageId: 'result-a' }); await first.promise; });
    expect(result.current.sending).toBe(true);
    expect(result.current.vote?.opinionId).toBe('op-b');
    expect(result.current.vote?.resultMessageId).toBeNull();
    act(() => { void result.current.sendResult(); });
    expect(invoke.mock.calls.filter(([name]) => name === 'opinion:sendVoteResult'))
      .toEqual([['opinion:sendVoteResult', { opinionId: 'op-a' }], ['opinion:sendVoteResult', { opinionId: 'op-b' }]]);
    await act(async () => {
      second.resolve({ ...completedVote, opinionId: 'op-b', resultMessageId: 'result-b' });
      await second.promise;
    });
    expect(result.current.sending).toBe(false);
    expect(result.current.vote?.resultMessageId).toBe('result-b');
  });

  it('sends a completed result only on request and keeps the persisted sent state after remount', async () => {
    const pending = deferred<unknown>();
    let savedVote: unknown = completedVote;
    const invoke = setup({ getVote: async () => savedVote, sendVoteResult: () => pending.promise });
    const view = show();
    const button = await screen.findByRole('button', { name: 'Send result' });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(invoke.mock.calls.filter(([name]) => name === 'opinion:sendVoteResult')).toHaveLength(0);

    fireEvent.click(button);
    fireEvent.click(button);
    expect((screen.getByRole('button', { name: 'Sending…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(invoke.mock.calls.filter(([name]) => name === 'opinion:sendVoteResult'))
      .toEqual([['opinion:sendVoteResult', { opinionId: 'op-a' }]]);
    savedVote = { ...completedVote, resultMessageId: 'result-a' };
    await act(async () => { pending.resolve(savedVote); await pending.promise; });
    expect((screen.getByRole('button', { name: 'Sent' }) as HTMLButtonElement).disabled).toBe(true);
    view.unmount();

    show();
    expect((await screen.findByRole('button', { name: 'Sent' }) as HTMLButtonElement).disabled).toBe(true);
    expect(invoke.mock.calls.filter(([name]) => name === 'opinion:sendVoteResult')).toHaveLength(1);
  });

  it.each(['running', 'interrupted'] as const)('disables result sending when the vote is %s', async (status) => {
    const invoke = setup({ getVote: async () => ({ ...completedVote, status }) });
    show();
    const button = await screen.findByRole('button', { name: 'Send result' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(invoke.mock.calls.filter(([name]) => name === 'opinion:sendVoteResult')).toHaveLength(0);
  });

  it('disables result sending for archived rooms even when the vote completed', async () => {
    const invoke = setup({ getVote: async () => completedVote });
    show('room-a', true);
    const button = await screen.findByRole('button', { name: 'Send result' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(invoke.mock.calls.filter(([name]) => name === 'opinion:sendVoteResult')).toHaveLength(0);
  });

  it('keeps a failed result send retryable without exposing a backend error', async () => {
    let attempts = 0;
    setup({ getVote: async () => completedVote, sendVoteResult: async () => {
      if (++attempts === 1) throw new Error('private backend detail');
      return { ...completedVote, resultMessageId: 'result-a' };
    } });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Send result' }));
    const error = await screen.findByTestId('chat-vote-send-error');
    expect(error.textContent).toBe('Could not send the vote result. Please try again.');
    expect(screen.queryByText('private backend detail')).toBeNull();
    const retry = screen.getByRole('button', { name: 'Send result' });
    expect((retry as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(retry);
    await screen.findByRole('button', { name: 'Sent' });
    expect(screen.queryByTestId('chat-vote-send-error')).toBeNull();
  });

  it.each(['resolve', 'reject'] as const)('ignores a send %s after changing rooms', async (outcome) => {
    const stale = deferred<unknown>();
    setup({ getVote: async (id) => ({ ...completedVote, opinionId: id }), sendVoteResult: () => stale.promise });
    const view = show();
    fireEvent.click(await screen.findByRole('button', { name: 'Send result' }));
    view.rerender(<ThemeProvider><GeneralVariant channelId="room-b" readOnly={false} /></ThemeProvider>);
    await screen.findByText('Topic op-b');
    await screen.findByRole('button', { name: 'Send result' });
    await act(async () => {
      if (outcome === 'resolve') stale.resolve({ ...completedVote, resultMessageId: 'result-a' });
      else stale.reject(new Error('old room send failure'));
      await stale.promise.catch(() => {});
    });
    expect((screen.getByRole('button', { name: 'Send result' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId('chat-vote-send-error')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sent' })).toBeNull();
  });

  it('only starts on explicit card action and suppresses a duplicate click while starting', async () => {
    const pending = deferred<typeof completedVote>();
    const invoke = setup({ startVote: () => pending.promise });
    show();
    const button = await screen.findByTestId('chat-vote-start');
    expect(invoke.mock.calls.filter(([name]) => name === 'opinion:startVote')).toHaveLength(0);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(invoke.mock.calls.filter(([name]) => name === 'opinion:startVote')).toHaveLength(1);
    pending.resolve(completedVote);
    await screen.findByTestId('chat-vote-results');
    expect(screen.queryByTestId('chat-vote-start')).toBeNull();
  });

  it('shows AI identity, opinion, each vote and pending/failed counts apart from user lights', async () => {
    setup({ getVote: async () => completedVote });
    show();
    const results = await screen.findByTestId('chat-vote-results');
    expect(within(results).getByText('Alpha')).toBeTruthy();
    expect(within(results).getByText('Ship it')).toBeTruthy();
    expect(within(results).getByText('Beta')).toBeTruthy();
    expect(within(results).getByText('Wait for QA')).toBeTruthy();
    expect(within(results).getByText('Gamma')).toBeTruthy();
    expect(within(results).getByText('Need more data')).toBeTruthy();
    expect(within(results).getByText('Delta')).toBeTruthy();
    expect(results.textContent).toContain('Pending 0');
    expect(results.textContent).toContain('Failed 1');
    expect(screen.getByTestId('ssm-box-general-vote-agree').textContent).toContain('2');
    expect(screen.getByTestId('ssm-box-general-vote-oppose').textContent).toContain('1');
  });

  it('allows archived rooms to inspect results without start or user vote controls', async () => {
    const invoke = setup({ getVote: async () => completedVote });
    show('room-a', true);
    await screen.findByTestId('chat-vote-results');
    expect(screen.queryByTestId('chat-vote-start')).toBeNull();
    expect(screen.queryByTestId('ssm-box-general-vote-agree')).toBeNull();
    expect(screen.queryByTestId('ssm-box-general-vote-oppose')).toBeNull();
    expect(screen.getByTestId('chat-user-light-counts').textContent).toContain('Your votes: agree 2');
    expect(invoke.mock.calls.filter(([name]) => name === 'opinion:startVote')).toHaveLength(0);
  });

  it('does not display a stale success or error after changing rooms', async () => {
    const stale = deferred<unknown>();
    const invoke = setup({ getVote: (id) => id === 'op-a' ? stale.promise : Promise.resolve(null) });
    const view = show();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('opinion:getVote', { opinionId: 'op-a' }));
    view.rerender(<ThemeProvider><GeneralVariant channelId="room-b" readOnly={false} /></ThemeProvider>);
    await screen.findByText('Topic op-b');
    stale.reject(new Error('old room error'));
    await waitFor(() => expect(screen.queryByText('old room error')).toBeNull());
    expect(screen.queryByTestId('chat-vote-results')).toBeNull();
  });

  it('polls only a running vote until it completes', async () => {
    let reads = 0;
    const invoke = setup({
      getVote: async () => ++reads === 1 ? null : completedVote,
      startVote: async () => ({ ...completedVote, status: 'running', completedAt: null,
        participants: completedVote.participants.map((person) => ({ ...person, status: 'pending', opinion: null, vote: null, error: null })),
        counts: { agree: 0, oppose: 0, abstain: 0, pending: 4, failed: 0, total: 4 } }),
    });
    show();
    fireEvent.click(await screen.findByTestId('chat-vote-start'));
    await screen.findByTestId('chat-vote-results');
    expect(screen.getByTestId('chat-vote-results').getAttribute('data-status')).toBe('running');
    expect(screen.getByTestId('chat-vote-counts').textContent).toContain('Pending 4');
    await waitFor(() => expect(screen.getByTestId('chat-vote-results').getAttribute('data-status')).toBe('completed'), { timeout: 3000 });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1100)); });
    expect(invoke.mock.calls.filter(([name]) => name === 'opinion:getVote')).toHaveLength(2);
  });

  it('discards a start result after the card changes to another room', async () => {
    const stale = deferred<unknown>();
    const invoke = setup({ startVote: () => stale.promise });
    const view = show();
    fireEvent.click(await screen.findByTestId('chat-vote-start'));
    expect(invoke).toHaveBeenCalledWith('opinion:startVote', { opinionId: 'op-a' });
    view.rerender(<ThemeProvider><GeneralVariant channelId="room-b" readOnly={false} /></ThemeProvider>);
    await screen.findByText('Topic op-b');
    await screen.findByTestId('chat-vote-start');
    await act(async () => { stale.resolve(completedVote); await stale.promise; });
    expect(screen.queryByTestId('chat-vote-results')).toBeNull();
    expect(screen.getByTestId('chat-vote-start').getAttribute('data-card-id')).toBe('op-b');
  });

  it('hides previous room cards while the next room list is unresolved', async () => {
    const pending = deferred<GeneralOpinionCard[]>();
    const invoke = setup({ listCards: (id) => id === 'room-b' ? pending.promise : Promise.resolve([card('op-a')]) });
    const view = show();
    await screen.findByText('Topic op-a');
    view.rerender(<ThemeProvider><GeneralVariant channelId="room-b" readOnly={false} /></ThemeProvider>);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('opinion:listGeneralCards', { channelId: 'room-b' }));
    expect(screen.queryByText('Topic op-a')).toBeNull();
    expect(screen.queryByTestId('chat-vote-start')).toBeNull();
    pending.resolve([card('op-b', 'room-b')]);
    await screen.findByText('Topic op-b');
  });
});
