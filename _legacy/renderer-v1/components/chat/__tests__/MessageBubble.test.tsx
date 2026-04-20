/**
 * MessageBubble component tests.
 *
 * Tests role-based CSS classes, speaker name display,
 * response time formatting, and token count display.
 */

// @vitest-environment jsdom

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MessageBubble } from '../MessageBubble';
import type { ChatMessage } from '../../../stores/chat-store';

// ── Mock react-i18next ─────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params) {
        let result = key;
        for (const [k, v] of Object.entries(params)) {
          result = result.replace(`{{${k}}}`, String(v));
        }
        return result;
      }
      return key;
    },
    i18n: { changeLanguage: vi.fn().mockResolvedValue(undefined) },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// ── Helpers ────────────────────────────────────────────────────────────

function makeMessage(overrides?: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: 'Test message',
    speakerName: 'GPT-4',
    timestamp: Date.now(),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('MessageBubble', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders user message with correct CSS class', () => {
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'user', speakerName: 'User' })} />,
    );

    const bubble = container.querySelector('.message-bubble');
    expect(bubble).not.toBeNull();
    expect(bubble!.classList.contains('user')).toBe(true);
  });

  it('renders assistant message with correct CSS class', () => {
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'assistant' })} />,
    );

    const bubble = container.querySelector('.message-bubble');
    expect(bubble).not.toBeNull();
    expect(bubble!.classList.contains('assistant')).toBe(true);
  });

  it('renders system message with correct CSS class', () => {
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'system', speakerName: 'System' })} />,
    );

    const bubble = container.querySelector('.message-bubble');
    expect(bubble).not.toBeNull();
    expect(bubble!.classList.contains('system')).toBe(true);
  });

  it('shows speaker name', () => {
    render(<MessageBubble message={makeMessage({ speakerName: 'Claude' })} />);

    expect(screen.getByText('Claude')).toBeInTheDocument();
  });

  it('falls back to role when speakerName is undefined', () => {
    render(<MessageBubble message={makeMessage({ speakerName: undefined, role: 'assistant' })} />);

    expect(screen.getByText('assistant')).toBeInTheDocument();
  });

  it('shows response time in ms for values under 1000', () => {
    render(<MessageBubble message={makeMessage({ responseTimeMs: 500 })} />);

    expect(screen.getByText('500ms')).toBeInTheDocument();
  });

  it('shows response time in seconds for values >= 1000', () => {
    render(<MessageBubble message={makeMessage({ responseTimeMs: 1500 })} />);

    expect(screen.getByText('1.5s')).toBeInTheDocument();
  });

  it('does not show response time when not provided', () => {
    const { container } = render(
      <MessageBubble message={makeMessage({ responseTimeMs: undefined })} />,
    );

    expect(container.textContent).not.toMatch(/\d+ms/);
    expect(container.textContent).not.toMatch(/\d+\.\d+s/);
  });

  it('shows token count', () => {
    render(<MessageBubble message={makeMessage({ tokenCount: 42 })} />);

    expect(screen.getByText('42 chat.tokens')).toBeInTheDocument();
  });

  it('does not show token count when not provided', () => {
    render(<MessageBubble message={makeMessage({ tokenCount: undefined })} />);

    expect(screen.queryByText(/chat\.tokens/)).not.toBeInTheDocument();
  });

  it('renders message content', () => {
    render(<MessageBubble message={makeMessage({ content: 'Hello from AI' })} />);

    expect(screen.getByText('Hello from AI')).toBeInTheDocument();
  });

  it('shows thinking dots when streaming with empty content', () => {
    const { container } = render(
      <MessageBubble message={makeMessage({ streaming: true, content: '' })} />,
    );

    expect(container.querySelector('.thinking-dots')).not.toBeNull();
  });

  it('shows content when streaming with non-empty content', () => {
    render(
      <MessageBubble message={makeMessage({ streaming: true, content: 'Partial text' })} />,
    );

    expect(screen.getByText('Partial text')).toBeInTheDocument();
  });

  it('highlights search terms', () => {
    const { container } = render(
      <MessageBubble
        message={makeMessage({ content: 'Hello World here' })}
        highlight="world"
      />,
    );

    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('World');
  });

  it('shows timestamp', () => {
    // Use a fixed timestamp
    const ts = new Date(2024, 0, 15, 14, 30, 0).getTime();
    const { container } = render(
      <MessageBubble message={makeMessage({ timestamp: ts })} />,
    );

    // The timestamp is formatted with toLocaleTimeString, just verify it rendered
    const metaArea = container.querySelector('.message-meta');
    expect(metaArea).not.toBeNull();
    // Should contain some time-like text
    expect(metaArea!.textContent).toMatch(/\d/);
  });
});
