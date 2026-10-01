// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SearchResultRow,
  __testOnlyRenderSafeSnippet,
} from '../SearchResultRow';
import { i18next } from '../../../i18n';
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
    projectName: null,
    ...partial,
  };
}

describe('SearchResultRow', () => {
  afterEach(() => cleanup());

  it('renders conversation / createdAt / snippet without a project label', () => {
    render(
      <SearchResultRow
        hit={hit()}
        onSelect={() => {}}
        locale="ko-KR"
      />,
    );
    expect(screen.getByTestId('search-result-channel').textContent).toBe(
      '#general',
    );
    expect(screen.queryByTestId('search-result-project')).toBeNull();
    expect(
      screen.getByTestId('search-result-snippet').innerHTML,
    ).toContain('<mark>foo</mark>');
  });

  it('shows the conversation name the chat list uses when one is given', () => {
    render(<SearchResultRow hit={hit({ channelName: 'dm:prov-a' })} onSelect={() => {}}
      locale="ko-KR" channelLabel="Luna" />);
    expect(screen.getByTestId('search-result-channel').textContent).toBe('Luna');
  });

  it('calls onSelect with the full hit on click', () => {
    const onSelect = vi.fn();
    const row = hit();
    render(
      <SearchResultRow
        hit={row}
        onSelect={onSelect}
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
        locale="ko-KR"
      />,
    );
    const btn = screen.getByTestId('search-result-row');
    expect(btn.getAttribute('data-message-id')).toBe('msg-42');
    expect(btn.getAttribute('data-channel-id')).toBe('ch-7');
  });

  it('identifies observer-only whisper search hits without interpreting names as HTML', () => {
    void i18next.changeLanguage('en');
    render(<SearchResultRow hit={hit({
      visibility: 'whisper',
      whisper: { recipientId: 'prov-b', senderName: '<Alice>', recipientName: '<Bob>', sourceMessageId: 'user-1', replyToMessageId: null, threadSeq: 1 },
      snippet: '<mark>secret</mark>',
    })} onSelect={() => {}} locale="en-US" />);
    expect(screen.getByTestId('search-result-row').getAttribute('data-visibility')).toBe('whisper');
    expect(screen.getByTestId('search-result-whisper-kind').textContent).toBe('Whisper');
    expect(screen.getByTestId('search-result-whisper-route').textContent).toBe('<Alice> → <Bob>');
    expect(screen.getByTestId('search-result-whisper-route').getAttribute('title')).toContain('prov-b');
    expect(screen.getByTestId('search-result-row').querySelector('alice')).toBeNull();
  });

  it('marks a private reply hit distinctly from the root whisper', () => {
    void i18next.changeLanguage('en');
    render(<SearchResultRow hit={hit({
      visibility: 'whisper',
      whisper: { recipientId: 'prov-a', senderName: 'Bob', recipientName: 'Alice', sourceMessageId: 'user-1',
        replyToMessageId: 'root-1', threadSeq: 2 },
    })} onSelect={() => {}} locale="en-US" />);
    expect(screen.getByTestId('search-result-whisper-kind').textContent).toBe('Reply 2/4');
    expect(screen.getByTestId('search-result-whisper-route').textContent).toBe('Bob → Alice');
  });
});

describe('SearchResultRow — chat error notices (D4)', () => {
  afterEach(() => cleanup());

  it('shows the translated failure text instead of the raw error code', () => {
    void i18next.changeLanguage('en');
    render(<SearchResultRow hit={hit({
      role: 'system', authorId: 'system', authorKind: 'system',
      content: 'invalid_response', meta: { chatError: 'invalid_response' },
      snippet: 'provider_<mark>error</mark>',
    })} onSelect={() => {}} locale="en-US" />);
    const snippet = screen.getByTestId('search-result-snippet');
    expect(snippet.textContent).toBe('An AI returned an invalid response format.');
    expect(snippet.textContent).not.toContain('provider_error');
    expect(snippet.innerHTML).not.toContain('<mark>');
  });

  it('shows the translated silence text for a silence notice (W4)', () => {
    void i18next.changeLanguage('en');
    render(<SearchResultRow hit={hit({
      role: 'system', authorId: 'ai-a', authorKind: 'member', content: 'turn_passed',
      meta: { chatSilence: { code: 'turn_passed', speakerName: 'Alice' } },
      snippet: 'turn_<mark>passed</mark>',
    })} onSelect={() => {}} locale="en-US" />);
    const snippet = screen.getByTestId('search-result-snippet');
    expect(snippet.textContent).toBe('Alice stayed silent this time.');
    expect(snippet.innerHTML).not.toContain('<mark>');
  });

  it('falls back to the highlighted snippet for a non-error system row', () => {
    render(<SearchResultRow hit={hit({
      role: 'system', authorId: 'system', authorKind: 'system',
      content: 'some plain notice', meta: null,
    })} onSelect={() => {}} locale="en-US" />);
    expect(screen.getByTestId('search-result-snippet').innerHTML).toContain('<mark>foo</mark>');
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
