/**
 * MessengerPage — R5 메신저 뷰 shell (Task 3).
 *
 * 이 스켈레톤은 실제 훅·컴포넌트 마운트 이전 구조만 잡는다. Task 4 이후
 * 좌/중/우 3 pane이 각각 `ChannelRail` / `Thread` / `MemberPanel`로 대체된다.
 * Empty state: active project가 없으면 3 pane을 내리고 안내 문구만 보여준다.
 *
 * 디자인 규약:
 * - hex literal 0 — 색/폰트는 전부 token CSS variable 경유.
 * - 3 pane column grid: 좌 16rem fixed / 가운데 1fr / 우 18rem fixed. Thread
 *   영역만 flex-grow. 테마별 column 폭은 Task 4+에서 조정(prep §2.1).
 * - `data-testid`: `messenger-page`, `messenger-empty-state`, `messenger-channel-rail`,
 *   `messenger-thread`, `messenger-member-panel`.
 */
import { clsx } from 'clsx';
import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { ChannelRail } from './ChannelRail';
import { useActiveProject } from '../../hooks/use-active-project';

export interface MessengerPageProps {
  className?: string;
}

export function MessengerPage({ className }: MessengerPageProps): ReactElement {
  const { t } = useTranslation();
  const { activeProjectId } = useActiveProject();

  if (activeProjectId === null) {
    return (
      <div
        data-testid="messenger-page"
        data-empty="true"
        className={clsx('flex items-center justify-center p-6 text-fg-muted', className)}
      >
        <p data-testid="messenger-empty-state" className="text-sm">
          {t('messenger.emptyState.noActiveProject')}
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="messenger-page"
      data-empty="false"
      className={clsx('grid h-full min-h-0', className)}
      style={{
        gridTemplateColumns: '16rem 1fr 18rem',
      }}
    >
      <aside
        data-testid="messenger-channel-rail"
        aria-label={t('messenger.pane.channelRail')}
        className="border-r border-border bg-project-bg min-h-0 overflow-hidden"
      >
        <ChannelRail projectId={activeProjectId} />
      </aside>

      <main
        data-testid="messenger-thread"
        aria-label={t('messenger.pane.thread')}
        className="flex flex-col min-h-0 bg-canvas"
      >
        {/* Task 5/6/7/8: <Thread /> */}
      </main>

      <aside
        data-testid="messenger-member-panel"
        aria-label={t('messenger.pane.memberPanel')}
        className="border-l border-border bg-panel-bg min-h-0 overflow-hidden"
      >
        {/* Task 9: <MemberPanel /> */}
      </aside>
    </div>
  );
}
