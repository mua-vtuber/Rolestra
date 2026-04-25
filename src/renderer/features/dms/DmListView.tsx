/**
 * DmListView — NavRail 아래 DM 섹션 (R10-Task3).
 *
 * 기존 Messenger `ChannelRail` 은 프로젝트 scope 의 user/system channel +
 * DM 을 한 곳에 렌더했다. R10 DmListView 는 전역 DM 전용 사이드 리스트로
 * 쓰이며, "+ 새 DM" 버튼으로 `DmCreateModal` 을 연다.
 */
import { clsx } from 'clsx';
import { useCallback, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useDmSummaries } from '../../hooks/use-dm-summaries';
import type { Channel } from '../../../shared/channel-types';
import { DmCreateModal } from './DmCreateModal';

export interface DmListViewProps {
  activeChannelId: string | null;
  onSelectDm: (channelId: string) => void;
  className?: string;
}

export function DmListView({
  activeChannelId,
  onSelectDm,
  className,
}: DmListViewProps): ReactElement {
  const { t } = useTranslation();
  const { data, loading } = useDmSummaries();
  const [modalOpen, setModalOpen] = useState<boolean>(false);

  const handleCreated = useCallback(
    (channel: Channel): void => {
      onSelectDm(channel.id);
    },
    [onSelectDm],
  );

  const existingDms = (data ?? []).filter((r) => r.exists);

  return (
    <nav
      data-testid="dm-list-view"
      className={clsx(
        'flex flex-col gap-1 border-t border-panel-border p-2',
        className,
      )}
    >
      <div className="flex items-center justify-between px-2 py-1">
        <span
          data-testid="dm-list-heading"
          className="text-xs font-display font-semibold text-fg-muted uppercase tracking-wide"
        >
          {t('dm.listTitle', { defaultValue: 'DM' })}
        </span>
        <button
          type="button"
          data-testid="dm-list-new-button"
          onClick={() => setModalOpen(true)}
          className="text-xs text-fg-muted hover:text-fg focus:outline-none focus:ring-1 focus:ring-brand rounded-panel px-1"
          aria-label={t('dm.newDm', { defaultValue: '새 DM' })}
        >
          {'+'}
        </button>
      </div>

      {loading && (
        <p data-testid="dm-list-loading" className="text-xs text-fg-muted px-2">
          {t('dm.loading', { defaultValue: '불러오는 중…' })}
        </p>
      )}
      {!loading && existingDms.length === 0 && (
        <p data-testid="dm-list-empty" className="text-xs text-fg-muted px-2">
          {t('dm.empty', { defaultValue: 'DM 없음' })}
        </p>
      )}
      <ul data-testid="dm-list-items" className="flex flex-col gap-0.5">
        {existingDms.map((row) => {
          if (row.channel === null) return null;
          const isActive = row.channel.id === activeChannelId;
          return (
            <li key={row.channel.id}>
              <button
                type="button"
                data-testid={`dm-list-item-${row.providerId}`}
                data-active={isActive ? 'true' : 'false'}
                onClick={() => onSelectDm(row.channel!.id)}
                className={clsx(
                  'flex w-full items-center gap-2 rounded-panel px-2 py-1 text-sm text-left',
                  'hover:bg-sunk focus:outline-none focus:ring-1 focus:ring-brand',
                  isActive && 'bg-sunk border border-panel-border',
                )}
              >
                <span aria-hidden="true" className="text-xs text-fg-muted">
                  {'@'}
                </span>
                <span className="truncate">{row.providerName}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <DmCreateModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onCreated={handleCreated}
      />
    </nav>
  );
}
