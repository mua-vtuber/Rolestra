/**
 * AboutTab — R10-Task6 application metadata + R10 design sign-off mark.
 *
 * Reads platform + version from the preload bridge (`window.arena`) so
 * the renderer never imports `electron` directly. The sign-off mark is
 * a plain string — Task 7 (theme fidelity) flips this to a stamped
 * graphic once the 6-theme evidence pack lands.
 */
import { useCallback, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../components/primitives/button';
import { invoke } from '../../../ipc/invoke';
import { useAppViewStore } from '../../../stores/app-view-store';

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
  const setView = useAppViewStore((s) => s.setView);

  // R11-Task6: "Restart onboarding" CTA. The wizard reads
  // `onboarding:get-state` on mount, so resetting the persisted row
  // back to step 1 + empty selections is enough to make a fresh run
  // appear. We deliberately do NOT also flip `completed=false` here —
  // App.tsx's first-boot probe is mount-once, so a returning user that
  // clicks this CTA enters via `setView('onboarding')`, not via the
  // probe, and the wizard's `currentStep=1` reset is what they expect.
  const handleRestart = useCallback((): void => {
    void (async () => {
      try {
        await invoke('onboarding:set-state', {
          partial: { currentStep: 1, selections: {} },
        });
      } catch (reason) {
        console.warn(
          '[rolestra] onboarding restart failed',
          reason instanceof Error ? reason.message : String(reason),
        );
      }
      setView('onboarding');
    })();
  }, [setView]);

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
        <Row label={t('settings.about.appName')}>Rolestra</Row>
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
        <Row label={t('settings.about.designSignOff')}>
          <span
            data-testid="settings-about-design-signoff"
            className="font-mono text-fg-muted"
          >
            R10 polish · pending
          </span>
        </Row>
      </dl>

      <div className="pt-2 border-t border-border-soft">
        <p className="text-xs text-fg-muted mb-2">
          {t('onboarding.description_settingsCta')}
        </p>
        <Button
          type="button"
          tone="secondary"
          size="sm"
          data-testid="settings-about-onboarding-cta"
          onClick={handleRestart}
        >
          {t('onboarding.settingsCta')}
        </Button>
      </div>
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
