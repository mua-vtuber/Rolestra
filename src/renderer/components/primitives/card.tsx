import { clsx } from 'clsx';
import { forwardRef, type HTMLAttributes } from 'react';

import { useTheme } from '../../theme/use-theme';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {}

export const Card = forwardRef<HTMLDivElement, CardProps>(({ className, ...rest }, ref) => (
  <div
    ref={ref}
    className={clsx(
      'bg-panel-bg text-fg border border-panel-border rounded-panel shadow-panel',
      className
    )}
    {...rest}
  />
));
Card.displayName = 'Card';

export interface CardHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Heading text/node; rendered first. */
  heading?: React.ReactNode;
  /** Optional right-aligned action slot. */
  action?: React.ReactNode;
}

export const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ className, heading, action, children, ...rest }, ref) => {
    const { token } = useTheme();
    const style = token.cardTitleStyle;
    return (
      <div
        ref={ref}
        data-title-style={style}
        className={clsx(
          'flex items-center gap-2 px-4 py-3 bg-panel-header-bg',
          style === 'divider' && 'border-b border-border-soft',
          style === 'bar' && 'border-l-4 border-brand',
          className
        )}
        {...rest}
      >
        {style === 'ascii' && <span aria-hidden className="text-fg-subtle font-mono text-xs">{'::'}</span>}
        {heading && <div className="flex-1 font-display font-semibold text-sm">{heading}</div>}
        {children}
        {action && <div>{action}</div>}
      </div>
    );
  }
);
CardHeader.displayName = 'CardHeader';

export const CardBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...rest }, ref) => (
    <div ref={ref} className={clsx('px-4 py-3', className)} {...rest} />
  )
);
CardBody.displayName = 'CardBody';

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...rest }, ref) => (
    <div
      ref={ref}
      className={clsx('px-4 py-3 border-t border-border-soft flex items-center gap-2', className)}
      {...rest}
    />
  )
);
CardFooter.displayName = 'CardFooter';
