/**
 * StreamingText component tests.
 *
 * Tests plain text rendering, fenced code block parsing,
 * search term highlighting, and edge cases.
 */

// @vitest-environment jsdom

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { StreamingText } from '../StreamingText';

// ── Mock react-i18next (not used by StreamingText, but satisfies module resolution) ──

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: vi.fn().mockResolvedValue(undefined) },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// ── Tests ──────────────────────────────────────────────────────────────

describe('StreamingText', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders plain text', () => {
    render(<StreamingText text="Hello, world!" />);
    expect(screen.getByText('Hello, world!')).toBeInTheDocument();
  });

  it('renders fenced code blocks', () => {
    const text = 'Before code\n```javascript\nconst x = 1;\n```\nAfter code';
    const { container } = render(<StreamingText text={text} />);

    // Should have a code block with language label
    const langLabel = container.querySelector('.code-block-lang');
    expect(langLabel).not.toBeNull();
    expect(langLabel!.textContent).toBe('javascript');

    // Should have a pre element with the code content
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toBe('const x = 1;\n');

    // Plain text segments
    expect(screen.getByText(/Before code/)).toBeInTheDocument();
    expect(screen.getByText(/After code/)).toBeInTheDocument();
  });

  it('renders code block without language', () => {
    const text = '```\nplain code\n```';
    const { container } = render(<StreamingText text={text} />);

    const langLabel = container.querySelector('.code-block-lang');
    expect(langLabel).toBeNull();

    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toBe('plain code\n');
  });

  it('highlights search terms in plain text', () => {
    const { container } = render(<StreamingText text="Hello World, hello again" highlight="hello" />);

    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(2);
    expect(marks[0].textContent).toBe('Hello');
    expect(marks[1].textContent).toBe('hello');
  });

  it('does not highlight inside code blocks', () => {
    const text = '```\nhello code\n```';
    const { container } = render(<StreamingText text={text} highlight="hello" />);

    // Code blocks render via <pre> without mark tags
    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(0);
  });

  it('handles empty input', () => {
    const { container } = render(<StreamingText text="" />);
    // Should render without error, producing an empty text node
    expect(container.textContent).toBe('');
  });

  it('handles text with no code blocks and no highlight', () => {
    render(<StreamingText text="Just plain text" />);
    expect(screen.getByText('Just plain text')).toBeInTheDocument();
  });

  it('handles multiple code blocks', () => {
    const text = '```python\nprint("A")\n```\nMiddle text\n```rust\nfn main() {}\n```';
    const { container } = render(<StreamingText text={text} />);

    const codeBlocks = container.querySelectorAll('.code-block');
    expect(codeBlocks).toHaveLength(2);

    const langLabels = container.querySelectorAll('.code-block-lang');
    expect(langLabels[0].textContent).toBe('python');
    expect(langLabels[1].textContent).toBe('rust');
  });

  it('escapes regex special characters in highlight', () => {
    const { container } = render(<StreamingText text="Test (value) here" highlight="(value)" />);

    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('(value)');
  });
});
