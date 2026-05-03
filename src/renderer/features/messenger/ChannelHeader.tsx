/**
 * ChannelHeader — Thread 상단 바 (R5-Task5).
 *
 * 표시 요소:
 * - `#` glyph + 채널명 (retro 는 mono font, 나머지는 sans)
 * - 읽기 전용 배지 (channel.readOnly === true)
 * - 참여자 수 (우측, memberCount 가 null 이면 dash)
 * - 액션 버튼: 이름 변경 / 삭제
 *
 * kind 별 동작 매트릭스:
 * - user          : rename/delete 렌더 + 활성.
 * - dm            : rename 미렌더(이름은 상대 이름 고정), delete 렌더 + 활성.
 * - system_*      : `[읽기 전용]` 배지 노출. rename/delete 렌더 + 비활성 +
 *                   title 안내(defence-in-depth — 서비스 레벨 SystemChannelProtectedError 도 존재).
 *
 * 회의 시작 / 회의 중단 버튼은 좌측 사이드바의 ChannelMeetingControl 이
 * host 한다. 헤더는 채널 메타데이터 + 이름 변경 / 삭제만 다룬다.
 *
 * hex literal 금지 — Tailwind utility + CSS variable 만 사용.
 */
import { clsx } from 'clsx';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../theme/use-theme';
import type { Channel } from '../../../shared/channel-types';

export interface ChannelHeaderProps {
  channel: Channel;
  /** 참여자 수. null 은 loading / DM 같이 수치 미정 상태. */
  memberCount: number | null;
  onRename?: () => void;
  onDelete?: () => void;
  className?: string;
}

function isSystemKind(channel: Channel): boolean {
  return channel.kind.startsWith('system_');
}

export function ChannelHeader({
  channel,
  memberCount,
  onRename,
  onDelete,
  className,
}: ChannelHeaderProps): ReactElement {
  const { t } = useTranslation();
  const { themeKey } = useTheme();

  const system = isSystemKind(channel);
  const isDm = channel.kind === 'dm';

  const renameDisabled = system;
  const renameTitle = system
    ? t('messenger.channelHeader.renameDisabledSystem')
    : undefined;

  const deleteDisabled = system;
  const deleteTitle = system
    ? t('messenger.channelHeader.deleteDisabledSystem')
    : undefined;

  const nameFontClasses = themeKey === 'retro' ? 'font-mono' : 'font-sans';
  const memberCountLabel =
    memberCount === null
      ? '—'
      : t('messenger.channelHeader.memberCount', { count: memberCount });

  const actionBtnClasses = clsx(
    'inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium',
    'transition-colors',
    'text-fg-muted hover:text-fg hover:bg-sunk',
    'disabled:opacity-50 disabled:pointer-events-none',
    themeKey === 'warm' ? 'rounded-md' : 'rounded-none',
  );

  return (
    <header
      data-testid="channel-header"
      data-channel-id={channel.id}
      data-channel-kind={channel.kind}
      data-theme-variant={themeKey}
      className={clsx(
        'flex items-center gap-3 border-b border-topbar-border bg-topbar-bg px-4 py-2.5',
        className,
      )}
    >
      <span
        data-testid="channel-header-glyph"
        className={clsx(
          'text-base',
          themeKey === 'retro' ? 'text-brand font-mono' : 'text-fg-subtle',
        )}
        aria-hidden="true"
      >
        #
      </span>
      <h2
        data-testid="channel-header-name"
        className={clsx('text-sm font-bold text-fg truncate', nameFontClasses)}
      >
        {channel.name}
      </h2>
      {channel.readOnly ? (
        <span
          data-testid="channel-header-readonly-badge"
          className={clsx(
            'inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold font-mono',
            'border border-border text-fg-subtle',
            themeKey === 'warm' ? 'rounded-full' : 'rounded-none',
          )}
        >
          {t('messenger.channelHeader.readOnlyBadge')}
        </span>
      ) : null}

      <div className="flex-1" />

      <span
        data-testid="channel-header-member-count"
        className="text-xs text-fg-muted font-mono"
      >
        {memberCountLabel}
      </span>

      {!isDm ? (
        <button
          type="button"
          onClick={onRename}
          disabled={renameDisabled || onRename === undefined}
          title={renameTitle}
          data-testid="channel-header-rename"
          data-disabled={renameDisabled ? 'true' : 'false'}
          className={actionBtnClasses}
        >
          {t('messenger.channelHeader.rename')}
        </button>
      ) : null}

      <button
        type="button"
        onClick={onDelete}
        disabled={deleteDisabled || onDelete === undefined}
        title={deleteTitle}
        data-testid="channel-header-delete"
        data-disabled={deleteDisabled ? 'true' : 'false'}
        className={actionBtnClasses}
      >
        {t('messenger.channelHeader.delete')}
      </button>
    </header>
  );
}
