/**
 * MessageSearchView — FTS5 메시지 검색 모달 (R10-Task2, Decision D2).
 *
 * spec §7.4 의 검색 진입: `ShellTopBar` 검색 아이콘 또는 `Cmd/Ctrl+K` 단축키
 * 로 모달 열림 → 입력 debounce 200ms 후 `message:search` IPC → 결과 row
 * 클릭 시 해당 채널로 deep-link(`onNavigate(channelId, messageId)`).
 *
 * Scope 옵션:
 *   - `'currentChannel'` : `activeChannelId` 가 있을 때만 활성, 없으면
 *                           `'currentProject'` 로 자동 전환.
 *   - `'currentProject'` : `activeProjectId` 필수. 없으면 모달이 입력 필드를
 *                           disabled 로 렌더.
 *   - `'global'`          : 제거 — IPC 스키마가 channelId 또는 projectId
 *                           필수. R10 Task 2 범위는 현재 프로젝트/채널 내부
 *                           검색만 지원하고, 앱 전역 검색은 V4 로 이월.
 *
 * 키보드:
 *   - ESC      → 닫기
 *   - Enter    → 첫 번째 hit 선택
 *   - ↑ / ↓    → 결과 row 포커스 이동 (R11+ — Task 2 에서는 hover/click 만)
 */
import * as Dialog from '@radix-ui/react-dialog';
import { clsx } from 'clsx';
import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { MessageSearchInput } from '../../../shared/ipc-types';
import type { MessageSearchHit } from '../../../shared/message-search-types';
import {
  useMessageSearch,
  type MessageSearchScope,
} from '../../hooks/use-message-search';
import { usePanelClipStyle } from '../../theme/use-panel-clip-style';
import { SearchResultRow } from './SearchResultRow';

export type MessageSearchScopeChoice = 'currentChannel' | 'currentProject';

export interface MessageSearchViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeProjectId: string | null;
  activeChannelId: string | null;
  activeProjectName: string | null;
  activeChannelName: string | null;
  onNavigate: (channelId: string, messageId: string) => void;
}

function resolveScope(
  choice: MessageSearchScopeChoice,
  projectId: string | null,
  channelId: string | null,
): MessageSearchScope {
  if (choice === 'currentChannel' && channelId !== null) {
    return { kind: 'channel', channelId };
  }
  if (choice === 'currentProject' && projectId !== null) {
    return { kind: 'project', projectId };
  }
  // 기본: 아무 것도 선택 불가 상태. Hook 에 넘기면 throw — View 에서 입력
  // disabled 로 먼저 막는다. 이 값은 타입 강제용 sentinel 로만 쓴다.
  return 'global';
}

