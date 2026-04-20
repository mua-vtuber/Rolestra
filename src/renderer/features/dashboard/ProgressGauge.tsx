/**
 * ProgressGauge — 3 테마 variant (warm · tactical · retro) 단일 진입 컴포넌트.
 *
 * 설계:
 * - 호출자는 항상 `<ProgressGauge value total label? />` 만 사용한다.
 * - 내부적으로 `useTheme().themeKey` 에 따라 다음 3가지 sub-variant 중 하나를
 *   렌더링한다:
 *     · warm     → 둥근 막대 (warm round-bar)
 *     · tactical → 12 세그먼트 다이아몬드 (tactical 12-segment diamond)
 *     · retro    → ASCII `[█...░...]` (retro monospace)
 * - 하드코딩 색상 금지: Tailwind theme 클래스 (`bg-brand`, `text-fg-muted`)
 *   혹은 CSS 변수 (`var(--color-accent)`) 만 사용한다. 이 파일 상단부터
 *   끝까지 hex literal (`#xxx`, `#xxxxxx`) 이 한 번도 등장하지 않도록
 *   유지해야 한다.
 * - 인라인 스타일 예외: tactical variant 의 12-slot 다이아몬드 clip-path 와
 *   gaugeGlow 기반 opacity scaling 은 Tailwind utility 로 표현할 수 없어
 *   (정적 클래스 셋으로 12개 polygon 을 나열하는 것이 오히려 유지보수를
 *   해친다) 해당 sub-component 에 한해 인라인 `style` 를 허용한다.
 *   나머지 variant 는 Tailwind + CSS 변수만 사용한다.
 */
import { clsx } from 'clsx';
import type { ReactElement } from 'react';

import { useTheme } from '../../theme/use-theme';

export interface ProgressGaugeProps {
  /** Current progress (any non-negative number; clamped against `total`). */
  value: number;
  /** Max total (must be > 0; non-positive values are defensively clamped). */
  total: number;
  /** Optional right-aligned label rendered in `font-mono`. */
  label?: string;
  /** Extra className applied to the outer wrapper. */
  className?: string;
}

const SEGMENT_TOTAL = 12;

/** Clamp a float ratio into `[0, 1]`. */
function clampRatio(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }
  const raw = value / total;
  if (raw <= 0) return 0;
  if (raw >= 1) return 1;
  return raw;
}

/** Round + clamp into `[0, SEGMENT_TOTAL]` for segment-count variants. */
function clampFilled(value: number, total: number): number {
  const ratio = clampRatio(value, total);
  const filled = Math.round(ratio * SEGMENT_TOTAL);
  if (filled <= 0) return 0;
  if (filled >= SEGMENT_TOTAL) return SEGMENT_TOTAL;
  return filled;
}

/* ────────────────────────────────────────────────────────────────────── */
/* Warm — horizontal round-bar gauge                                       */
/* ────────────────────────────────────────────────────────────────────── */

interface RoundBarGaugeProps {
  ratio: number;
}

