/**
 * ApprovalsWidget — right column of the R4 dashboard 2×2 grid (spans
 * both rows — the CSS grid-template-areas puts "approvals" in both row
 * slots so the widget naturally fills the full vertical extent).
 *
 * Lists up to `VISIBLE_LIMIT` pending approvals with a total count
 * badge in the header. Backed by {@link usePendingApprovals}, which
 * calls `approval:list` with `status='pending'`.
 *
 * R4: rows are non-interactive. R7 will wire the approval inbox
 * navigation via the optional `onRowActivate` prop.
 */
import { clsx } from 'clsx';
import { useCallback, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Card, CardHeader, CardBody } from '../../../components/primitives';
import { usePendingApprovals } from '../../../hooks/use-pending-approvals';
import { useSystemChannel } from '../../../hooks/use-system-channel';
import { useActiveChannelStore } from '../../../stores/active-channel-store';
import { useAppViewStore } from '../../../stores/app-view-store';
import { useActiveProject } from '../../../hooks/use-active-project';
import type { ApprovalItem } from '../../../../shared/approval-types';
import {
  CIRCUIT_BREAKER_TRIPWIRES,
  type CircuitBreakerTripwire,
} from '../../../../shared/circuit-breaker-types';

export interface ApprovalsWidgetProps {
  /** Max rows visible in the body. Extras contribute to the count badge only. */
  visibleLimit?: number;
  /**
   * Override the default navigation behaviour. When omitted the widget
   * routes to the approval's project `#승인-대기` (system_approval) channel
   * and switches the top-level view to `messenger` (R7-Task10). Pass a
   * custom handler when hosting the widget outside the standard shell
   * (storybook / tests / settings preview).
   */
  onRowActivate?: (item: ApprovalItem) => void;
  className?: string;
}

const DEFAULT_VISIBLE_LIMIT = 5;

const TRIPWIRES_SET: ReadonlySet<string> = new Set(CIRCUIT_BREAKER_TRIPWIRES);

/**
 * Resolve the tripwire label statically \u2014 i18next-parser \uac00 \uc815\uc801\uc73c\ub85c
 * \ud0a4\ub97c \uc218\uc9d1\ud558\ub3c4\ub85d switch \ubd84\uae30\ub85c \uc791\uc131. \ub3d9\uc801 \ud15c\ud50c\ub9bf \ud0a4\ub294 \ub2e4\uc74c i18n:check
 * \uc5d0\uc11c prune \ub41c\ub2e4.
 */
function resolveTripwireLabel(
  t: (key: string) => string,
  tripwire: CircuitBreakerTripwire,
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
  }
}

/**
 * Kind \ubcc4 1 \uc904 preview \u2014 payload `unknown` \uc744 \uc77d\uc5b4 \uc758\ubbf8 \uc788\ub294 \ud55c \uc904\uc744
 * \ub9cc\ub4e0\ub2e4. \uc774\uc804 \uad6c\ud604\uc740 `JSON.stringify` 80 \uc790 \uc808\ub2e8\uc744 \uadf8\ub300\ub85c \ub178\ucd9c\ud574
 * `{"source":"circuit_breaker","tripwire":"same_error","d\u2026` \uac19\uc740 raw
 * JSON \uc774 \ud654\uba74\uc5d0 \ubcf4\uc600\ub2e4 (dogfooding round2.6). kind \ubcc4 formatter \ub85c
 * \ub300\uccb4.
 *
 * payload \uac00 \ube48 \uac1d\uccb4\uc774\uac70\ub098 \uc608\uc0c1 \ud544\ub4dc\uac00 \ube44\uc5b4\uc788\uc73c\uba74 \ube48 \ubb38\uc790\uc5f4\uc744 \ubc18\ud658\ud574
 * row \uac00 kind \ub77c\ubca8 + \ube48 \ubd80\uc81c \ud615\ud0dc\ub85c \ub5a8\uc5b4\uc9c0\uac8c \ud55c\ub2e4 (raw JSON \ub178\ucd9c\ubcf4\ub2e4
 * \uc815\uc9c1).
 */
