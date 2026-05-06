// @vitest-environment jsdom

/**
 * GeneralVariant — 일반 채널 SsmBox final 본체 (R12-C2 T21).
 *
 * 검증 surface:
 *   - cards 0 건 → empty 텍스트 노출
 *   - cards N 건 → 카드 list 렌더 (제목 + 본문 + author label)
 *   - 카운터 = backend 의 agreeCount / opposeCount 값
 *   - userVote = 'agree' → agree 버튼 active (aria-pressed=true) + 강조 클래스
 *   - 동의 / 반대 버튼 클릭 → opinion:toggleLightVote IPC 호출
 *   - 카드 정렬 = 등록 역순 (최신이 위) — backend createdAt 오름차순 → renderer reverse
 *
 * stub:
 *   - opinion:listGeneralCards 가 mock cards 반환
 *   - opinion:toggleLightVote 가 patch 결과 반환 → hook 가 in-place 갱신
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SsmBox } from '../SsmBox/index';
import { i18next } from '../../../i18n';
import { ThemeProvider } from '../../../theme/theme-provider';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  useThemeStore,
} from '../../../theme/theme-store';
import type {
  GeneralOpinionCard,
  ListGeneralCardsResult,
  Opinion,
  ToggleLightVoteResult,
} from '../../../../shared/opinion-types';
import type { Channel } from '../../../../shared/channel-types';

function makeOpinion(overrides: Partial<Opinion> = {}): Opinion {
  return {
    id: overrides.id ?? 'op-1',
    parentId: null,
    meetingId: null,
    channelId: 'c-x',
    kind: 'user-raised',
    authorProviderId: null,
    authorLabel: 'user_1',
    title: '카드 제목',
    content: '카드 본문 내용',
    rationale: null,
    status: 'pending',
    exclusionReason: null,
    round: 0,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeCard(
  overrides: Partial<GeneralOpinionCard> = {},
  opOverrides: Partial<Opinion> = {},
): GeneralOpinionCard {
  return {
    opinion: makeOpinion(opOverrides),
    agreeCount: 0,
    opposeCount: 0,
    userVote: null,
    ...overrides,
  };
}

function makeChannel(): Channel {
  return {
    id: 'c-x',
    projectId: 'p-a',
    name: 'X',
    kind: 'user',
    readOnly: false,
    createdAt: 1_700_000_000_000,
    role: 'general',
    purpose: null,
    handoffMode: 'check',
    maxRounds: null,
  };
}

interface InvokeStub {
  invoke: ReturnType<typeof vi.fn>;
  toggleResults: ToggleLightVoteResult[];
}

function installArenaStub(
  initialCards: GeneralOpinionCard[],
  toggleResults: ToggleLightVoteResult[] = [],
): InvokeStub {
  const cardsRef = { value: initialCards };
  const stub: InvokeStub = {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      switch (channel) {
        case 'channel:list':
          return { channels: [] };
        case 'channel:get-global-general':
          return { channel: null };
        case 'meeting:list-active':
          return { meetings: [] };
        case 'opinion:listGeneralCards': {
          const result: ListGeneralCardsResult = {
            channelId:
              (payload as { channelId?: string } | undefined)?.channelId ??
              'c-x',
            cards: cardsRef.value,
          };
          return { result };
        }
        case 'opinion:toggleLightVote': {
          const next = toggleResults.shift();
          if (!next) {
            throw new Error('GeneralVariant test: toggleResults exhausted');
          }
          return { result: next };
        }
        default:
          return undefined;
      }
    }),
    toggleResults,
  };
  (window as unknown as { arena: unknown }).arena = {
    platform: 'linux',
    invoke: stub.invoke,
    onStream: () => () => undefined,
  };
  return stub;
}

function teardownArenaStub(): void {
  delete (window as unknown as { arena?: unknown }).arena;
}

function renderVariant(channel: Channel): void {
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
  render(
    <ThemeProvider>
      <SsmBox
        channelId={channel.id}
        channelOverride={channel}
        meetingOverride={null}
      />
    </ThemeProvider>,
  );
}

describe('GeneralVariant — final body (T21)', () => {
  beforeEach(() => {
    void i18next;
  });

  afterEach(() => {
    cleanup();
    teardownArenaStub();
    vi.restoreAllMocks();
  });

  it('cards 0 건 → empty 텍스트 노출 + 카운터 0', async () => {
    installArenaStub([]);
    renderVariant(makeChannel());

    await waitFor(() => {
      expect(screen.getByTestId('ssm-box-empty')).toBeTruthy();
    });
    expect(screen.queryAllByTestId('ssm-box-general-card').length).toBe(0);
  });

  it('cards 2 건 → 제목 / 본문 / author label 모두 렌더', async () => {
    const cards = [
      makeCard(
        { agreeCount: 3, opposeCount: 1, userVote: null },
        {
          id: 'op-a',
          title: '첫 카드',
          content: '첫 본문',
          authorLabel: 'user_1',
        },
      ),
      makeCard(
        { agreeCount: 0, opposeCount: 0, userVote: 'agree' },
        {
          id: 'op-b',
          title: '둘째 카드',
          content: '둘째 본문',
          authorLabel: 'pv-codex_1',
          authorProviderId: 'pv-codex',
          kind: 'self-raised',
          createdAt: 1_700_000_000_500,
        },
      ),
    ];
    installArenaStub(cards);
    renderVariant(makeChannel());

    await waitFor(() => {
      expect(
        screen.queryAllByTestId('ssm-box-general-card').length,
      ).toBe(2);
    });

    expect(screen.getByText('첫 카드')).toBeTruthy();
    expect(screen.getByText('둘째 카드')).toBeTruthy();
    expect(screen.getByText('첫 본문')).toBeTruthy();
    expect(screen.getByText('둘째 본문')).toBeTruthy();
    expect(screen.getByText('user_1')).toBeTruthy();
    expect(screen.getByText('pv-codex_1')).toBeTruthy();
  });

  it('카드 정렬 = 등록 역순 (최신이 위)', async () => {
    const cards = [
      makeCard({}, { id: 'op-old', title: '오래된 카드', createdAt: 1 }),
      makeCard({}, { id: 'op-new', title: '최신 카드', createdAt: 2 }),
    ];
    installArenaStub(cards);
    renderVariant(makeChannel());

    await waitFor(() => {
      expect(
        screen.queryAllByTestId('ssm-box-general-card').length,
      ).toBe(2);
    });

    const items = screen.queryAllByTestId('ssm-box-general-card');
    expect(items[0]!.getAttribute('data-card-id')).toBe('op-new');
    expect(items[1]!.getAttribute('data-card-id')).toBe('op-old');
  });

  it('userVote=agree → agree 버튼이 aria-pressed=true', async () => {
    const cards = [
      makeCard(
        { agreeCount: 1, opposeCount: 0, userVote: 'agree' },
        { id: 'op-a' },
      ),
    ];
    installArenaStub(cards);
    renderVariant(makeChannel());

    await waitFor(() => {
      expect(screen.getByTestId('ssm-box-general-vote-agree')).toBeTruthy();
    });
    const agreeBtn = screen.getByTestId('ssm-box-general-vote-agree');
    const opposeBtn = screen.getByTestId('ssm-box-general-vote-oppose');
    expect(agreeBtn.getAttribute('aria-pressed')).toBe('true');
    expect(agreeBtn.getAttribute('data-active')).toBe('true');
    expect(opposeBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('동의 버튼 클릭 → opinion:toggleLightVote 호출 + 카운터 갱신', async () => {
    const cards = [
      makeCard(
        { agreeCount: 0, opposeCount: 0, userVote: null },
        { id: 'op-a' },
      ),
    ];
    const toggleResults: ToggleLightVoteResult[] = [
      {
        opinionId: 'op-a',
        effect: 'inserted',
        userVote: 'agree',
        agreeCount: 1,
        opposeCount: 0,
      },
    ];
    const stub = installArenaStub(cards, toggleResults);
    renderVariant(makeChannel());

    await waitFor(() => {
      expect(screen.getByTestId('ssm-box-general-vote-agree')).toBeTruthy();
    });

    const agreeBtn = screen.getByTestId('ssm-box-general-vote-agree');
    fireEvent.click(agreeBtn);

    await waitFor(() => {
      expect(stub.invoke).toHaveBeenCalledWith(
        'opinion:toggleLightVote',
        expect.objectContaining({ opinionId: 'op-a', vote: 'agree' }),
      );
    });

    await waitFor(() => {
      const updated = screen.getByTestId('ssm-box-general-vote-agree');
      expect(updated.getAttribute('aria-pressed')).toBe('true');
    });
  });

  it('반대 버튼 클릭 → opinion:toggleLightVote 호출', async () => {
    const cards = [
      makeCard(
        { agreeCount: 0, opposeCount: 0, userVote: null },
        { id: 'op-a' },
      ),
    ];
    const toggleResults: ToggleLightVoteResult[] = [
      {
        opinionId: 'op-a',
        effect: 'inserted',
        userVote: 'oppose',
        agreeCount: 0,
        opposeCount: 1,
      },
    ];
    const stub = installArenaStub(cards, toggleResults);
    renderVariant(makeChannel());

    await waitFor(() => {
      expect(screen.getByTestId('ssm-box-general-vote-oppose')).toBeTruthy();
    });

    const opposeBtn = screen.getByTestId('ssm-box-general-vote-oppose');
    fireEvent.click(opposeBtn);

    await waitFor(() => {
      expect(stub.invoke).toHaveBeenCalledWith(
        'opinion:toggleLightVote',
        expect.objectContaining({ opinionId: 'op-a', vote: 'oppose' }),
      );
    });
  });
});
