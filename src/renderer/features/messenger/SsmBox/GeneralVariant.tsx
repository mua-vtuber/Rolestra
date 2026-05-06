/**
 * GeneralVariant — 일반 채널 SsmBox layout (R12-C2 T18 skeleton → T21 final).
 *
 * spec §11.13: "카드 누적 list (kind='self-raised' / 'user-raised' 도 표시)
 * + 가벼운 동의/반대 카운터 + 사용자 동의/반대 버튼. 합의/회의록/인계
 * surface 모두 X (잡담 정체성 유지)".
 *
 * T21 final 본체 (2026-05-06):
 *   - `useGeneralOpinionCards(channelId)` 가 카드 + 카운터 + 사용자 vote
 *     묶음 read.
 *   - 카드 list 렌더 — 정렬 = 등록 역순 (최신이 위로). 본문 truncate 금지
 *     (spec §11.13a "본문 truncate 금지") — long content 도 카드 안에서
 *     scroll 또는 expand 시킨다 (구현은 css `whitespace-pre-wrap` + max-h
 *     + overflow-auto).
 *   - 카운터 — 직원/사용자 통합 light vote 누적. 'abstain' 은 UI 미노출.
 *   - 동의/반대 버튼 — 사용자 1 인 voter. 같은 vote 재클릭 = 취소,
 *     다른 vote = 교체. backend 가 toggle/replace 강제.
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

import { useGeneralOpinionCards } from '../../../hooks/use-general-opinion-cards';
import type { ActiveMeetingSummary } from '../../../../shared/meeting-types';
import type { GeneralOpinionCard } from '../../../../shared/opinion-types';
import { SsmBoxFrame } from './shared';

export interface GeneralVariantProps {
  /** `null` = 채널 미선택 / 미해결 (hook 가 cards=null 로 비활성). */
  channelId: string | null;
  meeting: ActiveMeetingSummary | null;
  className?: string;
}

export function GeneralVariant({
  channelId,
  meeting,
  className,
}: GeneralVariantProps): ReactElement {
  const { t } = useTranslation();
  const { cards, loading, error, toggleLightVote } =
    useGeneralOpinionCards(channelId);

  // 등록 역순 (최신이 위) — backend 정렬은 createdAt 오름차순 안정.
  const orderedCards: GeneralOpinionCard[] | null =
    cards === null ? null : [...cards].reverse();

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
        {orderedCards !== null ? (
          <span
            data-testid="ssm-box-general-count"
            className="text-[11px] text-fg-muted"
          >
            {t('messenger.ssmBox.variants.general.cardCount', {
              count: orderedCards.length,
            })}
          </span>
        ) : null}
      </header>

      {error !== null ? (
        <p
          data-testid="ssm-box-general-error"
          className="text-xs text-danger"
          role="alert"
        >
          {t('messenger.ssmBox.variants.general.error', {
            message: error.message,
          })}
        </p>
      ) : null}

      {loading && cards === null ? (
        <p
          data-testid="ssm-box-general-loading"
          className="text-xs text-fg-muted"
        >
          {t('messenger.ssmBox.variants.general.loading')}
        </p>
      ) : null}

      {orderedCards !== null && orderedCards.length === 0 ? (
        <p
          data-testid="ssm-box-empty"
          className="text-xs text-fg-muted"
        >
          {t('messenger.ssmBox.variants.general.empty')}
        </p>
      ) : null}

      <ul
        data-testid="ssm-box-general-cards"
        className="flex flex-col gap-1.5 text-[11px]"
        aria-label={t('messenger.ssmBox.variants.general.cardsAria')}
      >
        {orderedCards?.map((card) => (
          <GeneralCardItem
            key={card.opinion.id}
            card={card}
            onVote={(vote) => {
              void toggleLightVote(card.opinion.id, vote);
            }}
          />
        ))}
      </ul>
    </SsmBoxFrame>
  );
}

interface GeneralCardItemProps {
  card: GeneralOpinionCard;
  onVote: (vote: 'agree' | 'oppose') => void;
}

function GeneralCardItem({ card, onVote }: GeneralCardItemProps): ReactElement {
  const { t } = useTranslation();
  const { opinion, agreeCount, opposeCount, userVote } = card;
  const kindLabel = t(
    `messenger.ssmBox.variants.general.kind.${opinion.kind}`,
  );

  return (
    <li
      data-testid="ssm-box-general-card"
      data-card-id={opinion.id}
      className="rounded border border-border bg-elev px-2 py-1.5 flex flex-col gap-1"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-fg font-medium">
          {opinion.title ?? t('messenger.ssmBox.variants.general.untitled')}
        </span>
        <span
          data-testid="ssm-box-general-card-kind"
          className="text-[10px] text-fg-muted"
        >
          {kindLabel}
        </span>
      </div>
      {opinion.content !== null && opinion.content.length > 0 ? (
        <div
          data-testid="ssm-box-general-card-body"
          className="max-h-32 overflow-auto whitespace-pre-wrap text-fg-muted"
        >
          {opinion.content}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <span className="text-[10px] text-fg-muted">{opinion.authorLabel}</span>
        <div
          className="flex items-center gap-1"
          aria-label={t('messenger.ssmBox.variants.general.voteGroupAria')}
        >
          <button
            type="button"
            data-testid="ssm-box-general-vote-agree"
            data-card-id={opinion.id}
            data-active={userVote === 'agree' ? 'true' : 'false'}
            onClick={() => {
              onVote('agree');
            }}
            aria-pressed={userVote === 'agree'}
            aria-label={t(
              'messenger.ssmBox.variants.general.agreeButtonAria',
              { count: agreeCount },
            )}
            className={
              userVote === 'agree'
                ? 'rounded border border-success px-1.5 py-0.5 text-success font-semibold'
                : 'rounded border border-border px-1.5 py-0.5 text-fg-muted hover:border-success'
            }
          >
            {t('messenger.ssmBox.variants.general.agreeButton', {
              count: agreeCount,
            })}
          </button>
          <button
            type="button"
            data-testid="ssm-box-general-vote-oppose"
            data-card-id={opinion.id}
            data-active={userVote === 'oppose' ? 'true' : 'false'}
            onClick={() => {
              onVote('oppose');
            }}
            aria-pressed={userVote === 'oppose'}
            aria-label={t(
              'messenger.ssmBox.variants.general.opposeButtonAria',
              { count: opposeCount },
            )}
            className={
              userVote === 'oppose'
                ? 'rounded border border-danger px-1.5 py-0.5 text-danger font-semibold'
                : 'rounded border border-border px-1.5 py-0.5 text-fg-muted hover:border-danger'
            }
          >
            {t('messenger.ssmBox.variants.general.opposeButton', {
              count: opposeCount,
            })}
          </button>
        </div>
      </div>
    </li>
  );
}
