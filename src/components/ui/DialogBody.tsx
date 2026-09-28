import type { HTMLAttributes } from 'react';

export type DialogBodyProps = HTMLAttributes<HTMLParagraphElement>;

/** Introductory copy under a dialog header (`dialog-intro`). */
export function DialogBody(props: DialogBodyProps) {
  return <p className="dialog-intro" {...props} />;
}
