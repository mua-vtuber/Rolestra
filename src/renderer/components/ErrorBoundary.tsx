/**
 * `ErrorBoundary` — top-level renderer error catch-net (R10-Task8).
 *
 * Strategy:
 *   1. Class-based React error boundary (the conventional form — React 19
 *      still does NOT ship a hook-style alternative in core; the
 *      `useErrorBoundary` pattern only exists in third-party libs).
 *   2. Renders a localized fallback (`error.boundary.title` /
 *      `error.boundary.description`) with a "다시 시도" button that resets
 *      `state.error` to null so the children re-mount.
 *   3. Side-channel for hooks: `useThrowToBoundary()` returns a callback
 *      that schedules a synchronous throw on the next render via React's
 *      "throw in a setState callback" trick — the only documented way to
 *      surface a Promise rejection (mutation hook reject) into a class
 *      ErrorBoundary, which by spec only catches *render-time* throws.
 *      Implementation: a tiny zustand-free pub/sub registers all live
 *      `useThrowToBoundary` listeners; the hook re-throws inside its
 *      consumer's render after `setState`. Combined with `<ErrorBoundary>`
 *      wrapping `<App />`, any async mutation can call `throwToBoundary(err)`
 *      and the boundary will catch on the very next render tick.
 *   4. Toast hook: a minimal in-component toast strip is rendered at the
 *      bottom-right whenever an error is registered via `notifyError()`.
 *      No external toast lib (the project does not yet ship one — design
 *      §3 reserves toast UX for R10+). The toast is dismissable and
 *      auto-clears after 6 seconds. Strings via `t()` only — error
 *      messages from `Error.message` are surfaced verbatim because they
 *      come from caller-controlled IPC error codes (see `mapErrorToI18nKey`
 *      patterns in messenger features).
 *
 * D8 ordering invariant note: the boundary is the LAST line of defence.
 * Hooks should still rollback their own optimistic state BEFORE throwing
 * to the boundary — otherwise a click on "다시 시도" leaves the store in
 * a half-applied state.
 */
import {
  Component,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from './primitives/button';

// ── Toast bus (renderer-only, module-scope pub/sub) ────────────────────
//
// We intentionally avoid Zustand here: the toast list is a transient UI
// detail with no cross-component reads, and a 30-line module-local store
// avoids importing the heavier store baseline into the boundary file.

export interface ErrorToastItem {
  readonly id: string;
  readonly message: string;
  readonly createdAt: number;
}

type ToastListener = (items: readonly ErrorToastItem[]) => void;

const toastListeners = new Set<ToastListener>();
let toastBuffer: readonly ErrorToastItem[] = [];

const TOAST_TTL_MS = 6_000;

function makeToastId(): string {
  // crypto.randomUUID is available in Electron renderer contexts
  // (lib.dom + Node 20). Falling back to Date.now() guards against the
  // jsdom polyfill matrix that test environments may ship without it.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `toast-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function publishToasts(next: readonly ErrorToastItem[]): void {
  toastBuffer = next;
  toastListeners.forEach((listener) => listener(next));
}

/**
 * Push a new error toast. Returns the toast id so callers can dismiss it
 * early. Auto-clears after `TOAST_TTL_MS`.
 */
export function notifyError(message: string): string {
  const id = makeToastId();
  const item: ErrorToastItem = { id, message, createdAt: Date.now() };
  publishToasts([...toastBuffer, item]);
  setTimeout(() => {
    publishToasts(toastBuffer.filter((t) => t.id !== id));
  }, TOAST_TTL_MS);
  return id;
}

export function dismissToast(id: string): void {
  publishToasts(toastBuffer.filter((t) => t.id !== id));
}

/**
 * Test helper: clears the toast buffer. Exported for unit-test isolation
 * — production code never invokes this. Marked as `__TEST__` to make
 * usage from app code stand out in code review.
 */
export function __TEST__clearToasts(): void {
  publishToasts([]);
}

/** Subscribe to toast updates. Returns unsubscribe. */
function subscribeToasts(listener: ToastListener): () => void {
  toastListeners.add(listener);
  listener(toastBuffer);
  return () => {
    toastListeners.delete(listener);
  };
}

// ── Throw-to-boundary side channel ─────────────────────────────────────
//
// React's class ErrorBoundary only catches errors thrown DURING render.
// Hook mutations reject asynchronously, so we re-throw on the next render
// via setState. The `pendingErrors` set is consumed by the
// `<ThrowSentinel>` component mounted just inside `<ErrorBoundary>` —
// when an error is queued, the sentinel re-renders and throws.

type SentinelListener = (err: Error) => void;
const sentinelListeners = new Set<SentinelListener>();

/**
 * Hook that returns a stable `(err) => void` callback. Default behaviour
 * is to publish a toast (non-blocking) — the right UX for a single async
 * mutation rejection where the rest of the app is still usable.
 *
 * Pass `{ rethrow: true }` to ALSO surface the error to the nearest
 * `<ErrorBoundary>` via the sentinel re-throw bus. That escalates to a
 * full-screen fallback and is intended for catastrophic failures where
 * keeping the current UI mounted would mislead the user (e.g. the IPC
 * bridge died, every subsequent invoke would also reject).
 *
 * The single hook intentionally covers both surfaces because the 3
 * R10-Task8 mutation hooks each have a different policy ceiling:
 *   - `use-channel-messages.send` — toast only (Composer keeps inline UX)
 *   - `use-autonomy-mode.confirm` — toast only (caller's dialog renders)
 *   - `use-queue.addLines`        — toast only (panel re-fetches naturally)
 * but a higher-level fallback can request `rethrow: true` if needed.
 */
interface ThrowToBoundaryOptions {
  readonly rethrow?: boolean;
}

export function useThrowToBoundary(): (
  err: unknown,
  options?: ThrowToBoundaryOptions,
) => void {
  return useCallback((err: unknown, options?: ThrowToBoundaryOptions) => {
    const error = err instanceof Error ? err : new Error(String(err));
    notifyError(error.message);
    if (options?.rethrow === true) {
      sentinelListeners.forEach((listener) => listener(error));
    }
  }, []);
}

/**
 * Sentinel component — subscribes to the throw bus and re-throws inside
 * its render so the parent `<ErrorBoundary>` catches it.
 */
function ThrowSentinel(): null {
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const listener: SentinelListener = (err) => setError(err);
    sentinelListeners.add(listener);
    return () => {
      sentinelListeners.delete(listener);
    };
  }, []);

  if (error !== null) {
    // Reset before throw so the boundary's retry can re-mount this
    // sentinel cleanly. The throw propagates up and React unmounts this
    // subtree before the `setError(null)` would run, so this assignment
    // is benign — but we keep it explicit to document intent.
    const captured = error;
    setError(null);
    throw captured;
  }
  return null;
}

