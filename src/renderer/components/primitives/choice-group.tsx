/**
 * ChoiceGroup — themed single-choice group on `@radix-ui/react-radio-group`
 * (spec 2026-10-01-messenger-redesign.md R5 settings: language, theme,
 * brightness).
 *
 * Radix supplies the radiogroup semantics (role="radiogroup"/"radio",
 * aria-checked, arrow-key movement); this wrapper only adds the look from
 * the approved settings mockup: a selected choice gets the brand border,
 * the active-item background and brand text; every choice uses the theme's
 * `--clip-control` corner cut (tactical chamfer, retro square).
 *
 * `ChoiceItem` is the compact chip; pass `className` + your own children
 * for a larger card (the theme preview cards do).
 */
import * as RadixRadioGroup from '@radix-ui/react-radio-group';
import { clsx } from 'clsx';
import { forwardRef, type ReactNode } from 'react';

export interface ChoiceGroupProps
  extends Omit<RadixRadioGroup.RadioGroupProps, 'asChild' | 'orientation'> {
  className?: string;
  children: ReactNode;
}

export const ChoiceGroup = forwardRef<HTMLDivElement, ChoiceGroupProps>(
  ({ className, children, ...rest }, ref) => (
    <RadixRadioGroup.Root
      ref={ref}
      orientation="horizontal"
      className={clsx('flex flex-wrap gap-2', className)}
      {...rest}
    >
      {children}
    </RadixRadioGroup.Root>
  ),
);
ChoiceGroup.displayName = 'ChoiceGroup';

/** Shared selected / unselected look; card-style items reuse it. */
export const CHOICE_STATE_CLASSES =
  'border border-border bg-transparent text-fg hover:bg-sunk ' +
  'data-[state=checked]:border-brand data-[state=checked]:bg-project-item-active-bg ' +
  'data-[state=checked]:text-brand-text data-[state=checked]:font-semibold ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ' +
  'disabled:pointer-events-none disabled:opacity-60 [clip-path:var(--clip-control)]';

export interface ChoiceItemProps
  extends Omit<RadixRadioGroup.RadioGroupItemProps, 'asChild'> {
  className?: string;
  children: ReactNode;
}

export const ChoiceItem = forwardRef<HTMLButtonElement, ChoiceItemProps>(
  ({ className, children, ...rest }, ref) => (
    <RadixRadioGroup.Item
      ref={ref}
      className={clsx(CHOICE_STATE_CLASSES, className ?? 'h-10 px-4 text-sm')}
      {...rest}
    >
      {children}
    </RadixRadioGroup.Item>
  ),
);
ChoiceItem.displayName = 'ChoiceItem';
