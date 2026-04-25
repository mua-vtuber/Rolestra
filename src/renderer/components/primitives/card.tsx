import { clsx } from 'clsx';
import { forwardRef, type CSSProperties, type HTMLAttributes } from 'react';

import { useTheme } from '../../theme/use-theme';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Apply theme `panelClip` token (clip-path polygon). Defaults to true so
   * tactical/military themes get their angular silhouette automatically.
   * Set `false` for full-bleed surfaces or modals where the clip would
   * break Radix portal layouts.
   */
  applyPanelClip?: boolean;
  /**
   * When the active theme is `tactical`, render four L-shaped corner
   * brackets in `border-brand` color (시안 01 fidelity). Defaults to
   * true; set false for compact inline cards where the brackets would
   * compete with surrounding chrome.
   */
  cornerBrackets?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  (
    {
      className,
      style,
      applyPanelClip = true,
      cornerBrackets = true,
      children,
      ...rest
    },
    ref,
  ) => {
    const { token, themeKey } = useTheme();
    const clip = applyPanelClip && token.panelClip !== 'none' ? token.panelClip : null;
    const merged: CSSProperties | undefined =
      clip !== null ? { ...style, clipPath: clip } : style;
    const showCornerBrackets = cornerBrackets && themeKey === 'tactical';
    return (
      <div
        ref={ref}
        data-panel-clip={clip ?? 'none'}
        data-corner-brackets={showCornerBrackets ? 'true' : 'false'}
        style={merged}
        className={clsx(
          'relative bg-panel-bg text-fg border border-panel-border rounded-panel shadow-panel',
          className,
        )}
        {...rest}
      >
        {showCornerBrackets && (
          <>
            <span
              aria-hidden="true"
              data-testid="card-corner-bracket"
              data-corner="tl"
              className="pointer-events-none absolute top-0 left-0 h-2.5 w-2.5 border-t border-l border-brand opacity-80"
            />
            <span
              aria-hidden="true"
              data-testid="card-corner-bracket"
              data-corner="tr"
              className="pointer-events-none absolute top-0 right-0 h-2.5 w-2.5 border-t border-r border-brand opacity-80"
            />
            <span
              aria-hidden="true"
              data-testid="card-corner-bracket"
              data-corner="bl"
              className="pointer-events-none absolute bottom-0 left-0 h-2.5 w-2.5 border-b border-l border-brand opacity-80"
            />
            <span
              aria-hidden="true"
              data-testid="card-corner-bracket"
              data-corner="br"
              className="pointer-events-none absolute bottom-0 right-0 h-2.5 w-2.5 border-b border-r border-brand opacity-80"
            />
          </>
        )}
        {children}
      </div>
    );
  },
);
Card.displayName = 'Card';

export interface CardHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Heading text/node; rendered first. */
  heading?: React.ReactNode;
  /** Optional right-aligned action slot. */
  action?: React.ReactNode;
  /**
   * Force the ASCII title style regardless of the active theme. Defaults to
   * `undefined` so the theme token (`cardTitleStyle`) wins. Useful for retro
   * surfaces that opt-in to ASCII headers in non-retro themes (rare).
   */
  asciiHeader?: boolean;
  /**
   * Optional count badge at the right edge (e.g. unread/pending count).
   * Retro renders `[N]` ASCII; warm/tactical render a small mono chip in
   * brand tone. `undefined` hides the badge entirely.
   */
  count?: number;
}

export const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ className, heading, action, children, asciiHeader, count, ...rest }, ref) => {
    const { token } = useTheme();
    const style = asciiHeader === true ? 'ascii' : token.cardTitleStyle;
    const isAscii = style === 'ascii';
    return (
      <div
        ref={ref}
        data-title-style={style}
        className={clsx(
          'flex items-center gap-2 px-4 py-3 bg-panel-header-bg',
          style === 'divider' && 'border-b border-border-soft',
          style === 'bar' && 'border-l-4 border-brand',
          className,
        )}
        {...rest}
      >
        {isAscii && (
          <span aria-hidden="true" className="select-none font-mono text-xs text-fg-subtle">
            ┌─
          </span>
        )}
        {heading !== undefined && heading !== null && heading !== false && (
          <div
            className={clsx(
              'flex-1 text-sm font-semibold',
              isAscii ? 'font-mono' : 'font-display',
            )}
          >
            {isAscii && (
              <span aria-hidden="true" className="mr-1 text-fg-muted">
                ./
              </span>
            )}
            {heading}
          </div>
        )}
        {children}
        {count !== undefined && count > 0 &&
          (isAscii ? (
            <span
              data-testid="card-header-count"
              data-count-style="ascii"
              className="font-mono text-xs text-fg-muted"
            >
              [{count}]
            </span>
          ) : (
            <span
              data-testid="card-header-count"
              data-count-style="chip"
              className="font-mono text-xs font-semibold text-brand"
            >
              {count}
            </span>
          ))}
        {action && <div>{action}</div>}
      </div>
    );
  },
);
CardHeader.displayName = 'CardHeader';

export const CardBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...rest }, ref) => (
    <div ref={ref} className={clsx('px-4 py-3', className)} {...rest} />
  ),
);
CardBody.displayName = 'CardBody';

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...rest }, ref) => (
    <div
      ref={ref}
      className={clsx('px-4 py-3 border-t border-border-soft flex items-center gap-2', className)}
      {...rest}
    />
  ),
);
CardFooter.displayName = 'CardFooter';
