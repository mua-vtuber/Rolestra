/**
 * QueuePanel — R9-Task3 project-scoped queue UI (spec §8 queue mode).
 *
 * Layout:
 *   - collapsible header ("할 일 큐 (N)" + pause/resume toggle)
 *   - multi-line textarea + "추가" button (line-per-item)
 *   - item list (drag handle / content / status badge / remove btn)
 *   - empty state
 *
 * Drag reorder uses HTML5 native drag events only — no dnd-kit dep (D3).
 * The committed order lives in local state; we optimistically reorder
 * the visible list on drop and ONLY THEN invoke `queue:reorder`. If the
 * invoke fails the stream snapshot (or manual refresh) restores the
 * authoritative order.
 */
import { clsx } from 'clsx';
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/primitives/button';
import { useQueue } from '../../hooks/use-queue';
import type { QueueItem, QueueItemStatus } from '../../../shared/queue-types';

export interface QueuePanelProps {
  projectId: string;
  className?: string;
}

function reorderLocal(
  items: QueueItem[],
  fromIdx: number,
  toIdx: number,
): QueueItem[] {
  if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return items;
  const copy = [...items];
  const [moved] = copy.splice(fromIdx, 1);
  if (moved === undefined) return items;
  copy.splice(toIdx, 0, moved);
  return copy;
}

function statusBadgeClass(status: QueueItemStatus): string {
  switch (status) {
    case 'in_progress':
      return 'bg-brand text-logo-fg';
    case 'done':
      return 'bg-success text-logo-fg';
    case 'failed':
      return 'bg-danger text-logo-fg';
    case 'cancelled':
    case 'paused':
      return 'bg-fg-muted text-logo-fg';
    case 'pending':
    default:
      return 'bg-panel-bg text-fg border border-border-soft';
  }
}

