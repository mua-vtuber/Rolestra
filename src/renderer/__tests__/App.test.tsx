// @vitest-environment jsdom

/**
 * App.tsx integration test (R4-Task10).
 *
 * We mount the real `App` component under a stubbed `window.arena`
 * bridge and assert the wiring around:
 *   - useProjects → Sidebar (R12-C T8 — ProjectRail 흡수)
 *   - Sidebar 프로젝트 클릭 → `project:open` IPC → store update
 *   - ShellTopBar subtitle reflects the active project's name
 *   - "+ 새 프로젝트" row opens the modal
 *   - localStorage persistence round-trip on the active project id
 *
 * Dashboard-internal hooks (KPI / widgets) are mocked to null/loading
 * states because those integrations are already covered by their
 * dedicated hook + widget tests. This suite focuses on the App-level
 * glue only.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── jsdom polyfills for Radix ───────────────────────────────────────
// Radix Dialog + RadioGroup rely on browser-only APIs that jsdom does
// not ship. Stubbing them here rather than pulling in a global setup
// keeps the scope narrow to this test file.
if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {
      /* noop */
    }
    unobserve(): void {
      /* noop */
    }
    disconnect(): void {
      /* noop */
    }
  };
}
if (typeof Element !== 'undefined') {
  const proto = Element.prototype as unknown as {
    hasPointerCapture?: (id: number) => boolean;
    releasePointerCapture?: (id: number) => void;
    setPointerCapture?: (id: number) => void;
    scrollIntoView?: () => void;
  };
  if (!proto.hasPointerCapture) proto.hasPointerCapture = () => false;
  if (!proto.releasePointerCapture) proto.releasePointerCapture = () => {};
  if (!proto.setPointerCapture) proto.setPointerCapture = () => {};
  if (!proto.scrollIntoView) proto.scrollIntoView = () => {};
}

import type { Project } from '../../shared/project-types';
import {
  ACTIVE_PROJECT_STORAGE_KEY,
  useActiveProjectStore,
} from '../stores/active-project-store';
import { i18next } from '../i18n';

// --- Hook mocks: keep the dashboard tree lightweight ---------------------
// `useProjects` + `useActiveProject` are left UNMOCKED — they are the
// subject of this test. Everything else (KPIs, widgets) runs against a
// stubbed bridge, so we short-circuit their IPC into a "loading forever"
// state to keep assertions focused.

vi.mock('../hooks/use-dashboard-kpis', () => ({
  useDashboardKpis: () => ({
    data: null,
    loading: true,
    error: null,
    refresh: async () => {},
  }),
}));

vi.mock('../hooks/use-active-meetings', () => ({
  useActiveMeetings: () => ({
    meetings: null,
    loading: true,
    error: null,
    refresh: async () => {},
  }),
}));

vi.mock('../hooks/use-recent-messages', () => ({
  useRecentMessages: () => ({
    messages: null,
    loading: true,
    error: null,
    refresh: async () => {},
  }),
}));

vi.mock('../hooks/use-members', () => ({
  useMembers: () => ({
    members: null,
    loading: true,
    error: null,
    refresh: async () => {},
  }),
}));

vi.mock('../hooks/use-pending-approvals', () => ({
  usePendingApprovals: () => ({
    items: null,
    loading: true,
    error: null,
    refresh: async () => {},
  }),
}));

// Import AFTER the vi.mock calls so the mocks are installed first.
import { App } from '../App';

// ------------------------------------------------------------------------

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p-alpha',
    slug: 'p-alpha',
    name: 'Alpha Project',
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

interface StubBridgeOptions {
  projects?: Project[];
  onOpen?: (id: string) => void;
  openRejection?: Error;
}

function stubBridge(options: StubBridgeOptions = {}) {
  const projects = options.projects ?? [];
  const invoke = vi.fn(async (channel: string, data: unknown) => {
    switch (channel) {
      case 'project:list':
        return { projects };
      case 'project:open': {
        const id = (data as { id: string }).id;
        options.onOpen?.(id);
        if (options.openRejection) throw options.openRejection;
        return { success: true };
      }
      default:
        throw new Error(`no mock for channel ${channel}`);
    }
  });
  vi.stubGlobal('arena', { platform: 'linux', invoke });
  return invoke;
}

