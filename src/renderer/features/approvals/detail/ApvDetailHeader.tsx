/**
 * ApvDetailHeader — top of the Approval detail panel.
 *
 * Surfaces the kind label + status badge in a single horizontal row.
 * Reuses {@link ApprovalStatusBadge} from R10 design polish round 1 so
 * the active filter tab and the detail header share one badge style.
 *
 * No avatar yet — the approval row's `requesterId` is opaque (provider
 * id) and the panel does not yet have a member-profile lookup hook on
 * R11. Header room is left so a follow-up phase (R11 polish round 3 or
 * R12) can drop the avatar in without restructuring layout.
 */

import { clsx } from 'clsx';
import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { ApprovalItem } from '../../../../shared/approval-types';
import { useTheme } from '../../../theme/use-theme';
import {
  ApprovalStatusBadge,
  type ApprovalDecision as ApprovalBadgeDecision,
} from '../ApprovalStatusBadge';

export interface ApvDetailHeaderProps {
  approval: ApprovalItem;
  className?: string;
}

/**
 * Map persisted ApprovalStatus → badge's 3-way decision literal. expired
 * and superseded both fold into `rejected` since the approvals UI does
 * not differentiate retired-by-time from retired-by-superseder; if a
 * follow-up phase wants distinct labels we add a new badge variant
 * rather than overload `rejected`.
 */
function statusToDecision(
  status: ApprovalItem['status'],
): ApprovalBadgeDecision {
  if (status === 'approved') return 'approved';
  if (
    status === 'rejected' ||
    status === 'expired' ||
    status === 'superseded'
  ) {
    return 'rejected';
  }
  return 'pending';
}

function kindLabel(
  t: (k: string) => string,
  kind: ApprovalItem['kind'],
): string {
  switch (kind) {
    case 'cli_permission':
      return t('approval.kind.cli_permission');
    case 'mode_transition':
      return t('approval.kind.mode_transition');
    case 'consensus_decision':
      return t('approval.kind.consensus_decision');
    case 'review_outcome':
      return t('approval.kind.review_outcome');
    case 'failure_report':
      return t('approval.kind.failure_report');
    case 'circuit_breaker':
      return t('approval.kind.circuit_breaker');
  }
}

export function ApvDetailHeader({
  approval,
  className,
}: ApvDetailHeaderProps): ReactElement {
  const { t } = useTranslation();
  const { themeKey } = useTheme();

  const titleFont = themeKey === 'retro' ? 'font-mono' : 'font-sans';
  const decision = statusToDecision(approval.status);

  return (
    <header
      data-testid="apv-detail-header"
      data-approval-id={approval.id}
      data-kind={approval.kind}
      data-status={approval.status}
      className={clsx(
        'flex items-center gap-3 border-b border-panel-border px-4 py-3',
        className,
      )}
    >
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        <span
          data-testid="apv-detail-header-label"
          className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle"
        >
          {t('approval.detail.header.label')}
        </span>
        <h2
          data-testid="apv-detail-header-title"
          className={clsx('text-base font-semibold text-fg truncate', titleFont)}
        >
          {kindLabel(t, approval.kind)}
        </h2>
      </div>
      <ApprovalStatusBadge decision={decision} />
    </header>
  );
}
