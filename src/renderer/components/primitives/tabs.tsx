/**
 * Tabs — themed wrapper around `@radix-ui/react-tabs` (R10-Task6).
 *
 * Surface
 *   - <Tabs value onValueChange>           → Radix Tabs.Root
 *   - <TabsList>{<TabsTrigger value/>}…</> → Radix Tabs.List + Tabs.Trigger
 *   - <TabsContent value/>                 → Radix Tabs.Content
 *
 * Theme integration
 *   - The trigger row honours `cardTitleStyle` so themes that prefer the
 *     `bar` heading get a left-edge brand bar on the active trigger,
 *     `divider` themes get the underline pattern, and `ascii` themes
 *     prepend the `:: ` glyph (mirrors Card.Header treatment).
 *   - The content panel honours `panelClip` (tactical/military themes
 *     get the corner-clipped polygon, others stay at `none`).
 *   - The trigger button itself reuses `miniBtnStyle` via cva so pill /
 *     notched / text variants follow the active theme.
 *
 * The wrapper is intentionally thin — callers compose tab content with
 * the same primitives (Card, Button, …) used elsewhere; Tabs is purely
 * a navigation container.
 */
import * as RadixTabs from '@radix-ui/react-tabs';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import { forwardRef, type ReactElement, type ReactNode } from 'react';

import { useTheme } from '../../theme/use-theme';

const tabsRootVariants = cva('flex flex-col w-full');

export interface TabsProps
  extends Omit<RadixTabs.TabsProps, 'asChild'>,
    VariantProps<typeof tabsRootVariants> {
  className?: string;
}

export const Tabs = forwardRef<HTMLDivElement, TabsProps>(
  ({ className, children, ...rest }, ref) => (
    <RadixTabs.Root
      ref={ref}
      className={clsx(tabsRootVariants(), className)}
      {...rest}
    >
      {children}
    </RadixTabs.Root>
  ),
);
Tabs.displayName = 'Tabs';

const tabsListVariants = cva(
  'flex flex-wrap items-stretch gap-1 px-2 py-1 bg-panel-header-bg',
  {
    variants: {
      titleStyle: {
        bar: 'border-b border-border-soft',
        divider: 'border-b border-border-soft',
        ascii: 'border-b border-dashed border-border-soft font-mono',
      },
    },
    defaultVariants: {
      titleStyle: 'divider',
    },
  },
);

export interface TabsListProps extends RadixTabs.TabsListProps {
  className?: string;
  children: ReactNode;
}

export const TabsList = forwardRef<HTMLDivElement, TabsListProps>(
  ({ className, children, ...rest }, ref) => {
    const { token } = useTheme();
    return (
      <RadixTabs.List
        ref={ref}
        data-title-style={token.cardTitleStyle}
        className={clsx(
          tabsListVariants({ titleStyle: token.cardTitleStyle }),
          className,
        )}
        {...rest}
      >
        {children}
      </RadixTabs.List>
    );
  },
);
TabsList.displayName = 'TabsList';

const tabsTriggerVariants = cva(
  'relative inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-display font-medium transition-colors text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand data-[state=active]:text-fg',
  {
    variants: {
      shape: {
        pill: 'rounded-full data-[state=active]:bg-elev data-[state=active]:shadow-panel',
        notched:
          'rounded-none [clip-path:polygon(6px_0,100%_0,100%_calc(100%-6px),calc(100%-6px)_100%,0_100%,0_6px)] data-[state=active]:bg-elev',
        text: 'rounded-none underline-offset-2 data-[state=active]:underline',
      },
      titleStyle: {
        bar: 'data-[state=active]:border-l-4 data-[state=active]:border-brand data-[state=active]:pl-2',
        divider:
          'data-[state=active]:after:absolute data-[state=active]:after:left-2 data-[state=active]:after:right-2 data-[state=active]:after:-bottom-[5px] data-[state=active]:after:h-0.5 data-[state=active]:after:bg-brand',
        ascii: 'data-[state=active]:before:content-[":>_"] data-[state=active]:before:mr-1',
      },
    },
    defaultVariants: {
      shape: 'pill',
      titleStyle: 'divider',
    },
  },
);

type TabsTriggerShape = NonNullable<
  VariantProps<typeof tabsTriggerVariants>['shape']
>;

const MINI_BTN_TO_TRIGGER_SHAPE: Record<string, TabsTriggerShape> = {
  pill: 'pill',
  notched: 'notched',
  text: 'text',
};

export interface TabsTriggerProps extends RadixTabs.TabsTriggerProps {
  className?: string;
  children: ReactNode;
}

export const TabsTrigger = forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ className, children, ...rest }, ref) => {
    const { token } = useTheme();
    const shape: TabsTriggerShape =
      MINI_BTN_TO_TRIGGER_SHAPE[token.miniBtnStyle] ?? 'pill';
    return (
      <RadixTabs.Trigger
        ref={ref}
        data-shape={shape}
        data-title-style={token.cardTitleStyle}
        className={clsx(
          tabsTriggerVariants({ shape, titleStyle: token.cardTitleStyle }),
          className,
        )}
        {...rest}
      >
        {children}
      </RadixTabs.Trigger>
    );
  },
);
TabsTrigger.displayName = 'TabsTrigger';

export interface TabsContentProps extends RadixTabs.TabsContentProps {
  className?: string;
  children: ReactNode;
}

export const TabsContent = forwardRef<HTMLDivElement, TabsContentProps>(
  ({ className, children, ...rest }, ref): ReactElement => {
    const { token } = useTheme();
    const clip = token.panelClip;
    const style =
      clip && clip !== 'none' ? { clipPath: clip } : undefined;
    return (
      <RadixTabs.Content
        ref={ref}
        data-panel-clip={clip}
        style={style}
        className={clsx(
          'flex-1 min-h-0 overflow-y-auto p-4 bg-panel-bg',
          'focus-visible:outline-none',
          className,
        )}
        {...rest}
      >
        {children}
      </RadixTabs.Content>
    );
  },
);
TabsContent.displayName = 'TabsContent';
