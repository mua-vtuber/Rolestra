/**
 * ApprovalBlock — 채널 스레드에 렌더되는 승인 요청 블록 (R5-Task7).
 *
 * prep §2.3.3 3-way 구조 + D4(한국어 라벨) 적용.
 * - warm    : radius 8 + warning-tint bg + 1.5px warning border + '⚠ 승인 요청' 라벨
 * - tactical: radius 0 + clip-path polygon(6px) + 동일 bg/border + '⚠ 승인 요청'
 * - retro   : token `approvalBodyStyle='quote'` 일 때 quote block + '[승인 요청]'
 *             mono 라벨 (warm/tactical 는 `plain` — quote 블록 없음)
 *
 * 버튼 3 variant (허가/조건부/거절) 은 `<Button shape='auto'>` 로 miniBtnStyle
 * 토큰(pill/notched/text) 을 그대로 재활용한다 (R3 규약 — button.tsx 의 기존
 * `MINI_BTN_TO_SHAPE` 매핑 사용).
 *
 * onDecision 콜백은 R5 범위에서 placeholder. 실제 permission:approve 등 IPC
 * wire 는 R7 에서 연결한다.
 *
 * hex literal 금지.
 */
import { clsx } from 'clsx';
import type { CSSProperties, ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/primitives/button';
import { useTheme } from '../../theme/use-theme';
import type { Message as ChannelMessage } from '../../../shared/message-types';

export type ApprovalDecision = 'allow' | 'conditional' | 'deny';

export interface ApprovalBlockProps {
  message: ChannelMessage;
  /** Task 7 범위: placeholder. 클릭 시 호출. 미지정이면 버튼 disabled. */
  onDecision?: (decision: ApprovalDecision) => void;
  className?: string;
}

const WARNING_BG = 'color-mix(in srgb, var(--color-warning) 10%, transparent)';
const WARNING_BORDER = 'var(--color-warning)';
const TACTICAL_CLIP =
  'polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)';

export function ApprovalBlock({
  message,
  onDecision,
  className,
}: ApprovalBlockProps): ReactElement {
  const { t } = useTranslation();
  const { themeKey, token } = useTheme();

  const rootAttrs = {
    'data-testid': 'approval-block',
    'data-theme-variant': themeKey,
    'data-message-id': message.id,
    'data-approval-body-style': token.approvalBodyStyle,
  } as const;

  // Parser-friendly static t() calls: i18next-parser extracts only literal
  // keys, so we branch at the call site rather than via a variable key.
  const labelText =
    themeKey === 'retro'
      ? t('messenger.approval.labelRetro')
      : t('messenger.approval.label');

  const handleDecision = (decision: ApprovalDecision): void => {
    onDecision?.(decision);
  };
  const btnDisabled = onDecision === undefined;

  const containerStyle: CSSProperties = {
    backgroundColor: WARNING_BG,
    border: `1.5px solid ${WARNING_BORDER}`,
  };
  if (themeKey === 'tactical') {
    containerStyle.clipPath = TACTICAL_CLIP;
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
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          tone="primary"
          shape="auto"
          data-testid="approval-block-allow"
          disabled={btnDisabled}
          onClick={() => handleDecision('allow')}
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
          onClick={() => handleDecision('conditional')}
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
          onClick={() => handleDecision('deny')}
        >
          {t('messenger.approval.deny')}
        </Button>
      </div>
    </div>
  );
}
