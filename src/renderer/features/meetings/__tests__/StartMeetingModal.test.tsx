// @vitest-environment jsdom

/**
 * StartMeetingModal (R5-Task7) — Radix Dialog 기반 topic 입력 + IPC payload
 * 검증 + 에러 표면 + 미셀렉트 채널 가드.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StartMeetingModal } from '../StartMeetingModal';
import { i18next } from '../../../i18n';
import { ThemeProvider } from '../../../theme/theme-provider';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  useThemeStore,
} from '../../../theme/theme-store';
import type { Meeting } from '../../../../shared/meeting-types';

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm-new',
    channelId: 'c-plan',
    topic: '회의 주제',
    state: 'CONVERSATION',
    stateSnapshotJson: null,
    startedAt: 1_700_000_000_000,
    endedAt: null,
    outcome: null,
    ...overrides,
  };
}

function stubBridge(
  handler: (channel: string, data: unknown) => Promise<unknown>,
): ReturnType<typeof vi.fn> {
  const invoke = vi.fn(handler);
  vi.stubGlobal('arena', { platform: 'linux', invoke });
  return invoke;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
});

describe('StartMeetingModal — open/close + validation', () => {
  it('closed modal renders nothing via portal content', () => {
    render(
      <ThemeProvider>
        <StartMeetingModal
          open={false}
          onOpenChange={() => undefined}
          channelId="c-plan"
        />
      </ThemeProvider>,
    );
    expect(screen.queryByTestId('start-meeting-modal')).toBeNull();
  });

  it('open=true → modal renders with topic input and submit button', () => {
    render(
      <ThemeProvider>
        <StartMeetingModal
          open
          onOpenChange={() => undefined}
          channelId="c-plan"
          channelName="기획"
        />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('start-meeting-modal')).toBeTruthy();
    expect(screen.getByTestId('start-meeting-topic')).toBeTruthy();
    expect(screen.getByTestId('start-meeting-submit')).toBeTruthy();
    expect(screen.getByTestId('start-meeting-channel-hint').textContent).toContain(
      '기획',
    );
  });

  it('submitting with empty topic surfaces required error', () => {
    render(
      <ThemeProvider>
        <StartMeetingModal
          open
          onOpenChange={() => undefined}
          channelId="c-plan"
        />
      </ThemeProvider>,
    );
    fireEvent.submit(screen.getByTestId('start-meeting-form'));
    expect(screen.getByTestId('start-meeting-error').textContent).toContain('주제');
  });

  it('topic shorter than 3 chars surfaces too-short error', () => {
    render(
      <ThemeProvider>
        <StartMeetingModal
          open
          onOpenChange={() => undefined}
          channelId="c-plan"
        />
      </ThemeProvider>,
    );
    fireEvent.change(screen.getByTestId('start-meeting-topic'), {
      target: { value: 'ab' },
    });
    fireEvent.submit(screen.getByTestId('start-meeting-form'));
    expect(screen.getByTestId('start-meeting-error').textContent).toContain('3');
  });

  it('topic longer than 200 chars surfaces too-long error', () => {
    render(
      <ThemeProvider>
        <StartMeetingModal
          open
          onOpenChange={() => undefined}
          channelId="c-plan"
        />
      </ThemeProvider>,
    );
    const tooLong = 'a'.repeat(201);
    fireEvent.change(screen.getByTestId('start-meeting-topic'), {
      target: { value: tooLong },
    });
    fireEvent.submit(screen.getByTestId('start-meeting-form'));
    expect(screen.getByTestId('start-meeting-error').textContent).toContain('200');
  });
});

describe('StartMeetingModal — submit wire-up', () => {
  it('valid topic → invoke channel:start-meeting with exact payload + onStarted + close', async () => {
    const expected = makeMeeting({ topic: 'n+1 리팩토링' });
    const invoke = stubBridge(async (channel, data) => {
      expect(channel).toBe('channel:start-meeting');
      expect(data).toEqual({ channelId: 'c-plan', topic: 'n+1 리팩토링' });
      return { meeting: expected };
    });
    const onStarted = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <ThemeProvider>
        <StartMeetingModal
          open
          onOpenChange={onOpenChange}
          channelId="c-plan"
          onStarted={onStarted}
        />
      </ThemeProvider>,
    );

    fireEvent.change(screen.getByTestId('start-meeting-topic'), {
      target: { value: '  n+1 리팩토링  ' },
    });
    fireEvent.submit(screen.getByTestId('start-meeting-form'));

    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(expected));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('IPC rejection → generic error surface + modal stays open', async () => {
    stubBridge(async () => {
      throw new Error('boom');
    });
    const onOpenChange = vi.fn();

    // Silence the intentional console.error emitted by the modal catch block.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <ThemeProvider>
        <StartMeetingModal
          open
          onOpenChange={onOpenChange}
          channelId="c-plan"
        />
      </ThemeProvider>,
    );
    fireEvent.change(screen.getByTestId('start-meeting-topic'), {
      target: { value: '회의 주제' },
    });
    fireEvent.submit(screen.getByTestId('start-meeting-form'));

    await waitFor(() =>
      expect(screen.getByTestId('start-meeting-error')).toBeTruthy(),
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    errSpy.mockRestore();
  });

  it('channelId=null → submit gated with error + submit button disabled', () => {
    render(
      <ThemeProvider>
        <StartMeetingModal
          open
          onOpenChange={() => undefined}
          channelId={null}
        />
      </ThemeProvider>,
    );
    const submit = screen.getByTestId('start-meeting-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });
});
