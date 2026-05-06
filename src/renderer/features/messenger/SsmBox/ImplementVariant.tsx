/**
 * ImplementVariant — 구현 부서 SsmBox layout (R12-C2 T18 land).
 *
 * spec §11.13: "designated AI 표시 + 진행도 게이지 + 작업 중 파일 list
 * (별 컴포넌트 — `<ImplementProgress>`). 회의 X — opinion 트리 / 투표
 * surface 자체가 없음".
 *
 * 구현 부서는 풀세트 회의 흐름을 *공유하지 않는다* — designated worker
 * 단일 AI 가 작업하고 완료 후 검토(audit) 인계 한 흐름. 따라서 SsmBox
 * 표현도 의견 트리 / 투표 카운터 자체가 없음. T18 시점 본 컴포넌트는
 * designated AI placeholder + 진행도 placeholder + file list placeholder.
 *
 * 실 데이터 hookup (designated worker resolver / RunStep 진행도 / 파일
 * list) 은 T23 (designated worker resolver), T19 (RunStep aggregator),
 * R12-W (구현 부서 분담 본격) 에서 진행.
 *
 * hex literal 금지.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { ActiveMeetingSummary } from '../../../../shared/meeting-types';
import { SsmBoxFrame } from './shared';

export interface ImplementVariantProps {
  meeting: ActiveMeetingSummary | null;
  className?: string;
}

export function ImplementVariant({
  meeting,
  className,
}: ImplementVariantProps): ReactElement {
  const { t } = useTranslation();

  return (
    <SsmBoxFrame
      variant="implement"
      role="implement"
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
          {t('messenger.ssmBox.variants.implement.heading')}
        </span>
      </header>

      {meeting === null ? (
        <p
          data-testid="ssm-box-empty"
          className="text-xs text-fg-muted"
        >
          {t('messenger.ssmBox.variants.implement.empty')}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div
            data-testid="ssm-box-designated-slot"
            className="rounded border border-dashed border-border px-2 py-1 text-[11px] text-fg-subtle"
          >
            {t('messenger.ssmBox.variants.implement.designatedPlaceholder')}
          </div>
          <div
            data-testid="ssm-box-progress-slot"
            className="rounded border border-dashed border-border px-2 py-1 text-[11px] text-fg-subtle"
          >
            {t('messenger.ssmBox.variants.implement.progressPlaceholder')}
          </div>
          <div
            data-testid="ssm-box-file-list-slot"
            className="rounded border border-dashed border-border px-2 py-1 text-[11px] text-fg-subtle"
          >
            {t('messenger.ssmBox.variants.implement.fileListPlaceholder')}
          </div>
        </div>
      )}
    </SsmBoxFrame>
  );
}
