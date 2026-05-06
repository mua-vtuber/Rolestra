/**
 * PostOpinionModal — R12-C2 P4 T20.
 *
 * 일반 채널 헤더 우측 [의견 게시] 버튼이 호스트하는 모달. 사용자가 별
 * entry 로 *제목 + 본문* 을 입력해 의견 카드를 등록한다. 등록 결과는
 * `kind='user-raised'`, `meetingId=null`, `parentId=null`,
 * `status='pending'` opinion row 로 저장 — 일반 채널 SsmBox GeneralVariant
 * (T18 placeholder, T21 final) 가 카드 list 에 표시.
 *
 * spec docs/specs/2026-05-01-rolestra-channel-roles-design.md
 *  - §4 일반 부서 새 정의 — *의견 게시* 버튼 (사용자 모달) 별도 entry
 *  - §11.13 SsmBox general row — 카드 누적 list
 *
 * 입력 검증 (UI 측):
 *   - 본문 ≥ 1 char (trim 후) — 비어 있으면 submit disabled
 *   - 제목은 비어도 됨 — 비어 있으면 backend 가 본문 첫 줄 / 80 자 cut 으로
 *     derive (OpinionService.deriveUserCommentTitle)
 *   - 길이 cap 은 ipc-schemas.ts (title ≤ 400, content ≤ 100,000) 와 정합
 *
 * 에러 매핑:
 *   PostFromGeneralValidationError → messenger.postOpinion.errors.validation
 *   기타                            → messenger.postOpinion.errors.generic
 *
 * hex literal 0 — Tailwind utility + CSS variable 만 사용.
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
import type { Opinion } from '../../../shared/opinion-types';

const TITLE_MAX_LEN = 400;
const TITLE_INPUT_MAX = TITLE_MAX_LEN + 1;
const CONTENT_MAX_LEN = 100_000;

export interface PostOpinionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 의견을 등록할 대상 일반 채널 ID. */
  channelId: string;
  /** 등록 성공 시 호출 — caller 가 SsmBox refetch / optimistic 업데이트 결정. */
  onPosted?: (opinion: Opinion) => void;
}

interface FormState {
  title: string;
  content: string;
  submitting: boolean;
  error: string | null;
}

const INITIAL_STATE: FormState = {
  title: '',
  content: '',
  submitting: false,
  error: null,
};

type FormAction =
  | { type: 'setTitle'; value: string }
  | { type: 'setContent'; value: string }
  | { type: 'submitStart' }
  | { type: 'submitError'; message: string }
  | { type: 'reset' };

function reducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'setTitle':
      return { ...state, title: action.value, error: null };
    case 'setContent':
      return { ...state, content: action.value, error: null };
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
    if (
      typeof e.name === 'string' &&
      e.name === 'PostFromGeneralValidationError'
    ) {
      return 'messenger.postOpinion.errors.validation';
    }
  }
  return 'messenger.postOpinion.errors.generic';
}

