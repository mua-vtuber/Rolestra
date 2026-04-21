/**
 * ChannelDeleteConfirm — Task 10 채널 삭제 확인 dialog.
 *
 * Radix Dialog 확인 창으로 `channel:delete` IPC 호출.
 *
 * 시스템 채널은 ChannelHeader 의 delete 버튼이 disabled 이라 진입 자체가
 * 막히지만, 서비스 레벨 `SystemChannelProtectedError` 가 올라올 수 있으므로
 * inline 에러로 표면한다.
 *
 * 삭제된 채널이 현재 active 이면 호스트가 `onDeleted(channelId)` 수신 후
 * active 를 clear 한다 (컴포넌트는 순수 viewer).
 *
 * 서버 에러 매핑:
 *   SystemChannelProtectedError → systemProtected
 *   ChannelNotFoundError        → notFound
 *   기타                         → generic
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
import type { Channel } from '../../../shared/channel-types';

export interface ChannelDeleteConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 삭제 대상 채널. null 이면 submit 은 disabled. */
  channel: Channel | null;
  /** 성공 시 호출 — 호스트가 refetch + active clear(필요 시) 를 담당한다. */
  onDeleted?: (channelId: string) => void;
}

function mapErrorToI18nKey(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { name?: unknown };
    if (typeof e.name === 'string') {
      if (e.name === 'SystemChannelProtectedError') {
        return 'messenger.channelDelete.errors.systemProtected';
      }
      if (e.name === 'ChannelNotFoundError') {
        return 'messenger.channelDelete.errors.notFound';
      }
    }
  }
  return 'messenger.channelDelete.errors.generic';
}

interface State {
  submitting: boolean;
  error: string | null;
}
type Action =
  | { type: 'reset' }
  | { type: 'submitStart' }
  | { type: 'submitError'; message: string };
const INITIAL_STATE: State = { submitting: false, error: null };
function reducer(_state: State, action: Action): State {
  switch (action.type) {
    case 'reset':
      return INITIAL_STATE;
    case 'submitStart':
      return { submitting: true, error: null };
    case 'submitError':
      return { submitting: false, error: action.message };
  }
}

export function ChannelDeleteConfirm({
  open,
  onOpenChange,
  channel,
  onDeleted,
}: ChannelDeleteConfirmProps): ReactElement {
  const { t } = useTranslation();
  const [{ submitting, error }, dispatch] = useReducer(reducer, INITIAL_STATE);

  // 모달 열릴 때 state 초기화 — dispatch 만 사용해 react-hooks/
  // set-state-in-effect 에 걸리지 않도록 한다.
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
    if (channel === null) return;
    dispatch({ type: 'submitStart' });
    try {
      await invoke('channel:delete', { id: channel.id });
      onDeleted?.(channel.id);
      onOpenChange(false);
    } catch (reason) {
      const key = mapErrorToI18nKey(reason);
      dispatch({ type: 'submitError', message: t(key) });
    }
  }, [channel, onDeleted, onOpenChange, t]);

  // DM 은 '대화 닫기' 라벨로 전환(D11 결정 — rename 이 의미 없는 DM 도 delete
  // 로 로컬 종료 가능). 시스템 채널은 진입 차단 + 서비스 레벨 보호.
  // 라벨 분기는 정적 t() 호출을 사용한다 — 동적 key 를 t(variable) 로
  // 건네면 i18next-parser 가 키를 감지하지 못해 ko/en.json 에서 빈값으로
  // 덮어쓴다 (D14 패턴).
  const isDm = channel?.kind === 'dm';
  const titleLabel = isDm
    ? t('messenger.channelDelete.titleDm')
    : t('messenger.channelDelete.title');
  const submitLabel = isDm
    ? t('messenger.channelDelete.submitDm')
    : t('messenger.channelDelete.submit');
  const bodyLabel = isDm
    ? t('messenger.channelDelete.bodyDm', { name: channel?.name ?? '' })
    : t('messenger.channelDelete.body', { name: channel?.name ?? '' });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-testid="channel-delete-confirm-overlay"
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        />
        <Dialog.Content
          data-testid="channel-delete-confirm"
          data-channel-id={channel?.id}
          data-channel-kind={channel?.kind}
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
              {titleLabel}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button
                type="button"
                tone="ghost"
                size="sm"
                data-testid="channel-delete-confirm-close"
                aria-label={t('messenger.channelDelete.cancel')}
                disabled={submitting}
              >
                <span aria-hidden="true">{'✕'}</span>
              </Button>
            </Dialog.Close>
          </div>

          <div
            data-testid="channel-delete-confirm-body"
            className="px-5 py-4 text-sm text-fg"
          >
            <p>{bodyLabel}</p>
            <p className="mt-2 text-xs text-fg-muted">
              {t('messenger.channelDelete.irreversibleHint')}
            </p>

            {error !== null && (
              <div
                role="alert"
                data-testid="channel-delete-error"
                className="mt-3 text-sm text-danger border border-danger rounded-panel px-3 py-2 bg-sunk"
              >
                {error}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border-soft px-5 py-4 bg-panel-header-bg">
            <Button
              type="button"
              tone="ghost"
              data-testid="channel-delete-cancel"
              onClick={handleClose}
              disabled={submitting}
            >
              {t('messenger.channelDelete.cancel')}
            </Button>
            <Button
              type="button"
              tone="danger"
              data-testid="channel-delete-submit"
              disabled={submitting || channel === null}
              onClick={() => {
                void handleSubmit();
              }}
            >
              {submitLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
