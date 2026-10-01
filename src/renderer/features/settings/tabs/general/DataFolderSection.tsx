/**
 * Conversation-log folder (settings "일반", spec 2026-10-01-messenger-redesign.md
 * R5-2/R5-3): the ArenaRoot the app created and actually uses, read-only,
 * with "폴더 열기". The AI working folder (`<ArenaRoot>/consensus`) is inside
 * it, so there is nothing to choose. Opening goes through
 * `arena-root:open-folder`, which takes no path — main opens the folder it
 * resolved. Both a failed lookup and a failed open are shown.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../../components/primitives/button';
import { LineIcon } from '../../../../components/shell/LineIcon';
import { invoke } from '../../../../ipc/invoke';
import { SettingsSection } from './SettingsSection';

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export function DataFolderSection(): ReactElement {
  const { t } = useTranslation();
  const [folder, setFolder] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    let cancelled = false;
    invoke('arena-root:get', undefined).then(
      ({ path }) => { if (!cancelled) setFolder(path); },
      (reason: unknown) => { if (!cancelled) setLoadError(messageOf(reason)); },
    );
    return () => { cancelled = true; };
  }, []);

  const open = async (): Promise<void> => {
    setOpening(true);
    setOpenError(null);
    try {
      await invoke('arena-root:open-folder', undefined);
    } catch (reason) {
      setOpenError(messageOf(reason));
    } finally {
      setOpening(false);
    }
  };

  return (
    <SettingsSection title={t('settings.general.folder.title')} testId="settings-data-folder">
      <div className="flex max-w-3xl items-center gap-4 border border-border-soft px-4 py-3.5 [background:var(--color-panel-bg)] [clip-path:var(--clip-control)]">
        <span aria-hidden="true" className="text-brand-text"><LineIcon name="folder" size={22} stroke={1.8} /></span>
        <div className="min-w-0 flex-1">
          <div data-testid="settings-data-folder-path" className="break-all font-mono text-preview">
            {folder ?? (loadError === null ? t('settings.general.folder.loading') : null)}
          </div>
          <div className="text-meta text-fg-muted">{t('settings.general.folder.description')}</div>
        </div>
        <Button type="button" tone="secondary" size="md" data-testid="settings-data-folder-open"
          disabled={folder === null || opening} onClick={() => void open()} className="shrink-0">
          {t('settings.general.folder.open')}
        </Button>
      </div>
      {loadError !== null ? (
        <p data-testid="settings-data-folder-error" role="alert" className="text-xs text-danger-text">
          {t('settings.general.folder.loadFailed', { message: loadError })}
        </p>
      ) : null}
      {openError !== null ? (
        <p data-testid="settings-data-folder-open-error" role="alert" className="text-xs text-danger-text">
          {t('settings.general.folder.openFailed', { message: openError })}
        </p>
      ) : null}
    </SettingsSection>
  );
}
