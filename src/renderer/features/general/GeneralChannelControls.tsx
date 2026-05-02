/**
 * GeneralChannelControls — R12-C T9 일반 채널 (전역 system_general) 의
 * "새 대화 시작" 컨트롤.
 *
 * 일반 채널 = 회의 X. 사용자가 임시 chat 하다가 컨텍스트 갈아엎을 때
 * "새 대화 시작" 클릭 → 모든 메시지 archive 후 채널 비우기.
 *
 * IPC: `channel:archive-conversation`. archive 위치는 main side
 * `<ArenaRoot>/conversations-archive/<ts>-<channelId>.json` (실제 표시는
 * 사용자에게는 hidden — 알림만 토스트로).
 *
 * Optimistic UI 는 적용 안 함 — archive + delete 가 결합 동작이라 실패 시
 * inconsistent 상태 가능. IPC 완료 후에 channels invalidation bus 발화로
 * Thread refresh 트리거.
 */
import { clsx } from 'clsx';
import { useCallback, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { notifyChannelsChanged } from '../../hooks/channel-invalidation-bus';
import { invoke } from '../../ipc/invoke';

export interface GeneralChannelControlsProps {
  channelId: string;
  /**
   * archive 성공 후 호출. Thread 의 message-list refetch 를 즉시 트리거
   * 한다. notifyChannelsChanged 는 채널 list 만 다루므로 별도 콜백.
   */
  onArchived?: (deletedCount: number) => void;
  className?: string;
}

export function GeneralChannelControls({
  channelId,
  onArchived,
  className,
}: GeneralChannelControlsProps): ReactElement {
  const { t } = useTranslation();
  const [pending, setPending] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleClick = useCallback(async (): Promise<void> => {
    if (pending) return;
    const ok = window.confirm(
      t('general.archiveConfirm', {
        defaultValue:
          '지금까지의 대화를 보관함에 저장하고 채널을 비웁니다. 계속할까요?',
      }),
    );
    if (!ok) return;
    setPending(true);
    setErrorMessage(null);
    try {
      const { deletedCount } = await invoke('channel:archive-conversation', {
        channelId,
      });
      onArchived?.(deletedCount);
      // 채널 list 의 unread count 등이 stale 일 수 있어 invalidation 발화.
      void notifyChannelsChanged();
    } catch (reason) {
      setErrorMessage(
        reason instanceof Error ? reason.message : String(reason),
      );
    } finally {
      setPending(false);
    }
  }, [channelId, onArchived, pending, t]);

  return (
    <div
      data-testid="general-channel-controls"
      className={clsx(
        'flex items-center gap-2 border-b border-topbar-border bg-sunk px-4 py-2 text-xs',
        className,
      )}
    >
      <span className="text-fg-muted">
        {t('general.modeHint', {
          defaultValue:
            '일반 채널은 단순 chat 입니다. 회의는 부서 채널에서 진행합니다.',
        })}
      </span>
      <div className="flex-1" />
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        data-testid="general-channel-archive-button"
        className={clsx(
          'inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-panel',
          'border border-panel-border text-fg-muted hover:text-fg hover:bg-canvas',
          'transition-colors disabled:opacity-50 disabled:pointer-events-none',
        )}
      >
        {pending
          ? t('general.archivePending', { defaultValue: '저장 중…' })
          : t('general.archiveAction', { defaultValue: '새 대화 시작' })}
      </button>
      {errorMessage !== null ? (
        <span
          data-testid="general-channel-archive-error"
          role="alert"
          className="text-danger"
        >
          {errorMessage}
        </span>
      ) : null}
    </div>
  );
}
