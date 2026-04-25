/**
 * ApprovalStatusBadge — 결재 항목의 결정 상태를 보여주는 작은 배지.
 *
 * 시안 03 (`docs/Rolestra_sample/03-apv-variants.jsx` `ApvStatusBadge`) 의
 * 3-way 분기를 옮겨온 컴포넌트.
 *
 * - 색상: success(허가) / danger(거절) / warning(대기) — 테두리 + 8% alpha bg
 * - 라벨:
 *   - warm/tactical: `대기 / 허가 / 거절` (i18n)
 *   - retro       : `[P] / [Y] / [N]` ASCII bracket (i18n)
 * - 형태: `badgeRadius` 토큰 (pill = warm, square = tactical/retro)
 * - 폰트: 항상 mono (시안과 동일)
 * - compact 옵션: list row 용 작은 변형(2x8 / 9px) vs detail header 용(4x10 / 10px)
 *
 * hex literal 금지 — 색은 CSS variable + color-mix.
 */
import { clsx } from 'clsx';
import { type CSSProperties, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../theme/use-theme';

export type ApprovalDecision = 'pending' | 'approved' | 'rejected';

export interface ApprovalStatusBadgeProps {
  decision: ApprovalDecision;
  /** list row 용 작은 변형. 기본 false(detail/standalone). */
  compact?: boolean;
  className?: string;
}

const SUCCESS_BG = 'color-mix(in srgb, var(--color-success) 8%, transparent)';
const DANGER_BG = 'color-mix(in srgb, var(--color-danger) 8%, transparent)';
const WARNING_BG = 'color-mix(in srgb, var(--color-warning) 8%, transparent)';

function decisionColors(decision: ApprovalDecision): {
  fg: string;
  border: string;
  bg: string;
} {
  switch (decision) {
    case 'approved':
      return {
        fg: 'text-success',
        border: 'border-success',
        bg: SUCCESS_BG,
      };
    case 'rejected':
      return {
        fg: 'text-danger',
        border: 'border-danger',
        bg: DANGER_BG,
      };
    case 'pending':
    default:
      return {
        fg: 'text-warning',
        border: 'border-warning',
        bg: WARNING_BG,
      };
  }
}

export function ApprovalStatusBadge({
  decision,
  compact = false,
  className,
}: ApprovalStatusBadgeProps): ReactElement {
  const { t } = useTranslation();
  const { themeKey, token } = useTheme();

  const isRetro = themeKey === 'retro';

  const label = (() => {
    if (decision === 'approved') {
      return isRetro
        ? t('approval.statusBadge.approvedRetro')
        : t('approval.statusBadge.approved');
    }
    if (decision === 'rejected') {
      return isRetro
        ? t('approval.statusBadge.rejectedRetro')
        : t('approval.statusBadge.rejected');
    }
    return isRetro
      ? t('approval.statusBadge.pendingRetro')
      : t('approval.statusBadge.pending');
  })();

  const colors = decisionColors(decision);

  const sizeClasses = compact
    ? 'px-2 py-0.5 text-[9px]'
    : 'px-2.5 py-1 text-[10px]';

  const radiusClass = token.badgeRadius === 'pill' ? 'rounded-full' : 'rounded-none';

  const style: CSSProperties = { backgroundColor: colors.bg };

  return (
    <span
      data-testid="approval-status-badge"
      data-decision={decision}
      data-theme-variant={themeKey}
      data-compact={compact ? 'true' : 'false'}
      className={clsx(
        'inline-flex items-center font-mono font-bold uppercase tracking-wider',
        'border whitespace-nowrap',
        sizeClasses,
        radiusClass,
        colors.fg,
        colors.border,
        className,
      )}
      style={style}
    >
      {label}
    </span>
  );
}
