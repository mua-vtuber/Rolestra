/**
 * GeneralVariant — 일반 채널 SsmBox layout (R12-C2 T18 skeleton, T21 final).
 *
 * spec §11.13: "카드 누적 list (kind='self-raised' / 'user-raised' 도 표시)
 * + 가벼운 동의/반대 카운터 + 사용자 동의/반대 버튼. 합의/회의록/인계
 * surface 모두 X (잡담 정체성 유지)".
 *
 * 본 variant 는 R12-C2 P4 의 T20 (`[##본문]` 파서 + 의견 게시 모달) 와
 * T21 (GeneralVariant final) 에서 본격 land 된다. T18 시점에는 layout
 * 분기 + placeholder 까지만.
 *
 * 적용 범위: `channel.role === 'general'` 인 *user-created* 일반 채널
 * (사용자가 별도로 만든 잡담 채널). 전역 system_general (#일반) 은
 * MemberPanel 이 합의 카드 자체를 hide 하므로 본 컴포넌트가 호출되지
 * 않는다.
 *
 * hex literal 금지.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { ActiveMeetingSummary } from '../../../../shared/meeting-types';
import { SsmBoxFrame } from './shared';

export interface GeneralVariantProps {
  meeting: ActiveMeetingSummary | null;
  className?: string;
}

export function GeneralVariant({
  meeting,
  className,
}: GeneralVariantProps): ReactElement {
  const { t } = useTranslation();

  return (
    <SsmBoxFrame
      variant="general"
      role="general"
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
          {t('messenger.ssmBox.variants.general.heading')}
        </span>
      </header>

      <p
        data-testid="ssm-box-empty"
        className="text-xs text-fg-muted"
      >
        {t('messenger.ssmBox.variants.general.empty')}
      </p>
      <ul
        data-testid="ssm-box-general-cards"
        className="flex flex-col gap-1 text-[11px] text-fg-muted"
        aria-label={t('messenger.ssmBox.variants.general.cardsAria')}
      >
        <li className="rounded border border-dashed border-border px-2 py-1">
          {t('messenger.ssmBox.variants.general.pendingDataNote')}
        </li>
      </ul>
    </SsmBoxFrame>
  );
}
