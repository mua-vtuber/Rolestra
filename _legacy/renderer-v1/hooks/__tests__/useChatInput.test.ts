/**
 * Tests for useChatInput hook.
 *
 * Validates input state management, send validation, clear-after-send,
 * keydown handling (Enter/Shift+Enter), and attachment management.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { installArenaMock } from './setup';
import { useChatInput } from '../useChatInput';
import { useChatStore } from '../../stores/chat-store';
import { useProviderStore } from '../../stores/provider-store';

// ── Mock stores ─────────────────────────────────────────────────────────

vi.mock('../../stores/chat-store', () => ({
  useChatStore: vi.fn(),
}));

vi.mock('../../stores/provider-store', () => ({
  useProviderStore: vi.fn(),
}));

const mockedUseChatStore = vi.mocked(useChatStore);
const mockedUseProviderStore = vi.mocked(useProviderStore);

describe('useChatInput', () => {
  let invoke: ReturnType<typeof vi.fn>;

  const sendMock = vi.fn().mockResolvedValue(undefined);
  const interjectMock = vi.fn().mockResolvedValue(undefined);
  const toggleProviderSelectionMock = vi.fn();

  function setupStores(overrides?: {
    sending?: boolean;
    paused?: boolean;
    providers?: Array<{ id: string }>;
    selectedProviderIds?: string[];
  }): void {
    const sending = overrides?.sending ?? false;
    const paused = overrides?.paused ?? false;
    const providers = overrides?.providers ?? [{ id: 'provider-1' }];
    const selectedProviderIds = overrides?.selectedProviderIds ?? ['provider-1'];

    mockedUseChatStore.mockImplementation((selector: unknown) => {
      const state = {
        sending,
        paused,
        send: sendMock,
        interject: interjectMock,
      };
      return (selector as (s: typeof state) => unknown)(state);
    });

    mockedUseProviderStore.mockImplementation((selector: unknown) => {
      const state = {
        providers,
        selectedProviderIds,
        toggleProviderSelection: toggleProviderSelectionMock,
      };
      return (selector as (s: typeof state) => unknown)(state);
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    ({ invoke } = installArenaMock());
    sendMock.mockResolvedValue(undefined);
    interjectMock.mockResolvedValue(undefined);
    setupStores();
  });

  // ── Initial state ──────────────────────────────────────────────

  it('starts with empty input and no attachments', () => {
    const { result } = renderHook(() => useChatInput({ pendingDiffs: null }));
    expect(result.current.input).toBe('');
    expect(result.current.attachments).toEqual([]);
  });

  // ── setInput ───────────────────────────────────────────────────

  it('updates input via setInput', () => {
    const { result } = renderHook(() => useChatInput({ pendingDiffs: null }));
    act(() => { result.current.setInput('hello'); });
    expect(result.current.input).toBe('hello');
  });

  // ── handleSend validation ──────────────────────────────────────

  it('does not send when input is empty', () => {
    const { result } = renderHook(() => useChatInput({ pendingDiffs: null }));
    act(() => { result.current.handleSend(); });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('does not send when input is whitespace only', () => {
    const { result } = renderHook(() => useChatInput({ pendingDiffs: null }));
    act(() => { result.current.setInput('   '); });
    act(() => { result.current.handleSend(); });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('does not send when no active providers', () => {
    setupStores({ selectedProviderIds: [] });
    const { result } = renderHook(() => useChatInput({ pendingDiffs: null }));
    act(() => { result.current.setInput('hello'); });
    act(() => { result.current.handleSend(); });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('does not send when pending diffs exist', () => {
    const { result } = renderHook(() => useChatInput({
      pendingDiffs: { operationId: 'op-1', diffs: [] },
    }));
    act(() => { result.current.setInput('hello'); });
    act(() => { result.current.handleSend(); });
    expect(sendMock).not.toHaveBeenCalled();
  });

  // ── Successful send ────────────────────────────────────────────

  it('calls send and clears input on valid send', () => {
    const { result } = renderHook(() => useChatInput({ pendingDiffs: null }));
    act(() => { result.current.setInput('hello world'); });
    act(() => { result.current.handleSend(); });
    expect(sendMock).toHaveBeenCalledWith('hello world', ['provider-1'], undefined);
    expect(result.current.input).toBe('');
  });

  it('clears attachments after send', () => {
    invoke.mockResolvedValue({ folderPath: '/test/path' });
    const { result } = renderHook(() => useChatInput({ pendingDiffs: null }));

    // Manually add attachment by invoking handleAttachFiles
    act(() => { result.current.setInput('msg'); });

    // After send, attachments should be empty
    act(() => { result.current.handleSend(); });
    expect(result.current.attachments).toEqual([]);
  });

  // ── Interject when sending/paused ──────────────────────────────

  it('calls interject instead of send when sending is true', () => {
    setupStores({ sending: true });
    const { result } = renderHook(() => useChatInput({ pendingDiffs: null }));
    act(() => { result.current.setInput('interjection'); });
    act(() => { result.current.handleSend(); });
    expect(interjectMock).toHaveBeenCalledWith('interjection', ['provider-1']);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('calls interject instead of send when paused is true', () => {
    setupStores({ paused: true });
    const { result } = renderHook(() => useChatInput({ pendingDiffs: null }));
    act(() => { result.current.setInput('paused msg'); });
    act(() => { result.current.handleSend(); });
    expect(interjectMock).toHaveBeenCalledWith('paused msg', ['provider-1']);
    expect(sendMock).not.toHaveBeenCalled();
  });

  // ── handleKeyDown ──────────────────────────────────────────────

  it('calls handleSend on Enter (without Shift)', () => {
    const { result } = renderHook(() => useChatInput({ pendingDiffs: null }));
    act(() => { result.current.setInput('key msg'); });

    const preventDefault = vi.fn();
    act(() => {
      result.current.handleKeyDown({
        key: 'Enter',
        shiftKey: false,
        nativeEvent: { isComposing: false },
        preventDefault,
      } as unknown as React.KeyboardEvent<HTMLTextAreaElement>);
    });
    expect(preventDefault).toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalled();
  });

  it('does not send on Shift+Enter', () => {
    const { result } = renderHook(() => useChatInput({ pendingDiffs: null }));
    act(() => { result.current.setInput('multiline'); });

    const preventDefault = vi.fn();
    act(() => {
      result.current.handleKeyDown({
        key: 'Enter',
        shiftKey: true,
        nativeEvent: { isComposing: false },
        preventDefault,
      } as unknown as React.KeyboardEvent<HTMLTextAreaElement>);
    });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('ignores keydown during IME composition', () => {
    const { result } = renderHook(() => useChatInput({ pendingDiffs: null }));
    act(() => { result.current.setInput('composing'); });

    act(() => {
      result.current.handleKeyDown({
        key: 'Enter',
        shiftKey: false,
        nativeEvent: { isComposing: true },
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent<HTMLTextAreaElement>);
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  // ── Attachment management ──────────────────────────────────────

  it('handleAttachFiles adds a folder path', async () => {
    invoke.mockResolvedValue({ folderPath: '/project/src' });
    const { result } = renderHook(() => useChatInput({ pendingDiffs: null }));

    await act(async () => { await result.current.handleAttachFiles(); });
    expect(result.current.attachments).toEqual(['/project/src']);
  });

  it('handleRemoveAttachment removes by index', async () => {
    invoke.mockResolvedValue({ folderPath: '/path/a' });
    const { result } = renderHook(() => useChatInput({ pendingDiffs: null }));

    await act(async () => { await result.current.handleAttachFiles(); });
    invoke.mockResolvedValue({ folderPath: '/path/b' });
    await act(async () => { await result.current.handleAttachFiles(); });
    expect(result.current.attachments).toEqual(['/path/a', '/path/b']);

    act(() => { result.current.handleRemoveAttachment(0); });
    expect(result.current.attachments).toEqual(['/path/b']);
  });

  it('handleAttachFiles does not add empty folder path', async () => {
    invoke.mockResolvedValue({ folderPath: '' });
    const { result } = renderHook(() => useChatInput({ pendingDiffs: null }));

    await act(async () => { await result.current.handleAttachFiles(); });
    expect(result.current.attachments).toEqual([]);
  });
});
