/**
 * GeneralChannelEntry — R12-C T8 통합 사이드바 최상단 일반 채널 entry.
 *
 * 전역 일반 채널 (system_general, projectId NULL) 단일 row. 클릭 시
 * messenger view 로 진입 + 그 채널을 active 로 전환.
 *
 * 일반 채널 = 회의 X (round 5 fix 의 1라운드 단순 응답 보존). 회의
 * 컨트롤 / member panel 모두 hide — 단순 chat. T9 에서 본격 동작 land.
 */
import { clsx } from 'clsx';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useGlobalGeneralChannel } from '../../hooks/use-global-general-channel';

export interface GeneralChannelEntryProps {
  activeChannelId: string | null;
  onSelectChannel: (channel: { id: string; name: string; projectId: string | null }) => void;
  className?: string;
}

export function GeneralChannelEntry({
  activeChannelId,
  onSelectChannel,
  className,
}: GeneralChannelEntryProps): ReactElement {
  const { t } = useTranslation();
  const { channel, loading, error } = useGlobalGeneralChannel();

  if (loading && channel === null) {
    return (
      <div
        data-testid="sidebar-general-loading"
        className={clsx('px-3 py-1.5 text-xs text-fg-subtle', className)}
      >
        {t('messenger.channelRail.loading')}
      </div>
    );
  }

  if (error !== null && channel === null) {
    return (
      <div
        data-testid="sidebar-general-error"
        role="alert"
        className={clsx('px-3 py-1.5 text-xs text-danger', className)}
      >
        {t('messenger.channelRail.error')}
      </div>
    );
  }

  if (channel === null) {
    // boot 직후 한 번 — ensureGlobalGeneralChannel 가 곧 채워준다.
    return (
      <div
        data-testid="sidebar-general-empty"
        className={clsx('px-3 py-1.5 text-xs text-fg-subtle', className)}
      >
        {t('sidebar.general.empty', { defaultValue: '일반 채널 준비 중…' })}
      </div>
    );
  }

  const isActive = channel.id === activeChannelId;
  return (
    <button
      type="button"
      data-testid="sidebar-general-entry"
      data-active={isActive ? 'true' : 'false'}
      onClick={() =>
        onSelectChannel({
          id: channel.id,
          name: channel.name,
          projectId: channel.projectId,
        })
      }
      className={clsx(
        'flex w-full items-center gap-2 rounded-panel px-2.5 py-1.5 text-left text-sm',
        'hover:bg-sunk focus:outline-none focus:ring-1 focus:ring-brand',
        isActive && 'bg-sunk border border-panel-border',
        !isActive && 'border border-transparent',
        className,
      )}
    >
      <span aria-hidden="true" className="text-base">
        {'💬'}
      </span>
      <span className="flex-1 truncate font-medium">
        {t('sidebar.general.label', { defaultValue: '일반 채널' })}
      </span>
    </button>
  );
}
