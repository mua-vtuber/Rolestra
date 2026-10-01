// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const notifyError = vi.hoisted(() => vi.fn());
vi.mock('../../components/ErrorBoundary', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../components/ErrorBoundary')>(), notifyError,
}));

import { useChatActivityStream } from '../use-chat-activity-stream';
import { i18next } from '../../i18n';
import { channelBusy, useChatActivityStore } from '../../stores/chat-activity-store';
import type { StreamChatActivityPayload, StreamChatRoundPayload } from '../../../shared/stream-events';

type Listener = (payload: unknown) => void;

function stub(activeRounds: () => Promise<{ channelIds: string[] }>) {
  const listeners = new Map<string, Listener>();
  const offs: string[] = [];
  const onStream = vi.fn((type: string, callback: Listener) => {
    listeners.set(type, callback);
    return () => { offs.push(type); };
  });
  const invoke = vi.fn(async (channel: string) => {
    if (channel !== 'chat:list-active-rounds') throw new Error(`unexpected IPC: ${channel}`);
    return activeRounds();
  });
  vi.stubGlobal('arena', { platform: 'linux', invoke, onStream });
  return {
    invoke, offs,
    activity: (payload: StreamChatActivityPayload) => listeners.get('stream:chat-activity')?.(payload),
    round: (payload: StreamChatRoundPayload) => listeners.get('stream:chat-round')?.(payload),
  };
}

beforeEach(() => {
  useChatActivityStore.getState().reset();
  notifyError.mockClear();
  void i18next.changeLanguage('ko');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('useChatActivityStream (spec 2026-10-01 F5, QA M1)', () => {
  it('feeds both streams into the store and unsubscribes on unmount', async () => {
    const bridge = stub(async () => ({ channelIds: [] }));
    const view = renderHook(() => useChatActivityStream());
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('chat:list-active-rounds', undefined));
    await act(async () => { await Promise.resolve(); });
    act(() => {
      bridge.activity({ channelId: 'room', providerId: 'ai-a', phase: 'writing', kind: 'turn' });
      bridge.round({ channelId: 'room', active: true });
    });
    expect(Object.keys(useChatActivityStore.getState().byChannel.room ?? {})).toEqual(['ai-a']);
    expect(channelBusy(useChatActivityStore.getState(), 'room')).toBe(true);

    view.unmount();
    expect(bridge.offs.sort()).toEqual(['stream:chat-activity', 'stream:chat-round']);
  });

  it('starts from the active rounds main reports, then applies round events that arrived meanwhile', async () => {
    let answer: (value: { channelIds: string[] }) => void = () => undefined;
    const bridge = stub(() => new Promise((resolve) => { answer = resolve; }));
    renderHook(() => useChatActivityStream());
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalled());

    act(() => {
      bridge.round({ channelId: 'room-a', active: false });
      bridge.round({ channelId: 'room-c', active: true });
    });
    await act(async () => { answer({ channelIds: ['room-a', 'room-b'] }); await Promise.resolve(); });

    const state = useChatActivityStore.getState();
    expect(channelBusy(state, 'room-a')).toBe(false);
    expect(channelBusy(state, 'room-b')).toBe(true);
    expect(channelBusy(state, 'room-c')).toBe(true);
  });

  it('says so when the active rounds cannot be read, and keeps following live events', async () => {
    const bridge = stub(async () => { throw new Error('ipc down'); });
    renderHook(() => useChatActivityStream());
    await waitFor(() => expect(notifyError).toHaveBeenCalledOnce());
    expect(notifyError.mock.calls[0]?.[0]).toBe('진행 중인 대화 상태를 불러오지 못했습니다. (ipc down)');
    act(() => bridge.round({ channelId: 'room', active: true }));
    expect(channelBusy(useChatActivityStore.getState(), 'room')).toBe(true);
  });
});
