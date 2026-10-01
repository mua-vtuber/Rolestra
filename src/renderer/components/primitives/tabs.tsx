/**
 * Tabs — themed wrapper around `@radix-ui/react-tabs` (R10-Task6).
 *
 * Surface
 *   - <Tabs value onValueChange orientation> → Radix Tabs.Root
 *   - <TabsList>{<TabsTrigger value/>}…</>   → Radix Tabs.List + Tabs.Trigger
 *   - <TabsContent value/>                   → Radix Tabs.Content
 *
 * Theme integration (horizontal)
 *   - The trigger row honours `cardTitleStyle`: `bar` themes get a left-edge
 *     brand bar on the active trigger, `ascii` themes prepend the `:> `
 *     glyph (mirrors Card.Header treatment).
 *   - The trigger button itself reuses `miniBtnStyle` via cva so notched /
 *     text variants follow the active theme.
 *
 * Vertical orientation (spec 2026-10-01-messenger-redesign.md R5 settings
 * menu): a stacked list where the active entry gets a brand left bar, the
 * active-item background and brand text — the same look in every theme.
 *
 * The content panel honours `panelClip` (tactical gets the corner-clipped
 * polygon, retro stays at `none`).
 *
 * The wrapper is intentionally thin — callers compose tab content with
 * the same primitives (Card, Button, …) used elsewhere; Tabs is purely
 * a navigation container.
 */
import * as RadixTabs from '@radix-ui/react-tabs';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import {
  createContext,
  forwardRef,
  useContext,
  type ReactElement,
  type ReactNode,
} from 'react';

import type { MiniBtnStyle } from '../../theme/theme-tokens';
import { useTheme } from '../../theme/use-theme';

type TabsOrientation = 'horizontal' | 'vertical';

const TabsOrientationContext = createContext<TabsOrientation>('horizontal');

const tabsRootVariants = cva('flex w-full', {
  variants: {
    orientation: {
      horizontal: 'flex-col',
      vertical: 'flex-row',
    },
  },
  defaultVariants: { orientation: 'horizontal' },
});

export interface TabsProps extends Omit<RadixTabs.TabsProps, 'asChild' | 'orientation'> {
  orientation?: TabsOrientation;
  className?: string;
}

export const Tabs = forwardRef<HTMLDivElement, TabsProps>(
  ({ className, children, orientation = 'horizontal', ...rest }, ref) => (
    <TabsOrientationContext.Provider value={orientation}>
      <RadixTabs.Root
        ref={ref}
        orientation={orientation}
        className={clsx(tabsRootVariants({ orientation }), className)}
        {...rest}
      >
        {children}
      </RadixTabs.Root>
    </TabsOrientationContext.Provider>
  ),
);
Tabs.displayName = 'Tabs';

const tabsListVariants = cva('flex', {
  variants: {
    titleStyle: {
      bar: 'flex-wrap items-stretch gap-1 px-2 py-1 bg-panel-header-bg border-b border-border-soft',
      ascii: 'flex-wrap items-stretch gap-1 px-2 py-1 bg-panel-header-bg border-b border-dashed border-border-soft font-mono',
      vertical: 'flex-col items-stretch gap-1',
    },
  },
});

export interface TabsListProps extends RadixTabs.TabsListProps {
  className?: string;
  children: ReactNode;
}

export const TabsList = forwardRef<HTMLDivElement, TabsListProps>(
  ({ className, children, ...rest }, ref) => {
    const { token } = useTheme();
    const orientation = useContext(TabsOrientationContext);
    const titleStyle = orientation === 'vertical' ? 'vertical' : token.cardTitleStyle;
    return (
      <RadixTabs.List
        ref={ref}
        data-title-style={titleStyle}
        className={clsx(tabsListVariants({ titleStyle }), className)}
        {...rest}
      >
        {children}
      </RadixTabs.List>
    );
  },
);
TabsList.displayName = 'TabsList';

const tabsTriggerVariants = cva(
  'relative inline-flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand',
  {
    variants: {
      shape: {
        notched:
          'px-3 py-1.5 text-sm font-display font-medium text-fg-muted hover:text-fg data-[state=active]:text-fg rounded-none [clip-path:polygon(6px_0,100%_0,100%_calc(100%-6px),calc(100%-6px)_100%,0_100%,0_6px)] data-[state=active]:bg-elev',
        text: 'px-3 py-1.5 text-sm font-display font-medium text-fg-muted hover:text-fg data-[state=active]:text-fg rounded-none underline-offset-2 data-[state=active]:underline',
        vertical:
          'h-tab-row w-full justify-start px-3 text-left text-body text-fg border-l-accent border-transparent hover:bg-sunk data-[state=active]:border-brand data-[state=active]:bg-project-item-active-bg data-[state=active]:text-brand-text data-[state=active]:font-semibold',
      },
      titleStyle: {
        bar: 'data-[state=active]:border-l-4 data-[state=active]:border-brand data-[state=active]:pl-2',
        ascii: 'data-[state=active]:before:content-[":>_"] data-[state=active]:before:mr-1',
        vertical: '',
      },
    },
  },
);

type TabsTriggerShape = NonNullable<VariantProps<typeof tabsTriggerVariants>['shape']>;

const MINI_BTN_TO_TRIGGER_SHAPE: Record<MiniBtnStyle, TabsTriggerShape> = {
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
    const orientation = useContext(TabsOrientationContext);
    const vertical = orientation === 'vertical';
    const shape: TabsTriggerShape = vertical ? 'vertical' : MINI_BTN_TO_TRIGGER_SHAPE[token.miniBtnStyle];
    const titleStyle = vertical ? 'vertical' : token.cardTitleStyle;
    return (
      <RadixTabs.Trigger
        ref={ref}
        data-shape={shape}
        data-title-style={titleStyle}
        className={clsx(tabsTriggerVariants({ shape, titleStyle }), className)}
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
  /**
   * Apply the theme `panelClip` corner cut. Defaults to true; set false for
   * a full-page content area (the settings screen) where a clipped page
   * edge would read as a cropped window.
   */
  applyPanelClip?: boolean;
}

export const TabsContent = forwardRef<HTMLDivElement, TabsContentProps>(
  ({ className, children, applyPanelClip = true, ...rest }, ref): ReactElement => {
    const { token } = useTheme();
    const clip = applyPanelClip ? token.panelClip : 'none';
    const style =
      clip !== 'none' ? { clipPath: clip } : undefined;
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
