/**
 * CircuitBreakerApprovalRow — R10-Task4 Approval Inbox row variant.
 *
 * Closes R9 Known Concern #6: a Circuit Breaker downgrade fired the
 * approval row, but the inbox rendered it through the generic
 * `ApprovalBlock` which only knows allow/reject/conditional gestures.
 * That gesture set is misleading for a "resume autonomy" decision —
 * there is nothing to reject, just one button to clear the tripwire and
 * restore the prior autonomy mode.
 *
 * This row replaces the generic block when `approval.kind ===
 * 'circuit_breaker'`. It surfaces:
 *   - The tripwire icon + a localized title (which of the four
 *     tripwires fired).
 *   - A `한계값 / 측정값` readout pulled from the approval payload
 *     (`limit`, `detail`, `previousMode`).
 *   - The reason / detail text the breaker minted.
 *   - A single "재개" button that calls
 *     `typedInvoke('approval:decide', { id, decision: 'approve' })`.
 *     The backend ApprovalDecisionRouter handles the rest
 *     (`circuitBreaker.resetCounter` + `setAutonomy(previousMode)`).
 *
 * Design constraints (CLAUDE.md):
 *   - All user-facing strings flow through `t()` — no inline copy. The
 *     `approval.circuitBreaker.*` namespace is added to the renderer
 *     i18n catalogue alongside this component.
 *   - No hex literal colours; use theme tokens (panelClip / theme
 *     border / Card primitive).
 *   - IPC via the typed `invoke()` wrapper — channel literal must match
 *     `IpcChannelMap['approval:decide']`.
 */

