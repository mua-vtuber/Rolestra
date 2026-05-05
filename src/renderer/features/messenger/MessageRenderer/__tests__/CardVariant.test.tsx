// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  MessageCardVariant,
  isCardMessage,
} from '../index';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  useThemeStore,
} from '../../../../theme/theme-store';
import { ThemeProvider } from '../../../../theme/theme-provider';
import type {
  ThemeKey,
  ThemeMode,
} from '../../../../theme/theme-tokens';
import type { Message as ChannelMessage } from '../../../../../shared/message-types';
import type { OpinionKind } from '../../../../../shared/opinion-types';

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

afterEach(() => {
  cleanup();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
});

const THEME_COMBOS: Array<[ThemeKey, ThemeMode]> = [
  ['warm', 'light'],
  ['warm', 'dark'],
  ['tactical', 'light'],
  ['tactical', 'dark'],
  ['retro', 'light'],
  ['retro', 'dark'],
];

const OPINION_KINDS: OpinionKind[] = [
  'root',
  'revise',
  'block',
  'addition',
  'self-raised',
  'user-raised',
];

const SHORT_CONTENT = '간단 의견 본문 — 카드 안에 그대로 보여야 함.';
const LONG_CONTENT = '가'.repeat(800);
const RATIONALE = '근거: 옛 설계가 오히려 무겁다.';

function makeOpinionMessage(args: {
  id?: string;
  kind: OpinionKind;
  content?: string;
  rationale?: string | null;
  title?: string | null;
}): ChannelMessage {
  return {
    id: args.id ?? 'msg-fixture',
    channelId: 'ch-1',
    meetingId: 'meet-1',
    authorId: 'codex-provider',
    authorKind: 'member',
    role: 'assistant',
    content: args.content ?? SHORT_CONTENT,
    meta: {
      opinion: {
        opinionRef: 'opn-001',
        opinionKind: args.kind,
        opinionScreenId: 'ITEM_001_01',
        authorLabel: 'codex_1',
        opinionTitle: args.title === undefined ? '카드 헤더 제목' : args.title,
        opinionRationale: args.rationale === undefined ? RATIONALE : args.rationale,
      },
    },
    createdAt: 1_700_000_000_000,
  };
}

function makeMinutesMessage(args?: {
  source?: 'moderator' | 'moderator-retry' | 'fallback';
  content?: string;
}): ChannelMessage {
  return {
    id: 'msg-minutes',
    channelId: 'ch-1',
    meetingId: 'meet-1',
    authorId: 'system',
    authorKind: 'system',
    role: 'system',
    content: args?.content ?? '# 회의록\n\n[합의]\n- 의견 1\n\n[제외]\n- 의견 2',
    meta: {
      minutes: {
        minutesPath: '/arena/proj/consensus/meetings/meet-1/minutes.md',
        minutesSource: args?.source ?? 'moderator',
        minutesProviderId: 'codex-provider',
      },
    },
    createdAt: 1_700_000_000_500,
  };
}

describe('isCardMessage — dispatcher 분기 결정', () => {
  it('opinion meta 있는 메시지는 card', () => {
    expect(isCardMessage(makeOpinionMessage({ kind: 'root' }))).toBe(true);
  });

  it('minutes meta 있는 메시지는 card', () => {
    expect(isCardMessage(makeMinutesMessage())).toBe(true);
  });

  it('plain 메시지는 card 아님', () => {
    const m: ChannelMessage = {
      id: 'm-plain',
      channelId: 'ch-1',
      meetingId: null,
      authorId: 'user',
      authorKind: 'user',
      role: 'user',
      content: '안녕',
      meta: null,
      createdAt: 1_700_000_000_000,
    };
    expect(isCardMessage(m)).toBe(false);
  });

  it('meta 부분 누락 (opinionKind 없음) 은 card 아님 — 잘못된 데이터 silent fallback 금지', () => {
    const m = {
      ...makeOpinionMessage({ kind: 'root' }),
      meta: {
        opinion: {
          opinionRef: 'opn-001',
          // opinionKind 누락 — type guard 가 거부해야 한다.
        } as unknown,
      },
    } as ChannelMessage;
    expect(isCardMessage(m)).toBe(false);
  });
});

