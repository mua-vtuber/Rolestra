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

import type { MessageSearchHit } from '../../../shared/message-search-types';

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
  /** 현재 활성 프로젝트 이름 — DM 구분용 라벨 결정에 사용. */
  emptyProjectLabel: string;
  locale: string;
}

export function SearchResultRow({
  hit,
  onSelect,
  emptyProjectLabel,
  locale,
}: SearchResultRowProps): ReactElement {
  const projectLabel = hit.projectName ?? emptyProjectLabel;
  const createdAtLabel = new Date(hit.createdAt).toLocaleString(locale);

  const handleClick = (e: MouseEvent<HTMLButtonElement>): void => {
    e.preventDefault();
    onSelect(hit);
  };

  // mark 태그 외 HTML 을 차단한 뒤 dangerouslySetInnerHTML. React 의 관례상
  // innerHTML 을 직접 주입하지 않는 게 좋지만, snippet 의 하이라이트를
  // 구현하려면 HTML 이 필요하다 — 대신 renderSafeSnippet 에서 화이트리스트로
  // 살균한다. 절대 금지 규칙 #1 (Node API 접근 금지) 과 무관, IPC 경유 결과.
  const safe = renderSafeSnippet(hit.snippet);

  return (
    <button
      type="button"
      data-testid="search-result-row"
      data-message-id={hit.id}
      data-channel-id={hit.channelId}
      onClick={handleClick}
      className={clsx(
        'flex w-full flex-col items-start gap-1 rounded-panel border border-panel-border',
        'bg-panel-bg px-4 py-3 text-left shadow-panel transition-colors',
        'hover:border-brand focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand',
      )}
    >
      <div className="flex w-full items-baseline justify-between gap-3 text-xs text-fg-muted">
        <span
          data-testid="search-result-channel"
          className="truncate font-display font-medium text-fg"
        >
          #{hit.channelName}
        </span>
        <span data-testid="search-result-project" className="truncate">
          {projectLabel}
        </span>
        <time
          data-testid="search-result-created-at"
          dateTime={new Date(hit.createdAt).toISOString()}
          className="shrink-0 tabular-nums"
        >
          {createdAtLabel}
        </time>
      </div>
      <p
        data-testid="search-result-snippet"
        className="text-sm text-fg line-clamp-3 [&_mark]:bg-highlight [&_mark]:text-highlight-foreground [&_mark]:px-0.5 [&_mark]:rounded-sm"
        dangerouslySetInnerHTML={{ __html: safe }}
      />
    </button>
  );
}
