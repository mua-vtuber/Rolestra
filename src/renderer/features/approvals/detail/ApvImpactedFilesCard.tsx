/**
 * ApvImpactedFilesCard — list of files projected by
 * `ExecutionService.dryRunPreview` for the active approval.
 *
 * R11-Task7 scope: shows path + change-kind chip per row. Line counts
 * default to 0 in the preview (real apply hasn't run) so we hide the
 * +/− columns until they are populated by a future apply-trace pass.
 *
 * Empty state: when the dryRunPreview returns no rows the card renders
 * a single placeholder row instead of vanishing — the user always sees
 * the section so the absence is intentional, not a load failure.
 */

import { clsx } from 'clsx';
import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { ApprovalImpactedFile } from '../../../../shared/approval-detail-types';
import { Card, CardBody, CardHeader } from '../../../components/primitives/card';

export interface ApvImpactedFilesCardProps {
  files: ApprovalImpactedFile[];
  className?: string;
}

function changeKindLabel(
  t: (k: string) => string,
  kind: ApprovalImpactedFile['changeKind'],
): string {
  if (kind === 'added') return t('approval.detail.impactedFiles.kind.added');
  if (kind === 'deleted') return t('approval.detail.impactedFiles.kind.deleted');
  return t('approval.detail.impactedFiles.kind.modified');
}

function changeKindClass(kind: ApprovalImpactedFile['changeKind']): string {
  if (kind === 'added') return 'text-success border-success';
  if (kind === 'deleted') return 'text-danger border-danger';
  return 'text-warning border-warning';
}

export function ApvImpactedFilesCard({
  files,
  className,
}: ApvImpactedFilesCardProps): ReactElement {
  const { t } = useTranslation();

  return (
    <Card
      data-testid="apv-impacted-files-card"
      data-row-count={String(files.length)}
      className={clsx('mx-4 my-2', className)}
    >
      <CardHeader heading={t('approval.detail.impactedFiles.title')} />
      <CardBody>
        {files.length === 0 ? (
          <p
            data-testid="apv-impacted-files-empty"
            className="text-xs text-fg-muted"
          >
            {t('approval.detail.impactedFiles.empty')}
          </p>
        ) : (
          <ul
            data-testid="apv-impacted-files-list"
            className="flex flex-col gap-1.5"
          >
            {files.map((file) => (
              <li
                key={`${file.path}::${file.changeKind}`}
                data-testid="apv-impacted-files-row"
                data-path={file.path}
                data-kind={file.changeKind}
                className="flex items-center gap-2 text-sm"
              >
                <span
                  data-testid="apv-impacted-files-kind"
                  className={clsx(
                    'inline-flex items-center font-mono text-[10px] font-bold uppercase tracking-wider',
                    'border whitespace-nowrap rounded-none px-2 py-0.5',
                    changeKindClass(file.changeKind),
                  )}
                >
                  {changeKindLabel(t, file.changeKind)}
                </span>
                <span
                  data-testid="apv-impacted-files-path"
                  className="font-mono text-xs text-fg break-all flex-1"
                >
                  {file.path}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