describe('MessageCardVariant — 6 테마 × 6 opinion kind 렌더 (spec §11.13a)', () => {
  for (const [themeKey, mode] of THEME_COMBOS) {
    for (const kind of OPINION_KINDS) {
      it(`${themeKey}-${mode} / kind=${kind}`, () => {
        useThemeStore.setState({ themeKey, mode });
        renderWithTheme(
          <MessageCardVariant
            message={makeOpinionMessage({ id: `m-${themeKey}-${mode}-${kind}`, kind })}
          />,
        );
        const card = screen.getByTestId('message-card');
        expect(card.getAttribute('data-card-variant')).toBe('opinion');
        expect(card.getAttribute('data-opinion-kind')).toBe(kind);
        expect(card.getAttribute('data-theme-variant')).toBe(themeKey);
        // 헤더 — authorLabel + screenId 둘 다 표시 (spec §11.13a).
        expect(screen.getByTestId('message-card-author-label').textContent).toBe('codex_1');
        expect(screen.getByTestId('message-card-screen-id').textContent).toBe('ITEM_001_01');
        // 본문은 truncate X.
        expect(screen.getByTestId('message-card-body').textContent).toBe(SHORT_CONTENT);
      });
    }
  }
});

describe('MessageCardVariant — 본문 collapse / expand', () => {
  it('짧은 본문은 collapse 토글이 없다', () => {
    useThemeStore.setState({ themeKey: 'warm', mode: 'light' });
    renderWithTheme(
      <MessageCardVariant message={makeOpinionMessage({ kind: 'root' })} />,
    );
    expect(screen.queryByTestId('message-card-toggle')).toBeNull();
    expect(
      screen.getByTestId('message-card-body').getAttribute('data-collapsed'),
    ).toBe('false');
  });

  it('긴 본문은 collapsed default — toggle 클릭 시 펼친다 (truncate 없이 full DOM 보존)', () => {
    useThemeStore.setState({ themeKey: 'warm', mode: 'light' });
    renderWithTheme(
      <MessageCardVariant
        message={makeOpinionMessage({ kind: 'root', content: LONG_CONTENT })}
      />,
    );
    const body = screen.getByTestId('message-card-body');
    // truncate 가 아니다 — 본문은 항상 통째로 DOM 안에 있고 max-height 로만 가린다.
    expect(body.textContent).toBe(LONG_CONTENT);
    expect(body.getAttribute('data-collapsed')).toBe('true');

    const toggle = screen.getByTestId('message-card-toggle');
    expect(toggle.getAttribute('data-collapsed')).toBe('true');
    fireEvent.click(toggle);
    expect(body.getAttribute('data-collapsed')).toBe('false');
    expect(toggle.getAttribute('data-collapsed')).toBe('false');
  });
});

describe('MessageCardVariant — opinion 액션 버튼 (handlers props 기반)', () => {
  it('handlers 미주입 시 footer 자체 렌더 X (placeholder 버튼 금지)', () => {
    useThemeStore.setState({ themeKey: 'warm', mode: 'light' });
    renderWithTheme(
      <MessageCardVariant message={makeOpinionMessage({ kind: 'root' })} />,
    );
    expect(screen.queryByTestId('message-card-footer')).toBeNull();
    expect(screen.queryByTestId('message-card-action-agree')).toBeNull();
  });

  it('onVote 주입 시 [동의] / [반대] 버튼 클릭 → 핸들러 호출', () => {
    useThemeStore.setState({ themeKey: 'tactical', mode: 'dark' });
    let captured: { ref: string; vote: string } | null = null;
    const onVote = (ref: string, vote: 'agree' | 'oppose'): void => {
      captured = { ref, vote };
    };
    renderWithTheme(
      <MessageCardVariant
        message={makeOpinionMessage({ kind: 'revise' })}
        opinionHandlers={{ onVote }}
      />,
    );
    fireEvent.click(screen.getByTestId('message-card-action-agree'));
    expect(captured).toEqual({ ref: 'opn-001', vote: 'agree' });
    fireEvent.click(screen.getByTestId('message-card-action-oppose'));
    expect(captured).toEqual({ ref: 'opn-001', vote: 'oppose' });
  });

  it('onSelectToggle 은 root 카드에 노출 (idea-workflow 한정)', () => {
    useThemeStore.setState({ themeKey: 'warm', mode: 'light' });
    const onSelectToggle = (): void => {};
    renderWithTheme(
      <MessageCardVariant
        message={makeOpinionMessage({ kind: 'root' })}
        opinionHandlers={{ onSelectToggle }}
      />,
    );
    expect(screen.getByTestId('message-card-action-select')).toBeTruthy();
  });

  it('onSelectToggle 은 root 외 kind 에는 노출 X', () => {
    useThemeStore.setState({ themeKey: 'warm', mode: 'light' });
    const onSelectToggle = (): void => {};
    for (const kind of ['revise', 'block', 'addition', 'self-raised', 'user-raised'] as OpinionKind[]) {
      cleanup();
      renderWithTheme(
        <MessageCardVariant
          message={makeOpinionMessage({ id: `m-${kind}`, kind })}
          opinionHandlers={{ onSelectToggle }}
        />,
      );
      expect(screen.queryByTestId('message-card-action-select')).toBeNull();
    }
  });

  it('onPropose 는 self-raised / user-raised 에 노출 X (회의 surface 외)', () => {
    useThemeStore.setState({ themeKey: 'warm', mode: 'light' });
    const onPropose = (): void => {};
    renderWithTheme(
      <MessageCardVariant
        message={makeOpinionMessage({ kind: 'self-raised' })}
        opinionHandlers={{ onPropose }}
      />,
    );
    expect(screen.queryByTestId('message-card-action-propose')).toBeNull();
  });

  it('onPropose 는 root / revise / block / addition 에 노출 O', () => {
    useThemeStore.setState({ themeKey: 'warm', mode: 'light' });
    const onPropose = (): void => {};
    for (const kind of ['root', 'revise', 'block', 'addition'] as OpinionKind[]) {
      cleanup();
      renderWithTheme(
        <MessageCardVariant
          message={makeOpinionMessage({ id: `m-${kind}`, kind })}
          opinionHandlers={{ onPropose }}
        />,
      );
      expect(screen.getByTestId('message-card-action-propose')).toBeTruthy();
    }
  });

  it('selected=true 면 [선택 취소] 라벨 / data-selected=true', () => {
    useThemeStore.setState({ themeKey: 'warm', mode: 'light' });
    const onSelectToggle = (): void => {};
    renderWithTheme(
      <MessageCardVariant
        message={makeOpinionMessage({ kind: 'root' })}
        selected
        opinionHandlers={{ onSelectToggle }}
      />,
    );
    const btn = screen.getByTestId('message-card-action-select');
    expect(btn.getAttribute('data-selected')).toBe('true');
  });
});

