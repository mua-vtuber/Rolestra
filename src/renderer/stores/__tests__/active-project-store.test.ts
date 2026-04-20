// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import {
  ACTIVE_PROJECT_STORAGE_KEY,
  useActiveProjectStore,
} from '../active-project-store';

function resetStore(): void {
  useActiveProjectStore.setState({ activeProjectId: null });
  localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
}

describe('active-project-store', () => {
  beforeEach(() => {
    resetStore();
  });

  it('persist key is literally "rolestra.activeProject.v1"', () => {
    expect(ACTIVE_PROJECT_STORAGE_KEY).toBe('rolestra.activeProject.v1');
  });

  it('initial state has activeProjectId=null', () => {
    expect(useActiveProjectStore.getState().activeProjectId).toBeNull();
  });

  it('setActiveProjectId updates the store', () => {
    useActiveProjectStore.getState().setActiveProjectId('p-123');
    expect(useActiveProjectStore.getState().activeProjectId).toBe('p-123');
  });

  it('setActiveProjectId accepts null (clear-equivalent)', () => {
    useActiveProjectStore.getState().setActiveProjectId('p-1');
    expect(useActiveProjectStore.getState().activeProjectId).toBe('p-1');

    useActiveProjectStore.getState().setActiveProjectId(null);
    expect(useActiveProjectStore.getState().activeProjectId).toBeNull();
  });

  it('persists only activeProjectId to localStorage under the literal key', () => {
    useActiveProjectStore.getState().setActiveProjectId('p-persist');

    const raw = localStorage.getItem('rolestra.activeProject.v1');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw ?? '{}') as { state: Record<string, unknown> };
    expect(parsed.state).toEqual({ activeProjectId: 'p-persist' });
  });
});
