/**
 * The step after an AI was added (spec 2026-10-01-messenger-redesign.md
 * R6-4): it was registered under its default name, and the user can go on
 * to the existing edit dialog to change the name and write the character
 * sheet, or close.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../components/primitives/button';
import { LineIcon } from '../../../components/shell/LineIcon';
import type { AddedAi } from './use-provider-connect';

export interface AddedStepProps {
  added: AddedAi;
  /** Null when the caller offers no editor; the step then only closes. */
  onEditProfile: (() => void) | null;
  onDone: () => void;
}

export function AddedStep({ added, onEditProfile, onDone }: AddedStepProps): ReactElement {
  const { t } = useTranslation();
  return (
    <section data-testid="provider-connect-added" data-provider-id={added.providerId} className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 text-success"><LineIcon name="check" size={18} stroke={2} /></span>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold">{t('providerConnect.added.title', { name: added.displayName })}</p>
          <p className="text-sm text-fg-muted">{t('providerConnect.added.body')}</p>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" tone="ghost" size="sm" data-testid="provider-connect-done" onClick={onDone}>
          {t('providerConnect.close')}
        </Button>
        {onEditProfile !== null ? (
          <Button type="button" tone="primary" size="sm" data-testid="provider-connect-edit-profile" onClick={onEditProfile}>
            {t('providerConnect.added.editProfile')}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
