/**
 * SsmBox — MemberPanel 합의 상태 섹션의 메인 viewport (R5-Task9).
 *
 * 2-way: tactical 만 `clip-path polygon(5px)` 으로 양 모서리를 깎아내고,
 * 나머지(warm / retro) 는 `panelRadius` 토큰을 그대로 적용한다(warm=12,
 * retro=0). 내부에 "SSM N/TOTAL" 라벨 + i18n 설명문 + `ProgressGauge`
 * (themeKey 에 따라 3 variant) 을 배치한다.
 *
 * meeting 이 없는 경우(=회의 비활성) 는 상위 MemberPanel 이 null 을
 * 넘기므로 이 컴포넌트는 그 때 별도 empty 라벨을 그린다.
 *
 * R12-C2 T10b: 옛 SSM 12-state 모델이 phase loop 8 phase 모델로 교체됨.
 * `SESSION_STATE_COUNT` 와 `meeting.stateIndex` 는 이제 phase 기반
 * (gather/tally/quick_vote/free_discussion/compose_minutes/handoff/done/
 *  aborted) 으로 매핑된다. 본 컴포넌트는 P3/R12-H 에서 phase 카드 + 박스
 * 새 layout 으로 재설계 예정 — 그 때까지는 "SSM N/TOTAL" 라벨이 phase
 * 진행률을 표현하는 placeholder 로 남는다.
 *
 * hex literal 금지.
 */
import { clsx } from 'clsx';
import type { CSSProperties, ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { ProgressGauge } from '../dashboard/ProgressGauge';
import { useTheme } from '../../theme/use-theme';
import type { ActiveMeetingSummary } from '../../../shared/meeting-types';
import { SESSION_STATE_COUNT } from '../../../shared/constants';

const TACTICAL_CLIP =
  'polygon(5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%, 0 5px)';

export interface SsmBoxProps {
  /** Active meeting for the current channel. `null` → empty state. */
  meeting: ActiveMeetingSummary | null;
  className?: string;
}

export function SsmBox({ meeting, className }: SsmBoxProps): ReactElement {
  const { t } = useTranslation();
  const { themeKey, token } = useTheme();

  const containerStyle: CSSProperties = {
    borderRadius: `${token.panelRadius}px`,
  };
  if (themeKey === 'tactical') {
    containerStyle.clipPath = TACTICAL_CLIP;
  }

  const rootAttrs = {
    'data-testid': 'ssm-box',
    'data-theme-variant': themeKey,
    'data-panel-radius': String(token.panelRadius),
    'data-has-meeting': meeting === null ? 'false' : 'true',
  } as const;

  if (meeting === null) {
    return (
      <div
        {...rootAttrs}
        className={clsx(
          'flex flex-col gap-1 border border-border bg-sunk px-3 py-2',
          themeKey === 'retro' ? 'font-mono' : 'font-sans',
          className,
        )}
        style={containerStyle}
      >
        <span
          data-testid="ssm-box-empty"
          className="text-xs text-fg-muted"
        >
          {t('messenger.ssmBox.empty')}
        </span>
      </div>
    );
  }

  const total = SESSION_STATE_COUNT;
  const value = Math.max(0, Math.min(total, meeting.stateIndex + 1));
  const label = `SSM ${value}/${total}`;

  return (
    <div
      {...rootAttrs}
      data-state-index={meeting.stateIndex}
      data-state-name={meeting.stateName}
      className={clsx(
        'flex flex-col gap-2 border border-border bg-sunk px-3 py-2',
        themeKey === 'retro' ? 'font-mono' : 'font-sans',
        className,
      )}
      style={containerStyle}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          data-testid="ssm-box-label"
          className="text-xs font-semibold text-fg"
        >
          {label}
        </span>
        <span
          data-testid="ssm-box-state-name"
          className="truncate text-[11px] text-fg-muted"
          title={meeting.stateName}
        >
          {meeting.stateName}
        </span>
      </div>
      <ProgressGauge value={value} total={total} />
      <p
        data-testid="ssm-box-description"
        className="text-[11px] text-fg-subtle"
      >
        {t('messenger.ssmBox.description', { topic: meeting.topic })}
      </p>
    </div>
  );
}
