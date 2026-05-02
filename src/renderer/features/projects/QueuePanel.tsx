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
import { usePanelClipStyle } from '../../theme/use-panel-clip-style';
import type { QueueItem } from '../../../shared/queue-types';
import { QueueActiveSpotlight } from './QueueActiveSpotlight';
import { QueueStatBar, type QueueStatBarCounts } from './QueueStatBar';
import { QueueStatusMark } from './QueueStatusMark';
import { useChannels } from '../../hooks/use-channels';
import { useActiveChannelStore } from '../../stores/active-channel-store';
import { useAppViewStore } from '../../stores/app-view-store';
import { invoke } from '../../ipc/invoke';
import { getSkillTemplate } from '../../../shared/skill-catalog';
import type { Channel } from '../../../shared/channel-types';
import type { RoleId } from '../../../shared/role-types';

/**
 * R12-C round 4 (큐 정리): 큐 패널의 input 영역에서 직접 시작 부서를
 * 선택해 워크플로우를 시작한다. 아이디어 / 기획만 entry 시작 가능 —
 * 디자인 / 구현 / 검토는 인계 trigger 전용 (spec §4.1).
 */
const ENTRY_DEPARTMENTS: ReadonlyArray<RoleId> = ['idea', 'planning'];
const DEFAULT_ENTRY_DEPARTMENT: RoleId = 'idea';
const DEPT_ICON: Record<string, string> = {
  idea: '💡',
  planning: '📋',
};

function isFinishedToday(item: QueueItem): boolean {
  if (item.finishedAt === null) return false;
  const d = new Date(item.finishedAt);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function aggregateCounts(items: ReadonlyArray<QueueItem>): QueueStatBarCounts {
  let pending = 0;
  let inProgress = 0;
  let doneToday = 0;
  let failed = 0;
  for (const item of items) {
    if (item.status === 'pending') pending += 1;
    else if (item.status === 'in_progress') inProgress += 1;
    else if (item.status === 'failed') failed += 1;
    else if (item.status === 'done' && isFinishedToday(item)) doneToday += 1;
  }
  return { pending, inProgress, doneToday, failed };
}

export interface QueuePanelProps {
  projectId: string;
  /**
   * R12-C round 2: 사용자가 메신저 탭에서 어느 프로젝트의 큐를 보고
   * 있는지 즉시 식별할 수 있도록 패널 헤더에 prefix 로 노출 (의견 4-4).
   * 미지정 시 헤더는 R11 까지의 기본 ("할 일 큐 / Tasks") 만 표시.
   */
  projectName?: string | null;
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

export function QueuePanel({
  projectId,
  projectName = null,
  className,
}: QueuePanelProps): ReactElement {
  const { t } = useTranslation();
  const panelClip = usePanelClipStyle();
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
  // R12-C round 4 (큐 정리) — 시작 부서 선택. addLines 후 그 부서 채널로
  // 메시지 송신 + active 채널 전환 + 메신저 view 진입까지 하나의 흐름.
  const [department, setDepartment] = useState<RoleId>(DEFAULT_ENTRY_DEPARTMENT);
  const { channels: projectChannels } = useChannels(projectId);
  const setActiveChannelIdStore = useActiveChannelStore(
    (s) => s.setActiveChannelId,
  );
  const setView = useAppViewStore((s) => s.setView);
  const departmentChannelByRole = (() => {
    const map = new Map<RoleId, Channel>();
    if (projectChannels === null) return map;
    for (const channel of projectChannels) {
      if (channel.role !== null && channel.role !== 'general') {
        map.set(channel.role, channel);
      }
    }
    return map;
  })();

  // Use `localItems` only during a drag; otherwise render the authoritative
  // `items` from the hook directly (so stream updates + refresh are visible).
  const displayItems = localItems ?? items;

  const statCounts = aggregateCounts(items);
  const activeItem = items.find((i) => i.status === 'in_progress') ?? null;

  const handleAdd = async (): Promise<void> => {
    const text = input.trim();
    if (text.length === 0) return;
    setMutationError(null);
    // 1) 큐에 task 등록 — 기존 동작 보존. 큐 list 가 사용자 누적 기록.
    try {
      await addLines(text);
    } catch (reason) {
      setMutationError(
        reason instanceof Error ? reason : new Error(String(reason)),
      );
      return;
    }
    // 2) 선택한 부서 채널로 메시지 송신 → meeting-auto-trigger 가
    //    워크플로우 시작. 채널 active + messenger view 로 라우팅.
    const channel = departmentChannelByRole.get(department);
    if (!channel) {
      setMutationError(
        new Error(
          `선택한 부서 채널 (${getSkillTemplate(department).label.ko}) 을 찾을 수 없습니다.`,
        ),
      );
      return;
    }
    try {
      await invoke('message:append', {
        channelId: channel.id,
        content: text,
      });
      setInput('');
      setActiveChannelIdStore(projectId, channel.id);
      setView('messenger');
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
      data-panel-clip={panelClip.rawClip}
      style={panelClip.style}
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
          {projectName !== null && projectName.length > 0 ? (
            <span
              data-testid="queue-panel-project-name"
              className="text-fg-muted"
            >
              {projectName} ·
            </span>
          ) : null}
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
          <QueueStatBar counts={statCounts} />
          <QueueActiveSpotlight item={activeItem} />

          {/*
            R12-C round 4 (큐 정리): 사용자 의견 — "할 일 작성" 과 "할 일
            큐" 영역 역할이 겹쳤으므로 단일 입력 영역으로 통합. textarea +
            시작 부서 라디오 + 추가 버튼. 추가 클릭 시:
              1) 큐 list 에 항목 등록 (기존 동작)
              2) 선택한 부서 채널로 메시지 send → auto-trigger 회의
              3) 그 부서 채널 active + messenger view 진입
            큐 list 가 사용자의 누적 기록을 담당하고, 워크플로우 시작은
            같은 클릭에 묶여 있다.
          */}
          <div className="space-y-2">
            <textarea
              data-testid="queue-panel-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('queue.panel.addPlaceholder')}
              rows={3}
              className="w-full text-sm border border-border-soft rounded-panel px-2 py-1 bg-sunk text-fg"
            />
            <div
              role="radiogroup"
              data-testid="queue-panel-department-radio"
              className="flex flex-wrap items-center gap-2"
            >
              <span className="text-xs text-fg-muted">
                {t('queue.panel.startDepartmentLabel', {
                  defaultValue: '시작 부서',
                })}
              </span>
              {ENTRY_DEPARTMENTS.map((role) => {
                const checked = department === role;
                const labelKo = getSkillTemplate(role).label.ko;
                const icon = DEPT_ICON[role] ?? '•';
                return (
                  <label
                    key={role}
                    data-testid={`queue-panel-department-${role}`}
                    data-checked={checked ? 'true' : 'false'}
                    className={clsx(
                      'inline-flex cursor-pointer items-center gap-1 rounded-panel border px-2 py-0.5 text-xs',
                      checked
                        ? 'border-panel-border bg-sunk font-bold text-fg'
                        : 'border-transparent text-fg-muted hover:bg-sunk',
                    )}
                  >
                    <input
                      type="radio"
                      name="queue-panel-department"
                      value={role}
                      checked={checked}
                      onChange={() => setDepartment(role)}
                      className="sr-only"
                    />
                    <span aria-hidden="true">{icon}</span>
                    <span>{labelKo}</span>
                  </label>
                );
              })}
            </div>
            <div className="flex items-center justify-between">
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
                    <span data-testid="queue-panel-item-status">
                      <QueueStatusMark status={item.status} />
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
