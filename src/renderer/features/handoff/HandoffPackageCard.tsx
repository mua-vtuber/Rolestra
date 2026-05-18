/**
 * HandoffPackageCard — R12-C2 P6 T29. spec §11.22.
 *
 * 받는 부서 채널 *첫 진입* 시 SsmBox 최상단에 표시되는 외주 의뢰서 카드.
 *
 * 표시:
 *   - 보낸 부서 (channelRole 또는 channelId)
 *   - 보낸 시각 (epoch ms → "N 분 전")
 *   - 인계 사유 (HandoffPackage.reason)
 *   - 회의록 미리보기 (truncate X scroll)
 *   - 받는 부서가 처리할 작업 list (mission card payload 에서 derive)
 *   - [회의록 통째 보기] → MinutesViewerModal
 *   - [의견 모아 회의 시작] → invoke('handoff:start-meeting-from-package')
 *   - [닫기] → 부모 onClose (SsmBox 가 카드 hide + 일반 layout 표시)
 *
 * 컴포넌트는 *controlled* — pending lookup + open mark 는 부모 (useHandoffPackage)
 * 책임. 본 컴포넌트는 props 받아 표시 + 사용자 액션 emit.
 *
 * spec docs/specs/2026-05-01-rolestra-channel-roles-design.md
 *  - §11.22.2  H2 카드 표시 항목
 *  - §11.22.4  컨텍스트 주입 — 회의록 통째 + 작업 list
 *  - §11.22.5  닫기 후 동작
 */

