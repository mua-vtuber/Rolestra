/**
 * HandoffApprovalModal — R12-C2 P6 T28.
 *
 * `handoff_mode='check'` 분기에서 사용자 결재 모달 surface. orchestrator 가
 * 회의 종결 시점 stream:handoff-required emit → 본 모듈이 listen → 자동 표시.
 *
 * 모달 본체:
 *   - 보낸 부서 / 받는 부서 (한국어 라벨)
 *   - 인계 사유 (HandoffPackage.reason — caller 가 합성한 1-line 헤드라인)
 *   - 회의록 본문 통째 (truncate 금지) — IPC `meetings:readMinutesBody` 별도 호출
 *   - audit→planning 인계 시 *"+리뷰 부서도 시작"* 체크박스 (spec §3 line 76)
 *   - [확인] / [취소] 버튼
 *
 * 사용자 액션:
 *   - [확인]  → invoke('handoff:approve', { meetingId, spawnReview }) → 모달 닫힘
 *   - [취소]  → invoke('handoff:cancel', { meetingId })               → 모달 닫힘
 *   - close X → [취소] 와 동일 (사용자 결정 명시)
 *
 * lifecycle:
 *   - stream:handoff-required → state set → 모달 open
 *   - 사용자 결정 / stream:handoff-rejected / stream:handoff-dispatched → 모달 close
 *
 * spec docs/specs/2026-05-01-rolestra-channel-roles-design.md
 *  - §3 line 76      review 부서 — audit handoff 결재 모달 안 *"+리뷰 부서도 시작"* 체크박스
 *  - §11.18.8c       handoff_mode 우회 룰 (check = 모달, auto = 자동)
 *  - §11.22.4 / .6   인계 패키지 = 회의록 본문 통째 + metadata
 */

import * as Dialog from '@radix-ui/react-dialog';
import {
  useCallback,
  useEffect,
  useState,
  type ReactElement,
} from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/primitives/button';
import { invoke } from '../../ipc/invoke';
import {
  parseHandoffPackage,
  type HandoffPackage,
} from '../../../shared/schema/handoff-package';
import type {
  StreamHandoffRequiredPayload,
  StreamHandoffDispatchedPayload,
  StreamHandoffRejectedPayload,
} from '../../../shared/stream-events';

interface PendingState {
  meetingId: string;
  package: HandoffPackage;
  minutesBody: string | null;
  minutesError: string | null;
  spawnReview: boolean;
  submitting: boolean;
  submitError: string | null;
}

/**
 * audit→planning 인계 분기 — *"+리뷰 부서도 시작"* 체크박스가 의미 있는 경우.
 * 다른 chain (idea/design/planning/implement) 인계 시 체크박스 표시 X.
 */
function isAuditToPlanningHandoff(pkg: HandoffPackage): boolean {
  return (
    pkg.sender.channelRole === 'audit' &&
    pkg.target.channelRole === 'planning'
  );
}