function previewByKind(
  t: (key: string, opts?: Record<string, unknown>) => string,
  item: ApprovalItem,
): string {
  const payload = item.payload;
  if (payload === null || payload === undefined) return '';
  const p = (typeof payload === 'object' ? payload : {}) as Record<
    string,
    unknown
  >;

  switch (item.kind) {
    case 'circuit_breaker': {
      const tripwire =
        typeof p.tripwire === 'string' && TRIPWIRES_SET.has(p.tripwire)
          ? (p.tripwire as CircuitBreakerTripwire)
          : null;
      if (tripwire === null) return '';
      return resolveTripwireLabel(t, tripwire);
    }
    case 'cli_permission': {
      const toolName = typeof p.toolName === 'string' ? p.toolName : '';
      const target = typeof p.target === 'string' ? p.target : '';
      if (toolName.length === 0 && target.length === 0) return '';
      return t('dashboard.approvals.preview.cli_permission', {
        toolName: toolName.length > 0 ? toolName : '\u2014',
        target: target.length > 0 ? target : '\u2014',
      });
    }
    case 'mode_transition': {
      const from = typeof p.currentMode === 'string' ? p.currentMode : '';
      const to = typeof p.targetMode === 'string' ? p.targetMode : '';
      if (from.length === 0 || to.length === 0) return '';
      return t('dashboard.approvals.preview.mode_transition', {
        from,
        to,
      });
    }
    case 'consensus_decision': {
      const votes =
        p.votes && typeof p.votes === 'object'
          ? (p.votes as Record<string, unknown>)
          : null;
      const yes = votes && typeof votes.yes === 'number' ? votes.yes : null;
      const no = votes && typeof votes.no === 'number' ? votes.no : null;
      if (yes === null || no === null) return '';
      return t('dashboard.approvals.preview.consensus_decision', {
        yes,
        no,
      });
    }
    case 'review_outcome':
    case 'failure_report':
      // Payload \ud0c0\uc785\uc774 \uc544\uc9c1 \uc815\uc758\ub418\uc9c0 \uc54a\uc740 kind \u2014 raw JSON \ub178\ucd9c\uc740 \uae08\uc9c0,
      // \ube48 \ubd80\uc81c\ub85c \ub454\ub2e4 (kind \ub77c\ubca8\ub9cc \ud45c\uc2dc).
      return '';
  }
}

export function ApprovalsWidget({
  visibleLimit = DEFAULT_VISIBLE_LIMIT,
  onRowActivate,
  className,
}: ApprovalsWidgetProps): ReactElement {
  const { t } = useTranslation();
  const { items, loading, error } = usePendingApprovals();

  // R7-Task10: default activation routes to the approval's project
  // `#승인-대기` channel + switches to the messenger view. Look up the
  // channel id via the active project(filter by active, not the
  // approval item's project — the two may differ when the user browses
  // approvals across projects in a future R10 multi-project dashboard).
  const { activeProjectId } = useActiveProject();
  const { channelId: inboxChannelId } = useSystemChannel(
    activeProjectId ?? null,
    'system_approval',
  );
  const setActiveChannelId = useActiveChannelStore(
    (s) => s.setActiveChannelId,
  );
  const setAppView = useAppViewStore((s) => s.setView);

  const defaultOnRowActivate = useCallback(
    (item: ApprovalItem): void => {
      // projectId null fallback — widget stays inert if no project is
      // active (we have nowhere safe to route the user to).
      if (activeProjectId === null) return;
      if (inboxChannelId !== null) {
        setActiveChannelId(activeProjectId, inboxChannelId);
      }
      setAppView('messenger');
      void item; // reserved for R10 per-row highlighting.
    },
    [activeProjectId, inboxChannelId, setActiveChannelId, setAppView],
  );

  const handleRowActivate = onRowActivate ?? defaultOnRowActivate;

  const total = items?.length ?? 0;
  const visible = items?.slice(0, visibleLimit) ?? [];

  const body = (() => {
    if (items === null && loading) {
      return (
        <div
          data-testid="approvals-widget-loading"
          className="text-sm text-fg-muted py-2"
        >
          {t('dashboard.approvals.loading')}
        </div>
      );
    }
    if (error !== null) {
      const message =
        error.message && error.message.length > 0
          ? error.message
          : t('dashboard.approvals.error');
      return (
        <div
          role="alert"
          data-testid="approvals-widget-error"
          className="text-sm text-danger py-2"
        >
          {message}
        </div>
      );
    }
    if (total === 0) {
      return (
        <div
          data-testid="approvals-widget-empty"
          className="text-sm text-fg-muted py-2"
        >
          {t('dashboard.approvals.empty')}
        </div>
      );
    }
    return (
      <ul
        data-testid="approvals-widget-list"
        className="flex flex-col gap-2"
      >
        {visible.map((item) => (
          <li
            key={item.id}
            data-testid="approvals-widget-row"
            data-approval-id={item.id}
            data-kind={item.kind}
            className="flex flex-col gap-1 border border-panel-border rounded-panel px-3 py-2"
          >
            <button
              type="button"
              data-testid="approvals-widget-row-activate"
              onClick={() => handleRowActivate(item)}
              className="text-left flex flex-col"
            >
              <span className="text-sm font-medium text-fg truncate">
                {t(`dashboard.approvals.kind.${item.kind}`, {
                  defaultValue: item.kind,
                })}
              </span>
              <span className="text-xs text-fg-muted truncate">
                {previewByKind(t, item)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  })();

  return (
    <Card
      data-testid="approvals-widget"
      className={clsx('flex flex-col', className)}
    >
      <CardHeader
        heading={t('dashboard.approvals.title')}
        count={items === null ? undefined : total}
      />
      <CardBody className="flex flex-col gap-2">{body}</CardBody>
    </Card>
  );
}
