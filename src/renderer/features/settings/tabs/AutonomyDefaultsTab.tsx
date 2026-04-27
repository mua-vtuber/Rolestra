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
import { useLlmCostSummary } from '../../../hooks/use-llm-cost-summary';
import type { LlmCostSummary } from '../../../../shared/llm-cost-types';

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
          <LlmCostSection
            priceMap={settings.llmCostUsdPerMillionTokens}
            disabled={savingKey === 'llmCostUsdPerMillionTokens'}
            onCommitPrice={async (providerId, nextPrice) => {
              await update('llmCostUsdPerMillionTokens', {
                ...settings.llmCostUsdPerMillionTokens,
                [providerId]: nextPrice,
              });
            }}
          />
        </div>
      )}
    </section>
  );
}

/** R11-Task8: rolling-window LLM 사용량 카드 + per-provider 단가 입력. */
const LLM_COST_PERIOD_DAYS = 30;

interface LlmCostSectionProps {
  priceMap: Record<string, number>;
  disabled: boolean;
  onCommitPrice: (providerId: string, nextPrice: number) => Promise<void>;
}

function LlmCostSection({
  priceMap,
  disabled,
  onCommitPrice,
}: LlmCostSectionProps): ReactElement {
  const { t } = useTranslation();
  const { summary, loading, error, refetch } =
    useLlmCostSummary(LLM_COST_PERIOD_DAYS);

  // F2-Task5: a missing summary while not loading and not in an error
  // state used to fall through to the "empty" branch, which conflated
  // "the period had zero usage" with "summary failed to load". The
  // loading-cost hook only ever leaves us in that state on an
  // unexpected internal failure (e.g. IPC contract drift), so promote
  // it to a user-visible error rather than silently rendering empty.
  const summaryUnavailable = !loading && error === null && summary === null;
  const rows: LlmCostSummary['byProvider'] = summary?.byProvider ?? [];

  return (
    <section
      data-testid="settings-autonomy-llm-cost-section"
      className="mt-4 pt-4 border-t border-border-soft space-y-2"
    >
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-display font-semibold">
          {t('llm.cost.title')}
        </h3>
        <span className="text-xs text-fg-muted">
          {t('llm.cost.periodLabel', { days: LLM_COST_PERIOD_DAYS })}
        </span>
      </header>
      <p className="text-xs text-fg-muted">
        {t('llm.cost.description', { days: LLM_COST_PERIOD_DAYS })}
      </p>

      {error !== null ? (
        <div
          role="alert"
          data-testid="settings-autonomy-llm-cost-error"
          className="text-xs text-danger border border-danger rounded-panel px-2 py-1 bg-sunk"
        >
          {t('llm.cost.error')} — {error.message}
        </div>
      ) : summaryUnavailable ? (
        <div
          role="alert"
          data-testid="settings-autonomy-llm-cost-error"
          className="text-xs text-danger border border-danger rounded-panel px-2 py-1 bg-sunk"
        >
          {t('llm.cost.unavailable')}
        </div>
      ) : loading ? (
        <p
          data-testid="settings-autonomy-llm-cost-loading"
          className="text-xs text-fg-muted italic"
        >
          {t('llm.cost.loading')}
        </p>
      ) : rows.length === 0 ? (
        <p
          data-testid="settings-autonomy-llm-cost-empty"
          className="text-xs text-fg-muted italic"
        >
          {t('llm.cost.empty', { days: LLM_COST_PERIOD_DAYS })}
        </p>
      ) : (
        <table
          data-testid="settings-autonomy-llm-cost-table"
          className="w-full text-xs border-collapse"
        >
          <thead className="text-fg-muted">
            <tr>
              <th className="text-left py-1 font-normal">
                {t('llm.cost.tableHeader.provider')}
              </th>
              <th className="text-right py-1 font-normal">
                {t('llm.cost.tableHeader.tokenIn')}
              </th>
              <th className="text-right py-1 font-normal">
                {t('llm.cost.tableHeader.tokenOut')}
              </th>
              <th className="text-right py-1 font-normal">
                {t('llm.cost.tableHeader.totalTokens')}
              </th>
              <th className="text-right py-1 font-normal">
                {t('llm.cost.tableHeader.price')}
              </th>
              <th className="text-right py-1 font-normal">
                {t('llm.cost.tableHeader.estimatedUsd')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <LlmCostRow
                key={row.providerId}
                providerId={row.providerId}
                tokenIn={row.tokenIn}
                tokenOut={row.tokenOut}
                estimatedUsd={row.estimatedUsd}
                price={priceMap[row.providerId] ?? 0}
                disabled={disabled}
                onCommitPrice={async (next) => {
                  await onCommitPrice(row.providerId, next);
                  await refetch();
                }}
              />
            ))}
          </tbody>
          {summary && (
            <tfoot>
              <tr className="border-t border-border-soft text-fg">
                <td colSpan={6} className="text-right py-1">
                  {t('llm.cost.totalTokens', {
                    value: summary.totalTokens.toLocaleString(),
                  })}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      )}
    </section>
  );
}

interface LlmCostRowProps {
  providerId: string;
  tokenIn: number;
  tokenOut: number;
  estimatedUsd: number | null;
  price: number;
  disabled: boolean;
  onCommitPrice: (next: number) => Promise<void>;
}

function LlmCostRow({
  providerId,
  tokenIn,
  tokenOut,
  estimatedUsd,
  price,
  disabled,
  onCommitPrice,
}: LlmCostRowProps): ReactElement {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string>(price > 0 ? String(price) : '');
  const [lastSyncedPrice, setLastSyncedPrice] = useState<number>(price);
  if (price !== lastSyncedPrice) {
    setLastSyncedPrice(price);
    setDraft(price > 0 ? String(price) : '');
  }
  const total = tokenIn + tokenOut;
  return (
    <tr data-testid={`settings-autonomy-llm-cost-row-${providerId}`}>
      <td className="py-1 text-left text-fg">{providerId}</td>
      <td className="py-1 text-right tabular-nums">{tokenIn.toLocaleString()}</td>
      <td className="py-1 text-right tabular-nums">{tokenOut.toLocaleString()}</td>
      <td className="py-1 text-right tabular-nums">{total.toLocaleString()}</td>
      <td className="py-1 text-right">
        <input
          type="number"
          min={0}
          step={0.01}
          aria-label={t('llm.cost.priceLabel')}
          data-testid={`settings-autonomy-llm-cost-price-${providerId}`}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const n = Number.parseFloat(draft);
            if (Number.isFinite(n) && n >= 0 && n !== price) {
              void onCommitPrice(n);
            } else {
              setDraft(price > 0 ? String(price) : '');
            }
          }}
          className="w-20 bg-elev text-fg border border-border-soft rounded-panel px-1.5 py-0.5 text-right tabular-nums"
        />
      </td>
      <td className="py-1 text-right tabular-nums">
        {estimatedUsd === null ? (
          <span className="text-fg-muted italic">
            {t('llm.cost.estimatedUsdMissing')}
          </span>
        ) : (
          `$ ${estimatedUsd.toFixed(4)}`
        )}
      </td>
    </tr>
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
