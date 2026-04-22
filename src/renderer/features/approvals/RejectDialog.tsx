/**
 * RejectDialog — R7-Task5 승인 거절(reject) 확인 + 코멘트 입력 다이얼로그.
 *
 * spec §7.7: 거절/조건부 결정은 반드시 reasoning comment 를 수반할 수 있어야 한다.
 * reject 의 경우 zod schema(`approvalDecideSchema`) 는 comment 를 필수로 요구하지
 * 않지만, UX 상 거절 사유를 유도한다(비워두면 undefined 로 전달).
 *
 * Radix Dialog 로 modal 렌더 → `approval:decide` IPC 호출.
 * 에러는 inline banner 로 표면(ApprovalNotFoundError / AlreadyDecidedError /
 * generic). 다이얼로그 cancel / ESC / 외부 클릭 시 invoke 0.
 *
 * hex literal 0 규약 유지.
 */
import * as Dialog from '@radix-ui/react-dialog';
import { clsx } from 'clsx';
import {
  useCallback,
  useEffect,
  useReducer,
  type ReactElement,
} from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/primitives/button';
import { invoke } from '../../ipc/invoke';

export interface RejectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 거절 대상 approval id. null 이면 submit 비활성. */
  approvalId: string | null;
  /** IPC 성공 시 호출 — ApprovalBlock 이 후속 정리(닫기 등)를 맡는다. */
  onDecided?: (id: string) => void;
}

function mapErrorToI18nKey(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { name?: unknown };
    if (typeof e.name === 'string') {
      if (e.name === 'ApprovalNotFoundError') {
        return 'messenger.approval.errors.notFound';
      }
      if (e.name === 'AlreadyDecidedError') {
        return 'messenger.approval.errors.alreadyDecided';
      }
    }
  }
  return 'messenger.approval.errors.generic';
}

interface State {
  comment: string;
  submitting: boolean;
  error: string | null;
}
type Action =
  | { type: 'reset' }
  | { type: 'setComment'; comment: string }
  | { type: 'submitStart' }
  | { type: 'submitError'; message: string };
const INITIAL_STATE: State = { comment: '', submitting: false, error: null };
function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'reset':
      return INITIAL_STATE;
    case 'setComment':
      return { ...state, comment: action.comment };
    case 'submitStart':
      return { ...state, submitting: true, error: null };
    case 'submitError':
      return { ...state, submitting: false, error: action.message };
  }
}

export function RejectDialog({
  open,
  onOpenChange,
  approvalId,
  onDecided,
}: RejectDialogProps): ReactElement {
  const { t } = useTranslation();
  const [{ comment, submitting, error }, dispatch] = useReducer(
    reducer,
    INITIAL_STATE,
  );

  useEffect(() => {
    if (open) {
      dispatch({ type: 'reset' });
    }
  }, [open]);

  const handleClose = useCallback((): void => {
    if (submitting) return;
    onOpenChange(false);
  }, [onOpenChange, submitting]);

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (approvalId === null) return;
    dispatch({ type: 'submitStart' });
    try {
      const trimmed = comment.trim();
      await invoke('approval:decide', {
        id: approvalId,
        decision: 'reject',
        comment: trimmed.length > 0 ? trimmed : undefined,
      });
      onDecided?.(approvalId);
      onOpenChange(false);
    } catch (reason) {
      const key = mapErrorToI18nKey(reason);
      dispatch({ type: 'submitError', message: t(key) });
    }
  }, [approvalId, comment, onDecided, onOpenChange, t]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-testid="approval-reject-overlay"
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        />
        <Dialog.Content
          data-testid="approval-reject-dialog"
          data-approval-id={approvalId ?? ''}
          className={clsx(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'w-[min(28rem,calc(100vw-2rem))]',
            'bg-panel-bg text-fg border border-panel-border rounded-panel shadow-panel',
          )}
          onInteractOutside={(e) => {
            if (submitting) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (submitting) e.preventDefault();
          }}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border-soft bg-panel-header-bg">
            <Dialog.Title className="text-base font-display font-semibold">
              {t('messenger.approval.rejectDialog.title')}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button
                type="button"
                tone="ghost"
                size="sm"
                data-testid="approval-reject-close"
                aria-label={t('messenger.approval.rejectDialog.cancel')}
                disabled={submitting}
              >
                <span aria-hidden="true">{'✕'}</span>
              </Button>
            </Dialog.Close>
          </div>

          <div
            data-testid="approval-reject-body"
            className="px-5 py-4 text-sm text-fg flex flex-col gap-3"
          >
            <p>{t('messenger.approval.rejectDialog.body')}</p>
            <textarea
              data-testid="approval-reject-comment"
              className="w-full resize-none rounded-panel border border-panel-border bg-sunk px-3 py-2 text-sm text-fg focus:outline-none focus:ring-1 focus:ring-brand"
              rows={4}
              maxLength={4000}
              value={comment}
              placeholder={t(
                'messenger.approval.rejectDialog.placeholder',
              )}
              disabled={submitting}
              onChange={(e) =>
                dispatch({ type: 'setComment', comment: e.target.value })
              }
            />
            {error !== null && (
              <div
                role="alert"
                data-testid="approval-reject-error"
                className="text-sm text-danger border border-danger rounded-panel px-3 py-2 bg-sunk"
              >
                {error}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border-soft px-5 py-4 bg-panel-header-bg">
            <Button
              type="button"
              tone="ghost"
              data-testid="approval-reject-cancel"
              onClick={handleClose}
              disabled={submitting}
            >
              {t('messenger.approval.rejectDialog.cancel')}
            </Button>
            <Button
              type="button"
              tone="danger"
              data-testid="approval-reject-submit"
              disabled={submitting || approvalId === null}
              onClick={() => {
                void handleSubmit();
              }}
            >
              {t('messenger.approval.rejectDialog.submit')}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
