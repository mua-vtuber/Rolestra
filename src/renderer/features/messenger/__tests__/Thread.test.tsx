// @vitest-environment jsdom

/**
 * Thread (R5-Task5) — active-channel 분기 + ChannelHeader 통합.
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

import { Thread } from '../Thread';
import { i18next } from '../../../i18n';
import { ThemeProvider } from '../../../theme/theme-provider';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  useThemeStore,
} from '../../../theme/theme-store';
import {
  ACTIVE_CHANNEL_STORAGE_KEY,
  useActiveChannelStore,
} from '../../../stores/active-channel-store';
import type { Channel } from '../../../../shared/channel-types';
import type { ActiveMeetingSummary } from '../../../../shared/meeting-types';
import type { MemberView } from '../../../../shared/member-profile-types';
import type {
  StreamEventType,
  StreamV3PayloadOf,
} from '../../../../shared/stream-events';

const PROJECT_ID = 'p-a';
type StreamHandler = (payload: unknown) => void;

function createStreamStub() {
  const handlers = new Map<StreamEventType, Set<StreamHandler>>();

  function onStream<T extends StreamEventType>(
    type: T,
    cb: (payload: StreamV3PayloadOf<T>) => void,
  ): () => void {
    const existing = handlers.get(type);
    const set = existing ?? new Set<StreamHandler>();
    if (!existing) {
      handlers.set(type, set);
    }
    set.add(cb as StreamHandler);
    return () => {
      set.delete(cb as StreamHandler);
    };
  }

  function emit<T extends StreamEventType>(
    type: T,
    payload: StreamV3PayloadOf<T>,
  ): void {
    const set = handlers.get(type);
    if (!set) return;
    for (const cb of set) cb(payload);
  }

  return { onStream, emit };
}

function makeChannel(overrides: Partial<Channel>): Channel {
  return {
    id: 'c-generic',
    projectId: PROJECT_ID,
    name: 'generic',
    kind: 'user',
    readOnly: false,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeMember(id: string): MemberView {
  return {
    providerId: id,
    displayName: id,
    avatarColor: '#123456',
    role: 'member',
    status: 'active',
    personality: null,
    expertise: [],
  } as unknown as MemberView;
}

interface StubOptions {
  channels?: Channel[];
  dms?: Channel[];
  meetings?: ActiveMeetingSummary[];
  members?: MemberView[];
  messages?: Array<Record<string, unknown>>;
  stream?: ReturnType<typeof createStreamStub>;
}

function stubBridge(options: StubOptions = {}) {
  const channels = options.channels ?? [];
  const dms = options.dms ?? [];
  const meetings = options.meetings ?? [];
  const members = options.members ?? [];
  const messages = options.messages ?? [];
  const invoke = vi.fn(async (channel: string, data: unknown) => {
    if (channel === 'channel:list') {
      const payload = data as { projectId: string | null };
      return payload.projectId === null
        ? { channels: dms }
        : { channels };
    }
    if (channel === 'member:list') return { members };
    if (channel === 'meeting:list-active') return { meetings };
    if (channel === 'message:list-by-channel') return { messages };
    if (channel === 'planning-design-check:decide') {
      const payload = data as { checkId: string; decision: string };
      return {
        check: {
          id: payload.checkId,
          projectId: PROJECT_ID,
          sourceDesignMeetingId: 'meeting-design',
          designChannelId: 'c-design',
          designChannelRole: 'design.ui',
          planningChannelId: 'c-planning',
          implementationChannelId: 'c-implement',
          requestTitle: '디자인 검수 요청서',
          requestBody: '# 디자인 검수 요청서',
          finalDesignMinutesPath: '/tmp/final.md',
          finalDesignMinutesBody: '# final design',
          snapshotDesktopPath: null,
          snapshotMobilePath: null,
          wireframeCheckpointsJson: '[]',
          wireframeUserNotesJson: '[]',
          workBundleKey: 'planning-minutes:planning-meeting',
          originalPlanningMinutesId: 'planning-meeting',
          originalPlanningMinutesPath: '/tmp/planning.md',
          originalPlanningMinutesBody: '# planning',
          originalPlanningMinutesMissingReason: null,
          returnCount: 1,
          verdict: 'misaligned',
          status: 'needs_user_decision',
          reason: '두 번째 검수에서도 의도와 다름',
          revisionDirection: '정보 밀도 조정',
          implementationDispatchId: null,
          designReturnDispatchId: null,
          userDecision: payload.decision,
          userDecisionNote: null,
          userDecisionDispatchId: null,
          payloadJson: null,
          createdAt: 1,
          decidedAt: 2,
        },
        dispatchRowId: null,
      };
    }
    throw new Error(`no mock for channel ${channel}`);
  });
  vi.stubGlobal('arena', {
    platform: 'linux',
    invoke,
    onStream: options.stream?.onStream ?? (() => () => undefined),
  });
  return invoke;
}

function resetStores(): void {
  useActiveChannelStore.setState({ channelIdByProject: {} });
  localStorage.removeItem(ACTIVE_CHANNEL_STORAGE_KEY);
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
}

function renderThread(ui: React.ReactElement): ReturnType<typeof render> {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

beforeEach(() => {
  vi.unstubAllGlobals();
  resetStores();
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
  resetStores();
  vi.unstubAllGlobals();
});

describe('Thread — empty state when no active channel', () => {
  it('renders empty-state when active channel id is unset', async () => {
    stubBridge({ channels: [makeChannel({ id: 'c-plan', name: '기획' })] });
    renderThread(<Thread projectId={PROJECT_ID} />);

    await waitFor(() =>
      expect(screen.getByTestId('thread').getAttribute('data-empty')).toBe('true'),
    );
    expect(screen.getByTestId('thread-empty-state').textContent).toContain(
      '채널을 선택',
    );
  });

  it('renders empty-state when memorised channel no longer exists (pruned list)', async () => {
    // Pre-set active channel to an id that is NOT in the fresh list → the
    // validation effect of useActiveChannel will clear it and Thread
    // should show empty-state.
    useActiveChannelStore.setState({
      channelIdByProject: { [PROJECT_ID]: 'c-gone' },
    });
    stubBridge({ channels: [makeChannel({ id: 'c-plan', name: '기획' })] });
    renderThread(<Thread projectId={PROJECT_ID} />);

    await waitFor(() =>
      expect(screen.getByTestId('thread').getAttribute('data-empty')).toBe('true'),
    );
  });
});

describe('Thread — renders ChannelHeader when a user channel is active', () => {
  it('mounts ChannelHeader with channel name; meeting buttons live in the sidebar (R12)', async () => {
    useActiveChannelStore.setState({
      channelIdByProject: { [PROJECT_ID]: 'c-plan' },
    });
    stubBridge({
      channels: [
        makeChannel({ id: 'c-plan', name: '기획', kind: 'user' }),
        makeChannel({ id: 'c-ref', name: '리팩토링', kind: 'user' }),
      ],
      members: [makeMember('a'), makeMember('b')],
      meetings: [],
    });
    renderThread(<Thread projectId={PROJECT_ID} />);

    await waitFor(() =>
      expect(screen.getByTestId('channel-header-name').textContent).toBe('기획'),
    );
    const thread = screen.getByTestId('thread');
    expect(thread.getAttribute('data-empty')).toBe('false');
    expect(thread.getAttribute('data-channel-id')).toBe('c-plan');

    // R12 dogfooding: 회의 시작 / 중단 버튼은 좌측 ChannelMeetingControl
    // 로 이전. ChannelHeader 는 더 이상 렌더하지 않음.
    expect(screen.queryByTestId('channel-header-start-meeting')).toBeNull();
    expect(screen.queryByTestId('channel-header-abort-meeting')).toBeNull();
  });

  it('does NOT render an abort-meeting button in the header even with an active meeting (R12 — sidebar owns it)', async () => {
    useActiveChannelStore.setState({
      channelIdByProject: { [PROJECT_ID]: 'c-plan' },
    });
    stubBridge({
      channels: [makeChannel({ id: 'c-plan', name: '기획', kind: 'user' })],
      members: [makeMember('a')],
      meetings: [
        {
          id: 'm-1',
          projectId: PROJECT_ID,
          projectName: 'P',
          channelId: 'c-plan',
          channelName: '기획',
          topic: 'n+1',
          stateIndex: 1,
          stateName: 'WORK_DISCUSSING',
          startedAt: 1_700_000_000_000,
          elapsedMs: 60_000,
        } as ActiveMeetingSummary,
      ],
    });
    renderThread(<Thread projectId={PROJECT_ID} />);

    await waitFor(() =>
      expect(screen.getByTestId('channel-header-name').textContent).toBe('기획'),
    );
    expect(screen.queryByTestId('channel-header-abort-meeting')).toBeNull();
    expect(screen.queryByTestId('channel-header-start-meeting')).toBeNull();
  });
});

describe('Thread — planning design check card', () => {
  it('shows 사용자 판단 필요 without official approval/rejection wording', async () => {
    useActiveChannelStore.setState({
      channelIdByProject: { [PROJECT_ID]: 'c-design' },
    });
    const invoke = stubBridge({
      channels: [makeChannel({ id: 'c-design', name: '디자인', kind: 'user' })],
      messages: [
        {
          id: 'm-planning-design-check',
          channelId: 'c-design',
          meetingId: 'meeting-design',
          authorId: 'system',
          authorKind: 'system',
          role: 'system',
          content: '사용자 판단 필요',
          createdAt: 1_700_000_000_000,
          meta: {
            planningDesignCheck: {
              id: 'check-1',
              status: 'needs_user_decision',
              verdict: 'misaligned',
              returnCount: 1,
              sourceDesignMeetingId: 'meeting-design',
              designChannelId: 'c-design',
              planningChannelId: 'c-planning',
              implementationChannelId: 'c-implement',
              reason: '두 번째 검수에서도 의도와 다름',
            },
          },
        },
      ],
    });
    renderThread(<Thread projectId={PROJECT_ID} />);

    await waitFor(() =>
      expect(screen.getByTestId('planning-design-check-card')).toBeTruthy(),
    );
    expect(screen.getAllByText('사용자 판단 필요').length).toBeGreaterThan(0);
    expect(
      screen.getByTestId(
        'planning-design-check-decision-send_to_implementation',
      ).textContent,
    ).toContain('구현으로 보내기');
    fireEvent.click(
      screen.getByTestId(
        'planning-design-check-decision-send_to_implementation',
      ),
    );
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('planning-design-check:decide', {
        checkId: 'check-1',
        decision: 'send_to_implementation',
        userNote: '',
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('planning-design-check-status').textContent).toBe(
        '사용자 판단 완료',
      ),
    );
    expect(
      screen.getByTestId('planning-design-check-user-decision').textContent,
    ).toContain('구현으로 보내기');
    expect(
      screen.queryByTestId(
        'planning-design-check-decision-send_to_implementation',
      ),
    ).toBeNull();
    expect(screen.queryByText('승인')).toBeNull();
    expect(screen.queryByText('반려')).toBeNull();
  });

  it('오래된 pending meta라도 최신 사용자 판단이 있으면 버튼을 다시 보이지 않는다', async () => {
    useActiveChannelStore.setState({
      channelIdByProject: { [PROJECT_ID]: 'c-design' },
    });
    const staleCheckMessage = {
      id: 'm-planning-design-check',
      channelId: 'c-design',
      meetingId: 'meeting-design',
      authorId: 'system',
      authorKind: 'system',
      role: 'system',
      content: '사용자 판단 필요',
      createdAt: 1_700_000_000_000,
      meta: {
        planningDesignCheck: {
          id: 'check-1',
          status: 'needs_user_decision',
          verdict: 'misaligned',
          returnCount: 1,
          sourceDesignMeetingId: 'meeting-design',
          designChannelId: 'c-design',
          planningChannelId: 'c-planning',
          implementationChannelId: 'c-implement',
          reason: '두 번째 검수에서도 의도와 다름',
          userDecision: null,
        },
      },
    };
    const invoke = stubBridge({
      channels: [makeChannel({ id: 'c-design', name: '디자인', kind: 'user' })],
      messages: [staleCheckMessage],
    });
    invoke.mockImplementation(async (channel: string, data: unknown) => {
      if (channel === 'channel:list') {
        const payload = data as { projectId: string | null };
        return payload.projectId === null
          ? { channels: [] }
          : { channels: [makeChannel({ id: 'c-design', name: '디자인', kind: 'user' })] };
      }
      if (channel === 'member:list') return { members: [] };
      if (channel === 'meeting:list-active') return { meetings: [] };
      if (channel === 'message:list-by-channel') {
        return { messages: [staleCheckMessage] };
      }
      if (channel === 'planning-design-check:get') {
        return {
          item: {
            id: 'check-1',
            projectId: PROJECT_ID,
            sourceDesignMeetingId: 'meeting-design',
            designChannelId: 'c-design',
            designChannelRole: 'design.ui',
            planningChannelId: 'c-planning',
            implementationChannelId: 'c-implement',
            requestTitle: '디자인 검수 요청서',
            requestBody: '# 디자인 검수 요청서',
            finalDesignMinutesPath: '/tmp/final.md',
            finalDesignMinutesBody: '# final design',
            snapshotDesktopPath: null,
            snapshotMobilePath: null,
            wireframeCheckpointsJson: '[]',
            wireframeUserNotesJson: '[]',
            workBundleKey: 'planning-minutes:planning-meeting',
            originalPlanningMinutesId: 'planning-meeting',
            originalPlanningMinutesPath: '/tmp/planning.md',
            originalPlanningMinutesBody: '# planning',
            originalPlanningMinutesMissingReason: null,
            returnCount: 1,
            verdict: 'misaligned',
            status: 'needs_user_decision',
            reason: '두 번째 검수에서도 의도와 다름',
            revisionDirection: '정보 밀도 조정',
            implementationDispatchId: null,
            designReturnDispatchId: null,
            userDecision: 'stop',
            userDecisionNote: null,
            userDecisionDispatchId: null,
            payloadJson: null,
            createdAt: 1,
            decidedAt: 2,
          },
        };
      }
      throw new Error(`no mock for channel ${channel}`);
    });

    renderThread(<Thread projectId={PROJECT_ID} />);

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('planning-design-check:get', {
        checkId: 'check-1',
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('planning-design-check-status').textContent).toBe(
        '사용자 판단 완료',
      ),
    );
    expect(
      screen.getByTestId('planning-design-check-user-decision').textContent,
    ).toContain('진행 중지');
    expect(
      screen.queryByTestId(
        'planning-design-check-decision-send_to_implementation',
      ),
    ).toBeNull();
  });
});

describe('Thread — MeetingBanner wire-up (Task 7)', () => {
  it('renders MeetingBanner when an active meeting exists in the channel', async () => {
    useActiveChannelStore.setState({
      channelIdByProject: { [PROJECT_ID]: 'c-plan' },
    });
    stubBridge({
      channels: [makeChannel({ id: 'c-plan', name: '기획', kind: 'user' })],
      members: [makeMember('a'), makeMember('b')],
      meetings: [
        {
          id: 'm-1',
          projectId: PROJECT_ID,
          projectName: 'P',
          channelId: 'c-plan',
          channelName: '기획',
          topic: 'r5 task 7',
          stateIndex: 2,
          stateName: 'WORK_DISCUSSING',
          startedAt: 1_700_000_000_000,
          elapsedMs: 3 * 60_000,
        } as ActiveMeetingSummary,
      ],
    });
    renderThread(<Thread projectId={PROJECT_ID} />);

    await waitFor(() =>
      expect(screen.getByTestId('meeting-banner')).toBeTruthy(),
    );
    expect(screen.getByTestId('meeting-banner').getAttribute('data-meeting-id')).toBe(
      'm-1',
    );
    expect(screen.getByTestId('meeting-banner-topic').textContent).toBe(
      'r5 task 7',
    );
  });

  it('does not render MeetingBanner when no active meeting for this channel', async () => {
    useActiveChannelStore.setState({
      channelIdByProject: { [PROJECT_ID]: 'c-plan' },
    });
    stubBridge({
      channels: [makeChannel({ id: 'c-plan', name: '기획', kind: 'user' })],
      members: [makeMember('a')],
      meetings: [],
    });
    renderThread(<Thread projectId={PROJECT_ID} />);

    await waitFor(() =>
      expect(screen.getByTestId('channel-header')).toBeTruthy(),
    );
    expect(screen.queryByTestId('meeting-banner')).toBeNull();
  });
});

describe('Thread — idea pick snapshot wire-up', () => {
  it('renders the idea pick card when the active channel receives a snapshot', async () => {
    const stream = createStreamStub();
    useActiveChannelStore.setState({
      channelIdByProject: { [PROJECT_ID]: 'c-idea' },
    });
    stubBridge({
      channels: [
        makeChannel({
          id: 'c-idea',
          name: '아이디어',
          kind: 'user',
          role: 'idea',
        }),
      ],
      members: [makeMember('codex')],
      meetings: [
        {
          id: 'm-idea',
          projectId: PROJECT_ID,
          projectName: 'P',
          channelId: 'c-idea',
          channelName: '아이디어',
          topic: '새 프로젝트 방향',
          stateIndex: 2,
          stateName: 'awaiting_user_pick',
          startedAt: 1_700_000_000_000,
          elapsedMs: 30_000,
        } as ActiveMeetingSummary,
      ],
      messages: [],
      stream,
    });

    renderThread(<Thread projectId={PROJECT_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId('channel-header-name').textContent).toBe(
        '아이디어',
      ),
    );

    act(() => {
      stream.emit('stream:idea-pick-snapshot', {
        meetingId: 'm-idea',
        channelId: 'c-idea',
        selectedScreenIds: ['ITEM_001'],
        cards: [
          {
            uuid: 'op-1',
            screenId: 'ITEM_001',
            title: '선택된 아이디어',
            content: '기획으로 넘길 수 있는 후보',
            rationale: '사용자 선택 유지 확인',
            authorLabel: 'codex_1',
          },
        ],
      });
    });

    await waitFor(() =>
      expect(screen.getByTestId('idea-pick-card').textContent).toContain(
        '선택된 아이디어',
      ),
    );
    expect(screen.getByTestId('idea-pick-kept-list').textContent).toContain(
      '선택된 아이디어',
    );
  });

  it('hides a stale idea pick snapshot when the active meeting is no longer awaiting_user_pick', async () => {
    const stream = createStreamStub();
    useActiveChannelStore.setState({
      channelIdByProject: { [PROJECT_ID]: 'c-idea' },
    });
    stubBridge({
      channels: [
        makeChannel({
          id: 'c-idea',
          name: '아이디어',
          kind: 'user',
          role: 'idea',
        }),
      ],
      members: [makeMember('codex')],
      meetings: [
        {
          id: 'm-idea',
          projectId: PROJECT_ID,
          projectName: 'P',
          channelId: 'c-idea',
          channelName: '아이디어',
          topic: '새 프로젝트 방향',
          stateIndex: 3,
          stateName: 'compose_minutes',
          startedAt: 1_700_000_000_000,
          elapsedMs: 60_000,
        } as ActiveMeetingSummary,
      ],
      messages: [],
      stream,
    });

    renderThread(<Thread projectId={PROJECT_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId('channel-header-name').textContent).toBe(
        '아이디어',
      ),
    );

    act(() => {
      stream.emit('stream:idea-pick-snapshot', {
        meetingId: 'm-idea',
        channelId: 'c-idea',
        selectedScreenIds: ['ITEM_001'],
        cards: [
          {
            uuid: 'op-1',
            screenId: 'ITEM_001',
            title: '오래된 아이디어',
            content: '이미 끝난 회의의 선택 카드',
            rationale: '회의 상태가 다르면 숨겨야 함',
            authorLabel: 'codex_1',
          },
        ],
      });
    });

    expect(screen.queryByTestId('idea-pick-card')).toBeNull();
  });
});

describe('Thread — meeting review notice wire-up', () => {
  it('opens the review panel and reject modal from the review notice card', async () => {
    useActiveChannelStore.setState({
      channelIdByProject: { [PROJECT_ID]: 'c-plan' },
    });
    const reviewMessage = {
      id: 'msg-review',
      channelId: 'c-plan',
      meetingId: 'm-plan',
      authorId: 'system',
      authorKind: 'system',
      role: 'system',
      content: '기획 회의록이 준비되었습니다.',
      meta: {
        reviewGate: {
          id: 'review-1',
          kind: 'planning_minutes',
          status: 'pending',
          sourceChannelId: 'c-plan',
          targetChannelId: 'c-design',
          targetRole: 'design.ux',
          title: '기획 회의록',
        },
      },
      createdAt: 1_700_000_000_000,
    };
    const invoke = stubBridge({
      channels: [
        makeChannel({
          id: 'c-plan',
          name: '기획',
          kind: 'user',
          role: 'planning',
        }),
      ],
      members: [makeMember('planner')],
      meetings: [],
      messages: [reviewMessage],
    });
    invoke.mockImplementation(async (channel: string, data: unknown) => {
      if (channel === 'channel:list') {
        const payload = data as { projectId: string | null };
        return payload.projectId === null
          ? { channels: [] }
          : {
              channels: [
                makeChannel({
                  id: 'c-plan',
                  name: '기획',
                  kind: 'user',
                  role: 'planning',
                }),
              ],
            };
      }
      if (channel === 'member:list') return { members: [makeMember('planner')] };
      if (channel === 'meeting:list-active') return { meetings: [] };
      if (channel === 'message:list-by-channel') return { messages: [reviewMessage] };
      if (channel === 'meeting-review:get') {
        return {
          item: {
            id: 'review-1',
            projectId: PROJECT_ID,
            meetingId: 'm-plan',
            sourceChannelId: 'c-plan',
            targetChannelId: 'c-design',
            targetRole: 'design.ux',
            kind: 'planning_minutes',
            status: 'pending',
            title: '기획 회의록',
            documentPath: '/tmp/minutes.md',
            documentBodySnapshot: '# 기획 회의록\n본문',
            userNote: null,
            payloadJson: '{}',
            createdAt: 1,
            decidedAt: null,
          },
        };
      }
      if (channel === 'meeting-review:decide') {
        return {
          review: {
            id: 'review-1',
            projectId: PROJECT_ID,
            meetingId: 'm-plan',
            sourceChannelId: 'c-plan',
            targetChannelId: 'c-design',
            targetRole: 'design.ux',
            kind: 'planning_minutes',
            status: 'stopped',
            title: '기획 회의록',
            documentPath: '/tmp/minutes.md',
            documentBodySnapshot: '# 기획 회의록\n본문',
            userNote: null,
            payloadJson: '{}',
            createdAt: 1,
            decidedAt: 2,
          },
          dispatchRowId: null,
          followUpRequired: false,
        };
      }
      throw new Error(`no mock for channel ${channel}`);
    });

    renderThread(<Thread projectId={PROJECT_ID} />);

    await waitFor(() =>
      expect(screen.getByTestId('message-card-action-review-open')).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId('message-card-action-review-open'));

    await waitFor(() =>
      expect(screen.getByTestId('meeting-review-document').textContent).toContain(
        '기획 회의록',
      ),
    );
    expect(screen.getByTestId('meeting-review-approve')).toBeTruthy();

    fireEvent.click(screen.getByTestId('meeting-review-reject'));
    await waitFor(() =>
      expect(screen.getByTestId('meeting-review-reject-stop')).toBeTruthy(),
    );
    expect(screen.queryByTestId('meeting-review-reject-restart')).toBeNull();
    fireEvent.click(screen.getByTestId('meeting-review-reject-stop'));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('meeting-review:decide', {
        reviewId: 'review-1',
        decision: 'stop',
        userNote: '',
      }),
    );
    await waitFor(() => {
      const reviewButton = screen.getByTestId(
        'message-card-action-review-open',
      ) as HTMLButtonElement;
      expect(reviewButton.disabled).toBe(true);
      expect(reviewButton.textContent).toContain('결정 완료');
    });
  });

  it('오래된 pending 회의록 검토 카드도 최신 상태가 완료면 새 결정을 열지 않는다', async () => {
    useActiveChannelStore.setState({
      channelIdByProject: { [PROJECT_ID]: 'c-plan' },
    });
    const reviewMessage = {
      id: 'msg-review',
      channelId: 'c-plan',
      meetingId: 'm-plan',
      authorId: 'system',
      authorKind: 'system',
      role: 'system',
      content: '기획 회의록이 준비되었습니다.',
      meta: {
        reviewGate: {
          id: 'review-1',
          kind: 'planning_minutes',
          status: 'pending',
          sourceChannelId: 'c-plan',
          targetChannelId: 'c-design',
          targetRole: 'design.ux',
          title: '기획 회의록',
        },
      },
      createdAt: 1_700_000_000_000,
    };
    const invoke = stubBridge({
      channels: [
        makeChannel({
          id: 'c-plan',
          name: '기획',
          kind: 'user',
          role: 'planning',
        }),
      ],
      messages: [reviewMessage],
    });
    invoke.mockImplementation(async (channel: string, data: unknown) => {
      if (channel === 'channel:list') {
        const payload = data as { projectId: string | null };
        return payload.projectId === null
          ? { channels: [] }
          : {
              channels: [
                makeChannel({
                  id: 'c-plan',
                  name: '기획',
                  kind: 'user',
                  role: 'planning',
                }),
              ],
            };
      }
      if (channel === 'member:list') return { members: [] };
      if (channel === 'meeting:list-active') return { meetings: [] };
      if (channel === 'message:list-by-channel') return { messages: [reviewMessage] };
      if (channel === 'meeting-review:get') {
        return {
          item: {
            id: 'review-1',
            projectId: PROJECT_ID,
            meetingId: 'm-plan',
            sourceChannelId: 'c-plan',
            targetChannelId: 'c-design',
            targetRole: 'design.ux',
            kind: 'planning_minutes',
            status: 'approved',
            title: '기획 회의록',
            documentPath: '/tmp/minutes.md',
            documentBodySnapshot: '# 기획 회의록\n본문',
            userNote: null,
            payloadJson: '{}',
            createdAt: 1,
            decidedAt: 2,
          },
        };
      }
      throw new Error(`no mock for channel ${channel}`);
    });

    renderThread(<Thread projectId={PROJECT_ID} />);

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('meeting-review:get', {
        reviewId: 'review-1',
      }),
    );
    await waitFor(() => {
      const reviewButton = screen.getByTestId(
        'message-card-action-review-open',
      ) as HTMLButtonElement;
      expect(reviewButton.disabled).toBe(true);
      expect(reviewButton.textContent).toContain('결정 완료');
    });
    fireEvent.click(screen.getByTestId('message-card-action-review-open'));
    expect(screen.queryByTestId('meeting-review-document')).toBeNull();
  });
});

describe('Thread — wireframe checkpoint notice wire-up', () => {
  function makeWireframeMessage(status = 'pending'): Record<string, unknown> {
    return {
      id: 'msg-wireframe',
      channelId: 'c-design',
      meetingId: 'm-design',
      authorId: 'system',
      authorKind: 'system',
      role: 'system',
      content: '와이어프레임 확인 안내',
      meta: {
        wireframeCheckpoint: {
          id: 'checkpoint-1',
          kind: 'wireframe',
          status,
          channelId: 'c-design',
          title: '와이어프레임 확인',
        },
      },
      createdAt: 1_700_000_000_000,
    };
  }

  function makeCheckpoint(status = 'pending', note: string | null = null) {
    return {
      id: 'checkpoint-1',
      projectId: PROJECT_ID,
      meetingId: 'm-design',
      channelId: 'c-design',
      kind: 'wireframe',
      status,
      title: '와이어프레임 확인',
      documentPath: '/tmp/wireframe-minutes.md',
      documentBodySnapshot: '# wireframe',
      userNote: note,
      payloadJson: '{}',
      createdAt: 1,
      decidedAt: status === 'pending' ? null : 2,
    };
  }

  it('수정 지시 note를 IPC로 저장하고 처리 완료 상태로 갱신한다', async () => {
    useActiveChannelStore.setState({
      channelIdByProject: { [PROJECT_ID]: 'c-design' },
    });
    const wireframeMessage = makeWireframeMessage('pending');
    const invoke = stubBridge({
      channels: [
        makeChannel({
          id: 'c-design',
          name: '디자인',
          kind: 'department',
          role: 'design.ui',
        }),
      ],
      members: [makeMember('designer')],
      meetings: [],
      messages: [wireframeMessage],
    });
    invoke.mockImplementation(async (channel: string, data: unknown) => {
      if (channel === 'channel:list') {
        const payload = data as { projectId: string | null };
        return payload.projectId === null
          ? { channels: [] }
          : {
              channels: [
                makeChannel({
                  id: 'c-design',
                  name: '디자인',
                  kind: 'department',
                  role: 'design.ui',
                }),
              ],
            };
      }
      if (channel === 'member:list') return { members: [makeMember('designer')] };
      if (channel === 'meeting:list-active') return { meetings: [] };
      if (channel === 'message:list-by-channel') {
        return { messages: [wireframeMessage] };
      }
      if (channel === 'design-checkpoint:get') {
        return { item: makeCheckpoint('pending') };
      }
      if (channel === 'design-checkpoint:decide') {
        return {
          checkpoint: makeCheckpoint(
            'revision_requested',
            '첫 화면 CTA를 더 작게 정리해줘.',
          ),
        };
      }
      throw new Error(`no mock for channel ${channel}`);
    });

    renderThread(<Thread projectId={PROJECT_ID} />);

    await waitFor(() =>
      expect(screen.getByTestId('wireframe-checkpoint-card')).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId('wireframe-checkpoint-request-revision'));
    fireEvent.change(screen.getByTestId('wireframe-checkpoint-note'), {
      target: { value: '첫 화면 CTA를 더 작게 정리해줘.' },
    });
    fireEvent.click(screen.getByTestId('wireframe-checkpoint-request-revision'));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('design-checkpoint:decide', {
        checkpointId: 'checkpoint-1',
        decision: 'request_revision',
        note: '첫 화면 CTA를 더 작게 정리해줘.',
      }),
    );
    await waitFor(() => {
      expect(screen.getByTestId('wireframe-checkpoint-status').textContent).toContain(
        '수정 지시 저장됨',
      );
      expect(
        (
          screen.getByTestId(
            'wireframe-checkpoint-request-revision',
          ) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
    });
  });

  it('오래된 pending meta라도 최신 checkpoint 상태가 완료면 다시 처리할 수 없다', async () => {
    useActiveChannelStore.setState({
      channelIdByProject: { [PROJECT_ID]: 'c-design' },
    });
    const wireframeMessage = makeWireframeMessage('pending');
    const invoke = stubBridge({
      channels: [
        makeChannel({
          id: 'c-design',
          name: '디자인',
          kind: 'department',
          role: 'design.ui',
        }),
      ],
      messages: [wireframeMessage],
    });
    invoke.mockImplementation(async (channel: string, data: unknown) => {
      if (channel === 'channel:list') {
        const payload = data as { projectId: string | null };
        return payload.projectId === null
          ? { channels: [] }
          : {
              channels: [
                makeChannel({
                  id: 'c-design',
                  name: '디자인',
                  kind: 'department',
                  role: 'design.ui',
                }),
              ],
            };
      }
      if (channel === 'member:list') return { members: [] };
      if (channel === 'meeting:list-active') return { meetings: [] };
      if (channel === 'message:list-by-channel') {
        return { messages: [wireframeMessage] };
      }
      if (channel === 'design-checkpoint:get') {
        return { item: makeCheckpoint('continued') };
      }
      throw new Error(`no mock for channel ${channel}`);
    });

    renderThread(<Thread projectId={PROJECT_ID} />);

    await waitFor(() =>
      expect(screen.getByTestId('wireframe-checkpoint-status').textContent).toContain(
        '이대로 계속',
      ),
    );
    fireEvent.click(screen.getByTestId('wireframe-checkpoint-continue'));
    expect(
      invoke.mock.calls.some((call) => call[0] === 'design-checkpoint:decide'),
    ).toBe(false);
  });
});

describe('Thread — ChannelHeader variants for system / dm kinds', () => {
  it('system_approval active channel → rename/delete disabled + readonly badge + no start-meeting + ApprovalInboxView branch (R7-Task7)', async () => {
    useActiveChannelStore.setState({
      channelIdByProject: { [PROJECT_ID]: 'c-sys-a' },
    });
    const inboxStub = stubBridge({
      channels: [
        makeChannel({
          id: 'c-sys-a',
          name: 'system-approval',
          kind: 'system_approval',
          readOnly: true,
        }),
      ],
      members: [],
    });
    // The inbox calls approval:list — extend the mock so the branch lands
    // in the empty state instead of throwing. Thread.test's stubBridge
    // default throws on unknown channels.
    (inboxStub as unknown as { mockImplementation: (fn: (...args: unknown[]) => unknown) => void }).mockImplementation(
      async (...args: unknown[]) => {
        const channel = args[0] as string;
        const data = args[1];
        if (channel === 'channel:list') {
          const payload = data as { projectId: string | null };
          return payload.projectId === null
            ? { channels: [] }
            : {
                channels: [
                  makeChannel({
                    id: 'c-sys-a',
                    name: 'system-approval',
                    kind: 'system_approval',
                    readOnly: true,
                  }),
                ],
              };
        }
        if (channel === 'member:list') return { members: [] };
        if (channel === 'meeting:list-active') return { meetings: [] };
        if (channel === 'approval:list') return { items: [] };
        if (channel === 'message:list-by-channel') return { messages: [] };
        throw new Error(`no mock for channel ${channel}`);
      },
    );

    renderThread(
      <Thread
        projectId={PROJECT_ID}
        onRenameChannel={() => undefined}
        onDeleteChannel={() => undefined}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('channel-header-readonly-badge')).toBeTruthy(),
    );
    expect(screen.queryByTestId('channel-header-start-meeting')).toBeNull();
    expect(
      (screen.getByTestId('channel-header-rename') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId('channel-header-delete') as HTMLButtonElement).disabled,
    ).toBe(true);

    // R7-Task7: #승인-대기 채널에서는 ApprovalInboxView 가 message-list 대신
    // 단독 렌더된다.
    await waitFor(() =>
      expect(screen.getByTestId('approval-inbox-view')).toBeTruthy(),
    );
    expect(screen.queryByTestId('thread-message-list')).toBeNull();
    expect(
      screen.getByTestId('approval-inbox-view').getAttribute('data-project-id'),
    ).toBe(PROJECT_ID);
  });

  it('dm active channel → no start-meeting, no rename, delete enabled', async () => {
    useActiveChannelStore.setState({
      channelIdByProject: { [PROJECT_ID]: 'c-dm-1' },
    });
    stubBridge({
      channels: [
        makeChannel({ id: 'c-plan', kind: 'user', name: '기획' }),
      ],
      dms: [
        makeChannel({
          id: 'c-dm-1',
          projectId: null,
          kind: 'dm',
          name: 'yuna',
        }),
      ],
      members: [makeMember('a')],
    });
    // Validation effect of useActiveChannel will clear c-dm-1 because
    // it is not in useChannels() result (project-scoped). DM channels
    // do not hang off `useChannels(projectId)` — they live in `useDms()`.
    // Thread in MVP treats "channel not in project list" as empty-state.
    renderThread(<Thread projectId={PROJECT_ID} />);

    await waitFor(() =>
      expect(screen.getByTestId('thread').getAttribute('data-empty')).toBe('true'),
    );
  });
});

describe('Thread — source-level hex color literal guard', () => {
  it('Thread.tsx contains zero hex color literals', () => {
    const source = readFileSync(resolve(__dirname, '..', 'Thread.tsx'), 'utf-8');
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
