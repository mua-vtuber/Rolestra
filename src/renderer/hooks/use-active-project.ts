/**
 * `useActiveProject` — active-project id + setter/clear.
 *
 * Responsibility boundary:
 * - This hook does NOT resolve the full `Project` object. Callers who
 *   need it should read `useProjects().projects` and look up by id.
 *   This keeps the hook decoupled from `useProjects` and avoids an
 *   unexpected second `project:list` IPC call whenever the active id
 *   changes.
 *
 * `setActive(id)`:
 * - Calls `project:open` FIRST. Main-side folder-missing detection,
 *   telemetry, etc. happen there.
 * - ONLY on success does the store get updated.
 * - On failure the rejection is re-thrown for the caller to surface.
 */
import { useCallback } from 'react';

import { invoke } from '../ipc/invoke';
import { useActiveProjectStore } from '../stores/active-project-store';

export interface UseActiveProjectResult {
  activeProjectId: string | null;
  setActive: (id: string) => Promise<void>;
  clear: () => void;
}

export function useActiveProject(): UseActiveProjectResult {
  const activeProjectId = useActiveProjectStore((s) => s.activeProjectId);
  const setActiveProjectId = useActiveProjectStore((s) => s.setActiveProjectId);

  const setActive = useCallback(
    async (id: string): Promise<void> => {
      await invoke('project:open', { id });
      setActiveProjectId(id);
    },
    [setActiveProjectId],
  );

  const clear = useCallback((): void => {
    setActiveProjectId(null);
  }, [setActiveProjectId]);

  return { activeProjectId, setActive, clear };
}