export function QueuePanel({ projectId, className }: QueuePanelProps): ReactElement {
  const { t } = useTranslation();
  const {
    items,
    paused,
    loading,
    error,
    addLines,
    remove,
    reorder,
    pause,
    resume,
  } = useQueue(projectId);

  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [input, setInput] = useState<string>('');
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [localItems, setLocalItems] = useState<QueueItem[] | null>(null);
  const [mutationError, setMutationError] = useState<Error | null>(null);

  // Use `localItems` only during a drag; otherwise render the authoritative
  // `items` from the hook directly (so stream updates + refresh are visible).
  const displayItems = localItems ?? items;

  const handleAdd = async (): Promise<void> => {
    const text = input.trim();
    if (text.length === 0) return;
    try {
      await addLines(text);
      setInput('');
      setMutationError(null);
    } catch (reason) {
      setMutationError(
        reason instanceof Error ? reason : new Error(String(reason)),
      );
    }
  };

  const handleTogglePause = async (): Promise<void> => {
    try {
      if (paused) await resume();
      else await pause();
      setMutationError(null);
    } catch (reason) {
      setMutationError(
        reason instanceof Error ? reason : new Error(String(reason)),
      );
    }
  };

  const handleDragStart = (idx: number) => (e: React.DragEvent): void => {
    setDragIdx(idx);
    setLocalItems(items);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (idx: number) => (e: React.DragEvent): void => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const base = localItems ?? items;
    setLocalItems(reorderLocal(base, dragIdx, idx));
    setDragIdx(idx);
  };

  const handleDrop = async (): Promise<void> => {
    const finalList = localItems;
    setDragIdx(null);
    setLocalItems(null);
    if (!finalList) return;
    const orderedIds = finalList.map((i) => i.id);
    const currentIds = items.map((i) => i.id);
    if (orderedIds.join(',') === currentIds.join(',')) return;
    try {
      await reorder(orderedIds);
      setMutationError(null);
    } catch (reason) {
      setMutationError(
        reason instanceof Error ? reason : new Error(String(reason)),
      );
    }
  };

  const handleRemove = (id: string) => async (): Promise<void> => {
    try {
      await remove(id);
      setMutationError(null);
    } catch (reason) {
      setMutationError(
        reason instanceof Error ? reason : new Error(String(reason)),
      );
    }
  };

  const displayError = mutationError ?? error;

  return (
    <section
      data-testid="queue-panel"
      data-project-id={projectId}
      data-paused={paused ? 'true' : 'false'}
      data-collapsed={collapsed ? 'true' : 'false'}
      className={clsx(
        'border border-panel-border rounded-panel bg-panel-bg',
        className,
      )}
    >
      <header className="flex items-center justify-between px-3 py-2 border-b border-border-soft bg-panel-header-bg">
        <button
          type="button"
          data-testid="queue-panel-toggle"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          className="flex items-center gap-2 text-sm font-display font-semibold"
        >
          <span aria-hidden="true">{collapsed ? '▶' : '▼'}</span>
          <span>{t('queue.panel.title', { count: items.length })}</span>
        </button>
        <Button
          type="button"
          tone={paused ? 'primary' : 'ghost'}
          size="sm"
          data-testid="queue-panel-pause-toggle"
          onClick={() => {
            void handleTogglePause();
          }}
        >
          {paused ? t('queue.panel.resume') : t('queue.panel.pause')}
        </Button>
      </header>

      {!collapsed && (
        <div className="p-3 space-y-3">
          <div>
            <textarea
              data-testid="queue-panel-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('queue.panel.addPlaceholder')}
              rows={3}
              className="w-full text-sm border border-border-soft rounded-panel px-2 py-1 bg-sunk text-fg"
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-fg-muted">
                {t('queue.panel.dragHint')}
              </span>
              <Button
                type="button"
                tone="primary"
                size="sm"
                data-testid="queue-panel-add"
                disabled={input.trim().length === 0 || loading}
                onClick={() => {
                  void handleAdd();
                }}
              >
                {t('queue.panel.add')}
              </Button>
            </div>
          </div>

          {displayError !== null && (
            <div
              role="alert"
              data-testid="queue-panel-error"
              className="text-xs text-danger border border-danger rounded-panel px-2 py-1 bg-sunk"
            >
              {displayError.message}
            </div>
          )}

          {displayItems.length === 0 ? (
            <p
              data-testid="queue-panel-empty"
              className="text-sm text-fg-muted italic"
            >
              {t('queue.panel.empty')}
            </p>
          ) : (
            <ul
              data-testid="queue-panel-list"
              className="space-y-1"
              onDrop={() => {
                void handleDrop();
              }}
              onDragOver={(e) => e.preventDefault()}
            >
              {displayItems.map((item, idx) => {
                const statusLabel =
                  item.status === 'pending'
                    ? t('queue.status.pending')
                    : item.status === 'in_progress'
                      ? t('queue.status.inProgress')
                      : item.status === 'done'
                        ? t('queue.status.done')
                        : item.status === 'failed'
                          ? t('queue.status.failed')
                          : item.status === 'cancelled'
                            ? t('queue.status.cancelled')
                            : t('queue.status.paused');
                return (
                  <li
                    key={item.id}
                    data-testid="queue-panel-item"
                    data-item-id={item.id}
                    data-status={item.status}
                    draggable
                    onDragStart={handleDragStart(idx)}
                    onDragOver={handleDragOver(idx)}
                    className={clsx(
                      'flex items-center gap-2 px-2 py-1.5 border border-border-soft rounded-panel bg-sunk',
                      item.status === 'in_progress' && 'ring-1 ring-brand',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="cursor-grab text-fg-muted select-none"
                    >
                      ⋮⋮
                    </span>
                    <span className="flex-1 text-sm truncate">{item.prompt}</span>
                    <span
                      data-testid="queue-panel-item-status"
                      className={clsx(
                        'text-[10px] px-1.5 py-0.5 rounded-panel',
                        statusBadgeClass(item.status),
                      )}
                    >
                      {statusLabel}
                    </span>
                    <button
                      type="button"
                      data-testid="queue-panel-item-remove"
                      aria-label={t('queue.panel.remove')}
                      disabled={item.status === 'in_progress'}
                      onClick={() => {
                        void handleRemove(item.id)();
                      }}
                      className="text-xs text-fg-muted hover:text-danger disabled:opacity-40"
                    >
                      {'✕'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
