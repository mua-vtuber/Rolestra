// @vitest-environment jsdom

import { StrictMode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjects } from '../use-projects';
import type { Project } from '../../../shared/project-types';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p-1',
    slug: 'p-1',
    name: 'Project 1',
    description: '',
    kind: 'new',
    externalLink: null,
    permissionMode: 'approval',
    autonomyMode: 'manual',
    status: 'active',
    createdAt: 1_700_000_000_000,
    archivedAt: null,
    ...overrides,
  };
}

/**
 * Builds a vi.fn() that dispatches per-channel based on its first arg so we
 * can assert call ordering across multiple IPC channels without brittle
 * mockResolvedValueOnce chains.
 */
function makeRouter(
  routes: Record<string, (data: unknown) => unknown>,
): ReturnType<typeof vi.fn> {
  return vi.fn((channel: string, data: unknown) => {
    const handler = routes[channel];
    if (!handler) {
      return Promise.reject(new Error(`no mock for channel ${channel}`));
    }
    try {
      return Promise.resolve(handler(data));
    } catch (reason) {
      return Promise.reject(reason);
    }
  });
}

describe('useProjects', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('mounts → fetches project:list with includeArchived=false exactly once in strict mode', async () => {
    const invoke = makeRouter({
      'project:list': () => ({ projects: [makeProject()] }),
    });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useProjects(), { wrapper: StrictMode });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const listCalls = invoke.mock.calls.filter((c) => c[0] === 'project:list');
    expect(listCalls).toHaveLength(1);
    expect(listCalls[0]?.[1]).toEqual({ includeArchived: false });
    expect(result.current.projects).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it('createNew invokes project:create, triggers project:list refresh, and returns the created project', async () => {
    const created = makeProject({ id: 'p-new', name: 'Fresh' });
    let listCall = 0;
    const invoke = makeRouter({
      'project:list': () => {
        listCall += 1;
        return { projects: listCall === 1 ? [] : [created] };
      },
      'project:create': () => ({ project: created }),
    });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useProjects());

    await waitFor(() => expect(result.current.loading).toBe(false));

    let returned: Project | undefined;
    await act(async () => {
      returned = await result.current.createNew({
        name: 'Fresh',
        kind: 'new',
        permissionMode: 'approval',
      });
    });

    expect(returned).toEqual(created);
    expect(invoke).toHaveBeenCalledWith('project:create', expect.objectContaining({ name: 'Fresh' }));
    const listCalls = invoke.mock.calls.filter((c) => c[0] === 'project:list');
    expect(listCalls).toHaveLength(2);

    await waitFor(() => {
      expect(result.current.projects).toEqual([created]);
    });
  });

  it('linkExternal invokes project:link-external, triggers refresh, returns project', async () => {
    const created = makeProject({ id: 'p-ext', kind: 'external' });
    const invoke = makeRouter({
      'project:list': () => ({ projects: [] }),
      'project:link-external': () => ({ project: created }),
    });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useProjects());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let returned: Project | undefined;
    await act(async () => {
      returned = await result.current.linkExternal({
        name: 'Ext',
        externalPath: '/tmp/ext',
        permissionMode: 'hybrid',
      });
    });

    expect(returned).toEqual(created);
    expect(invoke).toHaveBeenCalledWith(
      'project:link-external',
      expect.objectContaining({ externalPath: '/tmp/ext' }),
    );
    const listCalls = invoke.mock.calls.filter((c) => c[0] === 'project:list');
    expect(listCalls).toHaveLength(2);
  });

  it('importFolder invokes project:import, triggers refresh, returns project', async () => {
    const created = makeProject({ id: 'p-imp', kind: 'imported' });
    const invoke = makeRouter({
      'project:list': () => ({ projects: [] }),
      'project:import': () => ({ project: created }),
    });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useProjects());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let returned: Project | undefined;
    await act(async () => {
      returned = await result.current.importFolder({
        name: 'Imp',
        sourcePath: '/tmp/src',
        permissionMode: 'auto',
      });
    });

    expect(returned).toEqual(created);
    expect(invoke).toHaveBeenCalledWith(
      'project:import',
      expect.objectContaining({ sourcePath: '/tmp/src' }),
    );
    const listCalls = invoke.mock.calls.filter((c) => c[0] === 'project:list');
    expect(listCalls).toHaveLength(2);
  });

  it('archive invokes project:archive and triggers refresh', async () => {
    const invoke = makeRouter({
      'project:list': () => ({ projects: [] }),
      'project:archive': () => ({ success: true }),
    });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useProjects());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.archive('p-gone');
    });

    expect(invoke).toHaveBeenCalledWith('project:archive', { id: 'p-gone' });
    const listCalls = invoke.mock.calls.filter((c) => c[0] === 'project:list');
    expect(listCalls).toHaveLength(2);
  });

  it('mutation errors are re-thrown to the caller', async () => {
    const failure = new Error('folder missing');
    const invoke = makeRouter({
      'project:list': () => ({ projects: [] }),
      'project:create': () => {
        throw failure;
      },
    });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useProjects());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(
        result.current.createNew({
          name: 'x',
          kind: 'new',
          permissionMode: 'approval',
        }),
      ).rejects.toBe(failure);
    });
  });
});
