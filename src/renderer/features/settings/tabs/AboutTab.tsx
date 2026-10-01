/**
 * AboutTab — application metadata (name, platform, version).
 *
 * Reads platform + version from the preload bridge (`window.arena`) so
 * the renderer never imports `electron` directly. It has no "AI 추가"
 * button: adding an AI lives only in the AI tab (2026-10-01 user decision).
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

const APP_NAME = 'Rolestra';

interface ArenaPlatform {
  readonly platform: string;
  readonly version?: string;
}

function getArenaPlatform(): ArenaPlatform | null {
  if (typeof window === 'undefined') return null;
  const arena = (window as unknown as { arena?: ArenaPlatform }).arena;
  return arena ?? null;
}

export function AboutTab(): ReactElement {
  const { t } = useTranslation();
  const arena = getArenaPlatform();

  return (
    <section
      data-testid="settings-tab-about"
      className="space-y-4 max-w-xl"
    >
      <header>
        <h2 className="text-sm font-display font-semibold">
          {t('settings.about.title')}
        </h2>
        <p className="text-xs text-fg-muted mt-0.5">
          {t('settings.about.description')}
        </p>
      </header>

      <dl className="text-xs space-y-2">
        <Row label={t('settings.about.appName')}>{APP_NAME}</Row>
        <Row label={t('settings.about.platform')}>
          <span data-testid="settings-about-platform" className="font-mono">
            {arena?.platform ?? 'unknown'}
          </span>
        </Row>
        <Row label={t('settings.about.version')}>
          <span data-testid="settings-about-version" className="font-mono">
            {arena?.version ?? 'dev'}
          </span>
        </Row>
      </dl>

    </section>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): ReactElement {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 items-start py-1 border-b border-border-soft">
      <dt className="text-fg-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
