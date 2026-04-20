import * as RadixSeparator from '@radix-ui/react-separator';
import { clsx } from 'clsx';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export type SeparatorProps = ComponentPropsWithoutRef<typeof RadixSeparator.Root>;

export const Separator = forwardRef<HTMLDivElement, SeparatorProps>(
  ({ className, orientation = 'horizontal', decorative = true, ...rest }, ref) => (
    <RadixSeparator.Root
      ref={ref}
      decorative={decorative}
      orientation={orientation}
      className={clsx(
        'bg-border-soft shrink-0',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className
      )}
      {...rest}
    />
  )
);
Separator.displayName = 'Separator';
