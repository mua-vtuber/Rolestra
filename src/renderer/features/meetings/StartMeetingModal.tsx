/**
 * StartMeetingModal — `channel:start-meeting` dispatcher (R5-Task7).
 *
 * Radix Dialog 기반, R4 `ProjectCreateModal` 패턴 복제. 채널 상단 '회의 시작'
 * 버튼이 이 모달을 연다. 입력은 주제(topic) 하나 — `channel:start-meeting` 의
 * 실제 IPC 스펙이 `{channelId, topic}` 뿐이므로 UI 에서 받는 입력도 최소화한다.
 *
 * Validation (client-side only; Main-side zod + MeetingService 가 최종 판단):
 * - 공백 trim 후 3 자 이상 200 자 이하
 *
 * Success 시 `onStarted(meeting)` 를 먼저 호출한 뒤 `onOpenChange(false)` 로
 * 모달을 닫는다. 호출자(Thread) 는 useActiveMeetings.refresh() 를 실행해
 * MeetingBanner 가 즉시 떠오르게 한다.
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
import type { Meeting } from '../../../shared/meeting-types';

export interface StartMeetingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string | null;
  channelName?: string | null;
  onStarted?: (meeting: Meeting) => void;
}

const TOPIC_MIN_LEN = 3;
const TOPIC_MAX_LEN = 200;

interface FormState {
  topic: string;
  submitting: boolean;
  error: string | null;
}

const INITIAL_STATE: FormState = {
  topic: '',
  submitting: false,
  error: null,
};

type FormAction =
  | { type: 'setTopic'; value: string }
  | { type: 'submitStart' }
  | { type: 'submitError'; message: string }
  | { type: 'reset' };

function reducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'setTopic':
      return { ...state, topic: action.value, error: null };
    case 'submitStart':
      return { ...state, submitting: true, error: null };
    case 'submitError':
      return { ...state, submitting: false, error: action.message };
    case 'reset':
      return INITIAL_STATE;
  }
}

export function StartMeetingModal({
  open,
  onOpenChange,
  channelId,
  channelName,
  onStarted,
}: StartMeetingModalProps): ReactElement {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

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
    if (channelId === null) {
      dispatch({
        type: 'submitError',
        message: t('messenger.startMeeting.errors.noChannel'),
      });
      return;
    }
    const trimmed = state.topic.trim();
    if (trimmed.length === 0) {
      dispatch({
        type: 'submitError',
        message: t('messenger.startMeeting.errors.topicRequired'),
      });
      return;
    }
    if (trimmed.length < TOPIC_MIN_LEN) {
      dispatch({
        type: 'submitError',
        message: t('messenger.startMeeting.errors.topicTooShort', {
          min: TOPIC_MIN_LEN,
        }),
      });
      return;
    }
    if (trimmed.length > TOPIC_MAX_LEN) {
      dispatch({
        type: 'submitError',
        message: t('messenger.startMeeting.errors.topicTooLong', {
          max: TOPIC_MAX_LEN,
        }),
      });
      return;
    }

    dispatch({ type: 'submitStart' });
    try {
      const { meeting } = await invoke('channel:start-meeting', {
        channelId,
        topic: trimmed,
      });
      onStarted?.(meeting);
      onOpenChange(false);
      dispatch({ type: 'reset' });
    } catch (reason) {
      dispatch({
        type: 'submitError',
        message: t('messenger.startMeeting.errors.generic'),
      });
      // 로그만 남기고 사용자에겐 friendly message 표면.
      console.error('[StartMeetingModal] channel:start-meeting failed', reason);
    }
  }, [channelId, onOpenChange, onStarted, state.topic, t]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-testid="start-meeting-modal-overlay"
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        />
        <Dialog.Content
          data-testid="start-meeting-modal"
          className={clsx(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'w-[min(28rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-y-auto',
            'bg-elev text-fg border border-border rounded-panel shadow-panel',
          )}
          onInteractOutside={(e) => {
            if (state.submitting) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (state.submitting) e.preventDefault();
          }}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border-soft">
            <Dialog.Title className="text-base font-display font-semibold">
              {t('messenger.startMeeting.title')}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button
                type="button"
                tone="ghost"
                size="sm"
                data-testid="start-meeting-modal-close"
                aria-label={t('messenger.startMeeting.cancel')}
                disabled={state.submitting}
              >
                <span aria-hidden="true">{'✕'}</span>
              </Button>
            </Dialog.Close>
          </div>

          <form
            data-testid="start-meeting-form"
            className="flex flex-col gap-4 px-5 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSubmit();
            }}
          >
            {channelName ? (
              <div
                data-testid="start-meeting-channel-hint"
                className="text-xs text-fg-muted"
              >
                {t('messenger.startMeeting.channelHint', { name: channelName })}
              </div>
            ) : null}

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">
                {t('messenger.startMeeting.topicLabel')}
              </span>
              <input
                data-testid="start-meeting-topic"
                type="text"
                value={state.topic}
                maxLength={TOPIC_MAX_LEN + 1}
                placeholder={t('messenger.startMeeting.topicPlaceholder')}
                disabled={state.submitting}
                onChange={(e) =>
                  dispatch({ type: 'setTopic', value: e.target.value })
                }
                className="bg-elev text-fg border border-border rounded-panel px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </label>

            {state.error !== null && (
              <div
                role="alert"
                data-testid="start-meeting-error"
                className="text-sm text-danger border border-danger rounded-panel px-3 py-2 bg-sunk"
              >
                {state.error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1 border-t border-border-soft -mx-5 px-5 -mb-4 py-4">
              <Button
                type="button"
                tone="ghost"
                data-testid="start-meeting-cancel"
                onClick={handleClose}
                disabled={state.submitting}
              >
                {t('messenger.startMeeting.cancel')}
              </Button>
              <Button
                type="submit"
                tone="primary"
                data-testid="start-meeting-submit"
                disabled={state.submitting || channelId === null}
              >
                {t('messenger.startMeeting.submit')}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
