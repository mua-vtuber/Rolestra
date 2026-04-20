import * as RadixTooltip from '@radix-ui/react-tooltip';
import { clsx } from 'clsx';
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';

export interface TooltipProps {
  content: ReactNode;
  /** Child element that triggers the tooltip. Wrapped in Radix Trigger. */
  children: ReactNode;
  side?: RadixTooltip.TooltipContentProps['side'];
  delayDuration?: number;
}

const TooltipContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixTooltip.Content>
>(({ className, ...rest }, ref) => (
  <RadixTooltip.Content
    ref={ref}
    sideOffset={4}
    className={clsx(
      'z-50 px-2 py-1 text-xs font-sans bg-panel-bg text-fg border border-panel-border rounded-panel shadow-panel',
      className
    )}
    {...rest}
  />
));
TooltipContent.displayName = 'TooltipContent';

export function Tooltip({ content, children, side = 'top', delayDuration = 200 }: TooltipProps) {
  return (
    <RadixTooltip.Provider delayDuration={delayDuration}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <TooltipContent side={side}>{content}</TooltipContent>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}

export { TooltipContent };
