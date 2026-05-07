/**
 * HandoffMinutesViewerModal — R12-C2 P6 T29.
 *
 * HandoffPackageCard 의 [회의록 통째 보기] 버튼이 여는 modal. 회의록 markdown
 * 본문 통째 표시 (truncate X scroll). 본문 자체는 props 로 받음 — fetch / IPC
 * 책임은 caller (HandoffPackageCard).
 *
 * spec docs/specs/2026-05-01-rolestra-channel-roles-design.md
 *  - §11.22.2  H2 카드 [회의록 통째 보기] 모달
 *  - §11.22.4  truncate X
 */

import * as Dialog from '@radix-ui/react-dialog';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/primitives/button';

export interface HandoffMinutesViewerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 회의록 markdown 본문. null = 회의록 없음 또는 read 실패. */
  minutesBody: string | null;
}

export function HandoffMinutesViewerModal({
  open,
  onOpenChange,
  minutesBody,
}: HandoffMinutesViewerModalProps): ReactElement {
  const { t } = useTranslation();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--color-overlay-strong)] backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(90vw,860px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-xl">
          <header className="border-b border-[var(--color-border-subtle)] px-6 py-4">
            <Dialog.Title className="text-lg font-semibold text-[var(--color-text-strong)]">
              {t('handoff.minutesViewer.title')}
            </Dialog.Title>
          </header>

          <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
            {minutesBody === null ? (
              <p className="italic text-[var(--color-text-muted)]">
                {t('handoff.minutesViewer.unavailable')}
              </p>
            ) : (
              <pre className="whitespace-pre-wrap font-mono text-sm">
                {minutesBody}
              </pre>
            )}
          </div>

          <footer className="flex justify-end border-t border-[var(--color-border-subtle)] px-6 py-3">
            <Button tone="ghost" onClick={() => onOpenChange(false)}>
              {t('handoff.minutesViewer.close')}
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