describe('MessageCardVariant — minutes variant (3 source × 6 테마)', () => {
  const SOURCES = ['moderator', 'moderator-retry', 'fallback'] as const;
  for (const [themeKey, mode] of THEME_COMBOS) {
    for (const source of SOURCES) {
      it(`${themeKey}-${mode} / source=${source}`, () => {
        useThemeStore.setState({ themeKey, mode });
        renderWithTheme(
          <MessageCardVariant message={makeMinutesMessage({ source })} />,
        );
        const card = screen.getByTestId('message-card');
        expect(card.getAttribute('data-card-variant')).toBe('minutes');
        expect(card.getAttribute('data-minutes-source')).toBe(source);
        expect(card.getAttribute('data-theme-variant')).toBe(themeKey);
        // 회의록 본문은 truncate X.
        const body = screen.getByTestId('message-card-body');
        expect(body.textContent?.includes('[합의]')).toBe(true);
        expect(body.textContent?.includes('[제외]')).toBe(true);
      });
    }
  }

  it('handlers 주입 → [전체 보기] / [다음 부서로 인계] 버튼 호출', () => {
    useThemeStore.setState({ themeKey: 'warm', mode: 'light' });
    let opened: string | null = null;
    let handed: string | null = null;
    renderWithTheme(
      <MessageCardVariant
        message={makeMinutesMessage()}
        minutesHandlers={{
          onMinutesOpen: (path) => {
            opened = path;
          },
          onHandoff: (path) => {
            handed = path;
          },
        }}
      />,
    );
    fireEvent.click(screen.getByTestId('message-card-action-minutes-open'));
    expect(opened).toBe('/arena/proj/consensus/meetings/meet-1/minutes.md');
    fireEvent.click(screen.getByTestId('message-card-action-handoff'));
    expect(handed).toBe('/arena/proj/consensus/meetings/meet-1/minutes.md');
  });
});

describe('MessageCardVariant — null fallback (defensive)', () => {
  it('opinion / minutes meta 둘 다 없으면 null 반환', () => {
    useThemeStore.setState({ themeKey: 'warm', mode: 'light' });
    const m: ChannelMessage = {
      id: 'm-empty',
      channelId: 'ch-1',
      meetingId: null,
      authorId: 'user',
      authorKind: 'user',
      role: 'user',
      content: '안녕',
      meta: null,
      createdAt: 1_700_000_000_000,
    };
    const { container } = renderWithTheme(<MessageCardVariant message={m} />);
    expect(container.firstChild).toBeNull();
  });
});
