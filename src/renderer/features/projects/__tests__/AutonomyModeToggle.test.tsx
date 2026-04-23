// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '../../../i18n';
import { i18next } from '../../../i18n';
import { AutonomyModeToggle } from '../AutonomyModeToggle';

function setupArena(invoke: ReturnType<typeof vi.fn>): {
  emitStream: (type: string, payload: unknown) => void;
} {
  const subs = new Map<string, ((p: unknown) => void)[]>();
  vi.stubGlobal('arena', {
    platform: 'linux',
    invoke,
    onStream: (type: string, cb: (p: unknown) => void) => {
      const list = subs.get(type) ?? [];
      list.push(cb);
      subs.set(type, list);
      return () => {
        subs.set(type, (subs.get(type) ?? []).filter((h) => h !== cb));
      };
    },
  });
  return {
    emitStream: (type, payload) =>
      (subs.get(type) ?? []).forEach((cb) => cb(payload)),
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  void i18next.changeLanguage('ko');
});

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('AutonomyModeToggle', () => {
  it('renders 3 buttons with the current mode marked active', () => {
    setupArena(vi.fn());
    render(<AutonomyModeToggle projectId="p1" currentMode="manual" />);

    const manual = screen.getByTestId('autonomy-mode-manual');
    const auto = screen.getByTestId('autonomy-mode-auto_toggle');
    const queue = screen.getByTestId('autonomy-mode-queue');

    expect(manual.getAttribute('aria-pressed')).toBe('true');
    expect(auto.getAttribute('aria-pressed')).toBe('false');
    expect(queue.getAttribute('aria-pressed')).toBe('false');
    expect(manual.getAttribute('data-active')).toBe('true');
  });

  it('click manual → queue opens confirm dialog and does NOT invoke yet', () => {
    const invoke = vi.fn();
    setupArena(invoke);
    render(<AutonomyModeToggle projectId="p1" currentMode="manual" />);

    fireEvent.click(screen.getByTestId('autonomy-mode-queue'));

    expect(screen.getByTestId('autonomy-confirm-dialog')).toBeTruthy();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('auto_toggle → manual (downgrade) invokes immediately without dialog', async () => {
    const invoke = vi.fn().mockResolvedValue({ success: true });
    setupArena(invoke);
    render(<AutonomyModeToggle projectId="p1" currentMode="auto_toggle" />);

    fireEvent.click(screen.getByTestId('autonomy-mode-manual'));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('project:set-autonomy', {
        id: 'p1',
        mode: 'manual',
      });
    });
    expect(screen.queryByTestId('autonomy-confirm-dialog')).toBeNull();
  });

  it('full promote flow: click auto_toggle → ack → submit → invoke + dialog closes', async () => {
    const invoke = vi.fn().mockResolvedValue({ success: true });
    setupArena(invoke);
    render(<AutonomyModeToggle projectId="p1" currentMode="manual" />);

    fireEvent.click(screen.getByTestId('autonomy-mode-auto_toggle'));
    fireEvent.click(screen.getByTestId('autonomy-confirm-ack'));
    fireEvent.click(screen.getByTestId('autonomy-confirm-submit'));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('project:set-autonomy', {
        id: 'p1',
        mode: 'auto_toggle',
      });
    });
    await waitFor(() => {
      expect(screen.queryByTestId('autonomy-confirm-dialog')).toBeNull();
    });
  });

  it('cancel promotion → dialog closes + no invoke', () => {
    const invoke = vi.fn();
    setupArena(invoke);
    render(<AutonomyModeToggle projectId="p1" currentMode="manual" />);

    fireEvent.click(screen.getByTestId('autonomy-mode-auto_toggle'));
    fireEvent.click(screen.getByTestId('autonomy-confirm-cancel'));

    expect(screen.queryByTestId('autonomy-confirm-dialog')).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('stream:autonomy-mode-changed with matching projectId updates the active button', () => {
    const invoke = vi.fn();
    const { emitStream } = setupArena(invoke);
    render(<AutonomyModeToggle projectId="p1" currentMode="manual" />);

    act(() => {
      emitStream('stream:autonomy-mode-changed', {
        projectId: 'p1',
        mode: 'queue',
        reason: 'circuit_breaker',
      });
    });

    const queueBtn = screen.getByTestId('autonomy-mode-queue');
    expect(queueBtn.getAttribute('aria-pressed')).toBe('true');
  });
});
