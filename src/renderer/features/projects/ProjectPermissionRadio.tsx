/**
 * ProjectPermissionRadio — Radix RadioGroup over the three permission
 * modes defined in spec §7.3:
 *
 *   - 'auto'     : apply file changes with no approval gate
 *   - 'hybrid'   : reads auto, writes require approval
 *   - 'approval' : every op needs approval
 *
 * `disabledModes` lets a caller (the create modal) forbid specific
 * options. The primary use case is `kind='external'` → 'auto' is
 * forbidden (spec §7.3 CA-1). Disabled items announce `aria-disabled`
 * and are wrapped with a Tooltip that explains why. We avoid the HTML
 * `disabled` attribute on the label so the tooltip trigger still fires
 * on hover — same pattern as HeroQuickActions' meeting button.
 */
import { clsx } from 'clsx';
import * as RadioGroup from '@radix-ui/react-radio-group';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Tooltip } from '../../components/primitives/tooltip';
import type { PermissionMode } from '../../../shared/project-types';

export interface ProjectPermissionRadioProps {
  value: PermissionMode;
  onChange: (next: PermissionMode) => void;
  /** Modes that must not be selectable. Default `[]`. */
  disabledModes?: readonly PermissionMode[];
  /** Optional id prefix for labelled-by wiring. */
  idPrefix?: string;
}

interface PermissionEntry {
  value: PermissionMode;
  titleKey: string;
  hintKey: string;
}

const PERMISSION_ENTRIES: readonly PermissionEntry[] = [
  {
    value: 'auto',
    titleKey: 'project.create.permissionMode.auto',
    hintKey: 'project.create.permissionMode.autoHint',
  },
  {
    value: 'hybrid',
    titleKey: 'project.create.permissionMode.hybrid',
    hintKey: 'project.create.permissionMode.hybridHint',
  },
  {
    value: 'approval',
    titleKey: 'project.create.permissionMode.approval',
    hintKey: 'project.create.permissionMode.approvalHint',
  },
] as const;

export function ProjectPermissionRadio({
  value,
  onChange,
  disabledModes = [],
  idPrefix = 'project-permission',
}: ProjectPermissionRadioProps): ReactElement {
  const { t } = useTranslation();

  const disabledSet = new Set<PermissionMode>(disabledModes);

  return (
    <RadioGroup.Root
      value={value}
      onValueChange={(next) => {
        const mode = next as PermissionMode;
        if (disabledSet.has(mode)) return;
        onChange(mode);
      }}
      data-testid="project-permission-radio"
      className="flex flex-col gap-2"
      aria-label={t('project.create.permissionMode.label')}
    >
      {PERMISSION_ENTRIES.map((entry) => {
        const isDisabled = disabledSet.has(entry.value);
        const selected = entry.value === value;
        const itemId = `${idPrefix}-${entry.value}`;

        const node = (
          <label
            key={entry.value}
            htmlFor={itemId}
            data-testid={`project-permission-option-${entry.value}`}
            data-selected={selected ? 'true' : 'false'}
            aria-disabled={isDisabled ? 'true' : 'false'}
            className={clsx(
              'flex flex-col gap-0.5 rounded-panel border px-3 py-2 transition-colors',
              isDisabled
                ? 'bg-sunk border-border opacity-50 cursor-not-allowed'
                : selected
                  ? 'bg-panel-header-bg border-brand ring-1 ring-brand cursor-pointer'
                  : 'bg-elev border-border hover:bg-sunk cursor-pointer',
            )}
          >
            <div className="flex items-center gap-2">
              <RadioGroup.Item
                id={itemId}
                value={entry.value}
                disabled={isDisabled}
                aria-disabled={isDisabled ? 'true' : 'false'}
                className="w-4 h-4 rounded-full border border-border bg-panel-bg data-[state=checked]:border-brand flex items-center justify-center disabled:cursor-not-allowed"
              >
                <RadioGroup.Indicator className="w-2 h-2 rounded-full bg-brand" />
              </RadioGroup.Item>
              <span className="text-sm font-medium">{t(entry.titleKey)}</span>
            </div>
            <span className="pl-6 text-xs text-fg-muted">{t(entry.hintKey)}</span>
          </label>
        );

        if (isDisabled) {
          return (
            <Tooltip
              key={entry.value}
              content={t('project.errors.externalAutoForbidden')}
            >
              {node}
            </Tooltip>
          );
        }
        return node;
      })}
    </RadioGroup.Root>
  );
}
