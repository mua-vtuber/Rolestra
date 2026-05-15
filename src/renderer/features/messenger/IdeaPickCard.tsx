import { clsx } from 'clsx';
import {
  useCallback,
  useMemo,
  useState,
  type ReactElement,
} from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/primitives/button';
import { LineIcon } from '../../components/shell/LineIcon';
import { invoke } from '../../ipc/invoke';
import type { StreamIdeaPickSnapshotPayload } from '../../../shared/stream-events';

export interface IdeaPickCardProps {
  snapshot: StreamIdeaPickSnapshotPayload;
}

type ActionKind = 'idle' | 'approving' | 'requesting_more' | 'approved' | 'more_requested';

interface ActionState {
  kind: ActionKind;
  error: string | null;
}

export function IdeaPickCard({ snapshot }: IdeaPickCardProps): ReactElement {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(snapshot.selectedScreenIds ?? []),
  );
  const [comment, setComment] = useState('');
  const [action, setAction] = useState<ActionState>({
    kind: 'idle',
    error: null,
  });

  const selectedCount = selected.size;
  const canSubmit = selectedCount > 0 || comment.trim().length > 0;
  const locked =
    action.kind === 'approving' ||
    action.kind === 'requesting_more' ||
    action.kind === 'approved' ||
    action.kind === 'more_requested';

  const sortedSelected = useMemo(
    () => snapshot.cards.filter((card) => selected.has(card.screenId)),
    [snapshot.cards, selected],
  );

  const toggle = useCallback((screenId: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(screenId)) next.delete(screenId);
      else next.add(screenId);
      return next;
    });
  }, []);

  const submit = useCallback(
    async (kind: 'approve' | 'request_more'): Promise<void> => {
      if (!canSubmit || locked) return;
      setAction({
        kind: kind === 'approve' ? 'approving' : 'requesting_more',
        error: null,
      });
      const payload = {
        meetingId: snapshot.meetingId,
        selectedScreenIds: [...selected],
        userComment: comment,
      };
      try {
        const result =
          kind === 'approve'
            ? await invoke('meeting:idea-finalize-selection', payload)
            : await invoke('meeting:idea-request-more', payload);
        if (!result.ok) {
          setAction({ kind: 'idle', error: result.message });
          return;
        }
        setAction({
          kind: kind === 'approve' ? 'approved' : 'more_requested',
          error: null,
        });
      } catch (err) {
        setAction({
          kind: 'idle',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [canSubmit, comment, locked, selected, snapshot.meetingId],
  );

  return (
    <section
      data-testid="idea-pick-card"
      data-meeting-id={snapshot.meetingId}
      className="mx-4 my-3 rounded-md border border-border bg-elev p-4 shadow-sm"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
            {t('messenger.ideaPick.eyebrow')}
          </p>
          <h3 className="mt-1 text-base font-semibold text-fg">
            {t('messenger.ideaPick.title')}
          </h3>
          <p className="mt-1 text-xs text-fg-muted">
            {t('messenger.ideaPick.description')}
          </p>
        </div>
        <span
          data-testid="idea-pick-selected-count"
          className="shrink-0 rounded border border-border px-2 py-1 text-xs text-fg-muted"
        >
          {t('messenger.ideaPick.selectedCount', { count: selectedCount })}
        </span>
      </header>

      {sortedSelected.length > 0 ? (
        <div
          data-testid="idea-pick-kept-list"
          className="mt-3 rounded border border-border-subtle bg-sunk px-3 py-2 text-xs text-fg-muted"
        >
          <span className="font-medium text-fg">
            {t('messenger.ideaPick.keptLabel')}
          </span>{' '}
          {sortedSelected.map((card) => card.title || card.screenId).join(', ')}
        </div>
      ) : null}

      <div className="mt-3 grid gap-2">
        {snapshot.cards.map((card) => {
          const checked = selected.has(card.screenId);
          return (
            <label
              key={card.uuid}
              data-testid="idea-pick-option"
              data-screen-id={card.screenId}
              className={clsx(
                'grid cursor-pointer grid-cols-[auto_1fr] gap-3 rounded border p-3 transition-colors',
                checked
                  ? 'border-brand bg-brand/10'
                  : 'border-border-subtle bg-bg hover:bg-sunk',
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={locked}
                onChange={() => toggle(card.screenId)}
                className="mt-1 h-4 w-4 accent-brand"
                aria-label={t('messenger.ideaPick.optionAria', {
                  title: card.title,
                })}
              />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-fg">{card.title}</span>
                  <span className="text-[11px] text-fg-subtle">
                    {t('messenger.ideaPick.author', {
                      author: card.authorLabel,
                    })}
                  </span>
                </span>
                <span className="mt-1 block whitespace-pre-wrap text-xs text-fg-muted">
                  {card.content}
                </span>
                {card.rationale.trim().length > 0 ? (
                  <span className="mt-2 block text-[11px] text-fg-subtle">
                    {card.rationale}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>

      <label className="mt-3 block">
        <span className="mb-1 block text-xs font-medium text-fg">
          {t('messenger.ideaPick.commentLabel')}
        </span>
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          disabled={locked}
          data-testid="idea-pick-comment"
          rows={3}
          className="w-full resize-none rounded border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-brand disabled:opacity-60"
          placeholder={t('messenger.ideaPick.commentPlaceholder')}
        />
      </label>

      {action.error !== null ? (
        <p data-testid="idea-pick-error" className="mt-2 text-xs text-danger">
          {action.error}
        </p>
      ) : null}
      {action.kind === 'approved' ? (
        <p data-testid="idea-pick-success" className="mt-2 text-xs text-success">
          {t('messenger.ideaPick.approvedNotice')}
        </p>
      ) : null}
      {action.kind === 'more_requested' ? (
        <p data-testid="idea-pick-more-requested" className="mt-2 text-xs text-fg-muted">
          {t('messenger.ideaPick.moreRequestedNotice')}
        </p>
      ) : null}

      <footer className="mt-4 flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          tone="secondary"
          size="sm"
          disabled={!canSubmit || locked}
          onClick={() => void submit('request_more')}
          data-testid="idea-pick-request-more"
        >
          <LineIcon name="plus" size={14} className="mr-1" />
          {t('messenger.ideaPick.requestMore')}
        </Button>
        <Button
          type="button"
          tone="primary"
          size="sm"
          disabled={!canSubmit || locked}
          onClick={() => void submit('approve')}
          data-testid="idea-pick-approve"
        >
          <LineIcon name="arrow_right" size={14} className="mr-1" />
          {t('messenger.ideaPick.approve')}
        </Button>
      </footer>
    </section>
  );
}
