/**
 * ChannelRail — 좌측 채널 목록 레일 (R5-Task4).
 *
 * 3 섹션 구조:
 * 1. 시스템 채널 (system_general / system_approval / system_minutes) — 상단 고정,
 *    섹션 타이틀 없음. 3개 채널은 ProjectService post-create 훅에서 자동 생성
 *    (Task 11 wire-up). 순서는 main service 가 내려주는 createdAt 오름차순을
 *    그대로 따른다.
 * 2. 사용자 채널 (kind='user') — 섹션 타이틀 "채널" (retro: "$ 채널").
 *    하단 `+ 새 채널` 버튼 상시 노출(Task 10 에서 create modal 트리거).
 * 3. DM (kind='dm') — 섹션 타이틀 "DM" (retro: "$ DM"). 프로젝트 scope 와
 *    무관하므로 `useDms()` 의 전역 리스트를 그대로 보여준다.
 *
 * 데이터 소스:
 * - `useChannels(projectId)` — 시스템 + 사용자 채널 (main side 가 동일 리스트로 내려줌)
 * - `useDms()` — DM 전용 (projectId=null IPC)
 * - `useActiveChannel(projectId, channels)` — 활성 channelId + set/clear
 *
 * 섹션 타이틀 i18n 키는 D4 결정대로 `sectionTitle.<themeKey>.(channels|dm)` 6개
 * 모두 정적 호출로 열거한다(i18next-parser 가 각 호출을 독립적으로 추출 — keepRemoved
 * 불필요). warm/tactical 은 시작 값을 동일 "채널"/"DM" 로 두고, retro 만 "$ " 프리픽스.
 *
 * hex literal 0 규약을 유지한다.
 */
import { clsx } from 'clsx';
import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { ChannelMeetingControl } from './ChannelMeetingControl';
import { ChannelRow } from './ChannelRow';
import { useActiveChannel } from '../../hooks/use-active-channel';
import { useChannels } from '../../hooks/use-channels';
import { useDms } from '../../hooks/use-dms';
import { useGlobalGeneralChannel } from '../../hooks/use-global-general-channel';
import { useTheme } from '../../theme/use-theme';
import type { Channel, ChannelKind } from '../../../shared/channel-types';
import type { ActiveMeetingSummary } from '../../../shared/meeting-types';
import type { ThemeKey } from '../../theme/theme-tokens';

const SYSTEM_KINDS: ReadonlyArray<ChannelKind> = [
  'system_general',
  'system_approval',
  'system_minutes',
];

export interface ChannelRailProps {
  projectId: string;
  /**
   * Active meetings across all channels (host owns the {@link useActiveMeetings}
   * instance so abort/start refreshes there propagate to the row controls).
   * `null` while the initial fetch is in flight — controls render nothing.
   */
  meetings?: ActiveMeetingSummary[] | null;
  /** Open the start-meeting modal targeted at `channel`. */
  onStartMeeting?: (channel: Channel) => void;
  /** Abort the meeting with the given id. Resolves on IPC completion. */
  onAbortMeeting?: (meetingId: string) => Promise<void> | void;
  /** `+ 새 채널` 클릭 핸들러. Task 10 에서 Radix Dialog 기반 create modal 오픈에 연결. */
  onCreateChannel?: () => void;
  className?: string;
}

function resolveChannelsTitle(themeKey: ThemeKey, t: (key: string) => string): string {
  if (themeKey === 'warm') return t('messenger.channelRail.sectionTitle.warm.channels');
  if (themeKey === 'tactical') return t('messenger.channelRail.sectionTitle.tactical.channels');
  return t('messenger.channelRail.sectionTitle.retro.channels');
}

function resolveDmTitle(themeKey: ThemeKey, t: (key: string) => string): string {
  if (themeKey === 'warm') return t('messenger.channelRail.sectionTitle.warm.dm');
  if (themeKey === 'tactical') return t('messenger.channelRail.sectionTitle.tactical.dm');
  return t('messenger.channelRail.sectionTitle.retro.dm');
}

