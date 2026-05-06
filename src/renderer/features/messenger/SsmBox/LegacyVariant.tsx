/**
 * LegacyVariant — channel.role 이 5 variant 어디에도 매핑되지 않는 경우의
 * fallback (R12-C2 T18 land).
 *
 * 적용 대상:
 * - `role === null` — DM / system_general / 옛 user 채널 (R12-C 이전 생성)
 * - `role === 'design.character'` / `'design.background'` — R12-D 보류 부서
 *   (현 phase 에서 해당 채널 자체가 grayed out 이지만 만약 들어와도 안전)
 *
 * 본 fallback 은 옛 R5-R11 의 "SSM N/TOTAL placeholder" 와 동일한 표시
 * (회의 활성 시 phase 진행 라벨 / 비활성 시 빈 라벨). 풀세트 5+2.5 phase
 * 모델에서는 phase 진행률이 의미를 갖지 못하지만 기존 시각 일관성을
 * 위해 유지 — variant 라우팅이 정식인 5 부서로 좁혀지는 R12-W 시점에
 * 자연스럽게 dead branch 가 된다.
 *
 * hex literal 금지.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { ProgressGauge } from '../../dashboard/ProgressGauge';
import type { ActiveMeetingSummary } from '../../../../shared/meeting-types';
import type { ChannelRole } from '../../../../shared/channel-role-types';
import { SESSION_STATE_COUNT } from '../../../../shared/constants';
import { SsmBoxFrame } from './shared';

export interface LegacyVariantProps {
  /** channel.role — `null` 또는 5 variant 외 RoleId. */
  role: ChannelRole;
  meeting: ActiveMeetingSummary | null;
  className?: string;
}

export function LegacyVariant({
  role,
  meeting,
  className,
}: LegacyVariantProps): ReactElement {
  const { t } = useTranslation();

  if (meeting === null) {
    return (
      <SsmBoxFrame
        variant="legacy"
        role={role}
        hasMeeting={false}
        className={className}
      >
        <span
          data-testid="ssm-box-empty"
          className="text-xs text-fg-muted"
        >
          {t('messenger.ssmBox.empty')}
        </span>
      </SsmBoxFrame>
    );
  }

  const total = SESSION_STATE_COUNT;
  const value = Math.max(0, Math.min(total, meeting.stateIndex + 1));
  const label = `SSM ${value}/${total}`;

  return (
    <SsmBoxFrame
      variant="legacy"
      role={role}
      hasMeeting
      phaseIndex={meeting.stateIndex}
      phaseName={meeting.stateName}
      className={className}
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
    </SsmBoxFrame>
  );
}
