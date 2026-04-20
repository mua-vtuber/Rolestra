/**
 * InputArea component tests.
 *
 * Tests textarea rendering, send button behavior, disabled state,
 * attachment chips, and keyboard interaction.
 */

// @vitest-environment jsdom

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { InputArea } from '../InputArea';
import type { InputAreaProps } from '../InputArea';

// ── Mock react-i18next ─────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: vi.fn().mockResolvedValue(undefined) },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// ── Helpers ─────────────────────────────────────────────────────────────

/** Build default props with overrides for convenience. */
function makeProps(overrides: Partial<InputAreaProps> = {}): InputAreaProps {
  return {
    input: '',
    onInputChange: vi.fn(),
    onKeyDown: vi.fn(),
    onSend: vi.fn(),
    disabled: false,
    pendingDiffs: false,
    attachments: [],
    onAttachFiles: vi.fn(),
    onRemoveAttachment: vi.fn(),
    historyOpen: false,
    onHistoryToggle: vi.fn(),
    memoryOpen: false,
    onMemoryToggle: vi.fn(),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('InputArea', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders textarea and send button', () => {
    render(<InputArea {...makeProps()} />);

    expect(screen.getByPlaceholderText('chat.placeholder')).toBeInTheDocument();
    expect(screen.getByText('chat.send')).toBeInTheDocument();
  });

  it('calls onSend when send button is clicked', () => {
    const onSend = vi.fn();
    render(<InputArea {...makeProps({ input: 'Hello', onSend })} />);

    fireEvent.click(screen.getByText('chat.send'));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('disables send button when input is empty', () => {
    render(<InputArea {...makeProps({ input: '' })} />);

    expect(screen.getByText('chat.send')).toBeDisabled();
  });

  it('disables send button when input is only whitespace', () => {
    render(<InputArea {...makeProps({ input: '   ' })} />);

    expect(screen.getByText('chat.send')).toBeDisabled();
  });

  it('enables send button when input has content', () => {
    render(<InputArea {...makeProps({ input: 'Hello' })} />);

    expect(screen.getByText('chat.send')).not.toBeDisabled();
  });

  it('disables all inputs when disabled prop is true', () => {
    render(<InputArea {...makeProps({ input: 'Hello', disabled: true })} />);

    const textarea = screen.getByPlaceholderText('chat.placeholder');
    expect(textarea).toBeDisabled();
    expect(screen.getByText('chat.send')).toBeDisabled();
  });

  it('disables textarea and send button when pendingDiffs is true', () => {
    render(<InputArea {...makeProps({ input: 'Hello', pendingDiffs: true })} />);

    const textarea = screen.getByPlaceholderText('chat.placeholder');
    expect(textarea).toBeDisabled();
    expect(screen.getByText('chat.send')).toBeDisabled();
  });

  it('calls onInputChange when textarea value changes', () => {
    const onInputChange = vi.fn();
    render(<InputArea {...makeProps({ onInputChange })} />);

    fireEvent.change(screen.getByPlaceholderText('chat.placeholder'), {
      target: { value: 'New text' },
    });

    expect(onInputChange).toHaveBeenCalledWith('New text');
  });

  it('shows attachment chips', () => {
    render(
      <InputArea
        {...makeProps({
          attachments: ['/home/user/project', '/tmp/data.txt'],
        })}
      />,
    );

    // Should show the filename portion of the paths
    expect(screen.getByText('project')).toBeInTheDocument();
    expect(screen.getByText('data.txt')).toBeInTheDocument();
  });

  it('calls onRemoveAttachment when remove button is clicked', () => {
    const onRemoveAttachment = vi.fn();
    render(
      <InputArea
        {...makeProps({
          attachments: ['/home/user/file.txt'],
          onRemoveAttachment,
        })}
      />,
    );

    const removeBtn = screen.getByLabelText('remove');
    fireEvent.click(removeBtn);
    expect(onRemoveAttachment).toHaveBeenCalledWith(0);
  });

  it('does not show attachment chips when attachments is empty', () => {
    const { container } = render(
      <InputArea {...makeProps({ attachments: [] })} />,
    );

    expect(container.querySelector('.attachment-chips')).toBeNull();
  });

  it('renders attach button and calls onAttachFiles on click', () => {
    const onAttachFiles = vi.fn();
    render(<InputArea {...makeProps({ onAttachFiles })} />);

    const attachBtn = screen.getByTitle('chat.attach');
    expect(attachBtn).toBeInTheDocument();
    fireEvent.click(attachBtn);
    expect(onAttachFiles).toHaveBeenCalledTimes(1);
  });

  it('forwards keyboard events to onKeyDown', () => {
    const onKeyDown = vi.fn();
    render(<InputArea {...makeProps({ input: 'text', onKeyDown })} />);

    const textarea = screen.getByPlaceholderText('chat.placeholder');
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it('renders history and memory toggle buttons', () => {
    const onHistoryToggle = vi.fn();
    const onMemoryToggle = vi.fn();
    render(
      <InputArea
        {...makeProps({ onHistoryToggle, onMemoryToggle })}
      />,
    );

    const historyBtn = screen.getByText('history.title');
    const memoryBtn = screen.getByText('memory.title');
    expect(historyBtn).toBeInTheDocument();
    expect(memoryBtn).toBeInTheDocument();

    fireEvent.click(historyBtn);
    expect(onHistoryToggle).toHaveBeenCalledTimes(1);

    fireEvent.click(memoryBtn);
    expect(onMemoryToggle).toHaveBeenCalledTimes(1);
  });
});
