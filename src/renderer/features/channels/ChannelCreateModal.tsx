/**
 * ChannelCreateModal — Task 10 "새 채널" dialog.
 *
 * Radix Dialog + 이름/멤버 입력으로 `channel:create` IPC 호출.
 *
 * 책임:
 * - 이름: trim 후 3~50자. 중복 이름은 서버에서 `DuplicateChannelNameError`
 *   로 올라와 inline 에러로 표면한다.
 * - 멤버 선택: `useMembers()` 전체 명단(프로젝트 멤버 모음)을 체크박스로
 *   보여주고 기본값은 전체 선택(CreateUserChannel spec §7.4 의 "채널 멤버
 *   ⊆ 프로젝트 멤버" 불변을 사용자가 반드시 일부러 비워야 줄어들도록).
 * - submit 성공 시 `onCreated(channel)` 콜백으로 호스트(MessengerPage)에
 *   위임 — refresh/active 전환은 호스트가 담당한다. ProjectCreateModal 이
 *   `onCreated` 로 lift 한 것과 같은 패턴.
 * - ESC / 외부 클릭으로 닫힘. 제출 중엔 닫힘 차단.
 *
 * 서버 에러 매핑 (서비스 레벨 클래스명 → i18n 키):
 *   DuplicateChannelNameError → messenger.channelCreate.errors.duplicateName
 *   ChannelMemberFkError      → messenger.channelCreate.errors.memberFk
 *   기타                      → messenger.channelCreate.errors.generic
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
import { useMembers } from '../../hooks/use-members';
import { invoke } from '../../ipc/invoke';
import type { Channel } from '../../../shared/channel-types';

export interface ChannelCreateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** 성공 시 호출. 호스트가 refetch + activeChannel 전환을 담당한다. */
  onCreated?: (channel: Channel) => void;
}

const NAME_MIN_LEN = 3;
const NAME_MAX_LEN = 50;
const NAME_INPUT_MAX = NAME_MAX_LEN + 1;

interface FormState {
  name: string;
  /** 선택된 providerId 집합. 멤버 리스트 로드 후 첫 렌더에 전체 prefill. */
  memberProviderIds: string[];
  /** 전체 prefill 적용 여부. true 인 동안에만 members 도착 시 자동 채움. */
  prefillPending: boolean;
  submitting: boolean;
  error: string | null;
}

const INITIAL_STATE: FormState = {
  name: '',
  memberProviderIds: [],
  prefillPending: true,
  submitting: false,
  error: null,
};

type FormAction =
  | { type: 'setName'; value: string }
  | { type: 'setMembers'; value: string[] }
  | { type: 'prefillMembers'; value: string[] }
  | { type: 'submitStart' }
  | { type: 'submitError'; message: string }
  | { type: 'reset' };

function reducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'setName':
      return { ...state, name: action.value, error: null };
    case 'setMembers':
      // 사용자가 직접 선택을 조정하면 prefill 단계를 종료 — 이후 members
      // 가 refetch 돼도 자동으로 덮어쓰지 않는다.
      return {
        ...state,
        memberProviderIds: action.value,
        prefillPending: false,
      };
    case 'prefillMembers':
      return {
        ...state,
        memberProviderIds: action.value,
        prefillPending: false,
      };
    case 'submitStart':
      return { ...state, submitting: true, error: null };
    case 'submitError':
      return { ...state, submitting: false, error: action.message };
    case 'reset':
      return INITIAL_STATE;
  }
}

function mapErrorToI18nKey(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { name?: unknown };
    if (typeof e.name === 'string') {
      if (e.name === 'DuplicateChannelNameError') {
        return 'messenger.channelCreate.errors.duplicateName';
      }
      if (e.name === 'ChannelMemberFkError') {
        return 'messenger.channelCreate.errors.memberFk';
      }
    }
  }
  return 'messenger.channelCreate.errors.generic';
}

