// @vitest-environment jsdom

/**
 * SsmBox (R5-Task9 → R12-C2 T18) — 2-way container (tactical clip) + ProgressGauge
 * wire (LegacyVariant fallback) + 5 variant routing snapshot.
 *
 * R12-C2 T18: SsmBox public API 가 `{ channelId }` 1 개로 좁혀졌고 (spec
 * §11.13), 내부에서 5 variant 분기. 본 파일은 *테스트 우회 prop*
 * (`channelOverride` / `meetingOverride`) 를 통해 IPC stub 없이 분기 + 형태
 * 토큰 시각 검증을 한다. variant 라우팅은 별 파일 (`SsmBoxRouting.test.tsx`)
 * 에서 부서별로 검사.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
import type { ThemeKey } from '../../../theme/theme-tokens';
import type { Channel } from '../../../../shared/channel-types';
import type { ActiveMeetingSummary } from '../../../../shared/meeting-types';
import { SESSION_STATE_COUNT } from '../../../../shared/constants';

// SsmBox 가 useDms / useGlobalGeneralChannel / useActiveMeetings 를 내부에서
// 호출하므로, jsdom 에 최소한의 arena bridge stub 을 깔아 IPC 가 throw 하지
// 않게 한다. variant 분기 시각 검증에는 channelOverride / meetingOverride 를
// 사용하므로 IPC 응답이 실제로 사용되지는 않는다.
function installArenaStub(): { invoke: ReturnType<typeof vi.fn> } {
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
  return { invoke };
}

function teardownArenaStub(): void {
  delete (window as unknown as { arena?: unknown }).arena;
}

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: 'c-x',
    projectId: 'p-a',
    name: 'X',
    kind: 'user',
    readOnly: false,
    createdAt: 1_700_000_000_000,
    role: null,
    purpose: null,
    handoffMode: 'check',
    maxRounds: null,
    ...overrides,
  };
}

function makeMeeting(
  overrides: Partial<ActiveMeetingSummary> = {},
): ActiveMeetingSummary {
  return {
    id: 'm-1',
    projectId: 'p-a',
    projectName: 'P',
    channelId: 'c-x',
    channelName: 'X',
    topic: 'n+1 리팩토링',
    stateIndex: 2,
    stateName: 'free_discussion',
    startedAt: 1_700_000_000_000,
    elapsedMs: 3 * 60_000,
    pausedAt: null,
    ...overrides,
  };
}

function renderWithTheme(
  themeKey: ThemeKey,
  ui: React.ReactElement,
): ReturnType<typeof render> {
  useThemeStore.setState({ themeKey, mode: 'light' });
  return render(<ThemeProvider>{ui}</ThemeProvider>);
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

describe('SsmBox — 2-way clip-path (tactical only, LegacyVariant frame)', () => {
  // role=null 채널 → LegacyVariant 가 SsmBoxFrame 을 사용하므로 form
  // tokens 동일하게 검증된다.
  const legacyChannel = makeChannel({ role: null });

  it('warm: panelRadius=12 + NO clip-path', () => {
    renderWithTheme(
      'warm',
      <SsmBox
        channelId="c-x"
        channelOverride={legacyChannel}
        meetingOverride={makeMeeting()}
      />,
    );
    const box = screen.getByTestId('ssm-box');
    expect(box.getAttribute('data-theme-variant')).toBe('warm');
    expect(box.getAttribute('data-panel-radius')).toBe('12');
    expect(box.getAttribute('style')).toContain('border-radius: 12px');
    expect(box.getAttribute('style')).not.toContain('clip-path');
  });

  it('tactical: panelRadius=0 + clip-path polygon', () => {
    renderWithTheme(
      'tactical',
      <SsmBox
        channelId="c-x"
        channelOverride={legacyChannel}
        meetingOverride={makeMeeting()}
      />,
    );
    const box = screen.getByTestId('ssm-box');
    expect(box.getAttribute('data-theme-variant')).toBe('tactical');
    expect(box.getAttribute('data-panel-radius')).toBe('0');
    expect(box.getAttribute('style')).toContain('clip-path');
    expect(box.getAttribute('style')).toContain('polygon');
  });

  it('retro: panelRadius=0 + NO clip-path + mono font', () => {
    renderWithTheme(
      'retro',
      <SsmBox
        channelId="c-x"
        channelOverride={legacyChannel}
        meetingOverride={makeMeeting()}
      />,
    );
    const box = screen.getByTestId('ssm-box');
    expect(box.getAttribute('data-theme-variant')).toBe('retro');
    expect(box.getAttribute('data-panel-radius')).toBe('0');
    expect(box.getAttribute('style')).not.toContain('clip-path');
    expect(box.className).toContain('font-mono');
  });
});

describe('SsmBox — LegacyVariant meeting → ProgressGauge wire + label', () => {
  const legacyChannel = makeChannel({ role: null });

  it('label renders "SSM N/TOTAL" with (stateIndex+1) / SESSION_STATE_COUNT', () => {
    renderWithTheme(
      'warm',
      <SsmBox
        channelId="c-x"
        channelOverride={legacyChannel}
        meetingOverride={makeMeeting({ stateIndex: 4 })}
      />,
    );
    const label = screen.getByTestId('ssm-box-label').textContent ?? '';
    expect(label).toBe(`SSM 5/${SESSION_STATE_COUNT}`);
  });

  it('ProgressGauge receives value/total correctly', () => {
    renderWithTheme(
      'warm',
      <SsmBox
        channelId="c-x"
        channelOverride={legacyChannel}
        meetingOverride={makeMeeting({ stateIndex: 3 })}
      />,
    );
    const gauge = screen.getByTestId('progress-gauge');
    const warmGauge = gauge.querySelector('[data-gauge-variant="warm"]');
    expect(warmGauge).toBeTruthy();
    const ratio = Number(warmGauge?.getAttribute('data-gauge-ratio'));
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(1);
    expect(ratio).toBeCloseTo(4 / SESSION_STATE_COUNT, 4);
  });

  it('topic appears in description body', () => {
    renderWithTheme(
      'warm',
      <SsmBox
        channelId="c-x"
        channelOverride={legacyChannel}
        meetingOverride={makeMeeting({ topic: '릴리스 준비' })}
      />,
    );
    expect(screen.getByTestId('ssm-box-description').textContent).toContain(
      '릴리스 준비',
    );
  });
});

describe('SsmBox — meeting=null empty state (LegacyVariant)', () => {
  const legacyChannel = makeChannel({ role: null });

  it('renders empty label without gauge when meeting=null', () => {
    renderWithTheme(
      'warm',
      <SsmBox
        channelId="c-x"
        channelOverride={legacyChannel}
        meetingOverride={null}
      />,
    );
    const box = screen.getByTestId('ssm-box');
    expect(box.getAttribute('data-has-meeting')).toBe('false');
    expect(screen.getByTestId('ssm-box-empty')).toBeTruthy();
    expect(screen.queryByTestId('progress-gauge')).toBeNull();
  });

  it('falls back to LegacyVariant when channelId=null (no resolve possible)', () => {
    renderWithTheme(
      'warm',
      <SsmBox channelId={null} meetingOverride={null} channelOverride={null} />,
    );
    const box = screen.getByTestId('ssm-box');
    expect(box.getAttribute('data-ssm-variant')).toBe('legacy');
    expect(box.getAttribute('data-has-meeting')).toBe('false');
  });
});

describe('SsmBox — source-level hex color literal guard', () => {
  it('SsmBox/ folder files contain zero hex color literals', () => {
    const dir = resolve(__dirname, '..', 'SsmBox');
    const files = [
      'index.tsx',
      'shared.tsx',
      'IdeaVariant.tsx',
      'PlanningVariant.tsx',
      'DesignVariant.tsx',
      'ImplementVariant.tsx',
      'GeneralVariant.tsx',
      'LegacyVariant.tsx',
    ];
    for (const f of files) {
      const source = readFileSync(resolve(dir, f), 'utf-8');
      expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
    }
  });
});
