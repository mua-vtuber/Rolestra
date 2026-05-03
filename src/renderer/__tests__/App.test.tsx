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

import type { Channel } from '../../shared/channel-types';
import type { DmSummary } from '../../shared/dm-types';
import type { Project } from '../../shared/project-types';
import {
  ACTIVE_PROJECT_STORAGE_KEY,
  useActiveProjectStore,
} from '../stores/active-project-store';
import { useSidebarStore } from '../stores/sidebar-store';
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
  /**
   * R12-C 정리 #8 — 사이드바 ProjectAccordion 디폴트 펼침 상태에서
   * 각 프로젝트의 `useChannels(projectId)` 가 즉시 `channel:list({projectId})`
   * 를 호출한다. 미지정 시 빈 배열로 응답해 사이드바가 free-channels-empty
   * 안내만 띄우게 된다.
   */
  channelsByProject?: Record<string, Channel[]>;
  /** Sidebar 상단 GeneralChannelEntry 가 호출하는 channel:get-global-general 응답. */
  globalGeneralChannel?: Channel | null;
  /** Sidebar 하단 DmListView 가 호출하는 dm:list 응답. */
  dmSummaries?: DmSummary[];
}

function stubBridge(options: StubBridgeOptions = {}) {
  const projects = options.projects ?? [];
  const channelsByProject = options.channelsByProject ?? {};
  const globalGeneralChannel = options.globalGeneralChannel ?? null;
  const dmSummaries = options.dmSummaries ?? [];
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
      case 'channel:get-global-general':
        return { channel: globalGeneralChannel };
      case 'channel:list': {
        // R12-C: useChannels({projectId}) + useDms({projectId:null}) 둘 다
        // 같은 IPC 채널을 공유. projectId === null 이면 DM 만 (Sidebar 의
        // useDms 가 호출 — DmListView 는 useDmSummaries 만 쓰지만 useDms 가
        // MessengerPage 안쪽에서도 호출될 수 있어 안전하게 빈 배열 반환).
        const projectId = (data as { projectId: string | null }).projectId;
        if (projectId === null) return { channels: [] };
        return { channels: channelsByProject[projectId] ?? [] };
      }
      case 'dm:list':
        return { items: dmSummaries };
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
  // sidebar-store 의 펼침/접힘 토글이 it 간 leak 되지 않도록 리셋. 디폴트
  // = `projectExpanded: {}` (모든 키 펼침 default).
  useSidebarStore.setState({ projectExpanded: {} });
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

  // R12-C 정리 #8 (2026-05-03): R12-C T8 통합 사이드바 기준 재작성.
  // 옛 ProjectRail (`project-rail` / `project-rail-create`) 은 정리 #3 에서
  // 삭제됐고 Sidebar (`sidebar` + `sidebar-create-project` + `sidebar-projects-empty`)
  // 가 그 자리를 흡수했다.
  it('renders the sidebar with "+ 새 프로젝트" button + empty notice when there are no projects', async () => {
    stubBridge({ projects: [] });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('sidebar')).toBeTruthy();
    });

    expect(screen.getByTestId('sidebar-create-project')).toBeTruthy();
    expect(screen.getByTestId('sidebar-projects-empty')).toBeTruthy();
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

  // R12-C 정리 #8 (2026-05-03): 사이드바 ProjectAccordion 헤더 클릭 흐름.
  // 옛 ProjectRail row (`button[name=Beta]`) → `sidebar-project-header-${id}` 로 갱신.
  // Active marker 도 `aria-current="page"` → `data-active-project="true"` 로 변경.
  it('clicking a project header calls project:open and updates subtitle + sidebar active marker', async () => {
    const invoke = stubBridge({
      projects: [
        makeProject({ id: 'p-a', name: 'Alpha' }),
        makeProject({ id: 'p-b', name: 'Beta' }),
      ],
    });
    render(<App />);

    const betaHeader = await screen.findByTestId('sidebar-project-header-p-b');

    await act(async () => {
      fireEvent.click(betaHeader);
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

    // Active project section carries data-active-project='true'.
    await waitFor(() => {
      expect(
        screen
          .getByTestId('sidebar-project-p-b')
          .getAttribute('data-active-project'),
      ).toBe('true');
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

  // R12-C 정리 #8 (2026-05-03): "+ 새 프로젝트" 버튼이 ProjectRail →
  // Sidebar 로 hoist (`project-rail-create` → `sidebar-create-project`).
  it('"+ 새 프로젝트" button opens the ProjectCreateModal', async () => {
    stubBridge({ projects: [] });
    render(<App />);

    const createBtn = await screen.findByTestId('sidebar-create-project');

    // Modal closed initially.
    expect(screen.queryByTestId('project-create-modal')).toBeNull();

    await act(async () => {
      fireEvent.click(createBtn);
    });

    await waitFor(() => {
      expect(screen.getByTestId('project-create-modal')).toBeTruthy();
    });
  });

  // R12-C 정리 #8 (2026-05-03): MessengerPage.test.tsx line 133 의 옛
  // "+ 새 채널" 흐름을 사이드바 기준으로 흡수. 트리거가 ChannelRail 의
  // `channel-rail-create` → ProjectAccordion 의 `sidebar-project-create-channel-${id}`
  // 로 hoist 됐다 (App.tsx 가 ChannelCreateModal 을 host).
  it('"+ 새 채널" inside an expanded project opens the ChannelCreateModal', async () => {
    stubBridge({
      projects: [makeProject({ id: 'p-a', name: 'Alpha' })],
      channelsByProject: { 'p-a': [] },
    });
    render(<App />);

    // ProjectAccordion 디폴트 = 펼침 → "+ 새 채널" 버튼이 즉시 mount.
    const createChannelBtn = await screen.findByTestId(
      'sidebar-project-create-channel-p-a',
    );

    // Modal closed initially.
    expect(screen.queryByTestId('channel-create-modal')).toBeNull();

    await act(async () => {
      fireEvent.click(createChannelBtn);
    });

    await waitFor(() => {
      expect(screen.getByTestId('channel-create-modal')).toBeTruthy();
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
