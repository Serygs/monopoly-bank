import type { HTMLAttributes } from 'react';

export type DialogActionsProps = HTMLAttributes<HTMLDivElement>;

/** Trailing action row of a dialog or inline decision (`dialog-actions`). */
export function DialogActions(props: DialogActionsProps) {
  return <div className="dialog-actions" {...props} />;
}
