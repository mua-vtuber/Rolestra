/**
 * ProjectKindTabs — Radix RadioGroup over the three project kinds.
 *
 * Spec §7.3 enumerates exactly three kinds for project creation:
 *   - 'new'      : mkdir under `<ArenaRoot>/projects`
 *   - 'external' : junction/symlink to a user folder
 *   - 'imported' : copy a folder into the arena root
 *
 * Each option renders a title + a one-line hint so the user can tell
 * them apart without a separate tooltip. The selected option is
 * visually lifted (bg-panel-header-bg + ring) using the same design
 * tokens the rest of R3 uses; no hex literals. Rendered as a vertical
 * stack inside the modal for breathing room on narrow layouts.
 */
import { clsx } from 'clsx';
import * as RadioGroup from '@radix-ui/react-radio-group';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { ProjectKind } from '../../../shared/project-types';

export interface ProjectKindTabsProps {
  value: ProjectKind;
  onChange: (next: ProjectKind) => void;
  /** Optional id prefix for labelled-by wiring. */
  idPrefix?: string;
}

interface KindEntry {
  value: ProjectKind;
  titleKey: string;
  hintKey: string;
}

const KIND_ENTRIES: readonly KindEntry[] = [
  { value: 'new', titleKey: 'project.create.kind.new', hintKey: 'project.create.kind.newHint' },
  {
    value: 'external',
    titleKey: 'project.create.kind.external',
    hintKey: 'project.create.kind.externalHint',
  },
  {
    value: 'imported',
    titleKey: 'project.create.kind.imported',
    hintKey: 'project.create.kind.importedHint',
  },
] as const;

export function ProjectKindTabs({
  value,
  onChange,
  idPrefix = 'project-kind',
}: ProjectKindTabsProps): ReactElement {
  const { t } = useTranslation();

  return (
    <RadioGroup.Root
      value={value}
      onValueChange={(next) => onChange(next as ProjectKind)}
      data-testid="project-kind-tabs"
      className="flex flex-col gap-2"
      aria-label={t('project.create.kind.label')}
    >
      {KIND_ENTRIES.map((entry) => {
        const selected = entry.value === value;
        const itemId = `${idPrefix}-${entry.value}`;
        return (
          <label
            key={entry.value}
            htmlFor={itemId}
            data-testid={`project-kind-option-${entry.value}`}
            data-selected={selected ? 'true' : 'false'}
            className={clsx(
              'flex flex-col gap-0.5 rounded-panel border px-3 py-2 cursor-pointer transition-colors',
              selected
                ? 'bg-panel-header-bg border-brand ring-1 ring-brand'
                : 'bg-elev border-border hover:bg-sunk',
            )}
          >
            <div className="flex items-center gap-2">
              <RadioGroup.Item
                id={itemId}
                value={entry.value}
                className="w-4 h-4 rounded-full border border-border bg-panel-bg data-[state=checked]:border-brand flex items-center justify-center"
              >
                <RadioGroup.Indicator className="w-2 h-2 rounded-full bg-brand" />
              </RadioGroup.Item>
              <span className="text-sm font-medium">{t(entry.titleKey)}</span>
            </div>
            <span className="pl-6 text-xs text-fg-muted">{t(entry.hintKey)}</span>
          </label>
        );
      })}
    </RadioGroup.Root>
  );
}
