import { buttonCoreClass, buttonShapeClass, cx } from '../../components/ui/class-names';

export const balanceClass = cx(
  'relative mx-0 mt-[18px] mb-[14px] grid gap-[4px] overflow-hidden rounded-[14px] border border-accent bg-surface-inverse px-[18px] py-[16px] shadow-balance-inset',
  '*:relative *:z-1 [&_span]:text-small [&_span]:font-semibold [&_span]:text-highlight',
  '[&_strong]:font-money [&_strong]:text-money-xl [&_strong]:leading-[0.98] [&_strong]:font-bold [&_strong]:tracking-[-0.05em] [&_strong]:text-on-inverse [&_strong]:tabular-nums [&_strong]:wrap-anywhere',
);

export const shortfallClass =
  'mt-(--mb-space-2) flex flex-wrap items-center justify-between gap-(--mb-space-3) [&>p]:m-0 [&>p]:font-semibold [&>p]:text-danger';

/*
 * Declaring bankruptcy is a last resort, so it is a quiet text button in the danger colour rather
 * than a solid fill: a habitual tap on the brightest control must not land on it. A soft danger
 * fill shows on hover and press.
 */
export const bankruptcyClass = cx(
  buttonCoreClass,
  buttonShapeClass,
  'mt-(--mb-space-2) w-full border-transparent bg-transparent text-danger shadow-none',
  'fine-pointer:hover:bg-danger-soft not-disabled:active:bg-danger-soft',
);

export const stepPanelClass = 'flex flex-col overflow-hidden!';
export const stepBodyClass = 'min-h-0 flex-1 overflow-y-auto overscroll-contain pt-(--mb-space-3)';
export const stepFooterClass = cx(
  'shrink-0 max-md:mt-0! max-md:flex-row!',
  'max-md:[&_.button]:w-auto! max-md:[&>:first-child]:flex-1 max-md:[&>:last-child]:flex-[2]',
);
