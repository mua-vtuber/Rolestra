/**
 * `useProjects` — active-projects list + CRUD-ish mutations.
 *
 * Contract:
 * - On mount: fetches `project:list` once (strict-mode safe).
 * - Mutations (`createNew`, `linkExternal`, `importFolder`) re-run the
 *   list fetch on success and return the created `Project` so the
 *   caller (e.g. the project-creation modal) can decide whether to
 *   activate it. This hook NEVER calls the active-project store.
 * - `archive(id)` just re-runs the list.
 * - All mutation errors are re-thrown. Renderer UX owns error display.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { invoke } from '../ipc/invoke';
import type { Project, ProjectCreateInput } from '../../shared/project-types';
import type {
  ProjectImportInput,
  ProjectLinkExternalInput,
} from '../../shared/ipc-types';

export interface UseProjectsResult {
  projects: Project[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  createNew: (input: ProjectCreateInput) => Promise<Project>;
  linkExternal: (input: ProjectLinkExternalInput) => Promise<Project>;
  importFolder: (input: ProjectImportInput) => Promise<Project>;
  archive: (id: string) => Promise<void>;
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

export function useProjects(): UseProjectsResult {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const didMountFetchRef = useRef(false);
  const mountedRef = useRef(true);

  const runFetch = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const { projects: list } = await invoke('project:list', {
        includeArchived: false,
      });
      if (!mountedRef.current) return;
      setProjects(list);
      setError(null);
    } catch (reason) {
      if (!mountedRef.current) return;
      setError(toError(reason));
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (didMountFetchRef.current) {
      return () => {
        mountedRef.current = false;
      };
    }
    didMountFetchRef.current = true;
    void runFetch();
    return () => {
      mountedRef.current = false;
    };
  }, [runFetch]);

  const refresh = useCallback(async (): Promise<void> => {
    await runFetch();
  }, [runFetch]);

  const createNew = useCallback(
    async (input: ProjectCreateInput): Promise<Project> => {
      const { project } = await invoke('project:create', input);
      await runFetch();
      return project;
    },
    [runFetch],
  );

  const linkExternal = useCallback(
    async (input: ProjectLinkExternalInput): Promise<Project> => {
      const { project } = await invoke('project:link-external', input);
      await runFetch();
      return project;
    },
    [runFetch],
  );

  const importFolder = useCallback(
    async (input: ProjectImportInput): Promise<Project> => {
      const { project } = await invoke('project:import', input);
      await runFetch();
      return project;
    },
    [runFetch],
  );

  const archive = useCallback(
    async (id: string): Promise<void> => {
      await invoke('project:archive', { id });
      await runFetch();
    },
    [runFetch],
  );

  return {
    projects,
    loading,
    error,
    refresh,
    createNew,
    linkExternal,
    importFolder,
    archive,
  };
}
