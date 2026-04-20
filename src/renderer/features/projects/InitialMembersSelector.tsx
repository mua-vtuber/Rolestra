/**
 * InitialMembersSelector — multi-checkbox list of available providers
 * (i.e. "직원"/staff). Fetches once on mount via `provider:list`.
 *
 * Contract:
 * - `value`  — selected providerIds (state owned by the parent modal).
 * - `onChange(ids)` — called with the new selection whenever a box flips.
 *
 * Design notes:
 * - Native `<input type="checkbox">` (wrapped in a label) keeps this
 *   minimal; Radix currently ships a Checkbox primitive but it isn't
 *   in the project's deps and adding it only for a list of checkboxes
 *   isn't worth the bundle hit.
 * - Errors during `provider:list` render an inline message — we do NOT
 *   silently fabricate an empty list (that would masquerade a backend
 *   failure as "no staff yet").
 * - When providers is empty but fetched cleanly, the empty-state copy
 *   is surfaced from i18n.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { invoke } from '../../ipc/invoke';
import type { ProviderInfo } from '../../../shared/provider-types';

export interface InitialMembersSelectorProps {
  value: string[];
  onChange: (ids: string[]) => void;
}

interface FetchState {
  providers: ProviderInfo[] | null;
  error: Error | null;
  loading: boolean;
}

export function InitialMembersSelector({
  value,
  onChange,
}: InitialMembersSelectorProps): ReactElement {
  const { t } = useTranslation();
  const [state, setState] = useState<FetchState>({
    providers: null,
    error: null,
    loading: true,
  });
  const didFetchRef = useRef(false);

  useEffect(() => {
    if (didFetchRef.current) return;
    didFetchRef.current = true;
    let cancelled = false;

    const run = async (): Promise<void> => {
      try {
        const { providers } = await invoke('provider:list', undefined);
        if (cancelled) return;
        setState({ providers, error: null, loading: false });
      } catch (reason) {
        if (cancelled) return;
        const err =
          reason instanceof Error ? reason : new Error(String(reason));
        setState({ providers: null, error: err, loading: false });
      }
    };
    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  const selected = new Set(value);

  const toggle = (id: string): void => {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onChange(Array.from(next));
  };

  if (state.loading) {
    return (
      <div
        data-testid="initial-members-selector"
        data-state="loading"
        className="text-xs text-fg-muted"
      >
        {t('dashboard.people.loading')}
      </div>
    );
  }

  if (state.error !== null) {
    return (
      <div
        role="alert"
        data-testid="initial-members-selector"
        data-state="error"
        className="text-xs text-danger"
      >
        {state.error.message.length > 0
          ? state.error.message
          : t('project.errors.generic')}
      </div>
    );
  }

  const providers = state.providers ?? [];

  if (providers.length === 0) {
    return (
      <div
        data-testid="initial-members-selector"
        data-state="empty"
        className="text-xs text-fg-muted"
      >
        {t('project.create.members.empty')}
      </div>
    );
  }

  return (
    <div
      data-testid="initial-members-selector"
      data-state="ready"
      className="flex flex-col gap-1.5 max-h-40 overflow-y-auto"
    >
      {providers.map((provider) => {
        const checked = selected.has(provider.id);
        return (
          <label
            key={provider.id}
            data-testid={`initial-member-option-${provider.id}`}
            data-checked={checked ? 'true' : 'false'}
            className="flex items-center gap-2 text-sm cursor-pointer"
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggle(provider.id)}
              className="accent-brand"
            />
            <span>{provider.displayName}</span>
          </label>
        );
      })}
    </div>
  );
}
