/**
 * ApprovalBlock — 채널 스레드에 렌더되는 승인 요청 블록 (R5-Task7 최초 도입,
 * R7-Task5 에서 `approval:decide` IPC 전면 wire, R11-Task15 에서 허가 path
 * 에 Optimistic UI + ErrorBoundary toast 통합).
 *
 * prep §2.3.3 3-way 구조 + D4(한국어 라벨) 적용.
 * - warm    : radius 8 + warning-tint bg + 1.5px warning border + '⚠ 승인 요청'
 * - tactical: radius 0 + clip-path polygon(6px) + 동일 bg/border + '⚠ 승인 요청'
 * - retro   : token `approvalBodyStyle='quote'` 일 때 quote block + '[승인 요청]'
 *             mono 라벨 (warm/tactical 는 `plain` — quote 블록 없음)
 *
 * 버튼 3 variant (허가/조건부/거절) 은 `<Button shape='auto'>` 로 miniBtnStyle
 * 토큰(pill/notched/text) 을 그대로 재활용(R3 규약).
 *
 * R7-Task5 이후 decision 처리:
 *   - 허가(approve) → 즉시 invoke('approval:decide', { id, decision: 'approve' })
 *                     R11-Task15: optimistic — 클릭 즉시 row 의
 *                     `data-decision-preview` 가 'approve' 로 전환되고 모든
 *                     버튼이 비활성된다. 서버 응답이 성공이면 그대로 유지
 *                     (ApprovalInbox 의 `stream:approval-decided` 가 row 를
 *                     unmount). 실패면 preview 를 비우고 `optimisticRollback`
 *                     메시지를 inline 으로 출력 + ErrorBoundary toast 발사
 *                     (R10 D8 — 3 hook 패턴 재사용, throw 는 안 함).
 *   - 거절(reject)   → RejectDialog 를 열어 comment(선택) 입력 후 submit
 *   - 조건부(conditional) → ConditionalDialog (comment 필수) 후 submit
 *     (Optimistic 은 Allow path 에 한정 — Dialog 들이 자체 IPC 를 fire 하므로
 *      본 컴포넌트의 reducer 로 흐름이 들어오지 않는다. R11-Task15 scope 결정.)
 *
 * approval id 는 `message.meta.approvalRef` 에서 읽는다 — 누락 시 모든 버튼
 * 비활성(안전한 fallback). 실제 발사 시점에 approvalRef 가 있는 메시지만
 * Thread 가 ApprovalBlock 으로 분기하므로 런타임에는 항상 존재한다.
 *
 * hex literal 0 규약 유지.
 */
