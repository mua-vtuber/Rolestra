/**
 * ApvDiffPreviewCard — narrative preview of the upcoming change.
 *
 * R11-Task7: the dryRunPreview projection currently emits a single
 * `preview` string per file (the CLI permission's description text)
 * because the CLI has not actually run yet — there is no real diff to
 * render. The card shows up to 3 previews and surfaces a "더 보기"
 * affordance when the panel was truncated server-side.
 *
 * The preview is rendered inside a `<pre>` so newlines and CLI-style
 * indentation survive intact. The container clamps height with a scroll
 * so a long preview never pushes the votes / action bar below the fold.
 */

import { clsx } from 'clsx';
import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { ApprovalDiffPreview } from '../../../../shared/approval-detail-types';
import { Card, CardBody, CardHeader } from '../../../components/primitives/card';

export interface ApvDiffPreviewCardProps {
  previews: ApprovalDiffPreview[];
  /**
   * Soft cap on rendered preview rows. The dryRunPreview projection
   * already trims server-side, but the card reapplies the cap so a hand-
   * crafted detail (tests, future fixtures) cannot blow past the visual
   * budget.
   */
  maxRows?: number;
  className?: string;
}

const DEFAULT_MAX_ROWS = 3;

export function ApvDiffPreviewCard({
  previews,
  maxRows = DEFAULT_MAX_ROWS,
  className,
}: ApvDiffPreviewCardProps): ReactElement {
  const { t } = useTranslation();
  const rendered = previews.slice(0, maxRows);
  const overflow = previews.length - rendered.length;

  return (
    <Card
      data-testid="apv-diff-preview-card"
      data-row-count={String(previews.length)}
      className={clsx('mx-4 my-2', className)}
    >
      <CardHeader heading={t('approval.detail.diffPreview.title')} />
      <CardBody className="flex flex-col gap-2">
        {rendered.length === 0 ? (
          <p
            data-testid="apv-diff-preview-empty"
            className="text-xs text-fg-muted"
          >
            {t('approval.detail.diffPreview.empty')}
          </p>
        ) : (
          rendered.map((preview, idx) => (
            <div
              key={`${preview.path}::${idx}`}
              data-testid="apv-diff-preview-row"
              data-path={preview.path}
              data-truncated={preview.truncated ? 'true' : 'false'}
              className="flex flex-col gap-1"
            >
              <span
                data-testid="apv-diff-preview-path"
                className="font-mono text-[11px] text-fg-subtle break-all"
              >
                {preview.path}
              </span>
              <pre
                data-testid="apv-diff-preview-body"
                className="font-mono text-xs text-fg whitespace-pre-wrap bg-sunk border border-panel-border rounded-panel px-2 py-1 max-h-40 overflow-auto"
              >
                {preview.preview}
              </pre>
              {preview.truncated && (
                <span
                  data-testid="apv-diff-preview-truncated"
                  className="text-[10px] text-fg-subtle"
                >
                  {t('approval.detail.diffPreview.truncatedHint')}
                </span>
              )}
            </div>
          ))
        )}
        {overflow > 0 && (
          <p
            data-testid="apv-diff-preview-overflow"
            className="text-[10px] text-fg-subtle"
          >
            {t('approval.detail.diffPreview.overflowHint', { extra: overflow })}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
