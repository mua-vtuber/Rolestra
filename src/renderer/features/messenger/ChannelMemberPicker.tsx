/**
 * ChannelMemberPicker — 채널의 참여자 추가용 모달.
 *
 * MemberPanel 의 "+ 추가" 버튼이 트리거. `provider:list` 로 등록 직원 전체를
 * 가져와 *현재 채널에 없는* 직원만 multi-checkbox 로 노출한다. 사용자가
 * 1명 이상 체크 + [추가] 누르면 `channel:add-members` IPC 1회 발사 →
 * `notifyChannelsChanged()` 로 사이드바·MemberPanel·useChannels 전부
 * refetch.
 *
 * Why a separate component (vs inlining in MemberPanel):
 * - picker 는 채널마다 서로 다른 currentProviderIds 를 받아 필터링한다.
 *   MemberPanel 자체가 자주 remount 하지 않도록 모달은 별 컴포넌트로 분리.
 * - InitialMembersSelector 와 IPC 가 같지만 *기본 선택 안 함* 으로 다르다 —
 *   거기는 "프로젝트 만들 때 누구 부를까" 이고 여기는 "이 채널에 누구 더할까".
 *   prefill 분기는 의도적으로 분리.
 *
 * 디자인 규약:
 * - hex literal 0.
 * - i18n dictionary 경유 (`messenger.memberPicker.*`).
 * - 빈 상태 / loading / error 모두 명시.
 */
import * as Dialog from '@radix-ui/react-dialog';
import { clsx } from 'clsx';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/primitives/button';
import { notifyChannelsChanged } from '../../hooks/channel-invalidation-bus';
import { invoke } from '../../ipc/invoke';
import type { ProviderInfo } from '../../../shared/provider-types';

export interface ChannelMemberPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 현재 active channel id — 호출 측에서 반드시 비-null 보장. */
  channelId: string;
  /** 추가하면 안 되는 (이미 멤버인) providerId 집합. */
  currentProviderIds: ReadonlyArray<string>;
}

interface FetchState {
  providers: ProviderInfo[] | null;
  error: Error | null;
  loading: boolean;
}

export function ChannelMemberPicker({
  open,
  onOpenChange,
  channelId,
  currentProviderIds,
}: ChannelMemberPickerProps): ReactElement {
  const { t } = useTranslation();
  const [state, setState] = useState<FetchState>({
    providers: null,
    error: null,
    loading: true,
  });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 모달이 열릴 때마다 fetch + 선택 리셋. 닫혀있는 동안에는 IPC 보류 —
  // dialog 가 unmount 시키지 않더라도 effect 가 재실행되도록 `open` 을
  // 의존성으로 둔다.
  const fetchTokenRef = useRef(0);
  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setSubmitError(null);
    setState({ providers: null, error: null, loading: true });

    const myToken = ++fetchTokenRef.current;
    let cancelled = false;
    const run = async (): Promise<void> => {
      try {
        const { providers } = await invoke('provider:list', undefined);
        if (cancelled || fetchTokenRef.current !== myToken) return;
        setState({ providers, error: null, loading: false });
      } catch (reason) {
        if (cancelled || fetchTokenRef.current !== myToken) return;
        const err = reason instanceof Error ? reason : new Error(String(reason));
        setState({ providers: null, error: err, loading: false });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const currentSet = useMemo(() => new Set(currentProviderIds), [currentProviderIds]);
  const candidates = useMemo<ProviderInfo[]>(() => {
    if (state.providers === null) return [];
    return state.providers.filter((p) => !currentSet.has(p.id));
  }, [state.providers, currentSet]);

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async (): Promise<void> => {
    if (selected.size === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await invoke('channel:add-members', {
        id: channelId,
        providerIds: Array.from(selected),
      });
      await notifyChannelsChanged();
      onOpenChange(false);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const close = (): void => {
    if (submitting) return;
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-testid="channel-member-picker-overlay"
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        />
        <Dialog.Content
          data-testid="channel-member-picker"
          className={clsx(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'w-[min(28rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-y-auto',
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
              {t('messenger.memberPicker.title', { defaultValue: '직원 추가' })}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button
                type="button"
                tone="ghost"
                size="sm"
                aria-label={t('common.close', { defaultValue: '닫기' })}
                disabled={submitting}
              >
                <span aria-hidden="true">{'✕'}</span>
              </Button>
            </Dialog.Close>
          </div>

          <div className="flex flex-col gap-3 px-5 py-4">
            {state.loading && (
              <p
                data-testid="channel-member-picker-loading"
                className="text-sm text-fg-muted"
              >
                {t('dashboard.people.loading')}
              </p>
            )}
            {state.error !== null && (
              <p
                role="alert"
                data-testid="channel-member-picker-error"
                className="text-sm text-danger"
              >
                {state.error.message.length > 0
                  ? state.error.message
                  : t('messenger.memberPicker.errorGeneric', {
                      defaultValue: '직원 목록을 불러오지 못했습니다.',
                    })}
              </p>
            )}
            {!state.loading && state.error === null && candidates.length === 0 && (
              <p
                data-testid="channel-member-picker-empty"
                className="text-sm text-fg-muted"
              >
                {t('messenger.memberPicker.empty', {
                  defaultValue: '추가할 수 있는 직원이 없습니다.',
                })}
              </p>
            )}
            {!state.loading && candidates.length > 0 && (
              <div
                data-testid="channel-member-picker-list"
                className="flex flex-col gap-1.5 max-h-60 overflow-y-auto"
              >
                {candidates.map((provider) => {
                  const checked = selected.has(provider.id);
                  return (
                    <label
                      key={provider.id}
                      data-testid={`channel-member-picker-option-${provider.id}`}
                      data-checked={checked ? 'true' : 'false'}
                      className="flex items-center gap-2 text-sm cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(provider.id)}
                        disabled={submitting}
                        className="accent-brand"
                      />
                      <span>{provider.displayName}</span>
                    </label>
                  );
                })}
              </div>
            )}

            {submitError !== null && (
              <p
                role="alert"
                data-testid="channel-member-picker-submit-error"
                className="text-sm text-danger border border-danger rounded-panel px-3 py-2 bg-sunk"
              >
                {submitError}
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border-soft bg-panel-header-bg">
            <Button
              type="button"
              tone="ghost"
              onClick={close}
              disabled={submitting}
            >
              {t('common.cancel', { defaultValue: '취소' })}
            </Button>
            <Button
              type="button"
              tone="primary"
              data-testid="channel-member-picker-submit"
              onClick={() => void handleSubmit()}
              disabled={submitting || selected.size === 0 || candidates.length === 0}
            >
              {t('messenger.memberPicker.submit', { defaultValue: '추가' })}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
