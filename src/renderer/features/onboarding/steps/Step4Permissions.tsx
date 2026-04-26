/**
 * Step4Permissions — R11-Task6 wizard step 4.
 *
 * Three-mode radio (auto / hybrid / approval) that maps 1:1 onto
 * {@link PermissionMode}. The wizard recommends `hybrid` as the safest
 * default for a brand-new user (still asks before destructive ops, but
 * lets read-only / setup work flow without prompts). Power users can
 * pick `auto` here and the next step (first project) inherits the
 * choice as the project's `permissionMode` — `external` projects still
 * reject `auto` at the service layer (spec §7.3), so picking auto here
 * just narrows the user's later project-create options.
 */
import { type ChangeEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { PermissionMode } from '../../../../shared/project-types';

export interface Step4PermissionsProps {
  value: PermissionMode;
  onChange: (mode: PermissionMode) => void;
}

const MODES: ReadonlyArray<PermissionMode> = ['auto', 'hybrid', 'approval'];

export function Step4Permissions({
  value,
  onChange,
}: Step4PermissionsProps): ReactElement {
  const { t } = useTranslation();

  const handleSelect = (e: ChangeEvent<HTMLInputElement>): void => {
    const next = e.target.value as PermissionMode;
    if (MODES.includes(next)) onChange(next);
  };

  return (
    <section
      data-testid="onboarding-step-4"
      className="flex flex-col gap-3"
    >
      <p
        data-testid="onboarding-step-4-description"
        className="text-sm text-fg-muted"
      >
        {t('onboarding.step4.description')}
      </p>

      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">{t('onboarding.step4.title')}</legend>
        {MODES.map((mode) => {
          const checked = value === mode;
          return (
            <label
              key={mode}
              data-testid="onboarding-step-4-option"
              data-mode={mode}
              data-selected={checked ? 'true' : 'false'}
              className={`flex cursor-pointer items-start gap-3 rounded-panel border bg-panel-bg px-3 py-2 ${
                checked
                  ? 'border-brand ring-1 ring-brand'
                  : 'border-border-soft'
              }`}
            >
              <input
                type="radio"
                name="onboarding-permission-mode"
                value={mode}
                checked={checked}
                onChange={handleSelect}
                className="mt-1 accent-brand"
              />
              <div className="flex flex-col">
                <span className="text-sm font-medium text-fg">
                  {t(`onboarding.step4.modes.${mode}.label`)}
                </span>
                <span className="text-xs text-fg-muted">
                  {t(`onboarding.step4.modes.${mode}.description`)}
                </span>
              </div>
            </label>
          );
        })}
      </fieldset>
    </section>
  );
}
