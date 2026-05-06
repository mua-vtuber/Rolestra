/**
 * IdeaVariant — 아이디어 부서 SsmBox layout (R12-C2 T18 land).
 *
 * spec §11.13: "의견 list (kind='root' 만, 단순) + 옆에 사용자 선택 여부
 * (체크 마크). 진행 상황 X — step 2 까지만. step 2.5 / 3 / 4 / 5 surface X
 * (D-B-Light)".
 *
 * 본 컴포넌트는 layout skeleton — 실 opinion list / 선택 체크는 T19 이후
 * (`OpinionService` 연결 + idea-workflow phase 데이터 source) 에서 hookup.
 * T18 시점에는 부서별 시각 분기 + 빈 상태 placeholder 까지만.
 *
 * hex literal 금지.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { ActiveMeetingSummary } from '../../../../shared/meeting-types';
import { SsmBoxFrame } from './shared';

export interface IdeaVariantProps {
  meeting: ActiveMeetingSummary | null;
  className?: string;
}

export function IdeaVariant({ meeting, className }: IdeaVariantProps): ReactElement {
  const { t } = useTranslation();

  return (
    <SsmBoxFrame
      variant="idea"
      role="idea"
      hasMeeting={meeting !== null}
      phaseIndex={meeting?.stateIndex}
      phaseName={meeting?.stateName}
      className={className}
    >
      <header className="flex items-center justify-between gap-2">
        <span
          data-testid="ssm-box-variant-label"
          className="text-xs font-semibold text-fg"
        >
          {t('messenger.ssmBox.variants.idea.heading')}
        </span>
      </header>

      {meeting === null ? (
        <p
          data-testid="ssm-box-empty"
          className="text-xs text-fg-muted"
        >
          {t('messenger.ssmBox.variants.idea.empty')}
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <p
            data-testid="ssm-box-description"
            className="text-[11px] text-fg-subtle"
          >
            {t('messenger.ssmBox.variants.idea.placeholder', {
              topic: meeting.topic,
            })}
          </p>
          <ul
            data-testid="ssm-box-idea-list"
            className="flex flex-col gap-1 text-[11px] text-fg-muted"
            aria-label={t('messenger.ssmBox.variants.idea.listAria')}
          >
            <li className="rounded border border-dashed border-border px-2 py-1">
              {t('messenger.ssmBox.variants.idea.pendingDataNote')}
            </li>
          </ul>
        </div>
      )}
    </SsmBoxFrame>
  );
}
