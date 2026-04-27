/**
 * `useOnboardingState` — Onboarding wizard state hook.
 *
 * Round-trips three IPC channels (`onboarding:get-state` /
 * `onboarding:set-state` / `onboarding:complete`) against the persisted
 * single row backed by migration 013. The hook also exposes
 * `provider:detect` results so step 2 can refresh the auto-detected
 * candidates without a separate hook.
 *
 * Contract:
 *  - `state` is `OnboardingState | null` — null means "not yet hydrated".
 *    On mount, calls `onboarding:get-state` once. Until that resolves,
 *    consumers see `state=null + loading=true` and MUST render a
 *    loading-equivalent surface (OnboardingPage does this). F1 cleanup
 *    deliberately removed the `FALLBACK_STATE` constant that previously
 *    flashed a step-1 frame on a wizard the user was resuming at step 4
 *    — that fallback masked IPC failures and lied to the user about
 *    what state they were in.
 *  - In jsdom test environments (window.arena missing) the hook
 *    synthesises an empty state synchronously so component tests do not
 *    need IPC mocks. Production renderers always see the bridge so
 *    that path is unreachable.
 *  - `applyPartial` calls `onboarding:set-state` and replaces local state
 *    with the response; the IPC response is the source of truth (the
 *    main service merges field-by-field — re-applying its result keeps
 *    the renderer cache identical to what the next mount would read).
 *  - `complete()` calls `onboarding:complete`, then patches local state
 *    locally — there is no separate "after complete" read because the
 *    only follow-up is unmounting the wizard via App.tsx.
 *  - `restart()` is the AboutTab "Restart onboarding" wire — it sends a
 *    set-state with `currentStep:1, selections:{}` so the wizard
 *    re-mounts on a fresh row.
 *  - `error` carries the last IPC failure. `state===null && error!==null`
 *    is the explicit failure surface — caller MUST render an error UI
 *    (OnboardingPage falls back to a small inline message since the
 *    wizard is the only screen mounted at first boot).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { invoke } from '../../ipc/invoke';
import type {
  OnboardingState,
  OnboardingStep,
  OnboardingSelections,
  ProviderDetectionSnapshot,
} from '../../../shared/onboarding-types';

function bridgeAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const arena = (window as unknown as { arena?: unknown }).arena;
  return arena != null;
}

/**
 * Test-only synthetic state. F1 (mock/fallback cleanup) deliberately keeps
 * a separate path for jsdom: production renderer never enters this branch
 * (bridgeAvailable() returns true under Electron). The synthesised value
 * is *not* a fallback for IPC failure — that case is surfaced via
 * `state===null + error!==null` instead.
 */
function emptyTestState(): OnboardingState {
  return {
    completed: false,
    currentStep: 1,
    selections: {},
    updatedAt: 0,
  };
}

