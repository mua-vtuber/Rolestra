/**
 * MeetingBanner — 채널 상단 "회의 진행중" 배너 (R5-Task7).
 *
 * prep §2.2 3-way 구조 차이 + D4(영문 라벨 한국어화) 적용.
 * - warm    : heroBg 그라데이션 + `animate-pulse` success dot + '회의 진행중' pill
 *             + 제목(sans) + crew/elapsed/SSM meta row + 종료 버튼
 * - tactical: panelHeaderBg + LineIcon(spark) + 평면 '회의 진행중' + 우측 meta +
 *             clip-path polygon(6px) 통한 각진 하단 모서리
 * - retro   : 완전 별도 JSX — `[진행중] 제목 · 참여 3 · 경과 10분 · SSM 9/12`
 *             mono 1-line strip + 종료 버튼 텍스트 링크
 *
 * hex literal 금지 — 색상은 Tailwind utility + CSS variable(`color-mix`) 경유.
 * meeting.elapsedMs 는 read-time 측정값이라 1분 미만은 "0분" 으로 normalise.
 */
import { clsx } from 'clsx';
import {
  useMemo,
  type CSSProperties,
  type ReactElement,
} from 'react';
import { useTranslation } from 'react-i18next';

import { LineIcon } from '../../components/shell/LineIcon';
import { useTheme } from '../../theme/use-theme';
import { SESSION_STATE_COUNT } from '../../../shared/constants';
import type { ActiveMeetingSummary } from '../../../shared/meeting-types';

export interface MeetingBannerProps {
  meeting: ActiveMeetingSummary;
  /** 현재 채널의 참여자 수. null 이면 '—' dash 로 대체. */
  memberCount?: number | null;
  /** 회의 종료 버튼 콜백. 미지정 시 버튼 disabled. */
  onAbort?: () => void;
  /** 진행 중이면 버튼 라벨에 '종료 중…' 표시. */
  aborting?: boolean;
  className?: string;
}

const WARM_LABEL_BG =
  'color-mix(in srgb, var(--color-success) 12%, transparent)';
const WARM_DOT_COLOR = 'var(--color-success)';
const TACTICAL_BG = 'color-mix(in srgb, var(--color-brand) 10%, transparent)';
const TACTICAL_BORDER =
  'color-mix(in srgb, var(--color-brand) 44%, transparent)';
const TACTICAL_CLIP =
  'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)';

function elapsedMinutes(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.floor(ms / 60_000);
}

