/**
 * SearchOverlay component tests.
 *
 * Tests search input rendering, query change callback,
 * filtered/total count display, and close button.
 */

// @vitest-environment jsdom

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SearchOverlay } from '../SearchOverlay';

// ── Mock react-i18next ─────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: vi.fn().mockResolvedValue(undefined) },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// ── Tests ──────────────────────────────────────────────────────────────

describe('SearchOverlay', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders search input', () => {
    render(
      <SearchOverlay
        searchQuery=""
        onSearchQueryChange={vi.fn()}
        filteredCount={0}
        totalCount={10}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByPlaceholderText('chat.searchPlaceholder')).toBeInTheDocument();
  });

  it('calls onSearchQueryChange on input', () => {
    const onChange = vi.fn();
    render(
      <SearchOverlay
        searchQuery=""
        onSearchQueryChange={onChange}
        filteredCount={0}
        totalCount={10}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('chat.searchPlaceholder'), {
      target: { value: 'hello' },
    });

    expect(onChange).toHaveBeenCalledWith('hello');
  });

  it('shows filtered/total count when query is present', () => {
    render(
      <SearchOverlay
        searchQuery="test"
        onSearchQueryChange={vi.fn()}
        filteredCount={3}
        totalCount={10}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('3/10')).toBeInTheDocument();
  });

  it('does not show count when query is empty', () => {
    const { container } = render(
      <SearchOverlay
        searchQuery=""
        onSearchQueryChange={vi.fn()}
        filteredCount={0}
        totalCount={10}
        onClose={vi.fn()}
      />,
    );

    const countEl = container.querySelector('.search-bar-count');
    expect(countEl).not.toBeNull();
    expect(countEl!.textContent).toBe('');
  });

  it('calls onClose on close button click', () => {
    const onClose = vi.fn();
    render(
      <SearchOverlay
        searchQuery=""
        onSearchQueryChange={vi.fn()}
        filteredCount={0}
        totalCount={10}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByText('X'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('displays the current search query in the input', () => {
    render(
      <SearchOverlay
        searchQuery="existing query"
        onSearchQueryChange={vi.fn()}
        filteredCount={5}
        totalCount={10}
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText('chat.searchPlaceholder') as HTMLInputElement;
    expect(input.value).toBe('existing query');
  });

  it('shows zero count correctly', () => {
    render(
      <SearchOverlay
        searchQuery="nonexistent"
        onSearchQueryChange={vi.fn()}
        filteredCount={0}
        totalCount={5}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('0/5')).toBeInTheDocument();
  });
});