import { clsx } from 'clsx';
import {
  useCallback,
  useReducer,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/primitives/button';
import { useThrowToBoundary } from '../../components/ErrorBoundary';
import { invoke } from '../../ipc/invoke';
import { useTheme } from '../../theme/use-theme';
import { ConditionalDialog } from '../approvals/ConditionalDialog';
import { RejectDialog } from '../approvals/RejectDialog';
import type { Message as ChannelMessage } from '../../../shared/message-types';

export interface ApprovalBlockProps {
  message: ChannelMessage;
  className?: string;
}

const WARNING_BG = 'color-mix(in srgb, var(--color-warning) 10%, transparent)';
const WARNING_BORDER = 'var(--color-warning)';

type DialogKind = 'none' | 'reject' | 'conditional';

/** Allow-path optimistic decision preview surfaced via `data-decision-preview`. */
type DecisionPreview = 'approve' | null;

interface AllowState {
  submitting: boolean;
  /**
   * R11-Task15: filled the moment the허가 click fires so the row visibly
   * transitions to "approved" before the IPC resolves. Cleared back to null
   * on rollback; preserved on success so the parent's
   * `stream:approval-decided` listener can remove the row at its own pace.
   */
  decisionPreview: DecisionPreview;
  error: string | null;
}
type AllowAction =
  | { type: 'start' }
  | { type: 'success' }
  | { type: 'rollback'; message: string }
  | { type: 'reset' };
const ALLOW_INITIAL: AllowState = {
  submitting: false,
  decisionPreview: null,
  error: null,
};
function allowReducer(state: AllowState, action: AllowAction): AllowState {
  switch (action.type) {
    case 'start':
      return { submitting: true, decisionPreview: 'approve', error: null };
    case 'success':
      // Server confirmed; keep preview so the buttons stay locked until the
      // inbox stream removes this row. Drop the in-flight flag so the
      // component would still re-enable interactions if the row somehow
      // survives (e.g. a future inbox refactor).
      return { ...state, submitting: false };
    case 'rollback':
      return { submitting: false, decisionPreview: null, error: action.message };
    case 'reset':
      return ALLOW_INITIAL;
  }
}

export function ApprovalBlock({
  message,
  className,
}: ApprovalBlockProps): ReactElement {
  const { t } = useTranslation();
  const { themeKey, token } = useTheme();
  const throwToBoundary = useThrowToBoundary();

  const approvalRef = message.meta?.approvalRef;
  const approvalId =
    typeof approvalRef === 'string' && approvalRef.length > 0
      ? approvalRef
      : null;

  const [dialog, setDialog] = useState<DialogKind>('none');
  const [{ submitting, decisionPreview, error }, dispatch] = useReducer(
    allowReducer,
    ALLOW_INITIAL,
  );

  const rootAttrs = {
    'data-testid': 'approval-block',
    'data-theme-variant': themeKey,
    'data-message-id': message.id,
    'data-approval-body-style': token.approvalBodyStyle,
    'data-approval-id': approvalId ?? '',
    // R11-Task15: surfaces the optimistic decision preview to E2E + unit
    // tests. Cleared back to '' on rollback; sticks at 'approve' once the
    // 허가 click fires until the parent stream removes the row.
    'data-decision-preview': decisionPreview ?? '',
  } as const;

  const labelText =
    themeKey === 'retro'
      ? t('messenger.approval.labelRetro')
      : t('messenger.approval.label');

  const handleAllow = useCallback(async (): Promise<void> => {
    if (approvalId === null || submitting) return;
    // R11-Task15: optimistic — flip the row immediately so the user sees
    // the허가 gesture applied before the IPC round-trip. On success keep
    // the preview (parent stream removes the row); on failure rollback to
    // the pre-click state and surface a toast via the boundary bus.
    dispatch({ type: 'start' });
    try {
      await invoke('approval:decide', {
        id: approvalId,
        decision: 'approve',
      });
      dispatch({ type: 'success' });
    } catch (reason) {
      dispatch({
        type: 'rollback',
        message: t('messenger.approval.errors.optimisticRollback'),
      });
      // Toast-only — matches the R10 D8 patterns
      // (use-channel-messages.send / use-autonomy-mode.confirm /
      // use-queue.addLines): the rollback above already restored local
      // UI, the boundary surfaces the underlying error message globally
      // without unmounting the messenger thread.
      throwToBoundary(reason);
    }
  }, [approvalId, submitting, t, throwToBoundary]);

  const handleOpenReject = useCallback((): void => {
    if (approvalId === null || submitting) return;
    setDialog('reject');
  }, [approvalId, submitting]);

  const handleOpenConditional = useCallback((): void => {
    if (approvalId === null || submitting) return;
    setDialog('conditional');
  }, [approvalId, submitting]);

  const handleDialogChange = useCallback(
    (kind: DialogKind) =>
      (open: boolean): void => {
        setDialog(open ? kind : 'none');
      },
    [],
  );

  const btnDisabled = approvalId === null || submitting;

  const containerStyle: CSSProperties = {
    backgroundColor: WARNING_BG,
    border: `1.5px solid ${WARNING_BORDER}`,
  };
  if (token.panelClip !== 'none') {
    containerStyle.clipPath = token.panelClip;
  }

  const radiusClass =
    themeKey === 'warm' ? 'rounded-lg' : 'rounded-none';
  const labelFontClass =
    themeKey === 'retro' ? 'font-mono text-brand' : 'font-sans text-warning';

  const renderBody = (): ReactElement => {
    const useQuote =
      token.approvalBodyStyle === 'quote' && themeKey === 'retro';
    if (useQuote) {
      return (
        <div
          data-testid="approval-block-body"
          data-style="quote"
          className="border-l-2 border-border pl-3 py-1 font-mono text-sm text-fg whitespace-pre-wrap"
        >
          {message.content}
        </div>
      );
    }
    return (
      <p
        data-testid="approval-block-body"
        data-style="plain"
        className={clsx(
          'whitespace-pre-wrap text-sm text-fg',
          themeKey === 'retro' ? 'font-mono' : 'font-sans',
        )}
      >
        {message.content}
      </p>
    );
  };

  return (
    <div
      {...rootAttrs}
      className={clsx(
        'mx-4 my-2 flex flex-col gap-2 px-3 py-2',
        radiusClass,
        className,
      )}
      style={containerStyle}
    >
      <div
        data-testid="approval-block-label"
        className={clsx('text-xs font-semibold', labelFontClass)}
      >
        {labelText}
      </div>
      {renderBody()}
      {error !== null && (
        <div
          role="alert"
          data-testid="approval-block-error"
          className="text-xs text-danger border border-danger rounded-panel px-2 py-1 bg-sunk"
        >
          {error}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          tone="primary"
          shape="auto"
          data-testid="approval-block-allow"
          disabled={btnDisabled}
          onClick={() => {
            void handleAllow();
          }}
        >
          {t('messenger.approval.allow')}
        </Button>
        <Button
          type="button"
          size="sm"
          tone="secondary"
          shape="auto"
          data-testid="approval-block-conditional"
          disabled={btnDisabled}
          onClick={handleOpenConditional}
        >
          {t('messenger.approval.conditional')}
        </Button>
        <Button
          type="button"
          size="sm"
          tone="danger"
          shape="auto"
          data-testid="approval-block-deny"
          disabled={btnDisabled}
          onClick={handleOpenReject}
        >
          {t('messenger.approval.deny')}
        </Button>
      </div>

      <RejectDialog
        open={dialog === 'reject'}
        onOpenChange={handleDialogChange('reject')}
        approvalId={approvalId}
      />
      <ConditionalDialog
        open={dialog === 'conditional'}
        onOpenChange={handleDialogChange('conditional')}
        approvalId={approvalId}
      />
    </div>
  );
}