import { clsx } from 'clsx';
import type { TFunction } from 'i18next';
import { useCallback, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/primitives/button';
import { invoke } from '../../ipc/invoke';
import type { HandoffDispatchRowSummary } from '../../../shared/handoff/dispatch-row-summary';
import { HandoffMinutesViewerModal } from './HandoffMinutesViewerModal';

export interface HandoffPackageCardProps {
  /** 받는 부서 의뢰서 1 통 (handoff:list-by-channel + read-with-minutes 결과). */
  item: HandoffDispatchRowSummary;
  /** 회의록 markdown 본문. null = 회의록 없음 또는 read 실패. */
  minutesBody: string | null;
  /** 받는 부서 작업 list (mission card payload 에서 derive). */
  nextActions: readonly string[];
  /** [의견 모아 회의 시작] 후 호출 — caller 가 채널 활성 회의 surface 갱신. */
  onMeetingStarted?: (meetingId: string) => void;
  /** [닫기] / [의견 모아 회의 시작] 성공 후 호출 — caller 가 카드 hide. */
  onClose: () => void;
  className?: string;
}

interface ActionState {
  busy: boolean;
  error: string | null;
}

/**
 * 보낸 시각 → 사람이 읽기 쉬운 상대 시간. 1 분 미만 → justNow, 1~59 분 → minutesAgo,
 * 1~23 시간 → hoursAgo, 그 이상 → daysAgo. locale 분기는 `handoff.card.relativeTime.*`
 * 키에 위임.
 */
function formatRelativeTime(epochMs: number, now: number, t: TFunction): string {
  const diff = Math.max(0, now - epochMs);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return t('handoff.card.relativeTime.justNow');
  if (min < 60) return t('handoff.card.relativeTime.minutesAgo', { count: min });
  const hour = Math.floor(min / 60);
  if (hour < 24) return t('handoff.card.relativeTime.hoursAgo', { count: hour });
  const day = Math.floor(hour / 24);
  return t('handoff.card.relativeTime.daysAgo', { count: day });
}

export function HandoffPackageCard({
  item,
  minutesBody,
  nextActions,
  onMeetingStarted,
  onClose,
  className,
}: HandoffPackageCardProps): ReactElement {
  const { t } = useTranslation();
  const [showMinutes, setShowMinutes] = useState(false);
  const [action, setAction] = useState<ActionState>({
    busy: false,
    error: null,
  });
  const [now] = useState(() => Date.now());

  const handleStartMeeting = useCallback(async (): Promise<void> => {
    if (action.busy) return;
    setAction({ busy: true, error: null });
    try {
      const topic = t('handoff.card.defaultTopic', {
        sender: item.package.sender.channelRole ?? '—',
      });
      const { meeting } = await invoke('handoff:start-meeting-from-package', {
        dispatchRowId: item.id,
        topic,
      });
      onMeetingStarted?.(meeting.id);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setAction({ busy: false, error: message });
    }
  }, [action.busy, item.id, item.package.sender.channelRole, onClose, onMeetingStarted, t]);

  const handleClose = useCallback((): void => {
    if (action.busy) return;
    onClose();
  }, [action.busy, onClose]);

  const sender = item.package.sender.channelRole ?? '—';
  const target = item.package.target.channelRole ?? '—';
  const dispatchedAtLabel = formatRelativeTime(
    item.package.dispatchedAt,
    now,
    t,
  );

  return (
    <div
      data-testid="handoff-package-card"
      data-dispatch-row-id={item.id}
      className={clsx(
        'rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-sm',
        className,
      )}
    >
      <header className="border-b border-[var(--color-border-subtle)] px-5 py-3">
        <h3 className="text-base font-semibold text-[var(--color-text-strong)]">
          {t('handoff.card.title', { sender })}
        </h3>
        <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
          {t('handoff.card.subtitle', { sender, target, time: dispatchedAtLabel })}
        </p>
      </header>

      <div className="space-y-4 px-5 py-4 text-sm text-[var(--color-text)]">
        <section>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            {t('handoff.card.reason')}
          </h4>
          <p className="whitespace-pre-wrap">{item.package.reason}</p>
        </section>

        <section>
          <div className="mb-1 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              {t('handoff.card.minutesPreview')}
            </h4>
            <button
              type="button"
              onClick={() => setShowMinutes(true)}
              disabled={minutesBody === null}
              className="text-xs text-[var(--color-text-link)] underline disabled:opacity-50"
            >
              {t('handoff.card.viewFullMinutes')}
            </button>
          </div>
          <div className="max-h-40 overflow-y-auto rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] p-3 font-mono text-xs">
            {minutesBody === null ? (
              <p className="italic text-[var(--color-text-muted)]">
                {t('handoff.card.minutesUnavailable')}
              </p>
            ) : (
              <pre className="whitespace-pre-wrap">{minutesBody}</pre>
            )}
          </div>
        </section>

        <section>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            {t('handoff.card.nextActions')}
          </h4>
          {nextActions.length === 0 ? (
            <p className="italic text-[var(--color-text-muted)]">
              {t('handoff.card.nextActionsEmpty')}
            </p>
          ) : (
            <ul className="list-disc space-y-1 pl-5">
              {nextActions.map((a, i) => (
                <li key={`${i}-${a}`}>{a}</li>
              ))}
            </ul>
          )}
        </section>

        {action.error !== null && (
          <p className="text-sm text-[var(--color-text-danger)]">
            {t('handoff.card.actionError', { error: action.error })}
          </p>
        )}
      </div>

      <footer className="flex justify-end gap-2 border-t border-[var(--color-border-subtle)] px-5 py-3">
        <Button
          tone="ghost"
          onClick={handleClose}
          disabled={action.busy}
          data-testid="handoff-card-close"
        >
          {t('handoff.card.close')}
        </Button>
        <Button
          tone="primary"
          onClick={() => void handleStartMeeting()}
          disabled={action.busy}
          data-testid="handoff-card-start-meeting"
        >
          {t('handoff.card.startMeeting')}
        </Button>
      </footer>

      <HandoffMinutesViewerModal
        open={showMinutes}
        onOpenChange={setShowMinutes}
        minutesBody={minutesBody}
      />
    </div>
  );
}
