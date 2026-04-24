/**
 * ApprovalInboxView — R7-Task7 #승인-대기 시스템 채널 본문.
 *
 * Thread.tsx 는 `activeChannel.kind === 'system_approval'` 일 때 이 뷰를 단독
 * 렌더한다(메시지 리스트 대신). 각 pending `ApprovalItem` 을 ApprovalBlock 으로
 * 감싸 재사용 — decision 버튼 + Reject/Conditional 다이얼로그 동작이 자동으로
 * 올라온다. 결정 후에는 `stream:approval-decided` 이벤트를 `usePendingApprovals`
 * 가 받아 list 에서 해당 id 를 제거하므로 UI 는 자연스럽게 갱신된다.
 *
 * 컨텐츠 포맷은 `ApprovalItem.kind` 별로 최소한의 요약을 생성한다 — 상세는
 * Task 12 가 i18n 을 채워 넣고 R10 에서 kind 별 카드 UX 를 다듬는다. 현재 R7
 * 단계는 `ApprovalBlock` body 의 `whitespace-pre-wrap` 에 실리는 content 만
 * 한국어 고정 라벨로 채운다 — Task 12 가 static t() 로 전환.
 *
 * hex literal 금지.
 */
import { clsx } from 'clsx';
import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { usePendingApprovals } from '../../hooks/use-pending-approvals';
import type { ApprovalItem } from '../../../shared/approval-types';
import type { Message as ChannelMessage } from '../../../shared/message-types';
import { ApprovalBlock } from '../messenger/ApprovalBlock';

export interface ApprovalInboxViewProps {
  projectId: string;
  className?: string;
}

/**
 * ApprovalItem payload 를 ApprovalBlock body 에 실을 인간 친화 요약으로 변환.
 * 각 kind 는 spec §7.7 ApprovalCard body 의 "{action.summary} / 이유: {reason}"
 * 형식에 가깝게 두 줄로 포맷. 알 수 없는 kind 는 JSON fallback.
 */
function formatContent(item: ApprovalItem): string {
  const payload = item.payload;
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    if (item.kind === 'cli_permission') {
      const participant =
        typeof p.participantName === 'string' && p.participantName.length > 0
          ? p.participantName
          : typeof p.participantId === 'string'
            ? p.participantId
            : 'member';
      const tool = typeof p.toolName === 'string' ? p.toolName : '';
      const target = typeof p.target === 'string' ? p.target : '';
      const description =
        typeof p.description === 'string' && p.description.length > 0
          ? p.description
          : null;
      const head = `${participant} — ${tool}${target ? ` (${target})` : ''}`;
      return description === null ? head : `${head}\n이유: ${description}`;
    }
    if (item.kind === 'mode_transition') {
      const from = typeof p.currentMode === 'string' ? p.currentMode : '?';
      const to = typeof p.targetMode === 'string' ? p.targetMode : '?';
      const reason =
        typeof p.reason === 'string' && p.reason.length > 0 ? p.reason : null;
      const head = `권한 모드 변경: ${from} → ${to}`;
      return reason === null ? head : `${head}\n이유: ${reason}`;
    }
    if (item.kind === 'consensus_decision') {
      const finalText =
        typeof p.finalText === 'string' ? p.finalText : '';
      return finalText.length > 0 ? finalText : '(합의본 없음)';
    }
  }
  try {
    return JSON.stringify(payload);
  } catch {
    return '';
  }
}

/**
 * ApprovalBlock 은 `ChannelMessage` 를 받도록 설계돼 있다. 인박스에서는 DB 의
 * 메시지 row 가 아니라 승인 row 자체가 소스이므로 얇은 wrapper 메시지를
 * 즉석에서 합성한다. meta.approvalRef 가 있어 ApprovalBlock 의 IPC wire 가
 * 올바른 approval id 로 `approval:decide` 를 호출한다.
 */
function approvalToMessage(item: ApprovalItem): ChannelMessage {
  return {
    id: `approval-${item.id}`,
    channelId: item.channelId ?? '',
    meetingId: item.meetingId,
    authorId: item.requesterId ?? 'system',
    authorKind: 'system',
    role: 'system',
    content: formatContent(item),
    meta: { approvalRef: item.id },
    createdAt: item.createdAt,
  };
}

/**
 * Resolve the human label for an `ApprovalKind` through the renderer i18n
 * catalogue. Parser-friendly: each kind is a separate `t('...')` call with
 * a literal key so i18next-parser picks them up on sight. This anchors the
 * `approval.kind.*` namespace(Task 12) — once a consumer lands, the kind
 * subtree can move into broader UI without losing the catalogue entries.
 */
function kindLabel(
  t: (k: string) => string,
  kind: ApprovalItem['kind'],
): string {
  switch (kind) {
    case 'cli_permission':
      return t('approval.kind.cli_permission');
    case 'mode_transition':
      return t('approval.kind.mode_transition');
    case 'consensus_decision':
      return t('approval.kind.consensus_decision');
    case 'review_outcome':
      return t('approval.kind.review_outcome');
    case 'failure_report':
      return t('approval.kind.failure_report');
    // R9-Task6: CircuitBreaker downgrade receipts. The i18n key is added
    // to the populate pass in R9-Task11 — the fallback key itself reads
    // as a sensible label if a build reaches production before that
    // populate lands.
    case 'circuit_breaker':
      return t('approval.kind.circuit_breaker');
  }
}

export function ApprovalInboxView({
  projectId,
  className,
}: ApprovalInboxViewProps): ReactElement {
  const { t } = useTranslation();
  const { items, loading, error } = usePendingApprovals(projectId);

  const wrappedMessages = useMemo(() => {
    if (items === null) return [];
    return items.map((it) => ({ item: it, message: approvalToMessage(it) }));
  }, [items]);

  const body = (() => {
    if (items === null && loading) {
      return (
        <p
          data-testid="approval-inbox-loading"
          className="px-4 py-2 text-xs text-fg-muted"
        >
          {t('messenger.approval.inbox.loading')}
        </p>
      );
    }
    if (error !== null) {
      const message =
        error.message && error.message.length > 0
          ? error.message
          : t('messenger.approval.inbox.error');
      return (
        <div
          role="alert"
          data-testid="approval-inbox-error"
          className="mx-4 my-2 text-sm text-danger border border-danger rounded-panel px-3 py-2 bg-sunk"
        >
          {message}
        </div>
      );
    }
    if (items !== null && items.length === 0) {
      return (
        <p
          data-testid="approval-inbox-empty"
          className="px-4 py-2 text-xs text-fg-muted"
        >
          {t('messenger.approval.inbox.empty')}
        </p>
      );
    }
    return (
      <ul
        data-testid="approval-inbox-list"
        className="flex flex-col gap-1 py-2"
      >
        {wrappedMessages.map(({ item, message }) => (
          <li
            key={item.id}
            data-testid="approval-inbox-row"
            data-approval-id={item.id}
            data-kind={item.kind}
          >
            <div
              data-testid="approval-inbox-row-kind"
              className="px-4 text-xs font-semibold uppercase tracking-wide text-fg-muted"
            >
              {kindLabel(t, item.kind)}
            </div>
            <ApprovalBlock message={message} />
          </li>
        ))}
      </ul>
    );
  })();

  return (
    <div
      data-testid="approval-inbox-view"
      data-project-id={projectId}
      data-item-count={items === null ? 'null' : String(items.length)}
      className={clsx(
        'flex-1 min-h-0 overflow-y-auto text-sm text-fg',
        className,
      )}
    >
      {body}
    </div>
  );
}