export function ChannelCreateModal({
  open,
  onOpenChange,
  projectId,
  onCreated,
}: ChannelCreateModalProps): ReactElement {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const { members, loading: membersLoading, error: membersError } = useMembers();

  // 모달이 열릴 때마다 state 초기화 — 남아있던 입력값이 의도치 않게
  // 제출되는 것을 막는다. (ProjectCreateModal 과 동일 패턴.)
  useEffect(() => {
    if (open) {
      dispatch({ type: 'reset' });
    }
  }, [open]);

  // 모달이 열려 있고 members 가 막 도착한 시점에 1회 자동 prefill.
  useEffect(() => {
    if (!open) return;
    if (!state.prefillPending) return;
    if (members === null) return;
    dispatch({
      type: 'prefillMembers',
      value: members.map((m) => m.providerId),
    });
  }, [open, state.prefillPending, members]);

  const handleClose = useCallback((): void => {
    if (state.submitting) return;
    onOpenChange(false);
  }, [onOpenChange, state.submitting]);

  const handleSubmit = useCallback(async (): Promise<void> => {
    const trimmedName = state.name.trim();
    if (trimmedName.length === 0) {
      dispatch({
        type: 'submitError',
        message: t('messenger.channelCreate.errors.nameRequired'),
      });
      return;
    }
    if (trimmedName.length < NAME_MIN_LEN) {
      dispatch({
        type: 'submitError',
        message: t('messenger.channelCreate.errors.nameTooShort', {
          min: NAME_MIN_LEN,
        }),
      });
      return;
    }
    if (trimmedName.length > NAME_MAX_LEN) {
      dispatch({
        type: 'submitError',
        message: t('messenger.channelCreate.errors.nameTooLong', {
          max: NAME_MAX_LEN,
        }),
      });
      return;
    }

    dispatch({ type: 'submitStart' });
    try {
      const { channel } = await invoke('channel:create', {
        projectId,
        name: trimmedName,
        kind: 'user',
        memberProviderIds: state.memberProviderIds,
      });
      onCreated?.(channel);
      onOpenChange(false);
      dispatch({ type: 'reset' });
    } catch (reason) {
      const key = mapErrorToI18nKey(reason);
      dispatch({ type: 'submitError', message: t(key) });
    }
  }, [
    onCreated,
    onOpenChange,
    projectId,
    state.memberProviderIds,
    state.name,
    t,
  ]);

  const selectedSet = new Set(state.memberProviderIds);
  const toggleMember = (id: string): void => {
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    dispatch({ type: 'setMembers', value: Array.from(next) });
  };

  const renderMemberList = (): ReactElement => {
    if (membersLoading && members === null) {
      return (
        <div
          data-testid="channel-create-members"
          data-state="loading"
          className="text-xs text-fg-muted"
        >
          {t('messenger.channelCreate.members.loading')}
        </div>
      );
    }
    if (membersError !== null) {
      return (
        <div
          role="alert"
          data-testid="channel-create-members"
          data-state="error"
          className="text-xs text-danger"
        >
          {t('messenger.channelCreate.members.error')}
        </div>
      );
    }
    const list = members ?? [];
    if (list.length === 0) {
      return (
        <div
          data-testid="channel-create-members"
          data-state="empty"
          className="text-xs text-fg-muted"
        >
          {t('messenger.channelCreate.members.empty')}
        </div>
      );
    }
    return (
      <div
        data-testid="channel-create-members"
        data-state="ready"
        className="flex flex-col gap-1.5 max-h-40 overflow-y-auto"
      >
        {list.map((m) => {
          const checked = selectedSet.has(m.providerId);
          return (
            <label
              key={m.providerId}
              data-testid={`channel-create-member-option-${m.providerId}`}
              data-checked={checked ? 'true' : 'false'}
              className="flex items-center gap-2 text-sm cursor-pointer"
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={state.submitting}
                onChange={() => toggleMember(m.providerId)}
                className="accent-brand"
              />
              <span>{m.displayName}</span>
            </label>
          );
        })}
      </div>
    );
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-testid="channel-create-modal-overlay"
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out"
        />
        <Dialog.Content
          data-testid="channel-create-modal"
          className={clsx(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'w-[min(30rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-y-auto',
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
              {t('messenger.channelCreate.title')}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button
                type="button"
                tone="ghost"
                size="sm"
                data-testid="channel-create-modal-close"
                aria-label={t('messenger.channelCreate.cancel')}
                disabled={state.submitting}
              >
                <span aria-hidden="true">{'✕'}</span>
              </Button>
            </Dialog.Close>
          </div>

          <form
            data-testid="channel-create-form"
            className="flex flex-col gap-4 px-5 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSubmit();
            }}
          >
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">
                {t('messenger.channelCreate.name')}
              </span>
              <input
                data-testid="channel-create-name"
                type="text"
                value={state.name}
                maxLength={NAME_INPUT_MAX}
                placeholder={t('messenger.channelCreate.namePlaceholder')}
                disabled={state.submitting}
                onChange={(e) =>
                  dispatch({ type: 'setName', value: e.target.value })
                }
                className="bg-elev text-fg border border-border rounded-panel px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                autoFocus
              />
              <span className="text-xs text-fg-subtle">
                {t('messenger.channelCreate.nameHint', {
                  min: NAME_MIN_LEN,
                  max: NAME_MAX_LEN,
                })}
              </span>
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">
                {t('messenger.channelCreate.members.label')}
              </span>
              {renderMemberList()}
            </div>

            {state.error !== null && (
              <div
                role="alert"
                data-testid="channel-create-error"
                className="text-sm text-danger border border-danger rounded-panel px-3 py-2 bg-sunk"
              >
                {state.error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1 border-t border-border-soft -mx-5 px-5 -mb-4 py-4 bg-panel-header-bg">
              <Button
                type="button"
                tone="ghost"
                data-testid="channel-create-cancel"
                onClick={handleClose}
                disabled={state.submitting}
              >
                {t('messenger.channelCreate.cancel')}
              </Button>
              <Button
                type="submit"
                tone="primary"
                data-testid="channel-create-submit"
                disabled={state.submitting}
              >
                {t('messenger.channelCreate.submit')}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