export function MeetingBanner({
  meeting,
  memberCount = null,
  onAbort,
  aborting = false,
  className,
}: MeetingBannerProps): ReactElement {
  const { t } = useTranslation();
  const { themeKey } = useTheme();

  const minutes = useMemo(() => elapsedMinutes(meeting.elapsedMs), [meeting.elapsedMs]);
  const metaCrew =
    memberCount === null
      ? t('messenger.banner.metaCrewUnknown')
      : t('messenger.banner.metaCrew', { n: memberCount });
  const metaElapsed = t('messenger.banner.metaElapsed', { minutes });
  const metaSsm = t('messenger.banner.metaSsm', {
    cur: meeting.stateIndex + 1,
    total: SESSION_STATE_COUNT,
  });

  const abortLabel = aborting
    ? t('messenger.banner.aborting')
    : t('messenger.banner.abortButton');
  const abortDisabled = onAbort === undefined || aborting;

  const commonRootAttrs = {
    'data-testid': 'meeting-banner',
    'data-theme-variant': themeKey,
    'data-meeting-id': meeting.id,
  } as const;

  if (themeKey === 'retro') {
    return (
      <div
        {...commonRootAttrs}
        className={clsx(
          'flex items-center gap-2 border-b border-border-soft px-4 py-1.5',
          'bg-sunk font-mono text-xs text-fg',
          className,
        )}
      >
        <span
          data-testid="meeting-banner-retro-prefix"
          className="shrink-0 text-brand"
        >
          {t('messenger.banner.labelRetroPrefix')}
        </span>
        <span
          data-testid="meeting-banner-topic"
          className="truncate"
        >
          {meeting.topic}
        </span>
        <span
          data-testid="meeting-banner-meta"
          className="text-fg-muted whitespace-nowrap"
        >
          {` · ${metaCrew} · ${metaElapsed} · ${metaSsm}`}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          data-testid="meeting-banner-abort"
          disabled={abortDisabled}
          onClick={onAbort}
          className={clsx(
            'text-xs font-mono underline-offset-2 hover:underline',
            'text-danger disabled:opacity-50 disabled:pointer-events-none',
          )}
        >
          {abortLabel}
        </button>
      </div>
    );
  }

  if (themeKey === 'tactical') {
    const style: CSSProperties = {
      backgroundColor: TACTICAL_BG,
      borderBottom: `1px solid ${TACTICAL_BORDER}`,
      clipPath: TACTICAL_CLIP,
    };
    return (
      <div
        {...commonRootAttrs}
        className={clsx(
          'flex items-center gap-3 px-4 py-2 font-sans text-sm',
          className,
        )}
        style={style}
      >
        <LineIcon
          name="spark"
          size={16}
          stroke={1.4}
          className="shrink-0 text-brand"
        />
        <span
          data-testid="meeting-banner-label"
          className="shrink-0 font-mono text-xs tracking-wider text-brand"
        >
          {t('messenger.banner.labelActive')}
        </span>
        <span
          data-testid="meeting-banner-topic"
          className="truncate text-fg font-semibold"
        >
          {meeting.topic}
        </span>
        <div className="flex-1" />
        <span
          data-testid="meeting-banner-meta"
          className="text-xs text-fg-muted font-mono whitespace-nowrap"
        >
          {`${metaCrew} · ${metaElapsed} · ${metaSsm}`}
        </span>
        <button
          type="button"
          data-testid="meeting-banner-abort"
          disabled={abortDisabled}
          onClick={onAbort}
          className={clsx(
            'rounded-none border border-border px-2 py-0.5 text-xs font-mono',
            'text-danger hover:bg-sunk',
            'disabled:opacity-50 disabled:pointer-events-none',
          )}
        >
          {abortLabel}
        </button>
      </div>
    );
  }

  // warm
  const warmRootStyle: CSSProperties = { background: 'var(--color-hero-bg)' };
  const warmLabelStyle: CSSProperties = { backgroundColor: WARM_LABEL_BG };
  const warmDotStyle: CSSProperties = { backgroundColor: WARM_DOT_COLOR };
  return (
    <div
      {...commonRootAttrs}
      className={clsx(
        'flex items-center gap-3 border-b border-hero-border px-4 py-2.5 font-sans text-sm',
        className,
      )}
      style={warmRootStyle}
    >
      <span
        data-testid="meeting-banner-dot"
        className={clsx(
          'shrink-0 h-2 w-2 rounded-full animate-pulse',
        )}
        style={warmDotStyle}
        aria-hidden="true"
      />
      <span
        data-testid="meeting-banner-label"
        className={clsx(
          'shrink-0 inline-flex items-center rounded-full px-2 py-0.5',
          'text-xs font-semibold text-success',
        )}
        style={warmLabelStyle}
      >
        {t('messenger.banner.labelActive')}
      </span>
      <span
        data-testid="meeting-banner-topic"
        className="truncate text-fg font-semibold"
      >
        {meeting.topic}
      </span>
      <div className="flex-1" />
      <span
        data-testid="meeting-banner-meta"
        className="text-xs text-fg-muted whitespace-nowrap"
      >
        {`${metaCrew} · ${metaElapsed} · ${metaSsm}`}
      </span>
      <button
        type="button"
        data-testid="meeting-banner-abort"
        disabled={abortDisabled}
        onClick={onAbort}
        className={clsx(
          'rounded-full border border-border-soft px-3 py-1 text-xs font-medium',
          'text-danger hover:bg-sunk',
          'disabled:opacity-50 disabled:pointer-events-none',
        )}
      >
        {abortLabel}
      </button>
    </div>
  );
}
