/**
 * SecurityTab — R10-Task6 "위험한 자율 모드" opt-in toggle + flag preview.
 *
 * spec §7.6.5 introduced a single safety opt-in that gates the
 * `--dangerously-*` family of CLI flags. The toggle defaults to `false`
 * on first boot (R10 D1) and is intentionally surfaced behind a
 * separate tab so a stray click on Theme / Language never enables it
 * by accident.
 *
 * Below the toggle we show a live preview that calls
 * `permission:dry-run-flags` with the picked (provider × mode × project)
 * combo so the user can see exactly which argv would be appended to the
 * CLI when the opt-in is on. The preview is read-only — actual CLI
 * spawn still goes through `cli-runner.ts` at runtime.
 */
import { clsx } from 'clsx';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { useTranslation } from 'react-i18next';

import { invoke } from '../../../ipc/invoke';
import type {
  PermissionFlagInput,
  PermissionFlagOutput,
  PermissionFlagProviderType,
} from '../../../../shared/permission-flag-types';
import type {
  PermissionMode,
  ProjectKind,
} from '../../../../shared/project-types';

const DEFAULT_INPUT: PermissionFlagInput = {
  providerType: 'claude_cli',
  permissionMode: 'hybrid',
  projectKind: 'new',
  dangerousAutonomyOptIn: false,
};

const PROVIDER_TYPES: readonly PermissionFlagProviderType[] = [
  'claude_cli',
  'codex_cli',
  'gemini_cli',
] as const;

const PERMISSION_MODES: readonly PermissionMode[] = [
  'approval',
  'hybrid',
  'auto',
] as const;

const PROJECT_KINDS: readonly ProjectKind[] = [
  'new',
  'external',
  'imported',
] as const;

export function SecurityTab(): ReactElement {
  const { t } = useTranslation();
  const [input, setInput] = useState<PermissionFlagInput>(DEFAULT_INPUT);
  const [output, setOutput] = useState<PermissionFlagOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runDryRun = useCallback(
    async (next: PermissionFlagInput): Promise<void> => {
      try {
        const result = await invoke('permission:dry-run-flags', next);
        setOutput(result);
        setError(null);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [],
  );

  // Initial fetch — gated on a ref so React 19's strict-mode double
  // invocation does not double-call the IPC.
  const didMountFetchRef = useRef(false);
  useEffect(() => {
    if (didMountFetchRef.current) return;
    didMountFetchRef.current = true;
    void runDryRun(DEFAULT_INPUT);
  }, [runDryRun]);

  const updateInput = useCallback(
    (patch: Partial<PermissionFlagInput>): void => {
      setInput((prev) => {
        const next = { ...prev, ...patch };
        void runDryRun(next);
        return next;
      });
    },
    [runDryRun],
  );

  const handleToggleOptIn = (next: boolean): void => {
    updateInput({ dangerousAutonomyOptIn: next });
  };

  return (
    <section
      data-testid="settings-tab-security"
      className="space-y-4 max-w-2xl"
    >
      <header>
        <h2 className="text-sm font-display font-semibold">
          {t('settings.security.title')}
        </h2>
        <p className="text-xs text-fg-muted mt-0.5">
          {t('settings.security.description')}
        </p>
      </header>

      <div
        data-testid="settings-security-opt-in"
        className="border border-danger rounded-panel p-3 bg-sunk space-y-2"
      >
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            data-testid="settings-security-opt-in-toggle"
            checked={input.dangerousAutonomyOptIn}
            onChange={(e) => handleToggleOptIn(e.target.checked)}
            className="mt-0.5 accent-danger"
          />
          <span className="flex-1 text-sm">
            <strong className="text-danger">
              {t('settings.security.dangerousOptIn.label')}
            </strong>
            <span className="block text-xs text-fg-muted mt-1">
              {t('settings.security.dangerousOptIn.description')}
            </span>
          </span>
        </label>
      </div>

      <fieldset
        data-testid="settings-security-preview"
        className="border border-border-soft rounded-panel p-3 space-y-2"
      >
        <legend className="text-xs font-medium text-fg-muted px-1">
          {t('settings.security.preview.label')}
        </legend>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <SelectField
            id="security-provider"
            label={t('settings.security.preview.provider')}
            value={input.providerType}
            onChange={(value) =>
              updateInput({
                providerType: value as PermissionFlagProviderType,
              })
            }
            options={PROVIDER_TYPES.map((p) => ({
              value: p,
              label: t(`settings.security.preview.providerOption.${p}`),
            }))}
          />
          <SelectField
            id="security-mode"
            label={t('settings.security.preview.mode')}
            value={input.permissionMode}
            onChange={(value) =>
              updateInput({ permissionMode: value as PermissionMode })
            }
            options={PERMISSION_MODES.map((m) => ({
              value: m,
              label: t(`settings.security.preview.modeOption.${m}`),
            }))}
          />
          <SelectField
            id="security-kind"
            label={t('settings.security.preview.kind')}
            value={input.projectKind}
            onChange={(value) =>
              updateInput({ projectKind: value as ProjectKind })
            }
            options={PROJECT_KINDS.map((k) => ({
              value: k,
              label: t(`settings.security.preview.kindOption.${k}`),
            }))}
          />
        </div>

        {error !== null && (
          <div
            role="alert"
            data-testid="settings-security-preview-error"
            className="text-xs text-danger"
          >
            {error}
          </div>
        )}

        {output !== null && (
          <div
            data-testid="settings-security-preview-output"
            className="space-y-1.5"
          >
            <div
              data-testid="settings-security-preview-flags"
              data-blocked={output.blocked || undefined}
              className={clsx(
                'font-mono text-xs px-2 py-1.5 rounded-panel border',
                output.blocked
                  ? 'border-danger text-danger bg-sunk'
                  : 'border-border-soft text-fg bg-elev',
              )}
            >
              {output.blocked
                ? t('settings.security.preview.blocked', {
                    reason: output.blockedReason ?? 'unknown',
                  })
                : output.flags.length === 0
                  ? t('settings.security.preview.noFlags')
                  : output.flags.join(' ')}
            </div>
            {output.rationale.length > 0 && (
              <ul
                data-testid="settings-security-preview-rationale"
                className="text-xs text-fg-muted space-y-0.5"
              >
                {output.rationale.map((key) => (
                  <li key={key} className="font-mono">
                    {t(key, { defaultValue: key })}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </fieldset>
    </section>
  );
}

interface SelectFieldProps {
  id: string;
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}

function SelectField({
  id,
  label,
  value,
  options,
  onChange,
}: SelectFieldProps): ReactElement {
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-xs">
      <span className="text-fg-muted">{label}</span>
      <select
        id={id}
        data-testid={`${id}-select`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-elev text-fg border border-border-soft rounded-panel px-2 py-1.5"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