export function PostOpinionModal({
  open,
  onOpenChange,
  channelId,
  onPosted,
}: PostOpinionModalProps): ReactElement {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  // 모달이 열릴 때마다 state 초기화 — 남아 있던 입력값이 다음 entry 에
  // 의도치 않게 끼지 않도록.
  useEffect(() => {
    if (open) {
      dispatch({ type: 'reset' });
    }
  }, [open]);

  const handleClose = useCallback((): void => {
    if (state.submitting) return;
    onOpenChange(false);
  }, [onOpenChange, state.submitting]);

  const handleSubmit = useCallback(async (): Promise<void> => {
    const trimmedContent = state.content.trim();
    if (trimmedContent.length === 0) {
      dispatch({
        type: 'submitError',
        message: t('messenger.postOpinion.errors.contentRequired'),
      });
      return;
    }
    if (trimmedContent.length > CONTENT_MAX_LEN) {
      dispatch({
        type: 'submitError',
        message: t('messenger.postOpinion.errors.contentTooLong', {
          max: CONTENT_MAX_LEN,
        }),
      });
      return;
    }
    const trimmedTitle = state.title.trim();
    if (trimmedTitle.length > TITLE_MAX_LEN) {
      dispatch({
        type: 'submitError',
        message: t('messenger.postOpinion.errors.titleTooLong', {
          max: TITLE_MAX_LEN,
        }),
      });
      return;
    }

    dispatch({ type: 'submitStart' });
    try {
      const { result } = await invoke('opinion:postFromGeneral', {
        channelId,
        // PostOpinionModal entry = 사용자 발화 → 'user-raised' kind 분기.
        // 직원이 모달을 통해 등록하는 surface 는 spec 상 정의 X — 직원
        // 발화는 메시지 안 [##본문] 으로 자동 등록.
        authorProviderId: null,
        parts: [
          {
            // title 빈 문자열 → null 로 변환해 backend 가 content 첫 줄
            // 에서 derive 하도록.
            title: trimmedTitle.length > 0 ? trimmedTitle : null,
            content: trimmedContent,
          },
        ],
      });
      const inserted = result.inserted[0];
      if (inserted) {
        onPosted?.(inserted);
      }
      onOpenChange(false);
      dispatch({ type: 'reset' });
    } catch (reason) {
      const key = mapErrorToI18nKey(reason);
      dispatch({ type: 'submitError', message: t(key) });
    }
  }, [
    channelId,
    onPosted,
    onOpenChange,
    state.content,
    state.title,
    t,
  ]);

  const submitDisabled =
    state.submitting || state.content.trim().length === 0;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-testid="post-opinion-modal-overlay"
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out"
        />
        <Dialog.Content
          data-testid="post-opinion-modal"
          data-channel-id={channelId}
          className={clsx(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'w-[min(32rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-y-auto',
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
              {t('messenger.postOpinion.title')}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button
                type="button"
                tone="ghost"
                size="sm"
                data-testid="post-opinion-modal-close"
                aria-label={t('messenger.postOpinion.cancel')}
                disabled={state.submitting}
              >
                <span aria-hidden="true">{'✕'}</span>
              </Button>
            </Dialog.Close>
          </div>

          <form
            data-testid="post-opinion-form"
            className="flex flex-col gap-4 px-5 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSubmit();
            }}
          >
            <Dialog.Description className="text-xs text-fg-subtle">
              {t('messenger.postOpinion.description')}
            </Dialog.Description>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">
                {t('messenger.postOpinion.titleLabel')}
              </span>
              <input
                data-testid="post-opinion-title"
                type="text"
                value={state.title}
                maxLength={TITLE_INPUT_MAX}
                placeholder={t('messenger.postOpinion.titlePlaceholder')}
                disabled={state.submitting}
                onChange={(e) =>
                  dispatch({ type: 'setTitle', value: e.target.value })
                }
                className="bg-elev text-fg border border-border rounded-panel px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                autoFocus
              />
              <span className="text-xs text-fg-subtle">
                {t('messenger.postOpinion.titleHint')}
              </span>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">
                {t('messenger.postOpinion.contentLabel')}
              </span>
              <textarea
                data-testid="post-opinion-content"
                value={state.content}
                placeholder={t('messenger.postOpinion.contentPlaceholder')}
                disabled={state.submitting}
                rows={6}
                onChange={(e) =>
                  dispatch({ type: 'setContent', value: e.target.value })
                }
                className="bg-elev text-fg border border-border rounded-panel px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand resize-y"
              />
            </label>

            {state.error !== null && (
              <div
                role="alert"
                data-testid="post-opinion-error"
                className="text-sm text-danger border border-danger rounded-panel px-3 py-2 bg-sunk"
              >
                {state.error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1 border-t border-border-soft -mx-5 px-5 -mb-4 py-4 bg-panel-header-bg">
              <Button
                type="button"
                tone="ghost"
                data-testid="post-opinion-cancel"
                onClick={handleClose}
                disabled={state.submitting}
              >
                {t('messenger.postOpinion.cancel')}
              </Button>
              <Button
                type="submit"
                tone="primary"
                data-testid="post-opinion-submit"
                disabled={submitDisabled}
              >
                {t('messenger.postOpinion.submit')}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
