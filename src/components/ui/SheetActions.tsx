import type { HTMLAttributes } from 'react';
import { cx } from './class-names';

export type SheetActionsProps = HTMLAttributes<HTMLDivElement>;

/*
 * Below `md` the bar has no surface of its own: a gradient of the sheet colour fades the scrolling
 * content out under the pill buttons, so the rounded sheet stays one piece. It is sticky at the
 * sheet's foot; the negative offsets cancel the panel padding (`Dialog.tsx` `sheetClass`), so the
 * fade runs edge to edge while the buttons keep the sheet's own side padding. The bar is the last
 * thing in the scroll flow, so the content above it never ends underneath it.
 */
const sheetActionsClass = cx(
  'dialog-actions sheet-actions mt-(--mb-space-6) flex justify-end gap-(--mb-space-3)',
  'max-md:sticky max-md:bottom-[calc(-1_*_var(--mb-sheet-pad-bottom,var(--mb-space-5)))] max-md:z-1 max-md:-mb-(--mb-sheet-pad-bottom,var(--mb-space-5)) max-md:flex-row',
  'max-md:-ml-[max(18px,var(--mb-app-safe-left))] max-md:-mr-[max(18px,var(--mb-app-safe-right))]',
  'max-md:pl-[max(18px,var(--mb-app-safe-left))] max-md:pr-[max(18px,var(--mb-app-safe-right))]',
  'max-md:pt-(--mb-space-6) max-md:pb-(--mb-sheet-pad-bottom,var(--mb-space-5))',
  'max-md:bg-linear-to-t max-md:from-surface-elevated max-md:from-65% max-md:to-transparent',
  'max-md:[&_.button]:min-w-0 max-md:[&>*]:flex-1 max-md:[&>:last-child:not(:only-child)]:flex-[1.4]',
);

/**
 * Back / Review / Confirm row of a sheet or dialog. End-aligned from `md` up; below `md` a sticky,
 * one row (Back left, primary right and wider; a lone button is full width) with a gradient fade instead of a background strip. `dialog-actions` stays
 * as the hook for the payment inbox's `[&_.dialog-actions]` variants.
 */
export function SheetActions({ className, ...props }: SheetActionsProps) {
  return <div className={cx(sheetActionsClass, className)} {...props} />;
}
