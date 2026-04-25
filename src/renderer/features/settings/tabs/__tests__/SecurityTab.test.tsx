// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import '../../../../i18n';
import { i18next } from '../../../../i18n';
import { SecurityTab } from '../SecurityTab';

function makeRouter(
  routes: Record<string, (data: unknown) => unknown>,
): ReturnType<typeof vi.fn> {
  return vi.fn((channel: string, data: unknown) => {
    const handler = routes[channel];
    if (!handler) {
      return Promise.reject(new Error(`no mock for channel ${channel}`));
    }
    try {
      return Promise.resolve(handler(data));
    } catch (reason) {
      return Promise.reject(reason);
    }
  });
}

function setupArena(invoke: ReturnType<typeof vi.fn>): void {
  vi.stubGlobal('arena', {
    platform: 'linux',
    invoke,
    onStream: () => () => undefined,
  });
}

const allowOutput = {
  flags: ['--mode', 'hybrid'],
  rationale: ['permission.flag.reason.hybrid'],
  blocked: false,
  blockedReason: null,
};

const blockedOutput = {
  flags: [],
  rationale: ['permission.flag.reason.external_auto_forbidden'],
  blocked: true,
  blockedReason: 'external_auto_forbidden',
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  void i18next.changeLanguage('ko');
});

describe('SecurityTab', () => {
  it('opt-in toggle defaults to false', async () => {
    const invoke = makeRouter({
      'permission:dry-run-flags': () => allowOutput,
    });
    setupArena(invoke);

    render(<SecurityTab />);

    const toggle = (await screen.findByTestId(
      'settings-security-opt-in-toggle',
    )) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it('toggling opt-in re-runs permission:dry-run-flags with the new flag', async () => {
    const invoke = makeRouter({
      'permission:dry-run-flags': () => allowOutput,
    });
    setupArena(invoke);

    render(<SecurityTab />);

    await waitFor(() =>
      expect(
        invoke.mock.calls.filter((c) => c[0] === 'permission:dry-run-flags')
          .length,
      ).toBeGreaterThan(0),
    );

    const before = invoke.mock.calls.filter(
      (c) => c[0] === 'permission:dry-run-flags',
    ).length;

    const toggle = screen.getByTestId(
      'settings-security-opt-in-toggle',
    ) as HTMLInputElement;

    await act(async () => {
      fireEvent.click(toggle);
      await new Promise((r) => setTimeout(r, 0));
    });

    await waitFor(() => {
      const after = invoke.mock.calls.filter(
        (c) => c[0] === 'permission:dry-run-flags',
      ).length;
      expect(after).toBeGreaterThan(before);
    });

    const dryRunCalls = invoke.mock.calls.filter(
      (c) => c[0] === 'permission:dry-run-flags',
    );
    const lastCall = dryRunCalls[dryRunCalls.length - 1];
    expect(
      (lastCall[1] as { dangerousAutonomyOptIn: boolean })
        .dangerousAutonomyOptIn,
    ).toBe(true);
  });

  it('renders the returned flags when builder allows the combo', async () => {
    setupArena(
      makeRouter({
        'permission:dry-run-flags': () => allowOutput,
      }),
    );

    render(<SecurityTab />);

    const out = await screen.findByTestId('settings-security-preview-flags');
    expect(out.textContent).toContain('--mode hybrid');
    expect(out.getAttribute('data-blocked')).toBeNull();
  });

  it('renders a blocked banner when builder rejects the combo', async () => {
    setupArena(
      makeRouter({
        'permission:dry-run-flags': () => blockedOutput,
      }),
    );

    render(<SecurityTab />);

    const out = await screen.findByTestId('settings-security-preview-flags');
    expect(out.getAttribute('data-blocked')).toBe('true');
    expect(out.textContent).toContain('external_auto_forbidden');
  });
});
