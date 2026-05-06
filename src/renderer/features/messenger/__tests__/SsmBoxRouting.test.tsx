// @vitest-environment jsdom

/**
 * SsmBox variant routing — 5 variant + LegacyVariant fallback (R12-C2 T18 land).
 *
 * spec §11.13 의 7 RoleId × 5 variant 매핑을 보장:
 * - `'idea'`                              → IdeaVariant
 * - `'planning'` / `'review'` / `'audit'` → PlanningVariant
 * - `'design.ui'` / `'design.ux'`         → DesignVariant
 * - `'implement'`                         → ImplementVariant
 * - `'general'`                           → GeneralVariant
 * - `null` / `'design.character'` / `'design.background'` → LegacyVariant
 *
 * 각 variant 가 spec §11.13 의 핵심 surface 를 노출하는지도 단언:
 * - IdeaVariant: 의견 list slot
 * - PlanningVariant: 의견 트리 + 회의록 미리보기 footer
 * - DesignVariant: 디자인 단계 + Playwright 미리보기 slot
 * - ImplementVariant: designated / progress / file list slot
 * - GeneralVariant: 카드 누적 list
 *
 * 본 파일은 *분기 정확도* 를 본다. 형태 토큰 (clip-path / panelRadius /
 * font) 시각 검증은 SsmBox.test.tsx 가 LegacyVariant 위에서 처리.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SsmBox } from '../SsmBox/index';
import { i18next } from '../../../i18n';
import { ThemeProvider } from '../../../theme/theme-provider';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  useThemeStore,
} from '../../../theme/theme-store';
import type { Channel } from '../../../../shared/channel-types';
import type { ChannelRole } from '../../../../shared/channel-role-types';
import type { ActiveMeetingSummary } from '../../../../shared/meeting-types';

function installArenaStub(): void {
  const invoke = vi.fn(async (channel: string) => {
    switch (channel) {
      case 'channel:list':
        return { channels: [] };
      case 'channel:get-global-general':
        return { channel: null };
      case 'meeting:list-active':
        return { meetings: [] };
      default:
        return undefined;
    }
  });
  (window as unknown as { arena: unknown }).arena = {
    platform: 'linux',
    invoke,
    onStream: () => () => undefined,
  };
}

function teardownArenaStub(): void {
  delete (window as unknown as { arena?: unknown }).arena;
}

function makeChannel(role: ChannelRole): Channel {
  return {
    id: 'c-x',
    projectId: 'p-a',
    name: 'X',
    kind: 'user',
    readOnly: false,
    createdAt: 1_700_000_000_000,
    role,
    purpose: null,
    handoffMode: 'check',
    maxRounds: null,
  };
}

function makeMeeting(): ActiveMeetingSummary {
  return {
    id: 'm-1',
    projectId: 'p-a',
    projectName: 'P',
    channelId: 'c-x',
    channelName: 'X',
    topic: '주제',
    stateIndex: 1,
    stateName: 'opinion_gather',
    startedAt: 1_700_000_000_000,
    elapsedMs: 60_000,
    pausedAt: null,
  };
}

function renderWith(role: ChannelRole, withMeeting: boolean): void {
  useThemeStore.setState({ themeKey: 'warm', mode: 'light' });
  render(
    <ThemeProvider>
      <SsmBox
        channelId="c-x"
        channelOverride={makeChannel(role)}
        meetingOverride={withMeeting ? makeMeeting() : null}
      />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
  void i18next.changeLanguage('ko');
  installArenaStub();
});

afterEach(() => {
  cleanup();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
  teardownArenaStub();
});

describe('SsmBox routing — RoleId → variant 매핑 (spec §11.13)', () => {
  it("role='idea' → IdeaVariant + 의견 list slot", () => {
    renderWith('idea', true);
    const box = screen.getByTestId('ssm-box');
    expect(box.getAttribute('data-ssm-variant')).toBe('idea');
    expect(box.getAttribute('data-channel-role')).toBe('idea');
    expect(screen.getByTestId('ssm-box-idea-list')).toBeTruthy();
  });

  it("role='planning' → PlanningVariant + 의견 트리 + 회의록 미리보기", () => {
    renderWith('planning', true);
    const box = screen.getByTestId('ssm-box');
    expect(box.getAttribute('data-ssm-variant')).toBe('planning');
    expect(box.getAttribute('data-channel-role')).toBe('planning');
    expect(screen.getByTestId('ssm-box-opinion-tree')).toBeTruthy();
    expect(screen.getByTestId('ssm-box-minutes-preview')).toBeTruthy();
  });

  it("role='review' → PlanningVariant 공유 (review 헤더)", () => {
    renderWith('review', true);
    const box = screen.getByTestId('ssm-box');
    expect(box.getAttribute('data-ssm-variant')).toBe('planning');
    expect(box.getAttribute('data-channel-role')).toBe('review');
    expect(screen.getByTestId('ssm-box-opinion-tree')).toBeTruthy();
    expect(
      screen.getByTestId('ssm-box-variant-label').textContent ?? '',
    ).toContain('리뷰');
  });

  it("role='audit' → PlanningVariant 공유 (audit 헤더)", () => {
    renderWith('audit', true);
    const box = screen.getByTestId('ssm-box');
    expect(box.getAttribute('data-ssm-variant')).toBe('planning');
    expect(box.getAttribute('data-channel-role')).toBe('audit');
    expect(
      screen.getByTestId('ssm-box-variant-label').textContent ?? '',
    ).toContain('검토');
  });

  it("role='design.ui' → DesignVariant + 디자인 단계 + 미리보기 slot", () => {
    renderWith('design.ui', true);
    const box = screen.getByTestId('ssm-box');
    expect(box.getAttribute('data-ssm-variant')).toBe('design');
    expect(box.getAttribute('data-channel-role')).toBe('design.ui');
    expect(screen.getByTestId('ssm-box-design-sequence')).toBeTruthy();
    expect(screen.getByTestId('ssm-box-design-preview-slot')).toBeTruthy();
  });

  it("role='design.ux' → DesignVariant 공유 (UI/UX 통합)", () => {
    renderWith('design.ux', true);
    const box = screen.getByTestId('ssm-box');
    expect(box.getAttribute('data-ssm-variant')).toBe('design');
    expect(box.getAttribute('data-channel-role')).toBe('design.ux');
    expect(screen.getByTestId('ssm-box-design-sequence')).toBeTruthy();
  });

  it("role='implement' → ImplementVariant + designated / progress / file list slot", () => {
    renderWith('implement', true);
    const box = screen.getByTestId('ssm-box');
    expect(box.getAttribute('data-ssm-variant')).toBe('implement');
    expect(box.getAttribute('data-channel-role')).toBe('implement');
    expect(screen.getByTestId('ssm-box-designated-slot')).toBeTruthy();
    expect(screen.getByTestId('ssm-box-progress-slot')).toBeTruthy();
    expect(screen.getByTestId('ssm-box-file-list-slot')).toBeTruthy();
    // 구현 부서는 회의 X — opinion 트리 surface 자체가 없어야 한다.
    expect(screen.queryByTestId('ssm-box-opinion-tree')).toBeNull();
  });

  it("role='general' → GeneralVariant + 카드 누적 list", () => {
    renderWith('general', false);
    const box = screen.getByTestId('ssm-box');
    expect(box.getAttribute('data-ssm-variant')).toBe('general');
    expect(box.getAttribute('data-channel-role')).toBe('general');
    expect(screen.getByTestId('ssm-box-general-cards')).toBeTruthy();
    // 잡담 정체성 — 합의/회의록/인계 surface 없음.
    expect(screen.queryByTestId('ssm-box-minutes-preview')).toBeNull();
    expect(screen.queryByTestId('ssm-box-opinion-tree')).toBeNull();
  });

  it("role=null → LegacyVariant (DM / system / legacy)", () => {
    renderWith(null, true);
    const box = screen.getByTestId('ssm-box');
    expect(box.getAttribute('data-ssm-variant')).toBe('legacy');
    expect(box.getAttribute('data-channel-role')).toBe('');
  });

  it("role='design.character' → LegacyVariant (R12-D 보류 부서)", () => {
    renderWith('design.character', true);
    const box = screen.getByTestId('ssm-box');
    expect(box.getAttribute('data-ssm-variant')).toBe('legacy');
    expect(box.getAttribute('data-channel-role')).toBe('design.character');
  });

  it("role='design.background' → LegacyVariant (R12-D 보류 부서)", () => {
    renderWith('design.background', true);
    const box = screen.getByTestId('ssm-box');
    expect(box.getAttribute('data-ssm-variant')).toBe('legacy');
    expect(box.getAttribute('data-channel-role')).toBe('design.background');
  });
});

describe('SsmBox routing — meeting=null 시 각 variant 의 빈 상태', () => {
  it.each([
    ['idea'],
    ['planning'],
    ['review'],
    ['audit'],
    ['design.ui'],
    ['design.ux'],
    ['implement'],
  ] as const)(
    "role='%s' + meeting=null → ssm-box-empty 표시",
    (role) => {
      renderWith(role as ChannelRole, false);
      const box = screen.getByTestId('ssm-box');
      expect(box.getAttribute('data-has-meeting')).toBe('false');
      expect(screen.getByTestId('ssm-box-empty')).toBeTruthy();
    },
  );

  it("role='general' → meeting 유무 무관하게 ssm-box-empty 표시 (잡담 정체성)", () => {
    renderWith('general', false);
    const box = screen.getByTestId('ssm-box');
    expect(box.getAttribute('data-has-meeting')).toBe('false');
    expect(screen.getByTestId('ssm-box-empty')).toBeTruthy();
  });
});
