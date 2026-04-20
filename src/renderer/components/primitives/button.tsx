import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { useTheme } from '../../theme/use-theme';

const buttonVariants = cva(
  'inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 disabled:opacity-50 disabled:pointer-events-none',
  {
    variants: {
      tone: {
        primary: 'bg-brand text-white hover:bg-brand-deep',
        secondary: 'bg-elev text-fg border border-border hover:bg-sunk',
        ghost: 'bg-transparent text-fg hover:bg-sunk',
        danger: 'bg-danger text-white hover:opacity-90',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
      },
      shape: {
        pill: 'rounded-full',
        notched: 'rounded-none [clip-path:polygon(6px_0,100%_0,100%_calc(100%-6px),calc(100%-6px)_100%,0_100%,0_6px)]',
        text: 'rounded-none underline-offset-2 hover:underline',
      },
    },
    defaultVariants: {
      tone: 'primary',
      size: 'md',
      shape: 'pill',
    },
  }
);

type ShapeVariant = NonNullable<VariantProps<typeof buttonVariants>['shape']>;

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    Omit<VariantProps<typeof buttonVariants>, 'shape'> {
  /** Explicit shape; 'auto' picks from theme token miniBtnStyle. */
  shape?: ShapeVariant | 'auto';
  /** Render-as-child using Radix Slot. */
  asChild?: boolean;
}

const MINI_BTN_TO_SHAPE: Record<string, ShapeVariant> = {
  pill: 'pill',
  notched: 'notched',
  text: 'text',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, tone, size, shape = 'auto', asChild = false, ...rest }, ref) => {
    const { token } = useTheme();
    const resolvedShape: ShapeVariant =
      shape === 'auto' ? MINI_BTN_TO_SHAPE[token.miniBtnStyle] ?? 'pill' : shape;
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={clsx(buttonVariants({ tone, size, shape: resolvedShape }), className)}
        data-shape={resolvedShape}
        {...rest}
      />
    );
  }
);
Button.displayName = 'Button';

export { buttonVariants };