export function HandoffApprovalModal(): ReactElement | null {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingState | null>(null);

  // stream subscribe — handoff-required 도착 시 state set + 회의록 fetch.
  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? window.arena : undefined;
    const onStream = bridge?.onStream;
    if (!onStream) return;

    const offRequired = onStream(
      'stream:handoff-required',
      (payload: StreamHandoffRequiredPayload) => {
        let pkg: HandoffPackage;
        try {
          const parsed = JSON.parse(payload.packageJson) as unknown;
          pkg = parseHandoffPackage(parsed);
        } catch (err) {
          console.warn(
            '[HandoffApprovalModal] parseHandoffPackage threw',
            err instanceof Error ? err.message : String(err),
          );
          return;
        }
        setPending({
          meetingId: payload.meetingId,
          package: pkg,
          minutesBody: null,
          minutesError: null,
          spawnReview: false,
          submitting: false,
          submitError: null,
        });
        // 회의록 본문 fetch — invoke 결과를 비동기 setState.
        invoke('meetings:readMinutesBody', {
          meetingId: payload.meetingId,
          ordinal: 1,
        })
          .then(({ body }) => {
            setPending((prev) =>
              prev !== null && prev.meetingId === payload.meetingId
                ? { ...prev, minutesBody: body }
                : prev,
            );
          })
          .catch((err: unknown) => {
            const message =
              err instanceof Error ? err.message : String(err);
            setPending((prev) =>
              prev !== null && prev.meetingId === payload.meetingId
                ? { ...prev, minutesError: message }
                : prev,
            );
          });
      },
    );

    // dispatch / rejected 도착 시 모달 close — IPC 결과 도착 race condition 처리.
    const offDispatched = onStream(
      'stream:handoff-dispatched',
      (payload: StreamHandoffDispatchedPayload) => {
        setPending((prev) =>
          prev !== null && prev.meetingId === payload.meetingId ? null : prev,
        );
      },
    );
    const offRejected = onStream(
      'stream:handoff-rejected',
      (payload: StreamHandoffRejectedPayload) => {
        setPending((prev) =>
          prev !== null && prev.meetingId === payload.meetingId ? null : prev,
        );
      },
    );

    return (): void => {
      offRequired();
      offDispatched();
      offRejected();
    };
  }, []);

  const handleApprove = useCallback(async (): Promise<void> => {
    if (pending === null || pending.submitting) return;
    setPending({ ...pending, submitting: true, submitError: null });
    try {
      await invoke('handoff:approve', {
        meetingId: pending.meetingId,
        spawnReview: pending.spawnReview,
      });
      // dispatch 완료 — stream:handoff-dispatched 가 close 해주지만 즉시 close 도
      // 안전 (state 복귀 X — null set).
      setPending(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPending({
        ...pending,
        submitting: false,
        submitError: message,
      });
    }
  }, [pending]);

  const handleCancel = useCallback(async (): Promise<void> => {
    if (pending === null || pending.submitting) return;
    setPending({ ...pending, submitting: true, submitError: null });
    try {
      await invoke('handoff:cancel', { meetingId: pending.meetingId });
      setPending(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPending({
        ...pending,
        submitting: false,
        submitError: message,
      });
    }
  }, [pending]);

  if (pending === null) return null;

  const showSpawnReview = isAuditToPlanningHandoff(pending.package);

  return (
    <Dialog.Root
      open
      onOpenChange={(o) => {
        if (!o) void handleCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--color-overlay-strong)] backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(90vw,720px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-xl">
          <header className="border-b border-[var(--color-border-subtle)] px-6 py-4">
            <Dialog.Title className="text-lg font-semibold text-[var(--color-text-strong)]">
              {t('handoff.modal.title')}
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-[var(--color-text-muted)]">
              {t('handoff.modal.description')}
            </Dialog.Description>
          </header>

          <div className="max-h-[60vh] space-y-4 overflow-y-auto px-6 py-4 text-sm text-[var(--color-text)]">
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                {t('handoff.modal.routing')}
              </h3>
              <p>
                {t('handoff.modal.routingValue', {
                  sender: pending.package.sender.channelRole ?? '—',
                  target: pending.package.target.channelRole ?? '—',
                })}
              </p>
            </section>

            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                {t('handoff.modal.reason')}
              </h3>
              <p className="whitespace-pre-wrap">{pending.package.reason}</p>
            </section>

            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                {t('handoff.modal.minutes')}
              </h3>
              {pending.minutesError !== null ? (
                <p className="text-[var(--color-text-danger)]">
                  {t('handoff.modal.minutesError', {
                    error: pending.minutesError,
                  })}
                </p>
              ) : pending.minutesBody === null ? (
                <p className="italic text-[var(--color-text-muted)]">
                  {t('handoff.modal.minutesLoading')}
                </p>
              ) : (
                <pre className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] p-3 font-mono text-xs">
                  {pending.minutesBody}
                </pre>
              )}
            </section>

            {showSpawnReview && (
              <section>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={pending.spawnReview}
                    onChange={(e) =>
                      setPending({
                        ...pending,
                        spawnReview: e.target.checked,
                      })
                    }
                    disabled={pending.submitting}
                    className="mt-0.5"
                  />
                  <span className="text-sm text-[var(--color-text)]">
                    {t('handoff.modal.spawnReview')}
                  </span>
                </label>
                <p className="mt-1 pl-6 text-xs text-[var(--color-text-muted)]">
                  {t('handoff.modal.spawnReviewHint')}
                </p>
              </section>
            )}

            {pending.submitError !== null && (
              <p className="text-sm text-[var(--color-text-danger)]">
                {t('handoff.modal.submitError', {
                  error: pending.submitError,
                })}
              </p>
            )}
          </div>

          <footer className="flex justify-end gap-2 border-t border-[var(--color-border-subtle)] px-6 py-3">
            <Button
              tone="ghost"
              onClick={() => void handleCancel()}
              disabled={pending.submitting}
            >
              {t('handoff.modal.cancel')}
            </Button>
            <Button
              tone="primary"
              onClick={() => void handleApprove()}
              disabled={pending.submitting}
            >
              {t('handoff.modal.approve')}
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
