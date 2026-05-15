import * as Dialog from '@radix-ui/react-dialog';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/primitives';
import type { MeetingReviewDecision } from '../../../shared/meeting-review-types';

interface RejectDecisionModalProps {
  open: boolean;
  userNote: string;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (decision: Extract<MeetingReviewDecision, 'revise' | 'stop'>) => void;
}

export function RejectDecisionModal({
  open,
  userNote,
  submitting,
  onOpenChange,
  onSelect,
}: RejectDecisionModalProps): ReactElement {
  const { t } = useTranslation();
  const noteRequiredDisabled = userNote.trim().length === 0 || submitting;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-[var(--color-overlay-strong)] backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[61] w-[min(92vw,520px)] -translate-x-1/2 -translate-y-1/2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-xl">
          <header className="border-b border-[var(--color-border-subtle)] px-5 py-4">
            <Dialog.Title className="text-base font-semibold text-[var(--color-text-strong)]">
              {t('meetingReview.reject.title')}
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-[var(--color-text-muted)]">
              {t('meetingReview.reject.description')}
            </Dialog.Description>
          </header>
          <div className="space-y-2 px-5 py-4">
            <Button
              type="button"
              tone="secondary"
              className="w-full justify-start"
              disabled={noteRequiredDisabled}
              data-testid="meeting-review-reject-revise"
              onClick={() => onSelect('revise')}
            >
              {t('meetingReview.reject.revise')}
            </Button>
            <Button
              type="button"
              tone="danger"
              className="w-full justify-start"
              disabled={submitting}
              data-testid="meeting-review-reject-stop"
              onClick={() => onSelect('stop')}
            >
              {t('meetingReview.reject.stop')}
            </Button>
            {noteRequiredDisabled && !submitting ? (
              <p className="text-xs text-[var(--color-text-muted)]">
                {t('meetingReview.reject.noteRequired')}
              </p>
            ) : null}
          </div>
          <footer className="flex justify-end border-t border-[var(--color-border-subtle)] px-5 py-3">
            <Button
              type="button"
              tone="ghost"
              size="sm"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              {t('meetingReview.reject.close')}
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
