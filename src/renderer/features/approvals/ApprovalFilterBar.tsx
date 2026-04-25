/**
 * ApprovalFilterBar — 결재함 상단 필터 탭 (시안 03 `ApvFilterBar`).
 *
 * 4 탭: pending / approved / rejected / all. 현재(R10 polish) 시점에는
 * 결재 인박스 데이터가 pending 만 fetch 되므로(`usePendingApprovals`),
 * `pending` 탭만 활성 데이터로 렌더하고 나머지 탭은 0 카운트(또는
 * 외부에서 주입된 카운트)로 시각만 노출한다. R11 데이터 wiring 확장 시
 * `counts` 와 `onChange` 가 실제 다른 리스트로 전환된다.
 *
 * 테마별 시각 정체성 (시안과 1:1):
 * - warm    : rounded-full pill, sans, active bg=brand-14% / border=brand
 * - tactical: clip-path corner 5px, sans, active bg=brand-22% (dark) / brand-14% (light)
 * - retro   : square, mono, label에 `[P]/[A]/[R]/[*]` prefix
 *
 * hex literal 금지 — 색은 CSS variable + color-mix.
 */
import { clsx } from 'clsx';
import { useMemo, type CSSProperties, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../theme/use-theme';
import type { ThemeMode } from '../../theme/theme-tokens';

export type ApprovalFilter = 'pending' | 'approved' | 'rejected' | 'all';

export interface ApprovalFilterCounts {
  pending: number;
  approved: number;
  rejected: number;
  all: number;
}

export interface ApprovalFilterBarProps {
  active: ApprovalFilter;
  counts: ApprovalFilterCounts;
  /** 클릭 핸들러. 미지정 시 모든 탭 비활성(R10 한정 — pending 만 active 의미). */
  onChange?: (filter: ApprovalFilter) => void;
  className?: string;
}

const TACTICAL_CLIP =
  'polygon(5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%, 0 5px)';

function tacticalActiveBg(mode: ThemeMode): string {
  return mode === 'dark'
    ? 'color-mix(in srgb, var(--color-brand) 22%, transparent)'
    : 'color-mix(in srgb, var(--color-brand) 14%, transparent)';
}

const WARM_ACTIVE_BG = 'color-mix(in srgb, var(--color-brand) 14%, transparent)';
const RETRO_ACTIVE_BG = 'color-mix(in srgb, var(--color-brand) 12%, transparent)';

const TABS: ReadonlyArray<ApprovalFilter> = ['pending', 'approved', 'rejected', 'all'];

function resolveLabel(
  t: (key: string) => string,
  filter: ApprovalFilter,
  isRetro: boolean,
): string {
  if (isRetro) {
    if (filter === 'pending') return t('approval.filter.pendingRetro');
    if (filter === 'approved') return t('approval.filter.approvedRetro');
    if (filter === 'rejected') return t('approval.filter.rejectedRetro');
    return t('approval.filter.allRetro');
  }
  if (filter === 'pending') return t('approval.filter.pending');
  if (filter === 'approved') return t('approval.filter.approved');
  if (filter === 'rejected') return t('approval.filter.rejected');
  return t('approval.filter.all');
}

export function ApprovalFilterBar({
  active,
  counts,
  onChange,
  className,
}: ApprovalFilterBarProps): ReactElement {
  const { t } = useTranslation();
  const { themeKey, mode } = useTheme();

  const isRetro = themeKey === 'retro';
  const isTactical = themeKey === 'tactical';
  const isWarm = themeKey === 'warm';

  const tabRadius = isWarm ? 'rounded-full' : 'rounded-none';
  const tabFont = isRetro ? 'font-mono' : 'font-sans';

  const tactBg = useMemo(() => tacticalActiveBg(mode), [mode]);

  return (
    <div
      data-testid="approval-filter-bar"
      data-theme-variant={themeKey}
      data-active-filter={active}
      role="tablist"
      aria-label={t('approval.filter.aria')}
      className={clsx(
        'flex items-center gap-2 border-b border-panel-border bg-topbar-bg px-4 py-2',
        className,
      )}
    >
      {TABS.map((filter) => {
        const isActive = filter === active;
        const label = resolveLabel(t, filter, isRetro);
        const count = counts[filter];

        const baseStyle: CSSProperties = {};
        if (isTactical) {
          baseStyle.clipPath = TACTICAL_CLIP;
          if (isActive) baseStyle.backgroundColor = tactBg;
        } else if (isWarm && isActive) {
          baseStyle.backgroundColor = WARM_ACTIVE_BG;
        } else if (isRetro && isActive) {
          baseStyle.backgroundColor = RETRO_ACTIVE_BG;
        }

        return (
          <button
            key={filter}
            type="button"
            role="tab"
            aria-selected={isActive ? 'true' : 'false'}
            data-testid="approval-filter-tab"
            data-filter={filter}
            data-active={isActive ? 'true' : 'false'}
            disabled={onChange === undefined}
            onClick={() => onChange?.(filter)}
            className={clsx(
              'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold',
              'border transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-60',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand',
              tabRadius,
              tabFont,
              isActive
                ? 'border-brand text-brand'
                : 'border-panel-border text-fg-muted hover:text-fg',
            )}
            style={baseStyle}
          >
            <span>{label}</span>
            <span
              data-testid="approval-filter-count"
              className={clsx(
                'font-mono',
                isActive ? 'text-brand' : 'text-fg-subtle',
              )}
            >
              {count}
            </span>
          </button>
        );
      })}
      <div className="flex-1" />
    </div>
  );
}
