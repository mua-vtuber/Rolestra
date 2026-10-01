/**
 * MessageSearchView — the message search dialog, used two ways (spec
 * 2026-10-01-messenger-redesign.md R2-2, R3-1):
 *   - `scope.kind === 'chats'`: every conversation, opened from the chat
 *     list's search field (or Ctrl+K) with the query already typed;
 *   - `scope.kind === 'channel'`: one conversation, from the room header.
 * Results use the shared FTS search (`use-message-search.ts`).
 */
import * as Dialog from '@radix-ui/react-dialog';
import { clsx } from 'clsx';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { MessageSearchHit } from '../../../shared/message-search-types';
import { useMessageSearch, type MessageSearchScope } from '../../hooks/use-message-search';
import { SearchResultRow } from './SearchResultRow';

export type MessageSearchViewScope =
  | { kind: 'channel'; channelId: string; channelName: string }
  | { kind: 'chats' };

export interface MessageSearchViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: MessageSearchViewScope;
  /** Typed into the field when the dialog opens. */
  initialQuery?: string;
  /** Conversation name for a result row (chats scope); the stored channel name otherwise. */
  channelLabel?: (channelId: string) => string | null;
  onNavigate: (channelId: string, messageId: string) => void;
}

function ipcScope(scope: MessageSearchViewScope): MessageSearchScope {
  return scope.kind === 'chats' ? { kind: 'chats' } : { kind: 'channel', channelId: scope.channelId };
}

export function MessageSearchView({
  open, onOpenChange, scope, initialQuery = '', channelLabel, onNavigate,
}: MessageSearchViewProps): ReactElement {
  const { t, i18n } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const composingRef = useRef(false);
  const [inputValue, setInputValue] = useState('');
  const search = useMessageSearch(ipcScope(scope));
  const scopeKey = scope.kind === 'chats' ? 'chats' : scope.channelId;

  useEffect(() => {
    if (!open) return;
    search.clear();
    // Reset the controlled input (to the handed-over query) on every open.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInputValue(initialQuery);
    composingRef.current = false;
    search.setScope(ipcScope(scope));
    if (initialQuery.trim().length > 0) search.setQuery(initialQuery);
    setTimeout(() => inputRef.current?.focus(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scopeKey, initialQuery]);

  const handleRowSelect = (hit: MessageSearchHit): void => {
    onNavigate(hit.channelId, hit.id);
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay data-testid="message-search-overlay"
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content data-testid="message-search-dialog" data-scope={scope.kind} aria-describedby={undefined}
          className={clsx(
            'fixed left-1/2 top-[10%] z-50 flex max-h-[80vh] w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2',
            'flex-col border border-border bg-canvas text-fg shadow-panel [clip-path:var(--clip-control)]',
          )}>
          <div className="flex items-center justify-between border-b border-border-soft px-5 py-3">
            <Dialog.Title className="font-display text-base font-semibold">
              {t('message.search.title')}
            </Dialog.Title>
            <Dialog.Close data-testid="message-search-close" aria-label={t('message.search.close')}
              className="text-sm text-fg-muted hover:text-fg">{'✕'}</Dialog.Close>
          </div>
          <div className="flex flex-col gap-2 border-b border-border-soft px-5 py-3">
            <input ref={inputRef} type="search" data-testid="message-search-input"
              value={inputValue} placeholder={t('message.search.placeholder')}
              onChange={(event) => {
                const next = event.target.value;
                setInputValue(next);
                if (!composingRef.current) search.setQuery(next);
              }}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={(event) => {
                composingRef.current = false;
                const final = (event.target as HTMLInputElement).value;
                setInputValue(final);
                search.setQuery(final);
              }}
              className="w-full border border-border-soft bg-sunk px-3 py-2 text-sm text-fg focus:outline-none focus:ring-1 focus:ring-brand" />
            <div className="flex items-center justify-between gap-3 text-xs text-fg-muted">
              <span data-testid="message-search-channel-label">
                {scope.kind === 'chats'
                  ? t('message.search.filter.allChats')
                  : t('message.search.filter.currentChannel', { name: scope.channelName })}
              </span>
              <span data-testid="message-search-shortcut-hint">{t('message.search.shortcutHint')}</span>
            </div>
          </div>
          <div data-testid="message-search-results" className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
            {search.loading ? <p data-testid="message-search-loading" className="text-xs text-fg-muted">
              {t('message.search.loading')}</p> : null}
            {search.error ? <p data-testid="message-search-error" role="alert" className="text-xs text-danger-text">
              {t('message.search.error', { msg: search.error.message })}</p> : null}
            {!search.loading && !search.error && search.query.trim() && search.hits.length === 0 ? (
              <p data-testid="message-search-empty" className="text-xs text-fg-muted">{t('message.search.empty')}</p>
            ) : null}
            {search.hits.map((hit) => (
              <SearchResultRow key={hit.id} hit={hit} onSelect={handleRowSelect} locale={i18n.language}
                channelLabel={channelLabel?.(hit.channelId) ?? null} />
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
