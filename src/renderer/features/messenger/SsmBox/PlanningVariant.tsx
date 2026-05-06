/**
 * PlanningVariant — 기획 / 리뷰 / 검토 부서 공통 SsmBox layout
 * (R12-C2 T18 land).
 *
 * spec §11.13: "의견 트리 (parent chain 들여쓰기) + 현재 진행 의견 highlight
 * + 각 카드 동의/반대/수정 표시 + 카운터 (예: '2/3 동의') + 회의록
 * [합의]+[제외] 미리보기 footer".
 *
 * 풀세트 5+2.5 phase 흐름이 `planning` / `review` / `audit` 세 부서에서
 * 공유되므로 SsmBox 도 한 variant 컴포넌트로 통합. 부서별 세부 차이
 * (예: NG → 기획 인계 분기, 자유 발화 후 lock 풀림 등) 는 backend
 * workflow (`audit-workflow.ts` / `review-workflow.ts`) 가 흡수 — SsmBox
 * 표현 layer 는 동일.
 *
 * 실 opinion 트리 / 회의록 미리보기 hookup 은 T19 이후 (RunStep aggregator
 * + minutes preview API) 에서 진행. T18 시점에는 layout skeleton + 부서
 * 식별자 (`role`) 만 노출.
 *
 * hex literal 금지.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { RoleId } from '../../../../shared/role-types';
import type { ActiveMeetingSummary } from '../../../../shared/meeting-types';
import { SsmBoxFrame } from './shared';

export interface PlanningVariantProps {
  /** 기획 / 리뷰 / 검토 — 어느 부서 인지에 따라 헤더 라벨 분기. */
  role: Extract<RoleId, 'planning' | 'review' | 'audit'>;
  meeting: ActiveMeetingSummary | null;
  className?: string;
}

export function PlanningVariant({
  role,
  meeting,
  className,
}: PlanningVariantProps): ReactElement {
  const { t } = useTranslation();

  const headingKey =
    role === 'planning'
      ? 'messenger.ssmBox.variants.planning.heading'
      : role === 'review'
        ? 'messenger.ssmBox.variants.review.heading'
        : 'messenger.ssmBox.variants.audit.heading';

  return (
    <SsmBoxFrame
      variant="planning"
      role={role}
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
          {t(headingKey)}
        </span>
        {meeting !== null && (
          <span
            data-testid="ssm-box-state-name"
            className="truncate text-[11px] text-fg-muted"
            title={meeting.stateName}
          >
            {meeting.stateName}
          </span>
        )}
      </header>

      {meeting === null ? (
        <p
          data-testid="ssm-box-empty"
          className="text-xs text-fg-muted"
        >
          {t('messenger.ssmBox.variants.planning.empty')}
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <p
            data-testid="ssm-box-description"
            className="text-[11px] text-fg-subtle"
          >
            {t('messenger.ssmBox.variants.planning.placeholder', {
              topic: meeting.topic,
            })}
          </p>
          <ol
            data-testid="ssm-box-opinion-tree"
            className="flex flex-col gap-1 text-[11px] text-fg-muted"
            aria-label={t('messenger.ssmBox.variants.planning.treeAria')}
          >
            <li className="rounded border border-dashed border-border px-2 py-1">
              {t('messenger.ssmBox.variants.planning.pendingDataNote')}
            </li>
          </ol>
          <footer
            data-testid="ssm-box-minutes-preview"
            className="mt-1 rounded border border-dashed border-border px-2 py-1 text-[11px] text-fg-subtle"
          >
            {t('messenger.ssmBox.variants.planning.minutesPreviewPlaceholder')}
          </footer>
        </div>
      )}
    </SsmBoxFrame>
  );
}
