import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import { forwardRef, type HTMLAttributes } from 'react';

const badgeVariants = cva(
  'inline-flex items-center justify-center gap-1 font-mono font-bold text-[10px] px-1.5 h-[18px] min-w-[18px] leading-none',
  {
    variants: {
      tone: {
        neutral: 'bg-sunk text-fg',
        brand: 'bg-brand text-white',
        success: 'bg-success text-white',
        warning: 'bg-warning text-white',
        danger: 'bg-danger text-white',
      },
      shape: {
        pill: 'rounded-full',
        square: 'rounded-sm',
      },
    },
    defaultVariants: {
      tone: 'neutral',
      shape: 'pill',
    },
  }
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Render a leading dot in the same tone. */
  withDot?: boolean;
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, tone, shape, withDot = false, children, ...rest }, ref) => (
    <span ref={ref} className={clsx(badgeVariants({ tone, shape }), className)} {...rest}>
      {withDot && <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />}
      {children}
    </span>
  )
);
Badge.displayName = 'Badge';

export { badgeVariants };
