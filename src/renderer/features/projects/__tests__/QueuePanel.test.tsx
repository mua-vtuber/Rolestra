// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '../../../i18n';
import { i18next } from '../../../i18n';
import { QueuePanel } from '../QueuePanel';
import type { QueueItem } from '../../../../shared/queue-types';

function makeItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: 'q-1',
    projectId: 'p1',
    targetChannelId: null,
    orderIndex: 0,
    prompt: 'do X',
    status: 'pending',
    startedMeetingId: null,
    startedAt: null,
    finishedAt: null,
    lastError: null,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeRouter(
  routes: Record<string, (data: unknown) => unknown>,
): ReturnType<typeof vi.fn> {
  return vi.fn((channel: string, data: unknown) => {
    const handler = routes[channel];
    if (!handler) {
      return Promise.reject(new Error(`no mock for channel ${channel}`));
    }
    try {
      return Promise.resolve(handler(data));
    } catch (reason) {
      return Promise.reject(reason);
    }
  });
}

function setupArena(invoke: ReturnType<typeof vi.fn>): {
  emit: (type: string, payload: unknown) => void;
} {
  const subs = new Map<string, ((p: unknown) => void)[]>();
  vi.stubGlobal('arena', {
    platform: 'linux',
    invoke,
    onStream: (type: string, cb: (p: unknown) => void) => {
      const list = subs.get(type) ?? [];
      list.push(cb);
      subs.set(type, list);
      return () => {
        subs.set(type, (subs.get(type) ?? []).filter((h) => h !== cb));
      };
    },
  });
  return {
    emit: (type, payload) =>
      (subs.get(type) ?? []).forEach((cb) => cb(payload)),
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  void i18next.changeLanguage('ko');
});

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('QueuePanel', () => {
  it('empty state renders when queue:list returns no items', async () => {
    const invoke = makeRouter({ 'queue:list': () => ({ items: [] }) });
    setupArena(invoke);
    render(<QueuePanel projectId="p1" />);
    await waitFor(() => {
      expect(screen.getByTestId('queue-panel-empty')).toBeTruthy();
    });
  });

  it('renders each item from queue:list', async () => {
    const invoke = makeRouter({
      'queue:list': () => ({
        items: [
          makeItem({ id: 'q1', prompt: 'A' }),
          makeItem({ id: 'q2', prompt: 'B', status: 'in_progress' }),
        ],
      }),
    });
    setupArena(invoke);
    render(<QueuePanel projectId="p1" />);
    await waitFor(() => {
      expect(screen.getAllByTestId('queue-panel-item')).toHaveLength(2);
    });
    const items = screen.getAllByTestId('queue-panel-item');
    expect(items[0]?.getAttribute('data-status')).toBe('pending');
    expect(items[1]?.getAttribute('data-status')).toBe('in_progress');
  });

  it('add button disabled when input empty', async () => {
    const invoke = makeRouter({ 'queue:list': () => ({ items: [] }) });
    setupArena(invoke);
    render(<QueuePanel projectId="p1" />);
    await waitFor(() => {
      expect(screen.getByTestId('queue-panel-empty')).toBeTruthy();
    });
    const addBtn = screen.getByTestId('queue-panel-add') as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);
  });

  it('typing + add → invokes queue:add for each line', async () => {
    const invoke = makeRouter({
      'queue:list': () => ({ items: [] }),
      'queue:add': (data) => ({ item: makeItem({ id: 'new', prompt: (data as { prompt: string }).prompt }) }),
    });
    setupArena(invoke);
    render(<QueuePanel projectId="p1" />);
    await waitFor(() => screen.getByTestId('queue-panel-empty'));

    const input = screen.getByTestId('queue-panel-input');
    fireEvent.change(input, { target: { value: 'A\nB' } });

    const addBtn = screen.getByTestId('queue-panel-add');
    await act(async () => {
      fireEvent.click(addBtn);
      await new Promise((r) => setTimeout(r, 0));
    });

    const addCalls = invoke.mock.calls.filter((c) => c[0] === 'queue:add');
    expect(addCalls).toHaveLength(2);
  });

  it('pause button toggles label resume ↔ pause', async () => {
    const invoke = makeRouter({
      'queue:list': () => ({ items: [] }),
      'queue:pause': () => ({ success: true }),
      'queue:resume': () => ({ success: true }),
    });
    setupArena(invoke);
    render(<QueuePanel projectId="p1" />);
    await waitFor(() => screen.getByTestId('queue-panel-empty'));

    // i18n populate 는 Task 11 — 현재는 키 이름이 fallback 으로 렌더됨.
    // Task 11 에서 populate 한 뒤 "일시정지"/"재개" 로 업데이트 예정.
    const pauseBtn = screen.getByTestId('queue-panel-pause-toggle');
    const before = pauseBtn.textContent;

    await act(async () => {
      fireEvent.click(pauseBtn);
      await new Promise((r) => setTimeout(r, 0));
    });

    const resumeBtn = screen.getByTestId('queue-panel-pause-toggle');
    expect(resumeBtn.textContent).not.toBe(before);
    expect(invoke).toHaveBeenCalledWith('queue:pause', { projectId: 'p1' });
  });

  it('collapse toggle hides the body', async () => {
    const invoke = makeRouter({
      'queue:list': () => ({ items: [makeItem()] }),
    });
    setupArena(invoke);
    render(<QueuePanel projectId="p1" />);
    await waitFor(() => screen.getAllByTestId('queue-panel-item'));

    fireEvent.click(screen.getByTestId('queue-panel-toggle'));

    expect(screen.queryByTestId('queue-panel-input')).toBeNull();
    expect(
      screen.getByTestId('queue-panel').getAttribute('data-collapsed'),
    ).toBe('true');
  });

  it('stream:queue-updated reflects in UI (items + paused)', async () => {
    const invoke = makeRouter({ 'queue:list': () => ({ items: [] }) });
    const { emit } = setupArena(invoke);
    render(<QueuePanel projectId="p1" />);
    await waitFor(() => screen.getByTestId('queue-panel-empty'));

    act(() => {
      emit('stream:queue-updated', {
        projectId: 'p1',
        items: [makeItem({ id: 'q1', prompt: 'new' })],
        paused: true,
      });
    });

    expect(screen.getAllByTestId('queue-panel-item')).toHaveLength(1);
    expect(
      screen.getByTestId('queue-panel').getAttribute('data-paused'),
    ).toBe('true');
  });

  it('in_progress item has disabled remove button', async () => {
    const invoke = makeRouter({
      'queue:list': () => ({
        items: [makeItem({ id: 'active', status: 'in_progress' })],
      }),
    });
    setupArena(invoke);
    render(<QueuePanel projectId="p1" />);
    await waitFor(() => screen.getAllByTestId('queue-panel-item'));

    const removeBtn = screen.getByTestId('queue-panel-item-remove') as HTMLButtonElement;
    expect(removeBtn.disabled).toBe(true);
  });
});
