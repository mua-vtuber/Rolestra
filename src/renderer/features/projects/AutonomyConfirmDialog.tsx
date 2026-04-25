/**
 * AutonomyConfirmDialog — R9-Task2 2-stage confirmation for manual →
 * auto_toggle/queue promotions (spec §8 + D4).
 *
 * Displays the 4 Circuit Breaker tripwire defaults and requires an
 * explicit "이해했습니다" checkbox before the submit button enables.
 * Auto_toggle ↔ queue transitions and manual downgrades bypass this
 * dialog entirely (the hook's `request` handles that distinction).
 *
 * The dialog is purely presentational — the mutation is owned by
 * `useAutonomyMode.confirm()`. On submit → parent calls
 * `confirm()`; on cancel → parent calls `cancel()`; `onOpenChange(false)`
 * is a fallback to cover "esc" + overlay-click close paths.
 */
import * as Dialog from '@radix-ui/react-dialog';
import { clsx } from 'clsx';
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/primitives/button';
import { usePanelClipStyle } from '../../theme/use-panel-clip-style';
import type { AutonomyMode } from '../../../shared/project-types';

export interface AutonomyConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  from: AutonomyMode;
  to: AutonomyMode;
  isSaving?: boolean;
  error?: Error | null;
  onConfirm: () => void;
  onCancel: () => void;
}

const TRIPWIRE_KEYS = [
  'filesPerTurn',
  'cumulativeCliMs',
  'queueStreak',
  'sameError',
] as const;

export function AutonomyConfirmDialog({
  open,
  onOpenChange,
  from,
  to,
  isSaving = false,
  error = null,
  onConfirm,
  onCancel,
}: AutonomyConfirmDialogProps): ReactElement {
  const { t } = useTranslation();
  const [acked, setAcked] = useState<boolean>(false);
  const panelClip = usePanelClipStyle();

  // Reset the acknowledge checkbox every time the dialog re-opens so stale
  // state from a prior cancelled attempt cannot bypass the guard. Uses the
  // "adjusting state during render" pattern (React docs) rather than a
  // useEffect + setState to satisfy react-hooks/set-state-in-effect.
  const [wasOpen, setWasOpen] = useState<boolean>(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setAcked(false);
  }

  const handleCancel = (): void => {
    if (isSaving) return;
    onCancel();
    onOpenChange(false);
  };

  const handleSubmit = (): void => {
    if (!acked || isSaving) return;
    onConfirm();
  };

  // Static labels via t() — dynamic t(variable) would break i18next-parser
  // orphan-prune (D14 pattern documented in ChannelDeleteConfirm).
  const fromLabel =
    from === 'manual'
      ? t('autonomy.mode.manual')
      : from === 'auto_toggle'
        ? t('autonomy.mode.autoToggle')
        : t('autonomy.mode.queue');
  const toLabel =
    to === 'manual'
      ? t('autonomy.mode.manual')
      : to === 'auto_toggle'
        ? t('autonomy.mode.autoToggle')
        : t('autonomy.mode.queue');

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-testid="autonomy-confirm-overlay"
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        />
        <Dialog.Content
          data-testid="autonomy-confirm-dialog"
          data-from={from}
          data-to={to}
          data-panel-clip={panelClip.rawClip}
          style={panelClip.style}
          className={clsx(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'w-[min(34rem,calc(100vw-2rem))]',
            'bg-panel-bg text-fg border border-panel-border rounded-panel shadow-panel',
          )}
          onInteractOutside={(e) => {
            if (isSaving) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (isSaving) e.preventDefault();
          }}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border-soft bg-panel-header-bg">
            <Dialog.Title className="text-base font-display font-semibold">
              {t('autonomy.confirm.title')}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button
                type="button"
                tone="ghost"
                size="sm"
                aria-label={t('autonomy.confirm.cancel')}
                disabled={isSaving}
              >
                <span aria-hidden="true">{'✕'}</span>
              </Button>
            </Dialog.Close>
          </div>

          <div className="px-5 py-4 text-sm text-fg space-y-3">
            <p data-testid="autonomy-confirm-description">
              {t('autonomy.confirm.description', { from: fromLabel, to: toLabel })}
            </p>

            <div
              data-testid="autonomy-confirm-tripwires"
              className="border border-border-soft rounded-panel bg-sunk p-3 text-xs"
            >
              <p className="font-semibold mb-2">
                {t('autonomy.confirm.tripwireHeader')}
              </p>
              <ul className="space-y-1 list-disc pl-5">
                {TRIPWIRE_KEYS.map((key) => (
                  <li key={key} data-tripwire={key}>
                    {t(`circuitBreaker.tripwire.${key}.limit` as const)}
                  </li>
                ))}
              </ul>
            </div>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={acked}
                onChange={(e) => setAcked(e.target.checked)}
                disabled={isSaving}
                data-testid="autonomy-confirm-ack"
                className="mt-0.5"
              />
              <span>{t('autonomy.confirm.ack')}</span>
            </label>

            {error !== null && (
              <div
                role="alert"
                data-testid="autonomy-confirm-error"
                className="text-sm text-danger border border-danger rounded-panel px-3 py-2 bg-sunk"
              >
                {error.message}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border-soft px-5 py-4 bg-panel-header-bg">
            <Button
              type="button"
              tone="ghost"
              data-testid="autonomy-confirm-cancel"
              onClick={handleCancel}
              disabled={isSaving}
            >
              {t('autonomy.confirm.cancel')}
            </Button>
            <Button
              type="button"
              tone="primary"
              data-testid="autonomy-confirm-submit"
              onClick={handleSubmit}
              disabled={!acked || isSaving}
            >
              {t('autonomy.confirm.submit')}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
