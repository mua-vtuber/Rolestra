// @vitest-environment jsdom

/**
 * SsmBox (R5-Task9) — 2-way container (tactical clip) + ProgressGauge wire.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SsmBox } from '../SsmBox';
import { i18next } from '../../../i18n';
import { ThemeProvider } from '../../../theme/theme-provider';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  useThemeStore,
} from '../../../theme/theme-store';
import type { ThemeKey } from '../../../theme/theme-tokens';
import type { ActiveMeetingSummary } from '../../../../shared/meeting-types';
import { SESSION_STATE_COUNT } from '../../../../shared/constants';

function makeMeeting(
  overrides: Partial<ActiveMeetingSummary> = {},
): ActiveMeetingSummary {
  return {
    id: 'm-1',
    projectId: 'p-a',
    projectName: 'P',
    channelId: 'c-plan',
    channelName: '기획',
    topic: 'n+1 리팩토링',
    stateIndex: 2,
    stateName: 'WORK_DISCUSSING',
    startedAt: 1_700_000_000_000,
    elapsedMs: 3 * 60_000,
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
});

afterEach(() => {
  cleanup();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
});

describe('SsmBox — 2-way clip-path (tactical only)', () => {
  it('warm: panelRadius=12 + NO clip-path', () => {
    renderWithTheme('warm', <SsmBox meeting={makeMeeting()} />);
    const box = screen.getByTestId('ssm-box');
    expect(box.getAttribute('data-theme-variant')).toBe('warm');
    expect(box.getAttribute('data-panel-radius')).toBe('12');
    expect(box.getAttribute('style')).toContain('border-radius: 12px');
    expect(box.getAttribute('style')).not.toContain('clip-path');
  });

  it('tactical: panelRadius=0 + clip-path polygon', () => {
    renderWithTheme('tactical', <SsmBox meeting={makeMeeting()} />);
    const box = screen.getByTestId('ssm-box');
    expect(box.getAttribute('data-theme-variant')).toBe('tactical');
    expect(box.getAttribute('data-panel-radius')).toBe('0');
    expect(box.getAttribute('style')).toContain('clip-path');
    expect(box.getAttribute('style')).toContain('polygon');
  });

  it('retro: panelRadius=0 + NO clip-path + mono font', () => {
    renderWithTheme('retro', <SsmBox meeting={makeMeeting()} />);
    const box = screen.getByTestId('ssm-box');
    expect(box.getAttribute('data-theme-variant')).toBe('retro');
    expect(box.getAttribute('data-panel-radius')).toBe('0');
    expect(box.getAttribute('style')).not.toContain('clip-path');
    expect(box.className).toContain('font-mono');
  });
});

describe('SsmBox — meeting → ProgressGauge wire + label', () => {
  it('label renders "SSM N/TOTAL" with (stateIndex+1) / SESSION_STATE_COUNT', () => {
    renderWithTheme('warm', <SsmBox meeting={makeMeeting({ stateIndex: 4 })} />);
    const label = screen.getByTestId('ssm-box-label').textContent ?? '';
    expect(label).toBe(`SSM 5/${SESSION_STATE_COUNT}`);
  });

  it('ProgressGauge receives value/total correctly', () => {
    // R12-C2 T10b: SESSION_STATE_COUNT 가 12 → 8 (phase 모델). stateIndex=3
    // 으로 변경 — ratio = 4/8 = 0.5 로 phase 모델에서도 의미가 통하는 값.
    renderWithTheme('warm', <SsmBox meeting={makeMeeting({ stateIndex: 3 })} />);
    const gauge = screen.getByTestId('progress-gauge');
    const warmGauge = gauge.querySelector('[data-gauge-variant="warm"]');
    expect(warmGauge).toBeTruthy();
    const ratio = Number(warmGauge?.getAttribute('data-gauge-ratio'));
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(1);
    // expected ratio = (3+1) / SESSION_STATE_COUNT = 4 / 8 = 0.5
    expect(ratio).toBeCloseTo(4 / SESSION_STATE_COUNT, 4);
  });

  it('topic appears in description body', () => {
    renderWithTheme(
      'warm',
      <SsmBox meeting={makeMeeting({ topic: '릴리스 준비' })} />,
    );
    expect(screen.getByTestId('ssm-box-description').textContent).toContain(
      '릴리스 준비',
    );
  });
});

describe('SsmBox — meeting=null empty state', () => {
  it('renders empty label without gauge when meeting=null', () => {
    renderWithTheme('warm', <SsmBox meeting={null} />);
    const box = screen.getByTestId('ssm-box');
    expect(box.getAttribute('data-has-meeting')).toBe('false');
    expect(screen.getByTestId('ssm-box-empty')).toBeTruthy();
    expect(screen.queryByTestId('progress-gauge')).toBeNull();
  });
});

describe('SsmBox — source-level hex color literal guard', () => {
  it('SsmBox.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'SsmBox.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
