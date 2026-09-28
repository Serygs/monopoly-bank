import type { HTMLAttributes } from 'react';

export type DialogActionsProps = HTMLAttributes<HTMLDivElement>;

/**
 * End-aligned row; below `md` a sticky, full-width, primary-first stack at the sheet's foot.
 * `dialog-actions` stays as the hook for the payment inbox's `[&_.dialog-actions]` variants.
 */
const dialogActionsClass =
  'dialog-actions mt-(--mb-space-6) flex justify-end gap-(--mb-space-3) max-md:sticky max-md:-bottom-(--mb-space-5) max-md:z-1 max-md:-mb-(--mb-space-5) max-md:flex-col-reverse max-md:bg-surface-elevated max-md:px-0 max-md:pt-(--mb-space-4) max-md:pb-[max(var(--mb-space-4),env(safe-area-inset-bottom))] max-md:[&_.button]:w-full';

/** Trailing action row of a dialog or inline decision. */
export function DialogActions(props: DialogActionsProps) {
  return <div className={dialogActionsClass} {...props} />;
}