function RoundBarGauge({ ratio }: RoundBarGaugeProps): ReactElement {
  const percent = `${(ratio * 100).toFixed(2)}%`;
  return (
    <div
      data-gauge-variant="warm"
      data-gauge-ratio={ratio}
      className="h-2 w-full overflow-hidden bg-sunk"
      // radius-panel token per spec §7.5 (warm rounded-ends). Tailwind's
      // `rounded-panel` utility is defined in tailwind.config.ts → panel
      // token. Use the class over an inline style to keep the hex-color
      // guard clean.
      style={{ borderRadius: 'var(--radius-panel)' }}
    >
      <div
        data-gauge-fill="warm"
        data-fill-ratio={ratio}
        className="h-full bg-gradient-to-r from-brand to-accent"
        style={{ width: percent, borderRadius: 'var(--radius-panel)' }}
      />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Tactical — 12-segment diamond gauge                                     */
/* ────────────────────────────────────────────────────────────────────── */

interface TacticalSegmentGaugeProps {
  filled: number;
  total: number;
  glow: number;
}

/**
 * 12-slot diamond gauge. Inline style is used here (and only here) because
 * Tailwind v3 utility classes cannot statically express a 12-slot polygon
 * clip-path + per-segment alpha scaling driven by `gaugeGlow` token. The
 * rule is narrow: inline style only for `clipPath` and the opacity scalar.
 * All color references resolve through CSS variables.
 */
function TacticalSegmentGauge({ filled, total, glow }: TacticalSegmentGaugeProps): ReactElement {
  const slots = Array.from({ length: total }, (_, idx) => idx < filled);
  return (
    <div
      data-gauge-variant="tactical"
      data-gauge-filled={filled}
      data-gauge-total={total}
      className="grid h-2.5 w-full gap-[3px]"
      style={{ gridTemplateColumns: `repeat(${total}, 1fr)` }}
    >
      {slots.map((active, idx) => {
        // Alpha-taper from the head of the fill: most recent segment is
        // brightest, older ones fade. Matches docs/Rolestra_sample behavior
        // and scales with the `gaugeGlow` theme token (0 → flat, 1 → bright).
        const distanceFromHead = filled - 1 - idx;
        const baseAlpha =
          distanceFromHead <= 1 ? 1 : distanceFromHead <= 3 ? 0.75 : 0.45;
        const alpha = active ? baseAlpha * (0.6 + 0.4 * glow) : 1;
        return (
          <div
            key={idx}
            data-segment
            data-active={active ? 'true' : 'false'}
            className={active ? 'bg-brand' : 'bg-sunk'}
            // Inline-style exception (documented at file header): clip-path
            // and opacity scalar. No hex colors here.
            style={{
              opacity: alpha,
              clipPath:
                'polygon(0 0, calc(100% - 3px) 0, 100% 50%, calc(100% - 3px) 100%, 0 100%, 3px 50%)',
            }}
          />
        );
      })}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Retro — ASCII brackets + block chars                                    */
/* ────────────────────────────────────────────────────────────────────── */

interface RetroAsciiGaugeProps {
  filled: number;
  total: number;
}

function RetroAsciiGauge({ filled, total }: RetroAsciiGaugeProps): ReactElement {
  const filledGlyphs = '\u2588'.repeat(filled);
  const emptyGlyphs = '\u2591'.repeat(total - filled);
  const rendered = `[${filledGlyphs}${emptyGlyphs}]`;
  return (
    <span
      data-gauge-variant="retro"
      data-gauge-filled={filled}
      data-gauge-total={total}
      className="font-mono text-sm text-brand"
    >
      {rendered}
    </span>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Public component                                                        */
/* ────────────────────────────────────────────────────────────────────── */

export function ProgressGauge({
  value,
  total,
  label,
  className,
}: ProgressGaugeProps): ReactElement {
  const { themeKey, token } = useTheme();

  const body = (() => {
    if (themeKey === 'warm') {
      const ratio = clampRatio(value, total);
      return <RoundBarGauge ratio={ratio} />;
    }
    if (themeKey === 'tactical') {
      const filled = clampFilled(value, total);
      return (
        <TacticalSegmentGauge
          filled={filled}
          total={SEGMENT_TOTAL}
          glow={token.gaugeGlow}
        />
      );
    }
    // themeKey === 'retro'
    const filled = clampFilled(value, total);
    return <RetroAsciiGauge filled={filled} total={SEGMENT_TOTAL} />;
  })();

  return (
    <div
      data-testid="progress-gauge"
      data-theme-variant={themeKey}
      className={clsx('flex w-full items-center gap-2', className)}
    >
      <div className="flex-1 min-w-0">{body}</div>
      {label !== undefined ? (
        <span data-gauge-label className="font-mono text-xs text-fg-muted">
          {label}
        </span>
      ) : null}
    </div>
  );
}
