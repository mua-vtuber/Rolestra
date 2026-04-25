/**
 * AutonomyDefaultsTab — R10-Task6 default conversation/turn settings.
 *
 * Persists three knobs that the project create modal reads as defaults:
 *   - `defaultRounds`            (number | 'unlimited')
 *   - `softTokenLimit`           (number)
 *   - `hardTokenLimit`           (number)
 *
 * Circuit Breaker tripwire thresholds (R10-Task9) are intentionally not
 * exposed here — they live next to the running breaker view in the
 * dashboard once R10-Task11 ships KPI streaming. Surfacing both knobs
 * in the same tab would tempt users to over-tune defaults that already
 * cover 99% of cases.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { useTranslation } from 'react-i18next';

import { invoke } from '../../../ipc/invoke';
import { Button } from '../../../components/primitives/button';
import type { SettingsConfig } from '../../../../shared/config-types';

type RoundsValue = number | 'unlimited';

export function AutonomyDefaultsTab(): ReactElement {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<SettingsConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const { settings: cfg } = await invoke(
        'config:get-settings',
        undefined,
      );
      setSettings(cfg);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  const didMountFetchRef = useRef(false);
  useEffect(() => {
    if (didMountFetchRef.current) return;
    didMountFetchRef.current = true;
    void refresh();
  }, [refresh]);

  const update = async (
    key: keyof SettingsConfig,
    value: SettingsConfig[keyof SettingsConfig],
  ): Promise<void> => {
    if (settings === null) return;
    setSavingKey(key);
    try {
      const { settings: next } = await invoke('config:update-settings', {
        patch: { [key]: value } as Partial<SettingsConfig>,
      });
      setSettings(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSavingKey(null);
    }
  };

  const isLoading = settings === null;

  return (
    <section
      data-testid="settings-tab-autonomy-defaults"
      className="space-y-4 max-w-xl"
    >
      <header>
        <h2 className="text-sm font-display font-semibold">
          {t('settings.autonomyDefaults.title')}
        </h2>
        <p className="text-xs text-fg-muted mt-0.5">
          {t('settings.autonomyDefaults.description')}
        </p>
      </header>

      {error !== null && (
        <div
          role="alert"
          data-testid="settings-autonomy-defaults-error"
          className="text-xs text-danger border border-danger rounded-panel px-2 py-1 bg-sunk"
        >
          {error}
        </div>
      )}

      {isLoading ? (
        <p
          data-testid="settings-autonomy-defaults-loading"
          className="text-sm text-fg-muted italic"
        >
          {t('settings.autonomyDefaults.loading')}
        </p>
      ) : (
        <div className="space-y-3">
          <RoundsField
            label={t('settings.autonomyDefaults.defaultRounds')}
            value={settings.defaultRounds}
            disabled={savingKey === 'defaultRounds'}
            onCommit={(next) => {
              void update('defaultRounds', next);
            }}
          />
          <NumberField
            id="settings-soft-token-limit"
            label={t('settings.autonomyDefaults.softTokenLimit')}
            value={settings.softTokenLimit}
            disabled={savingKey === 'softTokenLimit'}
            onCommit={(next) => {
              void update('softTokenLimit', next);
            }}
          />
          <NumberField
            id="settings-hard-token-limit"
            label={t('settings.autonomyDefaults.hardTokenLimit')}
            value={settings.hardTokenLimit}
            disabled={savingKey === 'hardTokenLimit'}
            onCommit={(next) => {
              void update('hardTokenLimit', next);
            }}
          />
        </div>
      )}
    </section>
  );
}

interface RoundsFieldProps {
  label: string;
  value: RoundsValue;
  disabled: boolean;
  onCommit: (next: RoundsValue) => void;
}

function RoundsField({
  label,
  value,
  disabled,
  onCommit,
}: RoundsFieldProps): ReactElement {
  const { t } = useTranslation();
  const isUnlimited = value === 'unlimited';
  const numeric = isUnlimited ? 3 : value;
  const [draft, setDraft] = useState<string>(
    isUnlimited ? '' : String(numeric),
  );
  // Reset draft when the persisted value changes externally (after a
  // successful save). Uses the "adjust state during render" pattern so
  // we satisfy react-hooks/set-state-in-effect.
  const [lastSyncedValue, setLastSyncedValue] = useState<RoundsValue>(value);
  if (value !== lastSyncedValue) {
    setLastSyncedValue(value);
    setDraft(isUnlimited ? '' : String(numeric));
  }

  return (
    <div className="flex items-end gap-2">
      <label className="flex-1 flex flex-col gap-1 text-xs">
        <span className="text-fg-muted">{label}</span>
        <input
          type="number"
          min={1}
          max={99}
          data-testid="settings-autonomy-default-rounds"
          value={draft}
          disabled={disabled || isUnlimited}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const n = Number.parseInt(draft, 10);
            if (Number.isFinite(n) && n >= 1 && n !== numeric) {
              onCommit(n);
            } else {
              setDraft(String(numeric));
            }
          }}
          className="bg-elev text-fg border border-border-soft rounded-panel px-2 py-1.5"
        />
      </label>
      <label className="inline-flex items-center gap-1.5 text-xs pb-1.5">
        <input
          type="checkbox"
          data-testid="settings-autonomy-default-rounds-unlimited"
          checked={isUnlimited}
          disabled={disabled}
          onChange={(e) => {
            onCommit(e.target.checked ? 'unlimited' : numeric);
          }}
          className="accent-brand"
        />
        <span>{t('settings.autonomyDefaults.unlimited')}</span>
      </label>
    </div>
  );
}

interface NumberFieldProps {
  id: string;
  label: string;
  value: number;
  disabled: boolean;
  onCommit: (next: number) => void;
}

function NumberField({
  id,
  label,
  value,
  disabled,
  onCommit,
}: NumberFieldProps): ReactElement {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string>(String(value));
  // Reset draft when the persisted value changes (after a successful
  // save). Adjust state during render to avoid react-hooks/set-state-in-effect.
  const [lastSyncedValue, setLastSyncedValue] = useState<number>(value);
  if (value !== lastSyncedValue) {
    setLastSyncedValue(value);
    setDraft(String(value));
  }
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-xs">
      <span className="text-fg-muted">{label}</span>
      <div className="flex items-center gap-2">
        <input
          id={id}
          data-testid={id}
          type="number"
          min={1}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          className="flex-1 bg-elev text-fg border border-border-soft rounded-panel px-2 py-1.5"
        />
        <Button
          type="button"
          tone="secondary"
          size="sm"
          data-testid={`${id}-save`}
          disabled={disabled}
          onClick={() => {
            const n = Number.parseInt(draft, 10);
            if (Number.isFinite(n) && n >= 1) onCommit(n);
            else setDraft(String(value));
          }}
        >
          {t('settings.common.save')}
        </Button>
      </div>
    </label>
  );
}
