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
  /**
   * When true, the first successful provider fetch tick all available
   * providers as initially selected (mirrors ChannelCreateModal's
   * "default include all members" prefill). Skipped if `value` already
   * carries entries — prefill never overrides an explicit selection.
   * Without this, a project created from the modal without ticking
   * boxes would land with empty `project_members`, which makes
   * subsequent user-channel creation fail the composite FK check
   * (channel_members → project_members).
   */
  defaultSelectAll?: boolean;
}

interface FetchState {
  providers: ProviderInfo[] | null;
  error: Error | null;
  loading: boolean;
}

export function InitialMembersSelector({
  value,
  onChange,
  defaultSelectAll = false,
}: InitialMembersSelectorProps): ReactElement {
  const { t } = useTranslation();
  const [state, setState] = useState<FetchState>({
    providers: null,
    error: null,
    loading: true,
  });
  // Capture the latest defaultSelectAll/value/onChange in refs so the
  // fetch effect can read them without re-running on every parent
  // render. Re-running the fetch every render would re-fire the IPC
  // and (via the prefill branch) clobber any toggle the user just
  // made — refs let the effect read live values while staying mount-only.
  const defaultSelectAllRef = useRef(defaultSelectAll);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  defaultSelectAllRef.current = defaultSelectAll;
  valueRef.current = value;
  onChangeRef.current = onChange;

  useEffect(() => {
    // 주의 — `didFetchRef` 같은 mount-once 가드는 React 18 Strict Mode
    // 의 mount→cleanup→remount 패턴과 어울리지 않는다. ref 가 mount-1
    // 에서 true 로 set 되면, remount-2 는 fetch 를 건너뛰고, mount-1
    // 의 in-flight IPC 결과는 cleanup-1 이 set 한 cancelled=true 로
    // setState 가 죽어 영구 loading 에 갇힌다. Strict Mode 에서 IPC
    // 가 두 번 호출되는 비용보다 락업이 훨씬 비싸다 — 두 가드 중
    // cancelled 만 남긴다 (`provider:list` 는 in-memory registry
    // lookup 이라 idempotent · 비용 무시 가능).
    let cancelled = false;

    const run = async (): Promise<void> => {
      try {
        const { providers } = await invoke('provider:list', undefined);
        if (cancelled) return;
        setState({ providers, error: null, loading: false });
        // Default-select-all prefill — fires synchronously after the
        // fetch resolves so React batches the setState + parent
        // dispatch into a single render. Skipped when the parent
        // already carries a selection (user toggled) or the modal
        // didn't opt in. Without this, a project created via the
        // modal with no ticked boxes would land with empty
        // `project_members`, which makes the very next "+ 새 채널"
        // attempt fail the channel_members composite FK check.
        if (
          defaultSelectAllRef.current &&
          valueRef.current.length === 0 &&
          providers.length > 0
        ) {
          onChangeRef.current(providers.map((p) => p.id));
        }
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
