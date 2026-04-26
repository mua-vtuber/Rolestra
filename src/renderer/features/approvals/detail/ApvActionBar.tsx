/**
 * ApvActionBar — approve / conditional / reject controls for the detail
 * panel. Mirrors the gesture set inside `ApprovalBlock` but lives in the
 * detail tree so a future polish pass can swap layouts without touching
 * the messenger row.
 *
 * Wiring:
 *   - "허가" (approve) calls `invoke('approval:decide', { id, decision:
 *     'approve' })` immediately.
 *   - "조건부" (conditional) opens {@link ConditionalDialog}; on submit
 *     the dialog calls the same IPC with `decision: 'conditional'` and
 *     the user's required comment.
 *   - "거절" (reject) opens {@link RejectDialog}; on submit calls the IPC
 *     with `decision: 'reject'` and an optional comment.
 *
 * Disabled state when:
 *   - `approval.status !== 'pending'` (already decided or retired).
 *   - In-flight submission to keep the user from double-clicking.
 *
 * The bar deliberately does NOT optimistically hide the row — the
 * inbox's `stream:approval-decided` listener removes the entry once the
 * service emits, and the detail panel's parent reacts by clearing
 * `selectedApprovalId`. Optimistic UI is R11-Task15.
 */

import { clsx } from 'clsx';
import { useCallback, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { invoke } from '../../../ipc/invoke';
import type { ApprovalItem } from '../../../../shared/approval-types';
import { Button } from '../../../components/primitives/button';
import { ConditionalDialog } from '../ConditionalDialog';
import { RejectDialog } from '../RejectDialog';

export interface ApvActionBarProps {
  approval: ApprovalItem;
  /** Optional callback fired after a successful decide IPC. */
  onDecided?: () => void;
  className?: string;
}

type DialogKind = 'none' | 'reject' | 'conditional';

export function ApvActionBar({
  approval,
  onDecided,
  className,
}: ApvActionBarProps): ReactElement {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind>('none');

  const isPending = approval.status === 'pending';
  const disabled = !isPending || submitting;

  const handleApprove = useCallback(async () => {
    if (disabled) return;
    setSubmitting(true);
    setError(null);
    try {
      await invoke('approval:decide', {
        id: approval.id,
        decision: 'approve',
      });
      setSubmitting(false);
      onDecided?.();
    } catch (err) {
      setError(
        err instanceof Error && err.message.length > 0
          ? err.message
          : t('approval.detail.actions.errorGeneric'),
      );
      setSubmitting(false);
    }
  }, [disabled, approval.id, onDecided, t]);

  const handleDialogChange = useCallback(
    (kind: DialogKind) =>
      (open: boolean): void => {
        setDialog(open ? kind : 'none');
      },
    [],
  );

  return (
    <footer
      data-testid="apv-action-bar"
      data-approval-id={approval.id}
      data-status={approval.status}
      data-submitting={submitting ? 'true' : 'false'}
      className={clsx(
        'flex flex-col gap-2 border-t border-panel-border bg-topbar-bg px-4 py-3',
        className,
      )}
    >
      {error !== null && (
        <p
          role="alert"
          data-testid="apv-action-bar-error"
          className="text-xs text-danger"
        >
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          tone="primary"
          shape="auto"
          data-testid="apv-action-bar-approve"
          disabled={disabled}
          onClick={() => {
            void handleApprove();
          }}
        >
          {t('approval.detail.actions.approve')}
        </Button>
        <Button
          type="button"
          size="sm"
          tone="secondary"
          shape="auto"
          data-testid="apv-action-bar-conditional"
          disabled={disabled}
          onClick={() => setDialog('conditional')}
        >
          {t('approval.detail.actions.conditional')}
        </Button>
        <Button
          type="button"
          size="sm"
          tone="danger"
          shape="auto"
          data-testid="apv-action-bar-reject"
          disabled={disabled}
          onClick={() => setDialog('reject')}
        >
          {t('approval.detail.actions.reject')}
        </Button>
      </div>

      <RejectDialog
        approvalId={approval.id}
        open={dialog === 'reject'}
        onOpenChange={handleDialogChange('reject')}
      />
      <ConditionalDialog
        approvalId={approval.id}
        open={dialog === 'conditional'}
        onOpenChange={handleDialogChange('conditional')}
      />
    </footer>
  );
}
