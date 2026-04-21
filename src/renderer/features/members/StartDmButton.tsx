/**
 * StartDmButton — R5-Task11 멤버 프로필/카드의 "연락해보기" surface.
 *
 * 클릭 한 번으로 해당 provider 와의 DM 채널을 확보한다:
 * 1. `channel:create` (kind='dm', memberProviderIds=[providerId]) 시도
 * 2. `DuplicateDmError` 면 `channel:list({projectId: null})` 로 기존 DM 을
 *    찾아 그 row 를 재사용 ("한 provider 당 DM 1개" 불변 — spec §7.4 +
 *    `idx_dm_unique_per_provider`).
 * 3. 성공 시 `onStarted(channel)` 호출 → 호출자가 messenger view 로 전환
 *    하고 active DM 을 설정한다. Button 컴포넌트는 view/router 책임을
 *    가지지 않는다.
 * 4. CRUD 버스 invalidate: `notifyChannelsChanged()` 를 호출해 ChannelRail
 *    의 DM 섹션이 즉시 새 DM 을 반영하게 한다.
 *
 * 에러 UX: inline 문자열로 버튼 하단에 표면. 고정 UI 가 없는 surface(프로필
 * 카드) 가 쓸 수 있도록 `aria-live="polite"` 영역 옵션 제공.
 *
 * hex literal 0 규약 유지.
 */
import { clsx } from 'clsx';
import { useCallback, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/primitives/button';
import { notifyChannelsChanged } from '../../hooks/channel-invalidation-bus';
import { invoke } from '../../ipc/invoke';
import type { Channel } from '../../../shared/channel-types';

export interface StartDmButtonProps {
  providerId: string;
  /** 표시 이름 (aria-label 보완용). 없으면 providerId 사용. */
  displayName?: string;
  /** 성공 시 호출 — 호출자가 view 전환 + active DM 설정. */
  onStarted?: (channel: Channel) => void;
  className?: string;
}

function isDuplicateDm(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: unknown }).name;
  return name === 'DuplicateDmError';
}

function mapErrorToI18nKey(err: unknown): string {
  if (isDuplicateDm(err)) {
    // 일반적으로 2번째 list 조회에서 resolve 되므로 이 키에 도달하는 건
    // "기존 DM 이 존재해야 하는데 list 에서 못 찾음" 같은 일관성 위반.
    return 'messenger.startDm.errors.duplicateUnresolved';
  }
  return 'messenger.startDm.errors.generic';
}

export function StartDmButton({
  providerId,
  displayName,
  onStarted,
  className,
}: StartDmButtonProps): ReactElement {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = useCallback(async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    let resolved: Channel | null = null;
    try {
      const { channel } = await invoke('channel:create', {
        projectId: null,
        // main handler 가 DM kind 에선 name 을 `dm:${providerId}` 로 덮어
        // 쓰지만 zod schema 는 min(1) 을 요구한다. 의미있는 placeholder 로
        // providerId 를 그대로 넣는다.
        name: providerId,
        kind: 'dm',
        memberProviderIds: [providerId],
      });
      resolved = channel;
    } catch (reason) {
      if (isDuplicateDm(reason)) {
        // 기존 DM 복원: DM list 전수 조회 후 `dm:${providerId}` name 매칭.
        try {
          const { channels } = await invoke('channel:list', { projectId: null });
          const existing = channels.find(
            (c) => c.kind === 'dm' && c.name === `dm:${providerId}`,
          );
          if (existing) {
            resolved = existing;
          } else {
            setError(t(mapErrorToI18nKey(reason)));
          }
        } catch (listReason) {
          setError(t(mapErrorToI18nKey(listReason)));
        }
      } else {
        setError(t(mapErrorToI18nKey(reason)));
      }
    }

    if (resolved !== null) {
      // 생성 경로에서만 invalidate 가 엄밀히 필요하지만(list 경로는 이미
      // 존재) 양쪽 다 발화해도 cheap 하다.
      void notifyChannelsChanged();
      onStarted?.(resolved);
    }
    setSubmitting(false);
  }, [onStarted, providerId, t]);

  return (
    <div
      data-testid="start-dm-root"
      data-provider-id={providerId}
      className={clsx('flex flex-col gap-1', className)}
    >
      <Button
        type="button"
        tone="secondary"
        size="sm"
        data-testid="start-dm-button"
        disabled={submitting}
        onClick={() => {
          void handleClick();
        }}
        aria-label={t('messenger.startDm.ariaLabel', {
          name: displayName ?? providerId,
        })}
      >
        {t('messenger.startDm.label')}
      </Button>
      {error !== null && (
        <div
          role="alert"
          aria-live="polite"
          data-testid="start-dm-error"
          className="text-xs text-danger"
        >
          {error}
        </div>
      )}
    </div>
  );
}
