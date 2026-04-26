/**
 * ApprovalDetailPanel — right-hand half of the #승인-대기 split layout.
 *
 * Composes the 5 R11-Task7 cards:
 *   1. ApvDetailHeader        — kind label + status badge
 *   2. ApvImpactedFilesCard   — paths + change-kind chip
 *   3. ApvDiffPreviewCard     — text preview of the upcoming change
 *   4. ApvConsensusContextCard — votes + comments (only when meetingId set)
 *   5. ApvActionBar           — approve / conditional / reject controls
 *
 * Behaviour:
 *   - `approvalId === null` → renders the "no selection" zero-state. The
 *     hook short-circuits so no IPC fires.
 *   - `loading` / `error` slices use simple inline copy (no spinners) to
 *     match the rest of the inbox surface.
 *   - The decision happens inside ApvActionBar via `approval:decide`;
 *     the parent ApprovalInboxView listens for `stream:approval-decided`
 *     to clear the selection and remove the row from the list.
 */

import { clsx } from 'clsx';
import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useApprovalDetail } from '../use-approval-detail';
import { ApvDetailHeader } from './ApvDetailHeader';
import { ApvImpactedFilesCard } from './ApvImpactedFilesCard';
import { ApvDiffPreviewCard } from './ApvDiffPreviewCard';
import { ApvConsensusContextCard } from './ApvConsensusContextCard';
import { ApvActionBar } from './ApvActionBar';

export interface ApprovalDetailPanelProps {
  approvalId: string | null;
  /** Optional callback fired after a successful approval:decide. */
  onDecided?: () => void;
  className?: string;
}

export function ApprovalDetailPanel({
  approvalId,
  onDecided,
  className,
}: ApprovalDetailPanelProps): ReactElement {
  const { t } = useTranslation();
  const { detail, loading, error } = useApprovalDetail(approvalId);

  let body: ReactElement;
  if (approvalId === null) {
    body = (
      <p
        data-testid="apv-detail-empty"
        className="px-4 py-8 text-sm text-fg-muted text-center"
      >
        {t('approval.detail.empty')}
      </p>
    );
  } else if (error !== null) {
    body = (
      <div
        role="alert"
        data-testid="apv-detail-error"
        className="mx-4 my-4 text-sm text-danger border border-danger rounded-panel px-3 py-2 bg-sunk"
      >
        {error.message.length > 0 ? error.message : t('approval.detail.error')}
      </div>
    );
  } else if (loading || detail === null) {
    body = (
      <p
        data-testid="apv-detail-loading"
        className="px-4 py-8 text-sm text-fg-muted text-center"
      >
        {t('approval.detail.loading')}
      </p>
    );
  } else {
    body = (
      <div data-testid="apv-detail-cards" className="flex flex-col">
        <ApvDetailHeader approval={detail.approval} />
        <ApvImpactedFilesCard files={detail.impactedFiles} />
        <ApvDiffPreviewCard previews={detail.diffPreviews} />
        <ApvConsensusContextCard context={detail.consensusContext} />
      </div>
    );
  }

  return (
    <section
      data-testid="approval-detail-panel"
      data-approval-id={approvalId ?? ''}
      data-loading={loading ? 'true' : 'false'}
      className={clsx(
        'flex flex-col flex-1 min-h-0 border-l border-panel-border bg-panel-bg',
        className,
      )}
    >
      <div
        data-testid="apv-detail-scroll"
        className="flex-1 min-h-0 overflow-y-auto"
      >
        {body}
      </div>
      {detail !== null && (
        <ApvActionBar approval={detail.approval} onDecided={onDecided} />
      )}
    </section>
  );
}
