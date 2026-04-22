// @vitest-environment jsdom

/**
 * MemberRow (R5-Task9) — themeKey 3-way avatar vs status-dot + status mapping.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MemberRow } from '../MemberRow';
import { i18next } from '../../../i18n';
import { ThemeProvider } from '../../../theme/theme-provider';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  useThemeStore,
} from '../../../theme/theme-store';
import type { ThemeKey } from '../../../theme/theme-tokens';
import type {
  MemberView,
  WorkStatus,
} from '../../../../shared/member-profile-types';

function makeMember(overrides: Partial<MemberView> = {}): MemberView {
  return {
    providerId: 'p-alice',
    role: 'reviewer',
    personality: '',
    expertise: '',
    avatarKind: 'default',
    avatarData: null,
    statusOverride: null,
    updatedAt: 1_700_000_000_000,
    displayName: 'Alice',
    persona: '',
    workStatus: 'online' as WorkStatus,
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

describe('MemberRow — themeKey 3-way avatar vs status-dot', () => {
  it('warm: avatar rendered with circle shape + sans font', () => {
    renderWithTheme(
      'warm',
      <ul>
        <MemberRow member={makeMember()} />
      </ul>,
    );
    const row = screen.getByTestId('member-row');
    expect(row.getAttribute('data-theme-variant')).toBe('warm');
    // R8-Task7: ProfileAvatar with `profile` prop delegates to <Avatar>,
    // which exposes its own `data-testid="avatar"` + `data-shape`.
    const avatar = screen.getByTestId('avatar');
    expect(avatar.getAttribute('data-shape')).toBe('circle');
    const nameCol = screen.getByTestId('member-row-name').parentElement;
    expect(nameCol?.className).toContain('font-sans');
  });

  it('tactical: avatar rendered with diamond shape', () => {
    renderWithTheme(
      'tactical',
      <ul>
        <MemberRow member={makeMember()} />
      </ul>,
    );
    const row = screen.getByTestId('member-row');
    expect(row.getAttribute('data-theme-variant')).toBe('tactical');
    const avatar = screen.getByTestId('avatar');
    expect(avatar.getAttribute('data-shape')).toBe('diamond');
  });

  it('retro: NO avatar bubble, only status-dot button + mono font', () => {
    renderWithTheme(
      'retro',
      <ul>
        <MemberRow member={makeMember()} />
      </ul>,
    );
    const row = screen.getByTestId('member-row');
    expect(row.getAttribute('data-theme-variant')).toBe('retro');
    // No avatar bubble — only the trigger button wrapping a status-dot.
    expect(screen.queryByTestId('avatar')).toBeNull();
    expect(screen.queryByTestId('profile-avatar')).toBeNull();
    expect(screen.getByTestId('member-row-status-dot')).toBeTruthy();
    expect(screen.getByTestId('member-row-trigger')).toBeTruthy();
    const nameCol = screen.getByTestId('member-row-name').parentElement;
    expect(nameCol?.className).toContain('font-mono');
  });
});

describe('MemberRow — status dot colour mapping', () => {
  it('online → bg-success', () => {
    renderWithTheme(
      'warm',
      <ul>
        <MemberRow member={makeMember({ workStatus: 'online' })} />
      </ul>,
    );
    expect(screen.getByTestId('member-row-status-dot').className).toContain(
      'bg-success',
    );
  });

  it('connecting → bg-warning', () => {
    renderWithTheme(
      'warm',
      <ul>
        <MemberRow member={makeMember({ workStatus: 'connecting' })} />
      </ul>,
    );
    expect(screen.getByTestId('member-row-status-dot').className).toContain(
      'bg-warning',
    );
  });

  it('offline-manual → bg-fg-muted', () => {
    renderWithTheme(
      'warm',
      <ul>
        <MemberRow member={makeMember({ workStatus: 'offline-manual' })} />
      </ul>,
    );
    expect(screen.getByTestId('member-row-status-dot').className).toContain(
      'bg-fg-muted',
    );
  });
});

describe('MemberRow — source-level hex color literal guard', () => {
  it('MemberRow.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'MemberRow.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
