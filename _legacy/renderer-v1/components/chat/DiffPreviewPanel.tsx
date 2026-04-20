/**
 * Diff preview panel — shows file changes for approval/rejection.
 * Modify diffs show ±5 lines of context by default with expand toggle.
 */

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { DiffEntry } from '../../../shared/execution-types';

const CONTEXT_LINES = 5;

export interface DiffPreviewPanelProps {
  diffs: DiffEntry[];
  onApprove: () => void;
  onReject: () => void;
}

/**
 * Extract context-limited lines around changes between before and after content.
 * Returns { beforeSnippet, afterSnippet, hasMore } where hasMore indicates
 * whether the full content has more lines than the snippet.
 */
function extractContext(before: string, after: string): {
  beforeSnippet: string;
  afterSnippet: string;
  hasMore: boolean;
} {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const maxLen = Math.max(beforeLines.length, afterLines.length);

  // Find lines that differ
  const changedLineIndices = new Set<number>();
  for (let i = 0; i < maxLen; i++) {
    if ((beforeLines[i] ?? '') !== (afterLines[i] ?? '')) {
      changedLineIndices.add(i);
    }
  }

  if (changedLineIndices.size === 0) {
    return { beforeSnippet: before, afterSnippet: after, hasMore: false };
  }

  // Build set of lines to include (changed lines ± CONTEXT_LINES)
  const includedLines = new Set<number>();
  for (const idx of changedLineIndices) {
    for (let j = Math.max(0, idx - CONTEXT_LINES); j <= Math.min(maxLen - 1, idx + CONTEXT_LINES); j++) {
      includedLines.add(j);
    }
  }

  const hasMore = includedLines.size < maxLen;

  // Build contiguous ranges and join with separator
  const sortedLines = [...includedLines].sort((a, b) => a - b);
  const beforeParts: string[] = [];
  const afterParts: string[] = [];
  let lastLine = -2;

  for (const lineIdx of sortedLines) {
    if (lineIdx > lastLine + 1 && lastLine >= 0) {
      beforeParts.push('···');
      afterParts.push('···');
    }
    beforeParts.push(beforeLines[lineIdx] ?? '');
    afterParts.push(afterLines[lineIdx] ?? '');
    lastLine = lineIdx;
  }

  return {
    beforeSnippet: beforeParts.join('\n'),
    afterSnippet: afterParts.join('\n'),
    hasMore,
  };
}

export function DiffPreviewPanel({ diffs, onApprove, onReject }: DiffPreviewPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const opColor = (op: DiffEntry['operation']): string => {
    if (op === 'create') return 'var(--text-success)';
    if (op === 'delete') return 'var(--text-danger)';
    return 'var(--text-warning)';
  };

  return (
    <div className="diff-panel diff-panel--scroll">
      <div className="panel-header">
        <strong>{t('diff.title')}</strong>
        <span className="text-md" style={{ color: 'var(--text-tertiary)' }}>
          {t('diff.fileCount', { count: diffs.length })}
        </span>
      </div>

      {diffs.map((diff) => {
        const isExpanded = expandedPaths.has(diff.path);
        const isModify = diff.operation === 'modify' && diff.before != null && diff.after != null;

        // Compute context snippet; also determine if full content has more lines
        const ctx = (isModify && diff.before != null && diff.after != null)
          ? extractContext(diff.before, diff.after)
          : null;
        const canExpand = ctx?.hasMore ?? false;
        const beforeContent = isModify && !isExpanded && ctx ? ctx.beforeSnippet : diff.before;
        const afterContent = isModify && !isExpanded && ctx ? ctx.afterSnippet : diff.after;

        return (
          <div key={diff.path} className="diff-entry">
            <div className="diff-header">
              <code className="text-md">{diff.path}</code>
              <div className="diff-controls">
                {isModify && (canExpand || isExpanded) && (
                  <button
                    onClick={() => toggleExpand(diff.path)}
                    className="btn-control btn-control--xs"
                  >
                    {isExpanded ? t('diff.collapse') : t('diff.expand')}
                  </button>
                )}
                <span className="operation-badge" style={{ color: opColor(diff.operation) }}>
                  {t(`diff.op.${diff.operation}`)}
                </span>
              </div>
            </div>

            {isModify && (
              <div className="diff-compare">
                <div className={`diff-before ${isExpanded ? 'diff-height-lg' : 'diff-height-sm'}`}>
                  {beforeContent}
                </div>
                <div className={`diff-after ${isExpanded ? 'diff-height-lg' : 'diff-height-sm'}`}>
                  {afterContent}
                </div>
              </div>
            )}

            {diff.operation === 'create' && diff.after != null && (
              <div className="diff-create">
                {diff.after}
              </div>
            )}

            {diff.operation === 'delete' && diff.before != null && (
              <div className="diff-delete">
                {diff.before}
              </div>
            )}
          </div>
        );
      })}

      <div className="action-buttons" style={{ marginTop: 8 }}>
        <button onClick={onReject} className="btn-danger">
          {t('diff.reject')}
        </button>
        <button onClick={onApprove} className="btn-primary btn-primary--md">
          {t('diff.approve')}
        </button>
      </div>
    </div>
  );
}
