/**
 * AutonomyModeToggle — R9-Task2 project header 3-mode toggle.
 *
 * Thin wrapper over `useAutonomyMode` + `<AutonomyConfirmDialog>`. The
 * toggle itself is 3 buttons (manual / auto_toggle / queue); promotions
 * from manual route through the confirm dialog, other transitions go
 * straight to the IPC mutation.
 *
 * Mount surface: `ShellTopBar.rightSlot` when an `activeProjectId` is
 * present (App.tsx wires this). R10 moves to a dedicated ProjectHeader
 * row when the settings / project surfaces are reorganized.
 */
import { clsx } from 'clsx';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { AutonomyMode } from '../../../shared/project-types';
import { useAutonomyMode } from '../../hooks/use-autonomy-mode';
import { AutonomyConfirmDialog } from './AutonomyConfirmDialog';

export interface AutonomyModeToggleProps {
  projectId: string;
  currentMode: AutonomyMode;
  className?: string;
}

const MODES: readonly AutonomyMode[] = ['manual', 'auto_toggle', 'queue'] as const;

export function AutonomyModeToggle({
  projectId,
  currentMode,
  className,
}: AutonomyModeToggleProps): ReactElement {
  const { t } = useTranslation();
  const { mode, pendingTarget, isSaving, error, request, confirm, cancel } =
    useAutonomyMode(projectId, currentMode);

  return (
    <div
      data-testid="autonomy-mode-toggle"
      data-project-id={projectId}
      data-mode={mode}
      className={clsx('inline-flex items-center gap-1', className)}
    >
      <span className="text-xs text-fg-muted mr-1" aria-hidden="true">
        {t('autonomy.toggleLabel')}
      </span>
      {MODES.map((m) => {
        const isActive = mode === m;
        const label =
          m === 'manual'
            ? t('autonomy.mode.manual')
            : m === 'auto_toggle'
              ? t('autonomy.mode.autoToggle')
              : t('autonomy.mode.queue');
        const tooltip =
          m === 'manual'
            ? t('autonomy.mode.manualTooltip')
            : m === 'auto_toggle'
              ? t('autonomy.mode.autoToggleTooltip')
              : t('autonomy.mode.queueTooltip');
        return (
          <button
            key={m}
            type="button"
            data-testid={`autonomy-mode-${m}`}
            data-active={isActive ? 'true' : undefined}
            aria-pressed={isActive}
            aria-label={label}
            title={tooltip}
            onClick={() => request(m)}
            disabled={isSaving}
            className={clsx(
              'px-2.5 py-1 text-xs rounded-panel border transition-colors',
              isActive
                ? 'bg-brand text-logo-fg border-brand'
                : 'bg-panel-bg text-fg border-panel-border hover:border-brand',
              isSaving && 'opacity-60 cursor-not-allowed',
            )}
          >
            {label}
          </button>
        );
      })}

      <AutonomyConfirmDialog
        open={pendingTarget !== null}
        onOpenChange={(open) => {
          if (!open) cancel();
        }}
        from={mode}
        to={pendingTarget ?? mode}
        isSaving={isSaving}
        error={error}
        onConfirm={() => {
          void confirm();
        }}
        onCancel={cancel}
      />
    </div>
  );
}
