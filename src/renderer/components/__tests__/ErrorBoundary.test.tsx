// @vitest-environment jsdom

/**
 * ErrorBoundary tests — R10-Task8.
 *
 * Coverage:
 *   - Catches a throw in a child render → fallback UI renders.
 *   - "다시 시도" button resets the boundary; child re-renders.
 *   - useThrowToBoundary publishes a toast (non-blocking).
 *   - useThrowToBoundary({ rethrow: true }) escalates to fallback UI.
 *   - notifyError adds a toast item to the viewport.
 */

import { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __TEST__clearToasts,
  ErrorBoundary,
  notifyError,
  useThrowToBoundary,
} from '../ErrorBoundary';
import { i18next } from '../../i18n';

beforeEach(() => {
  void i18next.changeLanguage('ko');
  // Silence the explicit console.error from componentDidCatch and from
  // React's own boundary plumbing during the throw test.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // Toast bus is module-scoped, clear it between tests for isolation.
  __TEST__clearToasts();
});

afterEach(() => {
  cleanup();
  __TEST__clearToasts();
  vi.restoreAllMocks();
});

function Boom({ when }: { readonly when: boolean }): JSX.Element {
  if (when) throw new Error('boom-from-child');
  return <div data-testid="boom-child">child-ok</div>;
}

describe('ErrorBoundary — render-time throw', () => {
  it('catches a throw and renders the localized fallback', () => {
    render(
      <ErrorBoundary>
        <Boom when={true} />
      </ErrorBoundary>,
    );

    const fallback = screen.getByTestId('error-boundary-fallback');
    expect(fallback).toBeTruthy();
    expect(fallback.textContent).toContain('문제가 발생했습니다');
    expect(fallback.textContent).toContain('boom-from-child');
  });

  it('"다시 시도" button resets the boundary', async () => {
    // The retry button resets `state.error` inside the ErrorBoundary —
    // children must NOT throw on the subsequent render. We control that
    // via a top-level `crashed` toggle held by an outer wrapper that
    // exposes `setCrashed` through a useEffect-installed callback.
    let setCrashedExternal: ((v: boolean) => void) | null = null;
    function Wrapper(): JSX.Element {
      const [crashed, setCrashed] = useState(true);
      // Install AFTER render via effect so we don't violate
      // "no module-state writes during render" lint rule.
      useEffect(() => {
        setCrashedExternal = setCrashed;
        return () => {
          setCrashedExternal = null;
        };
      }, []);
      return (
        <ErrorBoundary>
          <Boom when={crashed} />
        </ErrorBoundary>
      );
    }

    render(<Wrapper />);

    expect(screen.getByTestId('error-boundary-fallback')).toBeTruthy();

    // Flip the wrapper state BEFORE clicking retry. Because the boundary
    // is currently rendering the fallback (children unmounted), this only
    // updates the wrapper's `crashed` prop; on retry, the boundary's
    // state.error resets and the children re-mount with `crashed=false`.
    act(() => {
      setCrashedExternal?.(false);
    });

    const retry = screen.getByTestId('error-boundary-retry');
    await act(async () => {
      fireEvent.click(retry);
    });

    await waitFor(() => {
      expect(screen.queryByTestId('error-boundary-fallback')).toBeNull();
      expect(screen.getByTestId('boom-child')).toBeTruthy();
    });
  });
});

describe('useThrowToBoundary', () => {
  function ThrowOnMount({
    rethrow,
    error,
  }: {
    readonly rethrow?: boolean;
    readonly error: Error;
  }): JSX.Element {
    const throwToBoundary = useThrowToBoundary();
    useEffect(() => {
      throwToBoundary(error, rethrow ? { rethrow: true } : undefined);
    }, [throwToBoundary, error, rethrow]);
    return <div data-testid="thrower">thrown</div>;
  }

  it('default — publishes a toast but keeps children mounted', async () => {
    render(
      <ErrorBoundary>
        <ThrowOnMount error={new Error('toast-only')} />
      </ErrorBoundary>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('error-toast')).toBeTruthy();
    });
    expect(screen.getByTestId('thrower')).toBeTruthy();
    expect(screen.queryByTestId('error-boundary-fallback')).toBeNull();
  });

  it('rethrow:true — escalates to the boundary fallback', async () => {
    render(
      <ErrorBoundary>
        <ThrowOnMount error={new Error('rethrow-please')} rethrow />
      </ErrorBoundary>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('error-boundary-fallback')).toBeTruthy();
    });
    expect(screen.queryByTestId('thrower')).toBeNull();
  });
});

describe('notifyError + toast viewport', () => {
  it('renders a toast when notifyError is called', async () => {
    render(
      <ErrorBoundary>
        <div data-testid="anchor">anchor</div>
      </ErrorBoundary>,
    );

    expect(screen.queryByTestId('error-toast')).toBeNull();

    act(() => {
      notifyError('manual-toast');
    });

    await waitFor(() => {
      const toast = screen.getByTestId('error-toast');
      expect(toast.textContent).toContain('manual-toast');
    });
  });
});
