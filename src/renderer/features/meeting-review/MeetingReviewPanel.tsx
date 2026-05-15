import * as Dialog from '@radix-ui/react-dialog';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/primitives';
import { invoke } from '../../ipc/invoke';
import type {
  MeetingReviewDecision,
  MeetingReviewGate,
} from '../../../shared/meeting-review-types';
import { RejectDecisionModal } from './RejectDecisionModal';

interface MeetingReviewPanelProps {
  reviewId: string | null;
  onClose: () => void;
  onLoaded?: (review: MeetingReviewGate) => void;
  onDecided?: (review: MeetingReviewGate) => void;
}

function toErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export function MeetingReviewPanel({
  reviewId,
  onClose,
  onLoaded,
  onDecided,
}: MeetingReviewPanelProps): ReactElement | null {
  if (reviewId === null) return null;

  return (
    <MeetingReviewPanelContent
      key={reviewId}
      reviewId={reviewId}
      onClose={onClose}
      onLoaded={onLoaded}
      onDecided={onDecided}
    />
  );
}

interface MeetingReviewPanelContentProps {
  reviewId: string;
  onClose: () => void;
  onLoaded?: (review: MeetingReviewGate) => void;
  onDecided?: (review: MeetingReviewGate) => void;
}

function MeetingReviewPanelContent({
  reviewId,
  onClose,
  onLoaded,
  onDecided,
}: MeetingReviewPanelContentProps): ReactElement {
  const { t } = useTranslation();
  const [item, setItem] = useState<MeetingReviewGate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userNote, setUserNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void invoke('meeting-review:get', { reviewId })
      .then(({ item: next }) => {
        if (cancelled) return;
        setItem(next);
        setUserNote(next.userNote ?? '');
        onLoaded?.(next);
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(toErrorMessage(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onLoaded, reviewId]);

  const decide = useCallback(
    async (decision: MeetingReviewDecision): Promise<void> => {
      setSubmitting(true);
      setError(null);
      try {
        const result = await invoke('meeting-review:decide', {
          reviewId,
          decision,
          userNote,
        });
        onDecided?.(result.review);
        onClose();
      } catch (reason) {
        setError(toErrorMessage(reason));
      } finally {
        setSubmitting(false);
      }
    },
    [onClose, onDecided, reviewId, userNote],
  );

  const disabled = submitting || loading || item?.status !== 'pending';
  const title = item?.title ?? t('meetingReview.titleFallback');

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--color-overlay-strong)] backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex h-[min(88vh,760px)] w-[min(94vw,1120px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-xl">
          <header className="border-b border-[var(--color-border-subtle)] px-6 py-4">
            <Dialog.Title className="text-lg font-semibold text-[var(--color-text-strong)]">
              {title}
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-[var(--color-text-muted)]">
              {t('meetingReview.description')}
            </Dialog.Description>
          </header>

          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px] gap-0">
            <section className="min-h-0 overflow-y-auto border-r border-[var(--color-border-subtle)] px-6 py-5">
              {loading ? (
                <p className="text-sm text-[var(--color-text-muted)]">
                  {t('meetingReview.loading')}
                </p>
              ) : error !== null ? (
                <p
                  data-testid="meeting-review-error"
                  className="text-sm text-[var(--color-text-danger)]"
                >
                  {t('meetingReview.error', { error })}
                </p>
              ) : item !== null ? (
                <pre
                  data-testid="meeting-review-document"
                  className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-[var(--color-text)]"
                >
                  {item.documentBodySnapshot}
                </pre>
              ) : null}
            </section>

            <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-5">
              <section>
                <h3 className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">
                  {t('meetingReview.noteLabel')}
                </h3>
                <textarea
                  data-testid="meeting-review-note"
                  value={userNote}
                  onChange={(event) => setUserNote(event.target.value)}
                  disabled={submitting || item?.status !== 'pending'}
                  className="mt-2 min-h-32 w-full resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
                  placeholder={t('meetingReview.notePlaceholder')}
                />
              </section>

              <section className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] p-3">
                <h3 className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">
                  {item !== null && item.status !== 'pending'
                    ? t('meetingReview.processedLabel')
                    : t('meetingReview.nextFlowLabel')}
                </h3>
                <p
                  data-testid={
                    item !== null && item.status !== 'pending'
                      ? 'meeting-review-processed-state'
                      : 'meeting-review-next-flow'
                  }
                  className="mt-2 text-sm text-[var(--color-text)]"
                >
                  {item !== null && item.status !== 'pending'
                    ? t('meetingReview.processed', {
                        status: t(
                          `messenger.messageCard.reviewGate.status.${item.status}`,
                        ),
                      })
                    : t('meetingReview.nextFlowPlanning')}
                </p>
              </section>

              {error !== null ? (
                <p className="text-sm text-[var(--color-text-danger)]">
                  {t('meetingReview.error', { error })}
                </p>
              ) : null}

              <div className="mt-auto space-y-2">
                <Button
                  type="button"
                  className="w-full"
                  disabled={disabled}
                  data-testid="meeting-review-approve"
                  onClick={() => void decide('approve')}
                >
                  {t('meetingReview.approvePlanning')}
                </Button>
                <Button
                  type="button"
                  tone="secondary"
                  className="w-full"
                  disabled={disabled}
                  data-testid="meeting-review-reject"
                  onClick={() => setRejectOpen(true)}
                >
                  {t('meetingReview.rejectButton')}
                </Button>
                <Button
                  type="button"
                  tone="ghost"
                  className="w-full"
                  disabled={submitting}
                  onClick={onClose}
                >
                  {t('meetingReview.close')}
                </Button>
              </div>
            </aside>
          </div>

          <RejectDecisionModal
            open={rejectOpen}
            userNote={userNote}
            submitting={submitting}
            onOpenChange={setRejectOpen}
            onSelect={(decision) => {
              setRejectOpen(false);
              void decide(decision);
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