// ── ErrorBoundary class component ──────────────────────────────────────

interface ErrorBoundaryProps {
  readonly children: ReactNode;
  /**
   * Optional render override for the fallback UI. Receives the captured
   * error and a `retry()` function that resets the boundary.
   */
  readonly fallback?: (props: { error: Error; retry: () => void }) => ReactNode;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  public state: ErrorBoundaryState = { error: null };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    // Console log (renderer only). Production crash reports are local-only
    // per design §12 — no remote telemetry.
    console.error('[rolestra] ErrorBoundary caught', error, info.componentStack);
    notifyError(error.message);
  }

  private readonly handleRetry = (): void => {
    this.setState({ error: null });
  };

  public override render(): ReactNode {
    const { error } = this.state;
    const { children, fallback } = this.props;
    if (error !== null) {
      if (fallback) {
        return fallback({ error, retry: this.handleRetry });
      }
      return <DefaultFallback error={error} retry={this.handleRetry} />;
    }
    return (
      <>
        <ThrowSentinel />
        {children}
        <ErrorToastViewport />
      </>
    );
  }
}

// ── Default fallback UI ────────────────────────────────────────────────

interface DefaultFallbackProps {
  readonly error: Error;
  readonly retry: () => void;
}

function DefaultFallback({ error, retry }: DefaultFallbackProps): ReactNode {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      data-testid="error-boundary-fallback"
      className="flex h-full min-h-screen w-full flex-col items-center justify-center gap-4 bg-bg p-8 text-fg"
    >
      <h1 className="text-2xl font-semibold">
        {t('error.boundary.title')}
      </h1>
      <p className="max-w-prose text-center text-sm text-muted">
        {t('error.boundary.description')}
      </p>
      <pre className="max-w-prose whitespace-pre-wrap rounded border border-border bg-sunk p-3 text-xs text-muted">
        {error.message}
      </pre>
      <Button
        type="button"
        tone="primary"
        onClick={retry}
        data-testid="error-boundary-retry"
      >
        {t('error.boundary.retry')}
      </Button>
    </div>
  );
}

// ── Toast viewport ─────────────────────────────────────────────────────

function ErrorToastViewport(): ReactNode {
  const [items, setItems] = useState<readonly ErrorToastItem[]>(toastBuffer);
  const { t } = useTranslation();

  useEffect(() => subscribeToasts(setItems), []);

  if (items.length === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="error-toast-viewport"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
    >
      {items.map((item) => (
        <div
          key={item.id}
          data-testid="error-toast"
          className="pointer-events-auto flex max-w-sm items-start gap-3 rounded border border-danger bg-elev p-3 text-sm text-fg shadow"
        >
          <div className="flex-1">
            <div className="font-medium text-danger">
              {t('error.toast.title')}
            </div>
            <div className="mt-1 text-xs text-muted">{item.message}</div>
          </div>
          <button
            type="button"
            data-testid="error-toast-dismiss"
            onClick={() => dismissToast(item.id)}
            className="text-xs text-muted hover:text-fg"
            aria-label={t('error.toast.dismiss')}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * HOC sugar: `withErrorBoundary(MyComponent)` for screen-level isolation
 * without re-typing the boundary props.
 */
export function withErrorBoundary<P extends object>(
  Wrapped: ComponentType<P>,
  fallback?: ErrorBoundaryProps['fallback'],
): ComponentType<P> {
  function Bounded(props: P): ReactNode {
    return (
      <ErrorBoundary fallback={fallback}>
        <Wrapped {...props} />
      </ErrorBoundary>
    );
  }
  Bounded.displayName = `WithErrorBoundary(${Wrapped.displayName ?? Wrapped.name ?? 'Component'})`;
  return Bounded;
}
