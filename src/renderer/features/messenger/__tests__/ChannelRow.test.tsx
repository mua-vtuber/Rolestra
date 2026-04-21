// @vitest-environment jsdom

/**
 * ChannelRow (R5-Task4) — themeKey 3-way 구조 diff + hex guard + click wiring.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChannelRow } from '../ChannelRow';
import { ThemeProvider } from '../../../theme/theme-provider';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../../../theme/theme-store';
import type { ThemeKey } from '../../../theme/theme-tokens';
import type { Channel } from '../../../../shared/channel-types';

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: 'c-1',
    projectId: 'p-a',
    name: 'general',
    kind: 'user',
    readOnly: false,
    createdAt: 1_700_000_000_000,
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

afterEach(() => {
  cleanup();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
});

describe('ChannelRow — themeKey 3-way glyph/shape differences', () => {
  it('warm: glyph "#", rounded-md, no clip-path', () => {
    renderWithTheme(
      'warm',
      <ChannelRow channel={makeChannel()} active={false} onClick={() => undefined} />,
    );
    const row = screen.getByTestId('channel-row');
    expect(row.getAttribute('data-theme-variant')).toBe('warm');
    const glyph = row.querySelector('[data-channel-glyph]');
    expect(glyph?.getAttribute('data-glyph-value')).toBe('#');
    expect(row.className).toContain('rounded-md');
    expect(row.className).not.toContain('rounded-none');
    expect(row.style.clipPath).toBe('');
  });

  it('tactical: glyph "#", rounded-none, clip-path polygon 4px', () => {
    renderWithTheme(
      'tactical',
      <ChannelRow channel={makeChannel()} active={false} onClick={() => undefined} />,
    );
    const row = screen.getByTestId('channel-row');
    expect(row.getAttribute('data-theme-variant')).toBe('tactical');
    const glyph = row.querySelector('[data-channel-glyph]');
    expect(glyph?.getAttribute('data-glyph-value')).toBe('#');
    expect(row.className).toContain('rounded-none');
    expect(row.style.clipPath).toContain('polygon');
    expect(row.style.clipPath).toContain('4px');
  });

  it('retro idle: glyph "·", rounded-none, mono font, no clip-path', () => {
    renderWithTheme(
      'retro',
      <ChannelRow channel={makeChannel()} active={false} onClick={() => undefined} />,
    );
    const row = screen.getByTestId('channel-row');
    expect(row.getAttribute('data-theme-variant')).toBe('retro');
    const glyph = row.querySelector('[data-channel-glyph]');
    expect(glyph?.getAttribute('data-glyph-value')).toBe('·');
    expect(row.className).toContain('rounded-none');
    expect(row.className).toContain('font-mono');
    expect(row.style.clipPath).toBe('');
  });

  it('retro active: glyph flips to "▶"', () => {
    renderWithTheme(
      'retro',
      <ChannelRow channel={makeChannel()} active={true} onClick={() => undefined} />,
    );
    const row = screen.getByTestId('channel-row');
    const glyph = row.querySelector('[data-channel-glyph]');
    expect(glyph?.getAttribute('data-glyph-value')).toBe('▶');
    expect(row.getAttribute('data-active')).toBe('true');
    expect(row.getAttribute('aria-current')).toBe('true');
  });

  it('warm active: applies project-item-active-bg Tailwind class', () => {
    renderWithTheme(
      'warm',
      <ChannelRow channel={makeChannel()} active={true} onClick={() => undefined} />,
    );
    const row = screen.getByTestId('channel-row');
    expect(row.className).toContain('bg-project-item-active-bg');
    expect(row.className).toContain('text-project-item-active-fg');
  });

  it('tactical active: applies brand-alpha bg + outline inline style', () => {
    renderWithTheme(
      'tactical',
      <ChannelRow channel={makeChannel()} active={true} onClick={() => undefined} />,
    );
    const row = screen.getByTestId('channel-row');
    expect(row.style.backgroundColor).toContain('color-mix');
    expect(row.style.backgroundColor).toContain('var(--color-brand)');
    expect(row.style.outline).toContain('color-mix');
  });
});

describe('ChannelRow — interaction + data-attributes', () => {
  it('click invokes onClick', () => {
    const onClick = vi.fn();
    renderWithTheme(
      'warm',
      <ChannelRow channel={makeChannel({ id: 'c-x' })} active={false} onClick={onClick} />,
    );
    fireEvent.click(screen.getByTestId('channel-row'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('exposes channelId + kind via data-attributes', () => {
    renderWithTheme(
      'tactical',
      <ChannelRow
        channel={makeChannel({ id: 'c-sys-1', kind: 'system_general', name: 'system-general' })}
        active={false}
        onClick={() => undefined}
      />,
    );
    const row = screen.getByTestId('channel-row');
    expect(row.getAttribute('data-channel-id')).toBe('c-sys-1');
    expect(row.getAttribute('data-channel-kind')).toBe('system_general');
    expect(row.textContent).toContain('system-general');
  });
});

describe('ChannelRow — source-level hex color literal guard', () => {
  it('ChannelRow.tsx contains zero hex color literals', () => {
    const source = readFileSync(resolve(__dirname, '..', 'ChannelRow.tsx'), 'utf-8');
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
