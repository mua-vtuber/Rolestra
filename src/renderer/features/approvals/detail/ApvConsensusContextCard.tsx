/**
 * ApvConsensusContextCard — meeting voting list.
 *
 * Renders the participantVotes returned by `meeting:voting-history` (or
 * already inlined inside `approval:detail-fetch`). Each row shows the
 * provider id + vote chip + (optional) free-text comment.
 *
 * Renders nothing visible when `context === null` — the panel passes
 * `null` only when the approval has no `meetingId`. A non-null context
 * with an empty `participantVotes` array still renders the card with a
 * zero-state copy so the user knows the meeting exists but no votes
 * have landed yet.
 */

import { clsx } from 'clsx';
import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { ApprovalConsensusContext } from '../../../../shared/approval-detail-types';
import { Card, CardBody, CardHeader } from '../../../components/primitives/card';

export interface ApvConsensusContextCardProps {
  context: ApprovalConsensusContext | null;
  className?: string;
}

type Vote = ApprovalConsensusContext['participantVotes'][number]['vote'];

function voteLabel(t: (k: string) => string, vote: Vote): string {
  if (vote === 'approve') return t('approval.detail.consensus.vote.approve');
  if (vote === 'reject') return t('approval.detail.consensus.vote.reject');
  return t('approval.detail.consensus.vote.abstain');
}

function voteClass(vote: Vote): string {
  if (vote === 'approve') return 'text-success border-success';
  if (vote === 'reject') return 'text-danger border-danger';
  return 'text-fg-muted border-panel-border';
}

export function ApvConsensusContextCard({
  context,
  className,
}: ApvConsensusContextCardProps): ReactElement | null {
  const { t } = useTranslation();
  if (context === null) return null;

  const { meetingId, participantVotes } = context;

  return (
    <Card
      data-testid="apv-consensus-card"
      data-meeting-id={meetingId}
      data-vote-count={String(participantVotes.length)}
      className={clsx('mx-4 my-2', className)}
    >
      <CardHeader heading={t('approval.detail.consensus.title')} />
      <CardBody>
        {participantVotes.length === 0 ? (
          <p
            data-testid="apv-consensus-empty"
            className="text-xs text-fg-muted"
          >
            {t('approval.detail.consensus.empty')}
          </p>
        ) : (
          <ul
            data-testid="apv-consensus-list"
            className="flex flex-col gap-1.5"
          >
            {participantVotes.map((entry, idx) => (
              <li
                key={`${entry.providerId}::${idx}`}
                data-testid="apv-consensus-row"
                data-provider-id={entry.providerId}
                data-vote={entry.vote}
                className="flex items-start gap-2 text-sm"
              >
                <span
                  data-testid="apv-consensus-vote"
                  className={clsx(
                    'inline-flex items-center font-mono text-[10px] font-bold uppercase tracking-wider',
                    'border whitespace-nowrap rounded-none px-2 py-0.5 mt-0.5',
                    voteClass(entry.vote),
                  )}
                >
                  {voteLabel(t, entry.vote)}
                </span>
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <span
                    data-testid="apv-consensus-provider"
                    className="font-mono text-xs text-fg truncate"
                  >
                    {entry.providerId}
                  </span>
                  {entry.comment !== undefined && entry.comment.length > 0 && (
                    <p
                      data-testid="apv-consensus-comment"
                      className="text-xs text-fg-muted whitespace-pre-wrap break-words"
                    >
                      {entry.comment}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
