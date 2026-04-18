/**
 * ChatView component tests.
 *
 * Tests message rendering, send flow, participant selection,
 * control buttons (pause/resume/stop), search, and empty states.
 */

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { installArenaMock, makeProviderInfo, type InvokeMock, type OnMock } from './setup';
import { useChatStore } from '../../stores/chat-store';
import { useProviderStore } from '../../stores/provider-store';

import { ChatView } from '../ChatView';

// ── Helpers ────────────────────────────────────────────────────────────

/** Reset both stores to initial state. */
function resetStores(): void {
  useChatStore.setState({
    messages: [],
    sending: false,
    paused: false,
    conversationState: 'idle',
  });
  useProviderStore.setState({
    providers: [],
    selectedProviderIds: null,
    loading: false,
    error: null,
  });
}

/**
 * Build an invoke mock that returns `providers` for provider:list,
 * ensuring mount-time fetchProviders populates the store correctly.
 */
function buildInvokeMock(providers: ReturnType<typeof makeProviderInfo>[] = []): InvokeMock {
  return vi.fn().mockImplementation(async (channel: string) => {
    if (channel === 'provider:list') return { providers };
    if (channel === 'consensus:status') return { consensus: null };
    if (channel === 'chat:send') return undefined;
    if (channel === 'chat:set-rounds') return undefined;
    return undefined;
  });
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('ChatView', () => {
  let invoke: InvokeMock;
  let on: OnMock;

  beforeEach(() => {
    const mocks = installArenaMock();
    on = mocks.on;
    invoke = buildInvokeMock();
    // Replace the invoke on window.arena
    (window as unknown as Record<string, unknown>).arena = {
      invoke,
      on,
      platform: 'linux',
    };
    resetStores();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // ── Empty state ────────────────────────────────────────────────────

  it('shows empty state when no providers exist', async () => {
    await act(async () => {
      render(<ChatView />);
    });

    expect(screen.getByText('chat.emptyState')).toBeInTheDocument();
  });

  it('shows "no participants" when all providers deselected', async () => {
    const provider = makeProviderInfo();
    invoke = buildInvokeMock([provider]);
    (window as unknown as Record<string, unknown>).arena = { invoke, on, platform: 'linux' };

    await act(async () => {
      render(<ChatView />);
    });

    await act(async () => {
      useProviderStore.getState().toggleProviderSelection(provider.id);
    });

    expect(screen.getByText('chat.noParticipants')).toBeInTheDocument();
  });

  it('disables textarea when all providers are deselected', async () => {
    const provider = makeProviderInfo();
    invoke = buildInvokeMock([provider]);
    (window as unknown as Record<string, unknown>).arena = { invoke, on, platform: 'linux' };

    await act(async () => {
      render(<ChatView />);
    });

    const textarea = screen.getByPlaceholderText('chat.placeholder');
    await act(async () => {
      useProviderStore.getState().toggleProviderSelection(provider.id);
    });
    expect(textarea).toBeDisabled();
  });

  // ── Message input + send ──────────────────────────────────────────

  it('disables send button when input is empty', async () => {
    const provider = makeProviderInfo();
    invoke = buildInvokeMock([provider]);
    (window as unknown as Record<string, unknown>).arena = { invoke, on, platform: 'linux' };

    await act(async () => {
      render(<ChatView />);
    });

    const sendBtn = screen.getByText('chat.send');
    expect(sendBtn).toBeDisabled();
  });

  it('sends message on button click and clears input', async () => {
    const provider = makeProviderInfo();
    invoke = buildInvokeMock([provider]);
    (window as unknown as Record<string, unknown>).arena = { invoke, on, platform: 'linux' };

    await act(async () => {
      render(<ChatView />);
    });

    const textarea = screen.getByPlaceholderText('chat.placeholder');
    const sendBtn = screen.getByText('chat.send');

    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Hello AI' } });
    });
    expect(sendBtn).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(sendBtn);
    });

    // Input should be cleared
    expect(textarea).toHaveValue('');
  });

  it('sends message on Enter key (without shift)', async () => {
    const provider = makeProviderInfo();
    invoke = buildInvokeMock([provider]);
    (window as unknown as Record<string, unknown>).arena = { invoke, on, platform: 'linux' };

    await act(async () => {
      render(<ChatView />);
    });

    const textarea = screen.getByPlaceholderText('chat.placeholder');
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Test message' } });
    });

    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    });

    expect(textarea).toHaveValue('');
  });

  it('does not send on Shift+Enter', async () => {
    const provider = makeProviderInfo();
    invoke = buildInvokeMock([provider]);
    (window as unknown as Record<string, unknown>).arena = { invoke, on, platform: 'linux' };

    await act(async () => {
      render(<ChatView />);
    });

    const textarea = screen.getByPlaceholderText('chat.placeholder');
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Multi-line' } });
    });

    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    });

    expect(textarea).toHaveValue('Multi-line');
  });

  // ── Message rendering ─────────────────────────────────────────────

  it('renders messages from the chat store', async () => {
    const provider = makeProviderInfo();
    invoke = buildInvokeMock([provider]);
    (window as unknown as Record<string, unknown>).arena = { invoke, on, platform: 'linux' };
    useChatStore.setState({
      messages: [
        { id: 'msg-1', role: 'user', content: 'Hello world', speakerName: 'User', timestamp: Date.now() },
        { id: 'msg-2', role: 'assistant', content: 'Hi there!', speakerName: 'Claude', timestamp: Date.now() },
      ],
    });

    await act(async () => {
      render(<ChatView />);
    });

    expect(screen.getByText('Hello world')).toBeInTheDocument();
    expect(screen.getByText('Hi there!')).toBeInTheDocument();
    expect(screen.getByText('User')).toBeInTheDocument();
    expect(screen.getByText('Claude')).toBeInTheDocument();
  });

  it('displays token count and response time on messages', async () => {
    const provider = makeProviderInfo();
    invoke = buildInvokeMock([provider]);
    (window as unknown as Record<string, unknown>).arena = { invoke, on, platform: 'linux' };
    useChatStore.setState({
      messages: [
        {
          id: 'msg-1', role: 'assistant', content: 'Response',
          speakerName: 'GPT', timestamp: Date.now(),
          tokenCount: 42, responseTimeMs: 1500,
        },
      ],
    });

    await act(async () => {
      render(<ChatView />);
    });

    expect(screen.getByText('42 chat.tokens')).toBeInTheDocument();
    expect(screen.getByText('1.5s')).toBeInTheDocument();
  });

  // ── Controls (pause/resume/stop) ──────────────────────────────────

  it('shows pause/stop buttons when sending', async () => {
    const provider = makeProviderInfo();
    invoke = buildInvokeMock([provider]);
    (window as unknown as Record<string, unknown>).arena = { invoke, on, platform: 'linux' };
    useChatStore.setState({ sending: true, paused: false });

    await act(async () => {
      render(<ChatView />);
    });

    expect(screen.getByText('chat.pause')).toBeInTheDocument();
    expect(screen.getByText('chat.stop')).toBeInTheDocument();
  });

  it('shows resume button when paused', async () => {
    const provider = makeProviderInfo();
    invoke = buildInvokeMock([provider]);
    (window as unknown as Record<string, unknown>).arena = { invoke, on, platform: 'linux' };
    useChatStore.setState({ sending: true, paused: true });

    await act(async () => {
      render(<ChatView />);
    });

    expect(screen.getByText('chat.resume')).toBeInTheDocument();
  });

  it('hides controls when not sending', async () => {
    const provider = makeProviderInfo();
    invoke = buildInvokeMock([provider]);
    (window as unknown as Record<string, unknown>).arena = { invoke, on, platform: 'linux' };
    useChatStore.setState({ sending: false });

    await act(async () => {
      render(<ChatView />);
    });

    expect(screen.queryByText('chat.pause')).not.toBeInTheDocument();
    expect(screen.queryByText('chat.stop')).not.toBeInTheDocument();
  });

  // ── Thinking indicator ────────────────────────────────────────────

  it('shows thinking indicator when sending', async () => {
    const provider = makeProviderInfo();
    invoke = buildInvokeMock([provider]);
    (window as unknown as Record<string, unknown>).arena = { invoke, on, platform: 'linux' };
    useChatStore.setState({ sending: true });

    await act(async () => {
      render(<ChatView />);
    });

    expect(document.querySelector('.thinking-dots')).toBeTruthy();
  });

  // ── Search ────────────────────────────────────────────────────────

  it('filters messages when search is active', async () => {
    const provider = makeProviderInfo();
    invoke = buildInvokeMock([provider]);
    (window as unknown as Record<string, unknown>).arena = { invoke, on, platform: 'linux' };
    useChatStore.setState({
      messages: [
        { id: 'msg-1', role: 'user', content: 'Hello world', timestamp: Date.now() },
        { id: 'msg-2', role: 'assistant', content: 'Goodbye world', timestamp: Date.now() },
        { id: 'msg-3', role: 'user', content: 'Something else', timestamp: Date.now() },
      ],
    });

    await act(async () => {
      render(<ChatView />);
    });
    const inputArea = screen.getByPlaceholderText('chat.placeholder');

    // Open search with Ctrl+F
    await act(async () => {
      fireEvent.keyDown(inputArea, { key: 'f', ctrlKey: true });
    });

    const searchInput = screen.getByPlaceholderText('chat.searchPlaceholder');
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'world' } });
    });

    // Should show 2 filtered messages
    expect(screen.getByText(/2\/3/)).toBeInTheDocument();
    expect(screen.queryByText('Something else')).not.toBeInTheDocument();
  });

  // ── History and Memory toggle buttons ─────────────────────────────

  it('renders history and memory toggle buttons', async () => {
    const provider = makeProviderInfo();
    invoke = buildInvokeMock([provider]);
    (window as unknown as Record<string, unknown>).arena = { invoke, on, platform: 'linux' };

    await act(async () => {
      render(<ChatView />);
    });

    expect(screen.getByText('history.title')).toBeInTheDocument();
    expect(screen.getByText('memory.title')).toBeInTheDocument();
  });

  // ── Stream event subscriptions ────────────────────────────────────

  it('subscribes to stream events on mount', async () => {
    const provider = makeProviderInfo();
    invoke = buildInvokeMock([provider]);
    (window as unknown as Record<string, unknown>).arena = { invoke, on, platform: 'linux' };

    await act(async () => {
      render(<ChatView />);
    });

    const subscribedEvents = on.mock.calls.map((call: unknown[]) => call[0]);
    expect(subscribedEvents).toContain('stream:message-start');
    expect(subscribedEvents).toContain('stream:token');
    expect(subscribedEvents).toContain('stream:message-done');
    expect(subscribedEvents).toContain('stream:state');
    expect(subscribedEvents).toContain('stream:error');
  });
});
