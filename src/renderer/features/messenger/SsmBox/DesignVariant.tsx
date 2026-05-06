/**
 * DesignVariant — 디자인 (UI / UX 통합) 부서 SsmBox layout
 * (R12-C2 T18 land).
 *
 * spec §11.13: "토론 round 표시 + UX/UI 시퀀스 (와이어프레임 5 단계 /
 * 디자인 2 단계) + Playwright PNG 미리보기 (별 컴포넌트 — `<DesignPreview>`
 * desktop / mobile 탭)".
 *
 * design-workflow (T16) 가 7 단계 (와이어프레임 5 + 디자인 2) 를 backend
 * 에서 진행. 본 SsmBox 는 그 진행 상황을 사용자에게 노출 — phase 라벨 +
 * Playwright 스냅샷 미리보기 (T16c land 된 `<DesignPreview>` 와 연결될
 * 자리). T18 시점에는 layout 분기까지만, 실 phase 데이터 hookup 은 T19+.
 *
 * `design.ui` / `design.ux` 두 RoleId 모두 본 variant 로 라우팅 — spec
 * §3 line 86 ("두 능력 묶음 — 분리하지 않음") 그대로. character /
 * background 부서는 R12-D 보류 → 본 variant 라우팅 X (legacy fallback).
 *
 * hex literal 금지.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { ActiveMeetingSummary } from '../../../../shared/meeting-types';
import { SsmBoxFrame } from './shared';

export interface DesignVariantProps {
  /** design.ui 또는 design.ux. 표시 라벨은 동일 (통합 부서). */
  role: 'design.ui' | 'design.ux';
  meeting: ActiveMeetingSummary | null;
  className?: string;
}

export function DesignVariant({
  role,
  meeting,
  className,
}: DesignVariantProps): ReactElement {
  const { t } = useTranslation();

  return (
    <SsmBoxFrame
      variant="design"
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
          {t('messenger.ssmBox.variants.design.heading')}
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
          {t('messenger.ssmBox.variants.design.empty')}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <p
            data-testid="ssm-box-description"
            className="text-[11px] text-fg-subtle"
          >
            {t('messenger.ssmBox.variants.design.placeholder', {
              topic: meeting.topic,
            })}
          </p>
          <ol
            data-testid="ssm-box-design-sequence"
            className="flex flex-col gap-1 text-[11px] text-fg-muted"
            aria-label={t('messenger.ssmBox.variants.design.sequenceAria')}
          >
            <li className="rounded border border-dashed border-border px-2 py-1">
              {t('messenger.ssmBox.variants.design.pendingDataNote')}
            </li>
          </ol>
          <div
            data-testid="ssm-box-design-preview-slot"
            className="rounded border border-dashed border-border px-2 py-1 text-[11px] text-fg-subtle"
          >
            {t('messenger.ssmBox.variants.design.previewSlotPlaceholder')}
          </div>
        </div>
      )}
    </SsmBoxFrame>
  );
}
