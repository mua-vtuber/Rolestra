// @vitest-environment jsdom

/**
 * ApprovalBlock (R5-Task7) — themeKey 3-way container + miniBtnStyle
 * 버튼 재활용 + hex literal guard.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApprovalBlock } from '../ApprovalBlock';
import { i18next } from '../../../i18n';
import { ThemeProvider } from '../../../theme/theme-provider';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  useThemeStore,
} from '../../../theme/theme-store';
import type { ThemeKey } from '../../../theme/theme-tokens';
import type { Message as ChannelMessage } from '../../../../shared/message-types';

function makeApprovalMessage(
  overrides: Partial<ChannelMessage> = {},
): ChannelMessage {
  return {
    id: 'msg-a',
    channelId: 'c-plan',
    meetingId: null,
    authorId: 'prov-a',
    authorKind: 'member',
    role: 'assistant',
    content: '이 파일을 삭제해도 될까요?',
    meta: { approvalRef: 'appr-1' },
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

beforeEach(() => {
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
});

describe('ApprovalBlock — themeKey 3-way container', () => {
  it('warm: rounded-lg container + warning label + plain body', () => {
    renderWithTheme(
      'warm',
      <ApprovalBlock message={makeApprovalMessage()} onDecision={() => undefined} />,
    );
    const root = screen.getByTestId('approval-block');
    expect(root.getAttribute('data-theme-variant')).toBe('warm');
    expect(root.className).toContain('rounded-lg');
    expect(root.getAttribute('style')).not.toContain('clip-path');
    expect(screen.getByTestId('approval-block-label').textContent).toBe(
      '⚠ 승인 요청',
    );
    expect(screen.getByTestId('approval-block-body').getAttribute('data-style')).toBe(
      'plain',
    );
  });

  it('tactical: rounded-none + clip-path polygon + warning label plain body', () => {
    renderWithTheme(
      'tactical',
      <ApprovalBlock message={makeApprovalMessage()} onDecision={() => undefined} />,
    );
    const root = screen.getByTestId('approval-block');
    expect(root.getAttribute('data-theme-variant')).toBe('tactical');
    expect(root.className).toContain('rounded-none');
    expect(root.getAttribute('style')).toContain('clip-path');
    expect(screen.getByTestId('approval-block-label').textContent).toBe(
      '⚠ 승인 요청',
    );
    expect(screen.getByTestId('approval-block-body').getAttribute('data-style')).toBe(
      'plain',
    );
  });

  it('retro: [승인 요청] label + approvalBodyStyle="quote" body', () => {
    renderWithTheme(
      'retro',
      <ApprovalBlock message={makeApprovalMessage()} onDecision={() => undefined} />,
    );
    const root = screen.getByTestId('approval-block');
    expect(root.getAttribute('data-theme-variant')).toBe('retro');
    expect(root.getAttribute('data-approval-body-style')).toBe('quote');
    expect(screen.getByTestId('approval-block-label').textContent).toBe(
      '[승인 요청]',
    );
    const body = screen.getByTestId('approval-block-body');
    expect(body.getAttribute('data-style')).toBe('quote');
    expect(body.className).toContain('border-l-2');
    expect(body.className).toContain('font-mono');
  });
});

describe('ApprovalBlock — decision buttons reuse miniBtnStyle via shape="auto"', () => {
  it('warm miniBtnStyle="pill" → buttons have data-shape="pill"', () => {
    renderWithTheme(
      'warm',
      <ApprovalBlock message={makeApprovalMessage()} onDecision={() => undefined} />,
    );
    const allow = screen.getByTestId('approval-block-allow');
    const cond = screen.getByTestId('approval-block-conditional');
    const deny = screen.getByTestId('approval-block-deny');
    expect(allow.getAttribute('data-shape')).toBe('pill');
    expect(cond.getAttribute('data-shape')).toBe('pill');
    expect(deny.getAttribute('data-shape')).toBe('pill');
  });

  it('tactical miniBtnStyle="notched" → buttons have data-shape="notched"', () => {
    renderWithTheme(
      'tactical',
      <ApprovalBlock message={makeApprovalMessage()} onDecision={() => undefined} />,
    );
    expect(screen.getByTestId('approval-block-allow').getAttribute('data-shape')).toBe(
      'notched',
    );
  });

  it('retro miniBtnStyle="text" → buttons have data-shape="text"', () => {
    renderWithTheme(
      'retro',
      <ApprovalBlock message={makeApprovalMessage()} onDecision={() => undefined} />,
    );
    expect(screen.getByTestId('approval-block-allow').getAttribute('data-shape')).toBe(
      'text',
    );
  });

  it('onDecision is invoked with the correct decision token', () => {
    const onDecision = vi.fn();
    renderWithTheme(
      'warm',
      <ApprovalBlock message={makeApprovalMessage()} onDecision={onDecision} />,
    );
    fireEvent.click(screen.getByTestId('approval-block-allow'));
    fireEvent.click(screen.getByTestId('approval-block-conditional'));
    fireEvent.click(screen.getByTestId('approval-block-deny'));
    expect(onDecision).toHaveBeenNthCalledWith(1, 'allow');
    expect(onDecision).toHaveBeenNthCalledWith(2, 'conditional');
    expect(onDecision).toHaveBeenNthCalledWith(3, 'deny');
  });

  it('onDecision undefined → buttons disabled', () => {
    renderWithTheme(
      'warm',
      <ApprovalBlock message={makeApprovalMessage()} />,
    );
    expect(
      (screen.getByTestId('approval-block-allow') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId('approval-block-conditional') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId('approval-block-deny') as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('ApprovalBlock — source-level hex color literal guard', () => {
  it('ApprovalBlock.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'ApprovalBlock.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
