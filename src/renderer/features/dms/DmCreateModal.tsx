/**
 * DmCreateModal — 신규 DM 생성 모달 (R10-Task3).
 *
 * spec §7.4: DM 은 사용자↔AI 1:1. provider 를 하나 선택하면 `dm:create` IPC
 * 가 `channels.kind='dm'` + `idx_dm_unique_per_provider` UNIQUE 로 1명당 1개
 * 채널만 만들어준다. 이미 DM 이 있는 provider row 는 disabled 로 렌더 — 더블
 * 클릭에 의한 race 는 server-side UNIQUE 가 잡지만, UX 레벨 가드 먼저.
 */
import * as Dialog from '@radix-ui/react-dialog';
import { clsx } from 'clsx';
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { invoke } from '../../ipc/invoke';
import { useDmSummaries } from '../../hooks/use-dm-summaries';
import { notifyChannelsChanged } from '../../hooks/channel-invalidation-bus';
import type { Channel } from '../../../shared/channel-types';
import type { DmSummary } from '../../../shared/dm-types';

export interface DmCreateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * 생성 성공 시 호출. renderer 가 activeChannel 을 신규 DM 채널로 전환.
   * 실패(이미 존재 포함) 는 modal 에 에러 배너로 표시하고 onCreated 는
   * 호출되지 않는다.
   */
  onCreated?: (channel: Channel) => void;
}

export function DmCreateModal({
  open,
  onOpenChange,
  onCreated,
}: DmCreateModalProps): ReactElement {
  const { t } = useTranslation();
  const { data, loading } = useDmSummaries();
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSelect = async (row: DmSummary): Promise<void> => {
    if (row.exists) return;
    if (submittingId !== null) return;
    setSubmittingId(row.providerId);
    setErrorMsg(null);
    try {
      const { channel } = await invoke('dm:create', {
        providerId: row.providerId,
      });
      notifyChannelsChanged();
      onCreated?.(channel);
      onOpenChange(false);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      // `DuplicateDmError` 는 main-side 에서 throw. UX 는 generic fallback
      // 으로 잡고, 메시지에 "duplicate" 가 포함되면 i18n 키로 덮어쓴다.
      if (/duplicate/i.test(message)) {
        setErrorMsg(t('dm.alreadyExists', { defaultValue: '이미 DM 있음' }));
      } else {
        setErrorMsg(
          t('dm.createError', {
            defaultValue: 'DM 생성 실패: {{msg}}',
            msg: message,
          }),
        );
      }
    } finally {
      setSubmittingId(null);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-testid="dm-create-overlay"
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        />
        <Dialog.Content
          data-testid="dm-create-dialog"
          className={clsx(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'w-[min(28rem,calc(100vw-2rem))]',
            'bg-panel-bg text-fg border border-panel-border rounded-panel shadow-panel',
          )}
        >
          <div className="flex items-center justify-between px-5 py-3 border-b border-border-soft bg-panel-header-bg">
            <Dialog.Title className="text-base font-display font-semibold">
              {t('dm.create.title', { defaultValue: '새 DM 시작' })}
            </Dialog.Title>
            <Dialog.Close
              data-testid="dm-create-close"
              aria-label={t('dm.create.close', { defaultValue: '닫기' })}
              className="text-sm text-fg-muted hover:text-fg focus:outline-none"
            >
              {'✕'}
            </Dialog.Close>
          </div>
          <div className="px-5 py-4 flex flex-col gap-2">
            <p className="text-xs text-fg-muted">
              {t('dm.create.body', {
                defaultValue:
                  'DM 은 사용자↔AI 1:1 대화입니다. 이미 DM 이 있는 AI 는 비활성화됩니다.',
              })}
            </p>
            {loading && (
              <p
                data-testid="dm-create-loading"
                className="text-xs text-fg-muted"
              >
                {t('dm.create.loading', { defaultValue: '불러오는 중…' })}
              </p>
            )}
            {errorMsg !== null && (
              <p
                role="alert"
                data-testid="dm-create-error"
                className="text-xs text-danger"
              >
                {errorMsg}
              </p>
            )}
            <ul
              data-testid="dm-create-provider-list"
              className="flex flex-col gap-1 max-h-[50vh] overflow-y-auto"
            >
              {(data ?? []).map((row) => (
                <li key={row.providerId}>
                  <button
                    type="button"
                    data-testid={`dm-create-provider-${row.providerId}`}
                    data-exists={row.exists ? 'true' : 'false'}
                    disabled={row.exists || submittingId !== null}
                    onClick={() => void handleSelect(row)}
                    className={clsx(
                      'flex w-full items-center justify-between gap-3 rounded-panel px-3 py-2',
                      'text-left text-sm border border-panel-border bg-sunk',
                      'hover:border-brand focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand',
                      'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-panel-border',
                    )}
                  >
                    <span className="truncate font-display">
                      {row.providerName}
                    </span>
                    <span className="shrink-0 text-xs text-fg-muted">
                      {row.exists
                        ? t('dm.create.existsBadge', {
                            defaultValue: '이미 있음',
                          })
                        : t('dm.create.newBadge', { defaultValue: '새로 만들기' })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
