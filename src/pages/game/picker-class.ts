import { cx } from '../../components/ui/class-names';

/** Layout of a fieldset of pressable choices (mortgages, loans). */
export const pickerClass = cx(
  'mx-0 my-(--mb-space-3) grid gap-(--mb-space-2) border-0 p-0 [&>legend]:mb-(--mb-space-2) [&>legend]:font-semibold [&>legend]:text-primary',
  '[&_button]:grid [&_button]:min-h-[56px] [&_button]:gap-[2px] [&_button]:rounded-[11px] [&_button]:border [&_button]:border-border',
  '[&_button]:bg-surface-elevated [&_button]:p-[10px] [&_button]:text-left [&_button]:font-semibold [&_button]:text-primary',
  '[&_button]:transition-[color,background-color,border-color,box-shadow] [&_button]:duration-(--mb-duration-fast) [&_button]:ease-standard',
  '[&_button[aria-pressed=true]]:border-accent [&_button[aria-pressed=true]]:bg-surface-subtle [&_button[aria-pressed=true]]:shadow-[inset_0_0_0_1px_var(--mb-color-accent)]',
  '[&_small]:font-regular [&_small]:text-secondary',
);
