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

/**
 * Truncate a kind-dependent preview string from the approval payload. The
 * payload shape is `unknown` at the type level (different kinds carry
 * different fields); we render a compact JSON preview bounded to keep the
 * widget height stable. Widgets down the line (R7 inbox) can replace this
 * with per-kind formatters.
 */
function previewPayload(payload: unknown): string {
  if (payload === null || payload === undefined) return '';
  if (typeof payload === 'string') return payload;
  try {
    const json = JSON.stringify(payload);
    return json.length > 80 ? json.slice(0, 80) + '\u2026' : json;
  } catch {
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
                {previewPayload(item.payload)}
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
