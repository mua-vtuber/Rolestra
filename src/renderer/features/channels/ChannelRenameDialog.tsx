/**
 * ChannelRenameDialog — Task 10 채널 이름 변경 dialog.
 *
 * Radix Dialog + 단일 이름 입력으로 `channel:rename` IPC 호출.
 *
 * 시스템 채널은 ChannelHeader 의 rename 버튼이 이미 disabled 이므로 진입
 * 자체가 막히지만, defence-in-depth 로 서비스 레벨에서도
 * `SystemChannelProtectedError` 가 올라오면 inline 에러로 표면한다.
 *
 * 서버 에러 매핑:
 *   DuplicateChannelNameError    → duplicateName
 *   SystemChannelProtectedError  → systemProtected
 *   ChannelNotFoundError         → notFound
 *   기타                          → generic
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

export interface ChannelRenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 대상 채널. null 이면 dialog 가 열려 있어도 내부 form 은 idle. */
  channel: Channel | null;
  /** 성공 시 호출. 호스트가 refetch 를 담당한다. */
  onRenamed?: (channel: Channel) => void;
}

const NAME_MIN_LEN = 3;
const NAME_MAX_LEN = 50;
const NAME_INPUT_MAX = NAME_MAX_LEN + 1;

interface FormState {
  name: string;
  submitting: boolean;
  error: string | null;
}

const INITIAL_STATE: FormState = {
  name: '',
  submitting: false,
  error: null,
};

type FormAction =
  | { type: 'setName'; value: string }
  | { type: 'submitStart' }
  | { type: 'submitError'; message: string }
  | { type: 'resetWithName'; name: string };

function reducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'setName':
      return { ...state, name: action.value, error: null };
    case 'submitStart':
      return { ...state, submitting: true, error: null };
    case 'submitError':
      return { ...state, submitting: false, error: action.message };
    case 'resetWithName':
      return { name: action.name, submitting: false, error: null };
  }
}

function mapErrorToI18nKey(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { name?: unknown };
    if (typeof e.name === 'string') {
      if (e.name === 'DuplicateChannelNameError') {
        return 'messenger.channelRename.errors.duplicateName';
      }
      if (e.name === 'SystemChannelProtectedError') {
        return 'messenger.channelRename.errors.systemProtected';
      }
      if (e.name === 'ChannelNotFoundError') {
        return 'messenger.channelRename.errors.notFound';
      }
    }
  }
  return 'messenger.channelRename.errors.generic';
}

export function ChannelRenameDialog({
  open,
  onOpenChange,
  channel,
  onRenamed,
}: ChannelRenameDialogProps): ReactElement {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  // 모달이 열릴 때 대상 채널의 현재 이름으로 input 을 prefill.
  useEffect(() => {
    if (open) {
      dispatch({ type: 'resetWithName', name: channel?.name ?? '' });
    }
  }, [open, channel]);

  const handleClose = useCallback((): void => {
    if (state.submitting) return;
    onOpenChange(false);
  }, [onOpenChange, state.submitting]);

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (channel === null) return;
    const trimmed = state.name.trim();
    // Unchanged 체크는 length validation 앞에 둔다. 기존 이름이 min 제약을
    // 충족하지 않는 경계 케이스(예: 과거에 더 짧은 이름이 허용됐던 row 가
    // 남아있다면) 에도 "변경 없이 닫기"가 정상 동작하도록.
    if (trimmed === channel.name) {
      onOpenChange(false);
      return;
    }
    // R12-C round 4 (#1-4): 부서 채널 (role !== null) 은 빈 이름 허용 —
    // backend 가 SKILL_CATALOG 라벨로 자동 복원한다. 자유 user 채널 / DM 은
    // 식별 가능한 이름 필요해서 차단 유지.
    const isDepartmentChannel = channel.role !== null;
    if (trimmed.length === 0 && !isDepartmentChannel) {
      dispatch({
        type: 'submitError',
        message: t('messenger.channelRename.errors.nameRequired'),
      });
      return;
    }
    if (
      trimmed.length > 0 &&
      trimmed.length < NAME_MIN_LEN &&
      !isDepartmentChannel
    ) {
      dispatch({
        type: 'submitError',
        message: t('messenger.channelRename.errors.nameTooShort', {
          min: NAME_MIN_LEN,
        }),
      });
      return;
    }
    if (trimmed.length > NAME_MAX_LEN) {
      dispatch({
        type: 'submitError',
        message: t('messenger.channelRename.errors.nameTooLong', {
          max: NAME_MAX_LEN,
        }),
      });
      return;
    }

    dispatch({ type: 'submitStart' });
    try {
      const { channel: updated } = await invoke('channel:rename', {
        id: channel.id,
        name: trimmed,
      });
      onRenamed?.(updated);
      onOpenChange(false);
    } catch (reason) {
      const key = mapErrorToI18nKey(reason);
      dispatch({ type: 'submitError', message: t(key) });
    }
  }, [channel, onOpenChange, onRenamed, state.name, t]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-testid="channel-rename-dialog-overlay"
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        />
        <Dialog.Content
          data-testid="channel-rename-dialog"
          data-channel-id={channel?.id}
          className={clsx(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'w-[min(28rem,calc(100vw-2rem))]',
            'bg-panel-bg text-fg border border-panel-border rounded-panel shadow-panel',
          )}
          onInteractOutside={(e) => {
            if (state.submitting) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (state.submitting) e.preventDefault();
          }}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border-soft bg-panel-header-bg">
            <Dialog.Title className="text-base font-display font-semibold">
              {t('messenger.channelRename.title')}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button
                type="button"
                tone="ghost"
                size="sm"
                data-testid="channel-rename-dialog-close"
                aria-label={t('messenger.channelRename.cancel')}
                disabled={state.submitting}
              >
                <span aria-hidden="true">{'✕'}</span>
              </Button>
            </Dialog.Close>
          </div>

          <form
            data-testid="channel-rename-form"
            className="flex flex-col gap-4 px-5 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSubmit();
            }}
          >
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">
                {t('messenger.channelRename.name')}
              </span>
              <input
                data-testid="channel-rename-name"
                type="text"
                value={state.name}
                maxLength={NAME_INPUT_MAX}
                placeholder={t('messenger.channelRename.namePlaceholder')}
                disabled={state.submitting || channel === null}
                onChange={(e) =>
                  dispatch({ type: 'setName', value: e.target.value })
                }
                className="bg-elev text-fg border border-border rounded-panel px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                autoFocus
              />
              <span className="text-xs text-fg-subtle">
                {t('messenger.channelRename.nameHint', {
                  min: NAME_MIN_LEN,
                  max: NAME_MAX_LEN,
                })}
              </span>
            </label>

            {state.error !== null && (
              <div
                role="alert"
                data-testid="channel-rename-error"
                className="text-sm text-danger border border-danger rounded-panel px-3 py-2 bg-sunk"
              >
                {state.error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1 border-t border-border-soft -mx-5 px-5 -mb-4 py-4 bg-panel-header-bg">
              <Button
                type="button"
                tone="ghost"
                data-testid="channel-rename-cancel"
                onClick={handleClose}
                disabled={state.submitting}
              >
                {t('messenger.channelRename.cancel')}
              </Button>
              <Button
                type="submit"
                tone="primary"
                data-testid="channel-rename-submit"
                disabled={state.submitting || channel === null}
              >
                {t('messenger.channelRename.submit')}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
