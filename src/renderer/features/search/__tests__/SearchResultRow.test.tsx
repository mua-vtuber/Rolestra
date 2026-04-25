// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SearchResultRow,
  __testOnlyRenderSafeSnippet,
} from '../SearchResultRow';
import type { MessageSearchHit } from '../../../../shared/message-search-types';

function hit(partial: Partial<MessageSearchHit> = {}): MessageSearchHit {
  return {
    id: 'm1',
    channelId: 'c1',
    meetingId: null,
    authorId: 'user',
    authorKind: 'user',
    role: 'user',
    content: 'full content',
    meta: null,
    createdAt: Date.UTC(2026, 3, 24, 10, 0),
    rank: -3,
    snippet: '<mark>foo</mark> bar',
    channelName: 'general',
    projectName: 'Alpha',
    ...partial,
  };
}

describe('SearchResultRow', () => {
  afterEach(() => cleanup());

  it('renders channel / project / createdAt / snippet', () => {
    render(
      <SearchResultRow
        hit={hit()}
        onSelect={() => {}}
        emptyProjectLabel="DM"
        locale="ko-KR"
      />,
    );
    expect(screen.getByTestId('search-result-channel').textContent).toBe(
      '#general',
    );
    expect(screen.getByTestId('search-result-project').textContent).toBe(
      'Alpha',
    );
    expect(
      screen.getByTestId('search-result-snippet').innerHTML,
    ).toContain('<mark>foo</mark>');
  });

  it('uses emptyProjectLabel when projectName is null (DM case)', () => {
    render(
      <SearchResultRow
        hit={hit({ projectName: null })}
        onSelect={() => {}}
        emptyProjectLabel="DM"
        locale="ko-KR"
      />,
    );
    expect(screen.getByTestId('search-result-project').textContent).toBe('DM');
  });

  it('calls onSelect with the full hit on click', () => {
    const onSelect = vi.fn();
    const row = hit();
    render(
      <SearchResultRow
        hit={row}
        onSelect={onSelect}
        emptyProjectLabel="DM"
        locale="en-US"
      />,
    );
    fireEvent.click(screen.getByTestId('search-result-row'));
    expect(onSelect).toHaveBeenCalledWith(row);
  });

  it('sets data-message-id + data-channel-id for navigation selectors', () => {
    render(
      <SearchResultRow
        hit={hit({ id: 'msg-42', channelId: 'ch-7' })}
        onSelect={() => {}}
        emptyProjectLabel="DM"
        locale="ko-KR"
      />,
    );
    const btn = screen.getByTestId('search-result-row');
    expect(btn.getAttribute('data-message-id')).toBe('msg-42');
    expect(btn.getAttribute('data-channel-id')).toBe('ch-7');
  });
});

describe('SearchResultRow — renderSafeSnippet sanitizer', () => {
  it('keeps <mark> and </mark> tags', () => {
    const out = __testOnlyRenderSafeSnippet('pre <mark>hit</mark> post');
    expect(out).toBe('pre <mark>hit</mark> post');
  });

  it('escapes raw HTML injected via content', () => {
    const out = __testOnlyRenderSafeSnippet(
      '<script>alert(1)</script> <mark>safe</mark>',
    );
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('<mark>safe</mark>');
  });

  it('escapes ampersands before tag rewrite (no double-escape)', () => {
    const out = __testOnlyRenderSafeSnippet('a & b <mark>c</mark>');
    expect(out).toBe('a &amp; b <mark>c</mark>');
  });
});