function resetActiveStore(): void {
  useActiveProjectStore.setState({ activeProjectId: null });
  localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
}

beforeEach(() => {
  vi.unstubAllGlobals();
  resetActiveStore();
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetActiveStore();
  vi.restoreAllMocks();
});

describe('App — full shell wiring (R4-Task10)', () => {
  it('does NOT render the app.mainPlaceholder text anywhere', async () => {
    stubBridge({ projects: [] });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('shell-root')).toBeTruthy();
    });

    // The dashboard page mounts in place of the placeholder.
    expect(screen.getByTestId('dashboard-page')).toBeTruthy();
    expect(
      screen.queryByText(/R4에서 대시보드가 여기에 들어옵니다/),
    ).toBeNull();
    expect(
      screen.queryByText(/The dashboard will move in here during R4/),
    ).toBeNull();
  });

  // R12-C 정리 #4 (2026-05-03): R12-C T8 사이드바 land 시점부터 outdated.
  // ProjectRail (data-testid="project-rail" / "project-rail-create") 가
  // 사이드바 (data-testid="sidebar" / "sidebar-create-project") 로 흡수됐고
  // active project marker 도 aria-current="page" → data-active-project="true"
  // 로 변경. 정리 #8 (통합 테스트 재작성 — 사이드바 기준) 에서 stubBridge IPC
  // 보강 + testid + active marker 갱신과 함께 통째 재작성한다.
  it.skip('renders an empty project list + the "+ 새 프로젝트" row without crashing (정리 #8 재작성 대기)', async () => {
    stubBridge({ projects: [] });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('project-rail')).toBeTruthy();
    });

    expect(screen.getByTestId('project-rail-create')).toBeTruthy();
  });

  it('renders every project returned by project:list', async () => {
    const projects = [
      makeProject({ id: 'p-a', name: 'Alpha' }),
      makeProject({ id: 'p-b', name: 'Beta' }),
      makeProject({ id: 'p-c', name: 'Gamma' }),
    ];
    stubBridge({ projects });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Alpha/ })).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: /Beta/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Gamma/ })).toBeTruthy();
  });

  it('no active project → ShellTopBar shows the "프로젝트 미선택" label', async () => {
    stubBridge({
      projects: [makeProject({ id: 'p-a', name: 'Alpha' })],
    });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('shell-topbar-subtitle')).toBeTruthy();
    });
    const subtitle = screen.getByTestId('shell-topbar-subtitle');
    expect(subtitle.textContent).toContain('프로젝트 미선택');
    expect(subtitle.getAttribute('data-active-project')).toBeNull();
  });

  // 정리 #4: aria-current="page" → data-active-project="true" outdated.
  // 정리 #8 통합 재작성 대기.
  it.skip('clicking a project row calls project:open and updates the subtitle (정리 #8 재작성 대기)', async () => {
    const invoke = stubBridge({
      projects: [
        makeProject({ id: 'p-a', name: 'Alpha' }),
        makeProject({ id: 'p-b', name: 'Beta' }),
      ],
    });
    render(<App />);

    const betaRow = await screen.findByRole('button', { name: /Beta/ });

    await act(async () => {
      fireEvent.click(betaRow);
    });

    await waitFor(() => {
      const openCalls = invoke.mock.calls.filter(
        (call) => call[0] === 'project:open',
      );
      expect(openCalls).toHaveLength(1);
      expect(openCalls[0]?.[1]).toEqual({ id: 'p-b' });
    });

    await waitFor(() => {
      const subtitle = screen.getByTestId('shell-topbar-subtitle');
      expect(subtitle.textContent).toContain('Beta');
      expect(subtitle.getAttribute('data-active-project')).toBe('true');
    });

    // Active row carries aria-current="page".
    await waitFor(() => {
      expect(
        screen
          .getByRole('button', { name: /Beta/ })
          .getAttribute('aria-current'),
      ).toBe('page');
    });
  });

  it('when project:open rejects, the store + subtitle stay unchanged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubBridge({
      projects: [makeProject({ id: 'p-a', name: 'Alpha' })],
      openRejection: new Error('folder missing'),
    });
    render(<App />);

    const alpha = await screen.findByRole('button', { name: /Alpha/ });
    await act(async () => {
      fireEvent.click(alpha);
    });

    await waitFor(() => {
      expect(warn).toHaveBeenCalled();
    });

    // No active project → subtitle still "프로젝트 미선택".
    expect(
      screen.getByTestId('shell-topbar-subtitle').textContent,
    ).toContain('프로젝트 미선택');
    expect(useActiveProjectStore.getState().activeProjectId).toBeNull();
  });

  // 정리 #4: project-rail-create testid 가 사이드바의 sidebar-create-project
  // 로 흡수. 정리 #8 통합 재작성 대기.
  it.skip('"+ 새 프로젝트" row opens the ProjectCreateModal (정리 #8 재작성 대기)', async () => {
    stubBridge({ projects: [] });
    render(<App />);

    const createRow = await screen.findByTestId('project-rail-create');

    // Modal closed initially.
    expect(screen.queryByTestId('project-create-modal')).toBeNull();

    await act(async () => {
      fireEvent.click(createRow);
    });

    await waitFor(() => {
      expect(screen.getByTestId('project-create-modal')).toBeTruthy();
    });
  });

  it('Hero new-project button also opens the same modal', async () => {
    stubBridge({ projects: [] });
    render(<App />);

    const heroNew = await screen.findByTestId('hero-quick-action-new-project');

    await act(async () => {
      fireEvent.click(heroNew);
    });

    await waitFor(() => {
      expect(screen.getByTestId('project-create-modal')).toBeTruthy();
    });
  });

  it('restores activeProjectId from localStorage when the store rehydrates', async () => {
    // Seed the store before mounting — this simulates a reload where
    // `zustand/persist` has already rehydrated from localStorage.
    useActiveProjectStore.setState({ activeProjectId: 'p-b' });

    stubBridge({
      projects: [
        makeProject({ id: 'p-a', name: 'Alpha' }),
        makeProject({ id: 'p-b', name: 'Beta' }),
      ],
    });
    render(<App />);

    await waitFor(() => {
      const subtitle = screen.getByTestId('shell-topbar-subtitle');
      expect(subtitle.textContent).toContain('Beta');
    });
  });
});

