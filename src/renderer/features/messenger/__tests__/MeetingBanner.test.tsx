// @vitest-environment jsdom

/**
 * MeetingBanner (R5-Task7) — themeKey 3-way DOM 단언 + retro 별도 JSX +
 * abort 콜백 + hex literal guard.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingBanner } from '../MeetingBanner';
import { i18next } from '../../../i18n';
import { ThemeProvider } from '../../../theme/theme-provider';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  useThemeStore,
} from '../../../theme/theme-store';
import type { ThemeKey } from '../../../theme/theme-tokens';
import type { ActiveMeetingSummary } from '../../../../shared/meeting-types';

function makeMeeting(
  overrides: Partial<ActiveMeetingSummary> = {},
): ActiveMeetingSummary {
  return {
    id: 'm-1',
    projectId: 'p-a',
    projectName: 'P',
    channelId: 'c-plan',
    channelName: '기획',
    topic: '회의 주제',
    stateIndex: 8,
    stateName: 'USER_DECISION',
    startedAt: 1_700_000_000_000,
    elapsedMs: 10 * 60_000 + 30_000,
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

describe('MeetingBanner — warm theme (heroBg + pulse dot + pill label)', () => {
  it('renders pulse dot + active label + topic + meta + abort button', () => {
    renderWithTheme(
      'warm',
      <MeetingBanner meeting={makeMeeting()} memberCount={3} onAbort={() => undefined} />,
    );
    const root = screen.getByTestId('meeting-banner');
    expect(root.getAttribute('data-theme-variant')).toBe('warm');
    expect(screen.getByTestId('meeting-banner-dot')).toBeTruthy();
    expect(screen.getByTestId('meeting-banner-label').textContent).toBe(
      '회의 진행중',
    );
    expect(screen.getByTestId('meeting-banner-topic').textContent).toBe(
      '회의 주제',
    );
    const meta = screen.getByTestId('meeting-banner-meta');
    expect(meta.textContent).toContain('3');
    expect(meta.textContent).toContain('10');
    expect(meta.textContent).toContain('SSM');
    expect(screen.queryByTestId('meeting-banner-retro-prefix')).toBeNull();
  });

  it('memberCount=null → dash placeholder in meta', () => {
    renderWithTheme(
      'warm',
      <MeetingBanner meeting={makeMeeting()} memberCount={null} />,
    );
    const meta = screen.getByTestId('meeting-banner-meta');
    expect(meta.textContent).toContain('—');
  });

  it('abort button disabled when onAbort is undefined', () => {
    renderWithTheme(
      'warm',
      <MeetingBanner meeting={makeMeeting()} memberCount={2} />,
    );
    const btn = screen.getByTestId('meeting-banner-abort') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('abort button click fires onAbort', () => {
    const onAbort = vi.fn();
    renderWithTheme(
      'warm',
      <MeetingBanner meeting={makeMeeting()} memberCount={2} onAbort={onAbort} />,
    );
    fireEvent.click(screen.getByTestId('meeting-banner-abort'));
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it('aborting=true → button disabled + label switches', () => {
    renderWithTheme(
      'warm',
      <MeetingBanner
        meeting={makeMeeting()}
        memberCount={2}
        onAbort={() => undefined}
        aborting
      />,
    );
    const btn = screen.getByTestId('meeting-banner-abort') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('종료 중…');
  });
});

describe('MeetingBanner — tactical theme (clip-path + spark icon + mono label)', () => {
  it('renders spark icon + mono label + meta on right', () => {
    renderWithTheme(
      'tactical',
      <MeetingBanner meeting={makeMeeting()} memberCount={3} onAbort={() => undefined} />,
    );
    const root = screen.getByTestId('meeting-banner');
    expect(root.getAttribute('data-theme-variant')).toBe('tactical');
    expect(root.getAttribute('style')).toContain('clip-path');
    expect(screen.queryByTestId('meeting-banner-dot')).toBeNull();
    expect(screen.getByTestId('meeting-banner-label').textContent).toBe(
      '회의 진행중',
    );
    expect(screen.getByTestId('meeting-banner-topic').textContent).toBe(
      '회의 주제',
    );
  });
});

describe('MeetingBanner — retro theme (별도 1-line mono strip)', () => {
  it('renders [진행중] prefix + topic + meta concatenated + abort as text link', () => {
    renderWithTheme(
      'retro',
      <MeetingBanner meeting={makeMeeting()} memberCount={3} onAbort={() => undefined} />,
    );
    const root = screen.getByTestId('meeting-banner');
    expect(root.getAttribute('data-theme-variant')).toBe('retro');
    expect(screen.getByTestId('meeting-banner-retro-prefix').textContent).toBe(
      '[진행중]',
    );
    expect(screen.getByTestId('meeting-banner-topic').textContent).toBe(
      '회의 주제',
    );
    const meta = screen.getByTestId('meeting-banner-meta');
    expect(meta.textContent).toContain(' · ');
    expect(meta.textContent).toContain('3');
    expect(meta.textContent).toContain('SSM');
    // retro has mono-only DOM; no warm pulse dot and no spark icon label.
    expect(screen.queryByTestId('meeting-banner-dot')).toBeNull();
    expect(screen.queryByTestId('meeting-banner-label')).toBeNull();
  });

  it('sub-minute elapsed floors to 0분', () => {
    renderWithTheme(
      'retro',
      <MeetingBanner
        meeting={makeMeeting({ elapsedMs: 45_000 })}
        memberCount={2}
      />,
    );
    expect(screen.getByTestId('meeting-banner-meta').textContent).toContain(
      '경과 0분',
    );
  });
});

describe('MeetingBanner — source-level hex color literal guard', () => {
  it('MeetingBanner.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'MeetingBanner.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