export function MessageSearchView({
  open,
  onOpenChange,
  activeProjectId,
  activeChannelId,
  activeProjectName,
  activeChannelName,
  onNavigate,
}: MessageSearchViewProps): ReactElement {
  const { t, i18n } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelClip = usePanelClipStyle();

  // 기본 scope 결정: 채널 > 프로젝트. 둘 다 없으면 disabled 상태.
  const initialChoice: MessageSearchScopeChoice =
    activeChannelId !== null ? 'currentChannel' : 'currentProject';
  const initialScope = resolveScope(
    initialChoice,
    activeProjectId,
    activeChannelId,
  );

  const search = useMessageSearch(initialScope);

  // 모달이 열릴 때 입력에 포커스 + query 초기화 + scope 를 최신 active 기준으로
  // 다시 계산(첫 오픈 이후 프로젝트가 바뀐 경우 대비).
  useEffect(() => {
    if (!open) return;
    search.clear();
    const nextScope = resolveScope(
      initialChoice,
      activeProjectId,
      activeChannelId,
    );
    search.setScope(nextScope);
    // Focus after Radix portal mount.
    setTimeout(() => inputRef.current?.focus(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeProjectId, activeChannelId]);

  const scopeLabel = useMemo(() => {
    if (
      search.scope !== 'global' &&
      search.scope.kind === 'channel' &&
      activeChannelName !== null
    ) {
      return t('message.search.filter.currentChannel', {
        defaultValue: '현재 채널: #{{name}}',
        name: activeChannelName,
      });
    }
    if (
      search.scope !== 'global' &&
      search.scope.kind === 'project' &&
      activeProjectName !== null
    ) {
      return t('message.search.filter.currentProject', {
        defaultValue: '현재 프로젝트: {{name}}',
        name: activeProjectName,
      });
    }
    return t('message.search.filter.noScope', {
      defaultValue: '활성 프로젝트 없음',
    });
  }, [search.scope, activeChannelName, activeProjectName, t]);

  const inputDisabled = search.scope === 'global';

  const handleScopeToggle = (): void => {
    // channel ↔ project 토글. active channel/project 가 있을 때만 반대쪽으로 전환.
    if (
      search.scope !== 'global' &&
      search.scope.kind === 'channel' &&
      activeProjectId !== null
    ) {
      search.setScope({ kind: 'project', projectId: activeProjectId });
    } else if (
      search.scope !== 'global' &&
      search.scope.kind === 'project' &&
      activeChannelId !== null
    ) {
      search.setScope({ kind: 'channel', channelId: activeChannelId });
    }
  };

  const handleRowSelect = (hit: MessageSearchHit): void => {
    onNavigate(hit.channelId, hit.id);
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-testid="message-search-overlay"
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        />
        <Dialog.Content
          data-testid="message-search-dialog"
          data-panel-clip={panelClip.rawClip}
          style={panelClip.style}
          className={clsx(
            'fixed left-1/2 top-[10%] z-50 -translate-x-1/2',
            'w-[min(42rem,calc(100vw-2rem))] max-h-[80vh]',
            'flex flex-col',
            'bg-panel-bg text-fg border border-panel-border rounded-panel shadow-panel',
          )}
        >
          <div className="flex items-center justify-between px-5 py-3 border-b border-border-soft bg-panel-header-bg">
            <Dialog.Title className="text-base font-display font-semibold">
              {t('message.search.title', { defaultValue: '메시지 검색' })}
            </Dialog.Title>
            <Dialog.Close
              data-testid="message-search-close"
              aria-label={t('message.search.close', { defaultValue: '닫기' })}
              className="text-sm text-fg-muted hover:text-fg focus:outline-none"
            >
              {'✕'}
            </Dialog.Close>
          </div>

          <div className="px-5 py-3 flex flex-col gap-2 border-b border-border-soft">
            <input
              ref={inputRef}
              type="search"
              data-testid="message-search-input"
              disabled={inputDisabled}
              value={search.query}
              placeholder={t('message.search.placeholder', {
                defaultValue: '검색어를 입력하세요 (FTS5 syntax 지원)',
              })}
              onChange={(e) => search.setQuery(e.target.value)}
              className={clsx(
                'w-full rounded-panel border border-panel-border bg-sunk px-3 py-2',
                'text-sm text-fg focus:outline-none focus:ring-1 focus:ring-brand',
                inputDisabled && 'opacity-60 cursor-not-allowed',
              )}
            />
            <div className="flex items-center justify-between gap-3 text-xs text-fg-muted">
              <button
                type="button"
                data-testid="message-search-scope-toggle"
                onClick={handleScopeToggle}
                disabled={activeChannelId === null || activeProjectId === null}
                className="underline hover:text-fg disabled:opacity-50"
              >
                {scopeLabel}
              </button>
              <span data-testid="message-search-shortcut-hint">
                {t('message.search.shortcutHint', {
                  defaultValue: 'Cmd/Ctrl+K 로 열기',
                })}
              </span>
            </div>
          </div>

          <div
            data-testid="message-search-results"
            className="flex-1 overflow-y-auto p-4 flex flex-col gap-2"
          >
            {search.loading && (
              <p
                data-testid="message-search-loading"
                className="text-xs text-fg-muted"
              >
                {t('message.search.loading', { defaultValue: '검색 중…' })}
              </p>
            )}
            {search.error !== null && (
              <p
                data-testid="message-search-error"
                role="alert"
                className="text-xs text-danger"
              >
                {t('message.search.error', {
                  defaultValue: '검색 실패: {{msg}}',
                  msg: search.error.message,
                })}
              </p>
            )}
            {!search.loading && !search.error && search.query.trim().length > 0 && search.hits.length === 0 && (
              <p
                data-testid="message-search-empty"
                className="text-xs text-fg-muted"
              >
                {t('message.search.empty', {
                  defaultValue: '검색 결과 없음',
                })}
              </p>
            )}
            {search.hits.map((hit: MessageSearchHit) => (
              <SearchResultRow
                key={hit.id}
                hit={hit}
                onSelect={handleRowSelect}
                emptyProjectLabel={t('message.search.dmLabel', {
                  defaultValue: 'DM',
                })}
                locale={i18n.language}
              />
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// Helper exported for hook integration (scope derivation without opening modal).
export { resolveScope as __testOnlyResolveScope };

// Silence TS unused for types exported above and referenced elsewhere.
export type { MessageSearchInput };