export interface UseOnboardingStateResult {
  state: OnboardingState | null;
  loading: boolean;
  error: Error | null;
  detection: ProviderDetectionSnapshot[];
  detectionLoading: boolean;
  setStep: (step: OnboardingStep) => Promise<void>;
  patchSelections: (
    selections: Partial<OnboardingSelections>,
  ) => Promise<void>;
  complete: () => Promise<void>;
  restart: () => Promise<void>;
  refreshDetection: () => Promise<void>;
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

export function useOnboardingState(): UseOnboardingStateResult {
  // Initialize loading=false + state=emptyTestState when the bridge is
  // missing so the test env never renders the spinner-equivalent shell.
  // Production renderers ALWAYS see the bridge so state=null + loading
  // =true is the right default (OnboardingPage handles the gap).
  const [state, setState] = useState<OnboardingState | null>(() =>
    bridgeAvailable() ? null : emptyTestState(),
  );
  const [loading, setLoading] = useState<boolean>(() => bridgeAvailable());
  const [error, setError] = useState<Error | null>(null);
  const [detection, setDetection] = useState<ProviderDetectionSnapshot[]>([]);
  const [detectionLoading, setDetectionLoading] = useState<boolean>(false);

  const mountedRef = useRef(true);
  const didFetchRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ── Initial fetch ──────────────────────────────────────────────
  useEffect(() => {
    if (didFetchRef.current) return;
    didFetchRef.current = true;

    if (!bridgeAvailable()) {
      // Test environment: skip the IPC fetch entirely. `loading` was
      // initialised to `false` by the bridgeAvailable() check above so
      // we do not need a synchronous setState here.
      return;
    }

    void (async () => {
      try {
        const { state: initial } = await invoke('onboarding:get-state', undefined);
        if (!mountedRef.current) return;
        setState(initial);
        setError(null);
      } catch (reason) {
        if (!mountedRef.current) return;
        // F1: do NOT swallow the failure into a synthetic default — leave
        // state=null and surface the error so OnboardingPage can render
        // a "wizard 상태를 불러오지 못했어요" frame instead of a
        // pretend-step-1 screen.
        setError(toError(reason));
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    })();
  }, []);

  // ── Mutation helpers ───────────────────────────────────────────
  const applyPartial = useCallback(
    async (partial: Partial<OnboardingState>): Promise<void> => {
      if (!bridgeAvailable()) {
        // Test environment merge: mirror the service's pure-function
        // semantics so component tests can drive the wizard without
        // round-tripping IPC. `prev` is non-null in the jsdom path
        // because emptyTestState() was used for the initial value.
        setState((prev) => {
          const base = prev ?? emptyTestState();
          return {
            ...base,
            currentStep: partial.currentStep ?? base.currentStep,
            selections: {
              ...base.selections,
              ...(partial.selections ?? {}),
            },
            updatedAt: Date.now(),
          };
        });
        return;
      }
      const { state: next } = await invoke('onboarding:set-state', {
        partial,
      });
      if (!mountedRef.current) return;
      setState(next);
    },
    [],
  );

  const setStep = useCallback(
    async (step: OnboardingStep): Promise<void> => {
      await applyPartial({ currentStep: step });
    },
    [applyPartial],
  );

  const patchSelections = useCallback(
    async (selections: Partial<OnboardingSelections>): Promise<void> => {
      await applyPartial({ selections: selections as OnboardingSelections });
    },
    [applyPartial],
  );

  const complete = useCallback(async (): Promise<void> => {
    if (!bridgeAvailable()) {
      setState((prev) => {
        const base = prev ?? emptyTestState();
        return { ...base, completed: true, updatedAt: Date.now() };
      });
      return;
    }
    await invoke('onboarding:complete', undefined);
    if (!mountedRef.current) return;
    setState((prev) =>
      prev === null
        ? null
        : { ...prev, completed: true, updatedAt: Date.now() },
    );
  }, []);

  const restart = useCallback(async (): Promise<void> => {
    // Reset the row to the canonical default by issuing a partial that
    // unwinds currentStep + selections. The main service ignores
    // partial.completed flips, so AboutTab also flips the local
    // `completed` flag through the dedicated path: applyPartial below
    // calls set-state then re-issues a get-state to honour the service
    // reset semantics. Implementation detail — main currently flips
    // completed only via `onboarding:set-state` because the service's
    // `applyPartial` preserves prior completed when the partial omits
    // the field. To keep the contract narrow we round-trip a fresh row
    // by setting step=1 + empty selections; AboutTab additionally
    // toggles `setView('onboarding')` so the wizard re-mounts and
    // re-fetches.
    await applyPartial({
      currentStep: 1,
      selections: {} as OnboardingSelections,
    });
  }, [applyPartial]);

  // ── Provider detection ─────────────────────────────────────────
  const refreshDetection = useCallback(async (): Promise<void> => {
    if (!bridgeAvailable()) return;
    setDetectionLoading(true);
    try {
      const { snapshots } = await invoke('provider:detect', undefined);
      if (!mountedRef.current) return;
      setDetection(snapshots);
    } catch (reason) {
      if (!mountedRef.current) return;
      // Detection is best-effort — surface the error without blocking
      // the wizard. The caller can decide to retry.
      console.warn(
        '[onboarding] provider:detect failed',
        reason instanceof Error ? reason.message : String(reason),
      );
    } finally {
      if (mountedRef.current) setDetectionLoading(false);
    }
  }, []);

  // F1: detection auto-mount. STAFF_CANDIDATES fixture 가 사라진 이후
  // Step2 staff-grid 의 단일 데이터 소스가 `provider:detect` 결과 (live
  // snapshot) 가 되므로 wizard 가 마운트되는 즉시 한 번 호출한다. didFetch
  // 가드로 중복 호출을 막고 (StrictMode 의 double-effect 방어), 호출 자체는
  // bridgeAvailable=false 인 테스트 환경에서 즉시 빠져나가므로 jsdom 비용은
  // 0 이다.
  const didFetchDetectionRef = useRef(false);
  useEffect(() => {
    if (didFetchDetectionRef.current) return;
    didFetchDetectionRef.current = true;
    if (!bridgeAvailable()) return;
    void refreshDetection();
  }, [refreshDetection]);

  return {
    state,
    loading,
    error,
    detection,
    detectionLoading,
    setStep,
    patchSelections,
    complete,
    restart,
    refreshDetection,
  };
}