function sectionTitleClasses(themeKey: ThemeKey): string {
  // warm: sans, 살짝 letterSpacing.
  // tactical: mono + uppercase 시각 대응 (한글은 대소문자 없으므로 tracking 강조).
  // retro: mono, lowercase-ish 그대로 — 타이틀 문자열 자체에 `$` 프리픽스 포함.
  return clsx(
    'px-3 py-2 text-[10px] font-bold text-fg-subtle',
    themeKey === 'warm' && 'font-sans tracking-wide',
    themeKey === 'tactical' && 'font-mono uppercase tracking-[0.15em]',
    themeKey === 'retro' && 'font-mono',
  );
}

export function ChannelRail({
  projectId,
  meetings,
  onStartMeeting,
  onAbortMeeting,
  onCreateChannel,
  className,
}: ChannelRailProps): ReactElement {
  const { t } = useTranslation();
  const { themeKey } = useTheme();

  const { channels, loading: channelsLoading, error: channelsError } = useChannels(projectId);
  const { dms, loading: dmsLoading, error: dmsError } = useDms();
  const { channel: globalGeneralChannel } = useGlobalGeneralChannel();
  // `useActiveChannel`'s validation clears the stored channelId when the
  // current channels list does not contain it. DMs + 전역 일반 채널은
  // useChannels(projectId) 의 응답에 없으므로 같이 병합해야 사용자가
  // 일반 채널 / DM 을 선택했을 때 active selection 이 보존된다.
  const validationChannels = useMemo<Channel[] | null>(() => {
    if (channels === null && dms === null && globalGeneralChannel === null) {
      return null;
    }
    const all: Channel[] = [...(channels ?? []), ...(dms ?? [])];
    if (globalGeneralChannel !== null) all.push(globalGeneralChannel);
    return all;
  }, [channels, dms, globalGeneralChannel]);
  const activeChannel = useActiveChannel(projectId, validationChannels);

  const systemChannels = useMemo<Channel[]>(
    () => (channels === null ? [] : channels.filter((c) => SYSTEM_KINDS.includes(c.kind))),
    [channels],
  );
  const userChannels = useMemo<Channel[]>(
    () => (channels === null ? [] : channels.filter((c) => c.kind === 'user')),
    [channels],
  );
  const dmChannels = useMemo<Channel[]>(() => dms ?? [], [dms]);

  const channelsTitle = resolveChannelsTitle(themeKey, t);
  const dmTitle = resolveDmTitle(themeKey, t);
  const titleClasses = sectionTitleClasses(themeKey);

  const initialChannelsLoading = channelsLoading && channels === null;
  const initialDmsLoading = dmsLoading && dms === null;
  const isInitialLoading = initialChannelsLoading && initialDmsLoading;

  // Map channelId → active meeting (one per channel by spec — see
  // `idx_meetings_active_per_channel`). `null` while meetings are still
  // loading so we don't briefly flash a "no meeting" affordance over a
  // channel that's actually busy.
  const meetingByChannel = useMemo<Map<string, ActiveMeetingSummary> | null>(() => {
    if (meetings === null || meetings === undefined) return null;
    const map = new Map<string, ActiveMeetingSummary>();
    for (const m of meetings) map.set(m.channelId, m);
    return map;
  }, [meetings]);

  const meetingControlReady =
    meetingByChannel !== null &&
    onStartMeeting !== undefined &&
    onAbortMeeting !== undefined;

  const renderRow = (channel: Channel): ReactElement => {
    const activeMeeting = meetingByChannel?.get(channel.id) ?? null;
    // R12-C: 회의 시작 버튼 표시 조건 갱신.
    // - 부서 채널 (channel.role !== null) = 할 일 큐에서 자동 워크플로우 → 수동 [회의 시작] hide
    // - system_general (전역 일반 채널) = 1라운드 단순 응답 → hide
    // - 자유 user 채널 (role === null) = 기존대로 [회의 시작] 버튼 표시
    // - 진행 중 meeting (activeMeeting != null) = 항상 표시 (abort 가능)
    const isFreeUserChannel =
      channel.kind === 'user' && channel.role === null;
    const showMeetingControl =
      meetingControlReady &&
      (activeMeeting !== null || isFreeUserChannel);
    const rightSlot = showMeetingControl ? (
      <ChannelMeetingControl
        channel={channel}
        activeMeeting={activeMeeting}
        onStartMeeting={onStartMeeting!}
        onAbortMeeting={onAbortMeeting!}
      />
    ) : undefined;
    return (
      <ChannelRow
        key={channel.id}
        channel={channel}
        active={channel.id === activeChannel.activeChannelId}
        onClick={() => activeChannel.set(channel.id)}
        rightSlot={rightSlot}
      />
    );
  };

  return (
    <div
      data-testid="channel-rail"
      data-theme-variant={themeKey}
      className={clsx('flex h-full min-h-0 flex-col', className)}
    >
      <div className="flex-1 overflow-y-auto">
        {isInitialLoading ? (
          <div
            data-testid="channel-rail-loading"
            className="px-3 py-4 text-xs text-fg-subtle"
          >
            {t('messenger.channelRail.loading')}
          </div>
        ) : null}

        {channelsError !== null ? (
          <div
            data-testid="channel-rail-error"
            role="alert"
            className="px-3 py-2 text-xs text-danger"
          >
            {t('messenger.channelRail.error')}
          </div>
        ) : null}

        {/* System section — 섹션 타이틀 없음. 채널 0개이면 빈 슬롯 생략.
            R12-C: 전역 일반 채널 (projectId=null, kind=system_general) 을
            맨 위에 prepend. 프로젝트 종속 system_approval/minutes 는 그 뒤. */}
        <section
          data-testid="channel-section-system"
          aria-label={t('messenger.channelRail.sectionAria.system')}
          className="flex flex-col gap-px py-1"
        >
          {globalGeneralChannel !== null ? renderRow(globalGeneralChannel) : null}
          {systemChannels.map(renderRow)}
        </section>

        {/* User channels section */}
        <section
          data-testid="channel-section-user"
          aria-label={t('messenger.channelRail.sectionAria.user')}
          className="flex flex-col gap-px py-1"
        >
          <h3
            data-testid="channel-section-title-user"
            data-section-kind="channels"
            className={titleClasses}
          >
            {channelsTitle}
          </h3>
          {!initialChannelsLoading && userChannels.length === 0 ? (
            <p
              data-testid="channel-rail-user-empty"
              className="px-3 py-1 text-xs text-fg-subtle"
            >
              {t('messenger.channelRail.userEmpty')}
            </p>
          ) : null}
          {userChannels.map(renderRow)}
          <button
            type="button"
            onClick={onCreateChannel}
            disabled={onCreateChannel === undefined}
            data-testid="channel-rail-create"
            className={clsx(
              'mx-1.5 mt-1 flex items-center gap-1.5 px-2.5 py-1.5 text-left text-sm',
              'text-fg-subtle hover:text-fg hover:bg-sunk',
              'transition-colors disabled:opacity-50 disabled:pointer-events-none',
              themeKey === 'retro' ? 'font-mono' : 'font-sans',
              themeKey === 'warm' ? 'rounded-md' : 'rounded-none',
            )}
          >
            <span aria-hidden="true">+</span>
            <span>{t('messenger.channelRail.createChannel')}</span>
          </button>
        </section>

        {/* DM section */}
        <section
          data-testid="channel-section-dm"
          aria-label={t('messenger.channelRail.sectionAria.dm')}
          className="flex flex-col gap-px py-1"
        >
          <h3
            data-testid="channel-section-title-dm"
            data-section-kind="dm"
            className={titleClasses}
          >
            {dmTitle}
          </h3>
          {dmsError !== null ? (
            <p
              data-testid="channel-rail-dm-error"
              role="alert"
              className="px-3 py-1 text-xs text-danger"
            >
              {t('messenger.channelRail.error')}
            </p>
          ) : null}
          {!initialDmsLoading && dmChannels.length === 0 ? (
            <p
              data-testid="channel-rail-dm-empty"
              className="px-3 py-1 text-xs text-fg-subtle"
            >
              {t('messenger.channelRail.dmEmpty')}
            </p>
          ) : null}
          {dmChannels.map(renderRow)}
        </section>
      </div>
    </div>
  );
}
