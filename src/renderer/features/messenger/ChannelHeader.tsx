/**
 * ChannelHeader — Thread 상단 바 (R5-Task5).
 *
 * 표시 요소:
 * - `#` glyph + 채널명 (retro 는 mono font, 나머지는 sans)
 * - 읽기 전용 배지 (channel.readOnly === true)
 * - 참여자 수 (우측, memberCount 가 null 이면 dash)
 * - 액션 버튼: 회의 시작 / 이름 변경 / 삭제
 *
 * kind 별 동작 매트릭스:
 * - user          : 회의 시작 렌더(활성: activeMeetingCount===0 만, 이미 회의 중이면 disabled + title).
 *                   rename/delete 렌더 + 활성.
 * - dm            : 회의 시작 미렌더. rename 미렌더(이름은 상대 이름 고정), delete 렌더 + 활성.
 * - system_*      : 회의 시작 미렌더. `[읽기 전용]` 배지 노출. rename/delete 렌더 + 비활성 +
 *                   title 안내(defence-in-depth — 서비스 레벨 SystemChannelProtectedError 도 존재).
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
  /** 이 채널에서 진행중인 회의 수. 0 이면 회의 시작 활성, >0 이면 비활성 + 안내. */
  activeMeetingCount?: number;
  onStartMeeting?: () => void;
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
  activeMeetingCount = 0,
  onStartMeeting,
  onRename,
  onDelete,
  className,
}: ChannelHeaderProps): ReactElement {
  const { t } = useTranslation();
  const { themeKey } = useTheme();

  const system = isSystemKind(channel);
  const isUser = channel.kind === 'user';
  const isDm = channel.kind === 'dm';
  const hasActiveMeeting = activeMeetingCount > 0;

  const startMeetingDisabled = hasActiveMeeting;
  const startMeetingTitle = hasActiveMeeting
    ? t('messenger.channelHeader.startMeetingDisabledBusy')
    : undefined;

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

      {isUser ? (
        <button
          type="button"
          onClick={onStartMeeting}
          disabled={startMeetingDisabled || onStartMeeting === undefined}
          title={startMeetingTitle}
          data-testid="channel-header-start-meeting"
          data-disabled={startMeetingDisabled ? 'true' : 'false'}
          className={clsx(
            actionBtnClasses,
            'border border-border-soft',
          )}
        >
          {t('messenger.channelHeader.startMeeting')}
        </button>
      ) : null}

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
