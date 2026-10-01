/**
 * GeneralVariant — 전역 일반 채널과 채팅방의 의견 카드 목록.
 *
 * 카드는 등록 역순으로 표시한다. 본문은 잘리지 않고 카드 안에서 스크롤된다.
 *
 * 기존 사용자 light 표는 동의/반대 토글과 누적 수를 보여준다. 별도의 AI
 * 투표는 카드별 명시적 시작 후 AI 의견과 찬성/반대/보류/대기/실패 집계를
 * 보여준다.
 *
 * 보관된 채팅방은 저장 결과를 읽을 수 있지만 투표 시작 및 사용자 토글은 숨긴다.
 *
 * hex literal 금지.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useGeneralOpinionCards } from '../../../hooks/use-general-opinion-cards';
import { useChatVote } from '../../../hooks/use-chat-vote';
import type { GeneralOpinionCard } from '../../../../shared/opinion-types';
import { SsmBoxFrame } from './shared';

export interface GeneralVariantProps {
  /** `null` = 채널 미선택 / 미해결 (hook 가 cards=null 로 비활성). */
  channelId: string | null;
  readOnly?: boolean;
  className?: string;
}

export function GeneralVariant({
  channelId,
  readOnly = false,
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
      hasMeeting={false}
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
          className="text-xs text-danger-text"
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
            readOnly={readOnly}
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
  readOnly: boolean;
  onVote: (vote: 'agree' | 'oppose') => void;
}

function GeneralCardItem({ card, readOnly, onVote }: GeneralCardItemProps): ReactElement {
  const { t } = useTranslation();
  const { opinion, agreeCount, opposeCount, userVote } = card;
  const aiVote = useChatVote(opinion.id);
  const vote = aiVote.vote;
  const kindLabel = t(
    `messenger.ssmBox.variants.general.kind.${opinion.kind}`,
  );

  return (
    <li
      data-testid="ssm-box-general-card"
      data-card-id={opinion.id}
      className="min-w-0 rounded border border-border bg-elev px-2 py-1.5 flex flex-col gap-1"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 break-words text-fg font-medium">
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
          className="max-h-32 min-w-0 overflow-auto whitespace-pre-wrap break-words text-fg-muted"
        >
          {opinion.content}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <span className="min-w-0 break-words text-[10px] text-fg-muted">{opinion.authorLabel}</span>
        {!readOnly ? <div
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
                ? 'rounded border border-danger px-1.5 py-0.5 text-danger-text font-semibold'
                : 'rounded border border-border px-1.5 py-0.5 text-fg-muted hover:border-danger'
            }
          >
            {t('messenger.ssmBox.variants.general.opposeButton', {
              count: opposeCount,
            })}
          </button>
        </div> : (
          <span data-testid="chat-user-light-counts" className="text-[10px] text-fg-muted">
            {t('messenger.ssmBox.variants.general.lightCounts', { agree: agreeCount, oppose: opposeCount })}
          </span>
        )}
      </div>
      <section className="border-t border-border-soft pt-1.5" aria-label={t('messenger.ssmBox.variants.general.aiVote.heading')}>
        <p className="mb-1 text-[10px] font-semibold text-fg-muted">
          {t('messenger.ssmBox.variants.general.aiVote.heading')}
        </p>
        {aiVote.error ? (
          <p role="alert" data-testid="chat-vote-error" className="text-xs text-danger-text">
            {t('messenger.ssmBox.variants.general.aiVote.error')}
          </p>
        ) : null}
        {vote ? (
          <div data-testid="chat-vote-results" data-card-id={opinion.id} data-status={vote.status} className="space-y-1.5">
            <p className="text-[10px] text-fg-muted">{t(`messenger.ssmBox.variants.general.aiVote.status.${vote.status}`)}</p>
            <div data-testid="chat-vote-counts" className="flex flex-wrap gap-x-2 text-[10px] text-fg-muted">
              {(['agree', 'oppose', 'abstain', 'pending', 'failed'] as const).map((key) => (
                <span key={key}>{t(`messenger.ssmBox.variants.general.aiVote.count.${key}`, { count: vote.counts[key] })}</span>
              ))}
            </div>
            <ul className="space-y-1">
              {vote.participants.map((participant) => (
                <li key={participant.providerId} data-testid="chat-vote-participant" data-provider-id={participant.providerId}
                  className="rounded border border-border-soft bg-sunk px-1.5 py-1">
                  <div className="flex justify-between gap-2 font-medium text-fg">
                    <span className="min-w-0 break-words">{participant.displayName}</span>
                    <span>{participant.vote
                      ? t(`messenger.ssmBox.variants.general.aiVote.choice.${participant.vote}`)
                      : t(`messenger.ssmBox.variants.general.aiVote.participantStatus.${participant.status}`)}</span>
                  </div>
                  {participant.opinion ? <p className="mt-0.5 min-w-0 whitespace-pre-wrap break-words text-fg-muted">{participant.opinion}</p> : null}
                  {participant.error ? <p className="mt-0.5 text-danger-text">{t(`messenger.ssmBox.variants.general.aiVote.failure.${participant.error}`)}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : !readOnly && !aiVote.loading ? (
          <button type="button" data-testid="chat-vote-start" data-card-id={opinion.id}
            disabled={aiVote.starting} onClick={() => { void aiVote.start(); }}
            className="rounded border border-brand px-2 py-0.5 text-[11px] font-semibold text-brand-text disabled:opacity-50">
            {aiVote.starting
              ? t('messenger.ssmBox.variants.general.aiVote.starting')
              : t('messenger.ssmBox.variants.general.aiVote.start')}
          </button>
        ) : null}
      </section>
    </li>
  );
}