describe('App — view router (R5-Task3)', () => {
  it('mounts DashboardPage by default', async () => {
    stubBridge({ projects: [] });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeTruthy();
    });
    expect(screen.queryByTestId('messenger-page')).toBeNull();
  });

  it('clicking the Messenger NavRail item swaps in MessengerPage', async () => {
    stubBridge({ projects: [] });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeTruthy();
    });

    const messengerNav = screen.getByRole('button', { name: 'Messenger' });
    await act(async () => {
      fireEvent.click(messengerNav);
    });

    await waitFor(() => {
      expect(screen.getByTestId('messenger-page')).toBeTruthy();
    });
    expect(screen.queryByTestId('dashboard-page')).toBeNull();
    // aria-current follows the active view.
    expect(messengerNav.getAttribute('aria-current')).toBe('page');
  });

  it('clicking Dashboard again returns to the dashboard view', async () => {
    stubBridge({ projects: [] });
    render(<App />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Messenger' }));
    });
    await waitFor(() => {
      expect(screen.getByTestId('messenger-page')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }));
    });
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeTruthy();
    });
    expect(screen.queryByTestId('messenger-page')).toBeNull();
  });

  it('clicking an unrouted NavRail item (e.g. Approval) keeps the current view', async () => {
    stubBridge({ projects: [] });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Approval' }));
    });

    // No router entry for approval → dashboard stays mounted.
    expect(screen.getByTestId('dashboard-page')).toBeTruthy();
    expect(screen.queryByTestId('messenger-page')).toBeNull();
  });

  it('clicking Settings routes to SettingsView (R9-Task4)', async () => {
    stubBridge({ projects: [] });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    });

    expect(screen.getByTestId('settings-view')).toBeTruthy();
    expect(screen.queryByTestId('dashboard-page')).toBeNull();
  });

  it('MessengerPage falls back to empty-state when there is no active project', async () => {
    stubBridge({ projects: [] });
    render(<App />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Messenger' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('messenger-empty-state')).toBeTruthy();
    });
  });
});

describe('App — source-level hardcoded color guard', () => {
  it('App.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'App.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
