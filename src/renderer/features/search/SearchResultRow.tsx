/**
 * SearchResultRow — `MessageSearchView` 의 단일 결과 행 (R10-Task2).
 *
 * FTS5 `snippet()` 가 반환한 문자열은 `<mark>...</mark>` HTML 을 섞어 보낸다.
 * SQLite 가 생성한 출력이라 이론적으로는 안전하지만 원문에 정확히 `<mark>`
 * 문자열이 있었던 경우에 한해 XSS 벡터가 될 수 있으므로, `<mark>` 외 모든
 * HTML 을 살균한 뒤 렌더한다.
 */
import { clsx } from 'clsx';
import type { MouseEvent, ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { chatNoticeText } from '../messenger/chat-notice';
import type { MessageSearchHit } from '../../../shared/message-search-types';
import { CHAT_WHISPER_THREAD_MAX_MESSAGES } from '../../../shared/chat-thread-limits';
import { isChatVoteResultMessage } from '../../../shared/message-types';

/**
 * HTML-escape 후 `<mark>` / `</mark>` 만 되살린다. snippet() 가 반환하는
 * 태그는 deterministic 하므로 정규식 한 줄이면 충분.
 */
function renderSafeSnippet(raw: string): string {
  const escaped = raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  // `&lt;mark&gt;` / `&lt;/mark&gt;` → `<mark>` / `</mark>`
  return escaped.replaceAll('&lt;mark&gt;', '<mark>').replaceAll('&lt;/mark&gt;', '</mark>');
}

// Utility just for tests — exported so we can pin the sanitizer behavior.
export function __testOnlyRenderSafeSnippet(raw: string): string {
  return renderSafeSnippet(raw);
}

export interface SearchResultRowProps {
  hit: MessageSearchHit;
  onSelect: (hit: MessageSearchHit) => void;
  locale: string;
  /** Conversation name as the chat list shows it; the stored name when null. */
  channelLabel?: string | null;
}

export function SearchResultRow({
  hit,
  onSelect,
  locale,
  channelLabel = null,
}: SearchResultRowProps): ReactElement {
  const { t } = useTranslation();
  const createdAtLabel = new Date(hit.createdAt).toLocaleString(locale);
  const whisper = hit.visibility === 'whisper' ? hit.whisper : undefined;

  const handleClick = (e: MouseEvent<HTMLButtonElement>): void => {
    e.preventDefault();
    onSelect(hit);
  };

  // mark 태그 외 HTML 을 차단한 뒤 dangerouslySetInnerHTML. React 의 관례상
  // innerHTML 을 직접 주입하지 않는 게 좋지만, snippet 의 하이라이트를
  // 구현하려면 HTML 이 필요하다 — 대신 renderSafeSnippet 에서 화이트리스트로
  // 살균한다. 절대 금지 규칙 #1 (Node API 접근 금지) 과 무관, IPC 경유 결과.
  //
  // D4: a chat notice (role='system' + meta.chatError, or W4 meta.chatSilence)
  // stores only a code (e.g. `provider_error`, `turn_passed`), and FTS5's
  // snippet() highlights fragments of that raw code — showing
  // `provider_<mark>error</mark>` to the user. Every surface must show the
  // same translated text instead (shared with SystemMessage via
  // chat-notice.ts); it renders as plain text, not a highlighted snippet,
  // since there is nothing left to highlight.
  const noticeText = hit.role === 'system' || isChatVoteResultMessage(hit) ? chatNoticeText(t, hit) : null;
  const safe = noticeText === null ? renderSafeSnippet(hit.snippet) : null;

  return (
    <button
      type="button"
      data-testid="search-result-row"
      data-message-id={hit.id}
      data-channel-id={hit.channelId}
      data-visibility={whisper ? 'whisper' : 'public'}
      onClick={handleClick}
      className={clsx(
        'flex w-full flex-col items-start gap-1 border border-border-soft',
        'px-4 py-3 text-left transition-colors [background:var(--color-panel-bg)] [clip-path:var(--clip-control)]',
        'hover:border-brand focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand',
      )}
    >
      <div className="flex w-full items-baseline justify-between gap-3 text-xs text-fg-muted">
        <span
          data-testid="search-result-channel"
          className="truncate font-display font-medium text-fg"
        >
          {channelLabel ?? `#${hit.channelName}`}
        </span>
        <time
          data-testid="search-result-created-at"
          dateTime={new Date(hit.createdAt).toISOString()}
          className="shrink-0 tabular-nums"
        >
          {createdAtLabel}
        </time>
      </div>
      {whisper ? (
        <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 text-xs text-whisper-fg">
          <span data-testid="search-result-whisper-kind" className="font-semibold">
            {whisper.replyToMessageId === null
              ? t('messenger.whisper.label')
              : t('messenger.whisper.threadReplyLabel', {
                position: whisper.threadSeq, max: CHAT_WHISPER_THREAD_MAX_MESSAGES })}
          </span>
          <span data-testid="search-result-whisper-route" className="min-w-0 break-words"
            title={t('messenger.whisper.routeIdentity', { senderId: hit.authorId, recipientId: whisper.recipientId })}>
            {whisper.senderName} {'→'} {whisper.recipientName}
          </span>
          <span className="text-fg-muted">{t('messenger.whisper.observer')}</span>
        </div>
      ) : null}
      {noticeText === null ? (
        <p
          data-testid="search-result-snippet"
          className="text-sm text-fg line-clamp-3 [&_mark]:bg-highlight [&_mark]:text-highlight-foreground [&_mark]:px-0.5 [&_mark]:rounded-sm"
          dangerouslySetInnerHTML={{ __html: safe ?? '' }}
        />
      ) : (
        <p data-testid="search-result-snippet" className="text-sm text-fg line-clamp-3">
          {noticeText}
        </p>
      )}
    </button>
  );
}
