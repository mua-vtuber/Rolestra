/**
 * ChannelRow — ChannelRail 의 단일 채널 엔트리 (R5-Task4).
 *
 * prep §2.1 3-way 구조 차이를 컴포넌트 내부에서 직접 처리한다
 * (ProgressGauge 패턴). 색상은 전부 Tailwind theme token 또는 CSS variable
 * 경유 — 이 파일에는 hex literal 이 한 번도 등장해서는 안 된다.
 *
 * 테마별 차이 요약:
 * - warm    : glyph `#`, rounded-md, active=itemActiveBg
 * - tactical: glyph `#`, rounded-none + clip-path polygon 4px,
 *             active=brand-12% alpha bg + brand-33% alpha outline
 * - retro   : glyph active `▶` / idle `·`, rounded-none, mono font
 *
 * Hook 보다는 presentation 수준에 가깝다: 데이터 fetch 는 ChannelRail 이 맡고,
 * ChannelRow 는 받은 채널 + active flag + onClick 만으로 렌더한다.
 */
import { clsx } from 'clsx';
import type { CSSProperties, ReactElement, ReactNode } from 'react';

import { useTheme } from '../../theme/use-theme';
import type { Channel } from '../../../shared/channel-types';

const TACTICAL_CLIP_PATH =
  'polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px)';

const TACTICAL_ACTIVE_BG = 'color-mix(in srgb, var(--color-brand) 12%, transparent)';
const TACTICAL_ACTIVE_OUTLINE = 'color-mix(in srgb, var(--color-brand) 33%, transparent)';

export interface ChannelRowProps {
  channel: Channel;
  active: boolean;
  onClick: () => void;
  /**
   * Optional control area rendered to the right of the channel name —
   * lives outside the selection `<button>` so its descendants can be
   * interactive (HTML forbids nested buttons). Used by ChannelRail to
   * surface meeting start / status / abort affordances next to the
   * channel label (sidebar-first meeting control, R12 dogfooding).
   */
  rightSlot?: ReactNode;
  className?: string;
}

export function ChannelRow({ channel, active, onClick, rightSlot, className }: ChannelRowProps): ReactElement {
  const { themeKey } = useTheme();

  const glyph = themeKey === 'retro' ? (active ? '▶' : '·') : '#';

  const baseClasses = clsx(
    'flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-sm',
    'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand',
    themeKey === 'retro' ? 'font-mono' : 'font-sans',
    active ? 'font-bold' : 'font-medium',
    active ? 'text-fg' : 'text-fg-muted hover:bg-sunk',
  );

  const shapeClasses = (() => {
    if (themeKey === 'warm') return 'rounded-md';
    return 'rounded-none';
  })();

  const warmActiveClasses = themeKey === 'warm' && active
    ? 'bg-project-item-active-bg text-project-item-active-fg'
    : '';

  const style: CSSProperties = {};
  if (themeKey === 'tactical') {
    style.clipPath = TACTICAL_CLIP_PATH;
    if (active) {
      style.backgroundColor = TACTICAL_ACTIVE_BG;
      style.outline = `1px solid ${TACTICAL_ACTIVE_OUTLINE}`;
      style.outlineOffset = '-1px';
    }
  }

  // The right slot (meeting controls etc.) cannot live INSIDE the
  // selection <button> — HTML forbids nested interactive elements. Outer
  // wrapper is a relatively positioned div; the selection button fills
  // the row, and the slot overlays the right edge with `pointer-events`
  // re-enabled so its own buttons remain clickable. Aside: keeping the
  // slot as a sibling (not absolute) would push the channel name when the
  // slot has content of variable width — overlay keeps the layout stable
  // across "no meeting / [회의 시작] / 🟢 회의 중" states.
  return (
    <div
      data-testid="channel-row-wrapper"
      data-channel-id={channel.id}
      className={clsx('relative group', className)}
    >
      <button
        type="button"
        onClick={onClick}
        className={clsx(baseClasses, shapeClasses, warmActiveClasses)}
        style={style}
        data-testid="channel-row"
        data-channel-id={channel.id}
        data-channel-kind={channel.kind}
        data-active={active ? 'true' : 'false'}
        data-theme-variant={themeKey}
        aria-current={active ? 'true' : undefined}
      >
        <span
          data-channel-glyph
          data-glyph-value={glyph}
          className={clsx(
            'inline-block text-center',
            active ? 'text-brand' : 'text-fg-subtle',
            themeKey === 'retro' && 'min-w-[12px]',
          )}
        >
          {glyph}
        </span>
        <span className="flex-1 truncate pr-12">{channel.name}</span>
      </button>
      {rightSlot ? (
        <div
          data-testid="channel-row-right-slot"
          className="pointer-events-none absolute inset-y-0 right-1 flex items-center"
        >
          <div className="pointer-events-auto flex items-center gap-1">
            {rightSlot}
          </div>
        </div>
      ) : null}
    </div>
  );
}
