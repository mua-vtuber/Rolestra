/**
 * `useAutonomyMode` — manage a project's autonomyMode (manual / auto_toggle /
 * queue) with a 2-stage confirmation flow for manual → auto_toggle/queue
 * promotions (spec §8 + R9 Decision Log D4).
 *
 * Contract (R9-Task2):
 * - The hook does NOT fetch project state. The caller owns `useProjects`
 *   and passes the current mode via `initialMode`. This avoids double
 *   source-of-truth and keeps the hook composable with project list
 *   surfaces.
 * - `request(target)` decides whether to open a confirmation dialog:
 *     manual → auto_toggle/queue  → dialog (pendingTarget set, caller
 *                                   renders `<AutonomyConfirmDialog>`)
 *     any other transition         → immediate invoke (direct mutation)
 *   Rationale: spec §8 Circuit Breaker applies to both auto_toggle AND
 *   queue identically, so once the user has confirmed on manual → auto
 *   there is no safety reason to re-confirm auto ↔ queue. Downgrades to
 *   manual are always safe and should minimize friction (D4).
 * - `confirm()` executes the pending mutation. Optimistically updates
 *   local `mode` state before the IPC resolves; rolls back on error.
 * - Subscribes to `stream:autonomy-mode-changed` and reconciles mode
 *   when the broadcast matches `projectId`. This covers (a) Circuit
 *   Breaker downgrades fired from main, (b) multi-window sync.
 */
import { useCallback, useEffect, useState } from 'react';

import { useThrowToBoundary } from '../components/ErrorBoundary';
import { invoke } from '../ipc/invoke';
import type { AutonomyMode } from '../../shared/project-types';
import type { StreamV3PayloadOf } from '../../shared/stream-events';

export interface UseAutonomyModeResult {
  mode: AutonomyMode;
  pendingTarget: AutonomyMode | null;
  isSaving: boolean;
  error: Error | null;
  /** Request a mode change. Opens confirm dialog for promotions only. */
  request: (target: AutonomyMode) => void;
  /** Confirm a pending promotion (caller's dialog "확인" button). */
  confirm: () => Promise<void>;
  /** Cancel a pending promotion (caller's dialog "취소"). */
  cancel: () => void;
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

/** Returns true iff the transition requires the 2-stage confirmation. */
export function needsConfirm(from: AutonomyMode, to: AutonomyMode): boolean {
  return from === 'manual' && (to === 'auto_toggle' || to === 'queue');
}

export function useAutonomyMode(
  projectId: string,
  initialMode: AutonomyMode,
): UseAutonomyModeResult {
  const [mode, setMode] = useState<AutonomyMode>(initialMode);
  const [pendingTarget, setPendingTarget] = useState<AutonomyMode | null>(
    null,
  );
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const throwToBoundary = useThrowToBoundary();

  // React "adjusting state during render" pattern — re-sync if the parent
  // passes a different initialMode (e.g. active project changed). Using
  // useEffect + setState would trigger eslint `set-state-in-effect`.
  const [lastInitial, setLastInitial] = useState<AutonomyMode>(initialMode);
  if (initialMode !== lastInitial) {
    setLastInitial(initialMode);
    setMode(initialMode);
  }

  // Subscribe to broadcast. Arena is undefined in non-preload tests;
  // guard for jsdom.
  useEffect(() => {
    const arena =
      typeof window !== 'undefined'
        ? (window as unknown as { arena?: { onStream?: unknown } }).arena
        : undefined;
    const onStream = (
      arena?.onStream as
        | (<T extends string>(
            type: T,
            cb: (payload: unknown) => void,
          ) => () => void)
        | undefined
    );
    if (!onStream) return;
    const unsub = onStream('stream:autonomy-mode-changed', (rawPayload) => {
      const payload = rawPayload as StreamV3PayloadOf<'stream:autonomy-mode-changed'>;
      if (payload.projectId !== projectId) return;
      setMode(payload.mode);
      // If a pending confirmation was racing with a main-side downgrade,
      // drop the pending UI — main is authoritative.
      setPendingTarget((prev) => (prev && prev !== payload.mode ? null : prev));
    });
    return unsub;
  }, [projectId]);

  const runMutation = useCallback(
    async (target: AutonomyMode): Promise<void> => {
      setIsSaving(true);
      setError(null);
      const prev = mode;
      // D8 ordering invariant: the optimistic setMode(target) below races
      // with `stream:autonomy-mode-changed` from the main process. If the
      // stream lands first AND its payload disagrees with `target` (e.g.
      // a Circuit Breaker downgrade preempted us), the stream subscriber
      // already cleared `pendingTarget` and reset `mode` to authoritative
      // — we must NOT undo that with the rollback path below. Detection:
      // by the time we rollback, current `mode` is no longer `target`,
      // meaning the stream wrote a different value first; in that case
      // the stream IS the truth, so skip rollback.
      setMode(target); // optimistic
      try {
        await invoke('project:set-autonomy', { id: projectId, mode: target });
        setPendingTarget(null);
      } catch (reason) {
        setMode((current) => (current === target ? prev : current));
        setError(toError(reason));
        throwToBoundary(reason);
        throw reason;
      } finally {
        setIsSaving(false);
      }
    },
    [mode, projectId, throwToBoundary],
  );

  const request = useCallback(
    (target: AutonomyMode) => {
      if (target === mode) return;
      if (needsConfirm(mode, target)) {
        setPendingTarget(target);
        return;
      }
      void runMutation(target).catch(() => {
        // Error already surfaced via `error` state; swallow promise rejection.
      });
    },
    [mode, runMutation],
  );

  const confirm = useCallback(async (): Promise<void> => {
    if (pendingTarget == null) return;
    await runMutation(pendingTarget);
  }, [pendingTarget, runMutation]);

  const cancel = useCallback(() => {
    setPendingTarget(null);
  }, []);

  return { mode, pendingTarget, isSaving, error, request, confirm, cancel };
}
