/**
 * HandoffModeToggle — R12-C2 P6 T28.
 *
 * 채널의 `handoff_mode` 를 'check' (디폴트, 사용자 결재 모달) 또는 'auto' (자동
 * 인계 + Notification) 로 토글. spec §11.18.8c.
 *
 * 진입 위치 2곳 (T28 land 시점은 둘 다 본 컴포넌트 재사용):
 *   - 채널 설정 모달 안 한 행 (라벨 + 토글)
 *   - 사이드바 channel row 우측 ⚙ popover 안 (라벨 + 토글)
 *
 * 동작:
 *   - 사용자가 다른 mode 클릭 → invoke('channel:update-handoff-mode', ...)
 *   - 성공 → caller props.onUpdated(channel) 호출 (외부 store 갱신)
 *   - 실패 → 에러 메시지 inline 표시
 *
 * 시스템 채널 (kind='system_*') 은 backend service 가 거부 — UI 가 본 컴포넌트를
 * 시스템 채널에서 mount 하지 않아야 한다 (caller 책임). 본 컴포넌트는 mount 시
 * 점에 channel.kind 검사 X.
 */

import { clsx } from 'clsx';
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { invoke } from '../../ipc/invoke';
import type { Channel } from '../../../shared/channel-types';
import type { HandoffMode } from '../../../shared/channel-role-types';

export interface HandoffModeToggleProps {
  /** 현재 채널 — id + 현재 handoff_mode + name (UI label). */
  channel: Channel;
  /** 갱신 성공 시 호출 — caller 가 store / refetch 결정. */
  onUpdated?: (channel: Channel) => void;
  className?: string;
}

const MODES: ReadonlyArray<HandoffMode> = ['check', 'auto'] as const;

export function HandoffModeToggle({
  channel,
  onUpdated,
  className,
}: HandoffModeToggleProps): ReactElement {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = async (mode: HandoffMode): Promise<void> => {
    if (saving || mode === channel.handoffMode) return;
    setSaving(true);
    setError(null);
    try {
      const { channel: updated } = await invoke('channel:update-handoff-mode', {
        id: channel.id,
        handoffMode: mode,
      });
      onUpdated?.(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      data-testid="handoff-mode-toggle"
      data-channel-id={channel.id}
      data-mode={channel.handoffMode}
      className={clsx('flex items-center gap-2', className)}
    >
      <span className="text-xs text-fg-muted" aria-hidden="true">
        {t('messenger.handoff.toggle.label')}
      </span>
      <div className="inline-flex gap-1">
        {MODES.map((m) => {
          const active = channel.handoffMode === m;
          const label =
            m === 'check'
              ? t('messenger.handoff.toggle.check')
              : t('messenger.handoff.toggle.auto');
          return (
            <button
              key={m}
              type="button"
              data-testid={`handoff-mode-${m}`}
              data-active={active ? 'true' : undefined}
              aria-pressed={active}
              aria-label={label}
              onClick={() => void handleSelect(m)}
              disabled={saving}
              className={clsx(
                'rounded-panel border px-2.5 py-1 text-xs transition-colors',
                active
                  ? 'border-brand bg-brand text-logo-fg'
                  : 'border-panel-border bg-panel-bg text-fg hover:border-brand',
                saving && 'cursor-not-allowed opacity-60',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
      {error !== null && (
        <span className="text-xs text-[var(--color-text-danger)]">
          {t('messenger.handoff.toggle.error', { error })}
        </span>
      )}
    </div>
  );
}