import { useCallback, useState, type CSSProperties, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';

import { invoke } from '../../ipc/invoke';
import { useTheme } from '../../theme/use-theme';
import { Card, CardBody, CardFooter, CardHeader } from '../../components/primitives/card';
import { Button } from '../../components/primitives/button';
import {
  CIRCUIT_BREAKER_TRIPWIRES,
  type CircuitBreakerTripwire,
} from '../../../shared/circuit-breaker-types';
import type { ApprovalItem } from '../../../shared/approval-types';

export interface CircuitBreakerApprovalRowProps {
  item: ApprovalItem;
  /** Optional className passthrough for layout-side composition. */
  className?: string;
}

/** Visual mark used in the row header. Inline SVG keeps the bundle
 * theme-token-driven (`currentColor` honours `text-warning`). */
function TripwireIcon(): ReactElement {
  return (
    <svg
      data-testid="cb-approval-icon"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v9" />
      <path d="M5.6 8a8 8 0 1 0 12.8 0" />
    </svg>
  );
}

/**
 * Narrowed extraction of the breaker payload. The DB column is
 * `unknown` so we treat each field defensively.
 */
interface BreakerPayloadView {
  tripwire: CircuitBreakerTripwire | null;
  measured: number | null;
  threshold: number | null;
  reason: string | null;
  previousMode: string | null;
}

const TRIPWIRES_SET: ReadonlySet<string> = new Set(CIRCUIT_BREAKER_TRIPWIRES);

/**
 * Read the breaker payload off `item.payload` with shape-tolerance. The
 * approval row is created server-side with
 * `{source, tripwire, detail, previousMode}`; this helper pulls the
 * fields the row needs, accepting either the new `detail.threshold` /
 * `detail.measured` shape or the older `detail.count` / `detail.ms`
 * variants minted by the breaker `fire()` helper.
 */
function readPayload(item: ApprovalItem): BreakerPayloadView {
  const out: BreakerPayloadView = {
    tripwire: null,
    measured: null,
    threshold: null,
    reason: null,
    previousMode: null,
  };
  const payload = item.payload;
  if (!payload || typeof payload !== 'object') return out;
  const p = payload as Record<string, unknown>;

  if (typeof p.tripwire === 'string' && TRIPWIRES_SET.has(p.tripwire)) {
    out.tripwire = p.tripwire as CircuitBreakerTripwire;
  }
  if (typeof p.previousMode === 'string') {
    out.previousMode = p.previousMode;
  }
  if (typeof p.reason === 'string') {
    out.reason = p.reason;
  }
  if (typeof p.threshold === 'number') {
    out.threshold = p.threshold;
  }
  if (typeof p.measured === 'number') {
    out.measured = p.measured;
  }

  // Detail-shape fallbacks. The breaker emits one of `count` / `ms` /
  // `category` per tripwire — map to a single `measured` number.
  const detail = p.detail;
  if (detail && typeof detail === 'object') {
    const d = detail as Record<string, unknown>;
    if (out.measured === null && typeof d.count === 'number') {
      out.measured = d.count;
    }
    if (out.measured === null && typeof d.ms === 'number') {
      out.measured = d.ms;
    }
    if (out.threshold === null && typeof d.threshold === 'number') {
      out.threshold = d.threshold;
    }
    if (out.threshold === null && typeof d.limit === 'number') {
      out.threshold = d.limit;
    }
  }
  return out;
}

/**
 * Resolve the title string for the row header. Each tripwire takes its
 * own static `t()` call so `i18next-parser` can pick the keys up — a
 * dynamic template-literal key is invisible to the static parser and
 * gets pruned on the next `i18n:check` run.
 */
function resolveTripwireTitle(
  t: (key: string) => string,
  tripwire: CircuitBreakerTripwire | null,
): string {
  switch (tripwire) {
    case 'files_per_turn':
      return t('approval.circuitBreaker.title.files_per_turn');
    case 'cumulative_cli_ms':
      return t('approval.circuitBreaker.title.cumulative_cli_ms');
    case 'queue_streak':
      return t('approval.circuitBreaker.title.queue_streak');
    case 'same_error':
      return t('approval.circuitBreaker.title.same_error');
    case null:
    default:
      return t('approval.circuitBreaker.title.fallback');
  }
}

/**
 * Format `measured` / `threshold` for the readout. We render a placeholder
 * dash when a value is missing rather than dropping the row — the
 * visual structure stays consistent across tripwires and the user still
 * sees the resume button.
 */
function formatNumber(value: number | null): string {
  if (value === null) return '—';
  return String(value);
}

export function CircuitBreakerApprovalRow({
  item,
  className,
}: CircuitBreakerApprovalRowProps): ReactElement {
  const { t } = useTranslation();
  const { token } = useTheme();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const view = readPayload(item);
  const tripwireKey = view.tripwire ?? 'unknown';
  const title = resolveTripwireTitle(t, view.tripwire);

  const handleResume = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await invoke('approval:decide', {
        id: item.id,
        decision: 'approve',
      });
      // Success leaves the row in a `submitting=false` state that the
      // parent (`ApprovalInboxView`) will unmount when the
      // `stream:approval-decided` push lands. We do NOT optimistically
      // hide the row here so the IPC failure path can re-enable the
      // button without competing with the stream-driven merge.
      setSubmitting(false);
    } catch (err) {
      const message =
        err instanceof Error && err.message.length > 0
          ? err.message
          : t('approval.circuitBreaker.errors.generic');
      setError(message);
      setSubmitting(false);
    }
  }, [item.id, submitting, t]);

  const containerStyle: CSSProperties = {};
  if (token.panelClip !== 'none') {
    containerStyle.clipPath = token.panelClip;
  }

  return (
    <Card
      data-testid="cb-approval-row"
      data-approval-id={item.id}
      data-tripwire={tripwireKey}
      className={clsx('mx-4 my-2', className)}
      style={containerStyle}
    >
      <CardHeader
        heading={
          <span className="flex items-center gap-2 text-warning">
            <TripwireIcon />
            <span data-testid="cb-approval-title">{title}</span>
          </span>
        }
      />
      <CardBody className="flex flex-col gap-2">
        <p
          data-testid="cb-approval-readout"
          className="text-sm text-fg font-mono"
        >
          {t('approval.circuitBreaker.readout', {
            threshold: formatNumber(view.threshold),
            measured: formatNumber(view.measured),
          })}
        </p>
        {view.reason !== null && view.reason.length > 0 ? (
          <p data-testid="cb-approval-reason" className="text-sm text-fg-muted">
            {view.reason}
          </p>
        ) : null}
        {view.previousMode !== null ? (
          <p
            data-testid="cb-approval-previous-mode"
            className="text-xs text-fg-subtle"
          >
            {t('approval.circuitBreaker.previousMode', {
              mode: view.previousMode,
            })}
          </p>
        ) : null}
        {error !== null ? (
          <p
            role="alert"
            data-testid="cb-approval-error"
            className="text-xs text-danger"
          >
            {error}
          </p>
        ) : null}
      </CardBody>
      <CardFooter>
        <Button
          data-testid="cb-approval-resume"
          tone="primary"
          size="sm"
          onClick={handleResume}
          disabled={submitting}
        >
          {submitting
            ? t('approval.circuitBreaker.resuming')
            : t('approval.circuitBreaker.resume')}
        </Button>
      </CardFooter>
    </Card>
  );
}
