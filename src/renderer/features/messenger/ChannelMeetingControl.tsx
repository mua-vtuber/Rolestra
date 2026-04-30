/**
 * ChannelMeetingControl — sidebar-side meeting start/abort affordance
 * (R12 dogfooding feedback: 회의 시작/종료 버튼 위치를 채널 헤더에서
 * 좌측 채널 row 우측으로 이동).
 *
 * Renders one of three states next to a channel name:
 *   1. **No active meeting + user channel** → small `[회의 시작]` button.
 *      Hidden until the row is hovered (`group-hover`) so the channel
 *      list stays visually quiet at rest.
 *   2. **Active meeting** → `● 회의 중` label with `[중단]` button next
 *      to it. Always visible — the user must always see at a glance
 *      which channel is busy and have one click to stop it.
 *   3. **Anything else** (system_*, dm) → renders nothing.
 *
 * Why a separate component (vs inlining inside ChannelRail): the
 * abort gesture is async with a confirm step in the future (T11 plans
 * a confirm dialog), and isolating the busy/error state here keeps
 * the rail's row map a one-liner.
 *
 * Hex literals are forbidden in this surface — colours come from theme
 * tokens (`text-success` for the busy dot, `text-danger` for abort).
 */
import { clsx } from 'clsx';
import { useCallback, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../theme/use-theme';
import type { Channel } from '../../../shared/channel-types';
import type { ActiveMeetingSummary } from '../../../shared/meeting-types';

export interface ChannelMeetingControlProps {
  channel: Channel;
  /** The meeting active in this channel, if any. */
  activeMeeting: ActiveMeetingSummary | null;
  /** Open the start-meeting modal targeted at `channel`. */
  onStartMeeting: (channel: Channel) => void;
  /** Abort `activeMeeting`. The handler is responsible for the IPC call. */
  onAbortMeeting: (meetingId: string) => Promise<void> | void;
}

export function ChannelMeetingControl({
  channel,
  activeMeeting,
  onStartMeeting,
  onAbortMeeting,
}: ChannelMeetingControlProps): ReactElement | null {
  const { t } = useTranslation();
  const { themeKey } = useTheme();
  const [aborting, setAborting] = useState(false);

  const handleStart = useCallback(
    (event: React.MouseEvent): void => {
      // Stop the click from bubbling to the parent ChannelRow's selection
      // button — the user opened the modal, not chose the channel.
      event.stopPropagation();
      onStartMeeting(channel);
    },
    [channel, onStartMeeting],
  );

  const handleAbort = useCallback(
    async (event: React.MouseEvent): Promise<void> => {
      event.stopPropagation();
      if (activeMeeting === null) return;
      if (aborting) return;
      setAborting(true);
      try {
        await onAbortMeeting(activeMeeting.id);
      } finally {
        setAborting(false);
      }
    },
    [activeMeeting, aborting, onAbortMeeting],
  );

  const buttonShape = themeKey === 'warm' ? 'rounded-md' : 'rounded-none';
  const buttonBase = clsx(
    'inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium',
    'transition-colors',
    themeKey === 'retro' ? 'font-mono' : 'font-sans',
    buttonShape,
  );

  if (activeMeeting !== null) {
    return (
      <>
        <span
          data-testid="channel-row-meeting-active-label"
          className={clsx(
            'inline-flex items-center gap-1 px-1 text-[10px]',
            'text-success',
            themeKey === 'retro' ? 'font-mono' : 'font-sans',
          )}
          aria-label={t('messenger.channelRail.meetingActive')}
        >
          <span aria-hidden="true">●</span>
          <span className="hidden xl:inline">
            {t('messenger.channelRail.meetingActive')}
          </span>
        </span>
        <button
          type="button"
          onClick={handleAbort}
          disabled={aborting}
          data-testid="channel-row-meeting-abort"
          className={clsx(
            buttonBase,
            'border border-danger text-danger hover:bg-danger/10',
            'disabled:opacity-50 disabled:pointer-events-none',
          )}
        >
          {aborting
            ? t('messenger.channelRail.abortingMeeting')
            : t('messenger.channelRail.abortMeeting')}
        </button>
      </>
    );
  }

  // No active meeting. Only user channels can start one (system_* are
  // read-only or auto-managed; dm flows are single-turn — both excluded
  // by ChannelRail before we even get here, but we double-check to keep
  // this component honest if it's reused elsewhere later).
  if (channel.kind !== 'user') {
    return null;
  }

  return (
    <button
      type="button"
      onClick={handleStart}
      data-testid="channel-row-meeting-start"
      className={clsx(
        buttonBase,
        'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
        'border border-border-soft text-fg-muted hover:text-fg hover:bg-sunk',
      )}
    >
      {t('messenger.channelRail.startMeeting')}
    </button>
  );
}
