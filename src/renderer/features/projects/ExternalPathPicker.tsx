/**
 * ExternalPathPicker — label + "Choose folder" button + selected-path
 * readout. Calls `project:pick-folder` (the v3 Main-side OS
 * folder-picker channel — the legacy `workspace:pick-folder` is still
 * registered but banned from the v3 renderer by
 * `src/renderer/__tests__/legacy-channel-isolation.test.ts`). Used by
 * the ProjectCreateModal for both `kind='external'` (externalPath) and
 * `kind='imported'` (sourcePath) — the labels are driven by i18n keys
 * passed in as props.
 *
 * Errors bubbling up from the IPC layer are rendered inline below the
 * button (no toast). The spec (§7.3) demands visible error feedback and
 * the modal's inline error surface keeps mobile/keyboard a11y simple.
 */
import { clsx } from 'clsx';
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/primitives/button';
import { invoke } from '../../ipc/invoke';

export interface ExternalPathPickerProps {
  value: string | null;
  onChange: (path: string | null) => void;
  /** i18n key for the field label, e.g. 'project.create.externalPath.label'. */
  labelKey: string;
  /** i18n key for the button text, e.g. 'project.create.externalPath.choose'. */
  chooseLabelKey: string;
  /** Optional testid prefix so multiple pickers on one modal disambiguate. */
  testIdPrefix?: string;
}

export function ExternalPathPicker({
  value,
  onChange,
  labelKey,
  chooseLabelKey,
  testIdPrefix = 'external-path-picker',
}: ExternalPathPickerProps): ReactElement {
  const { t } = useTranslation();
  const [pickError, setPickError] = useState<string | null>(null);

  const handleChoose = async (): Promise<void> => {
    setPickError(null);
    try {
      const result = await invoke('project:pick-folder', undefined);
      if (result.folderPath) {
        onChange(result.folderPath);
      }
    } catch (reason) {
      const message =
        reason instanceof Error && reason.message.length > 0
          ? reason.message
          : t('project.errors.generic');
      setPickError(message);
    }
  };

  const notSelected = t('project.create.externalPath.notSelected');
  const display = value ?? notSelected;

  return (
    <div data-testid={testIdPrefix} className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{t(labelKey)}</span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          tone="secondary"
          size="sm"
          data-testid={`${testIdPrefix}-button`}
          onClick={() => {
            void handleChoose();
          }}
        >
          {t(chooseLabelKey)}
        </Button>
        <span
          data-testid={`${testIdPrefix}-value`}
          className={clsx(
            'text-xs truncate',
            value ? 'text-fg' : 'text-fg-muted italic',
          )}
          title={value ?? undefined}
        >
          {display}
        </span>
      </div>
      {pickError !== null && (
        <span
          role="alert"
          data-testid={`${testIdPrefix}-error`}
          className="text-xs text-danger"
        >
          {pickError}
        </span>
      )}
    </div>
  );
}
