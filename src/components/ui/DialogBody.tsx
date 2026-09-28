import type { HTMLAttributes } from 'react';

export type DialogBodyProps = HTMLAttributes<HTMLParagraphElement>;

/** Introductory copy under a dialog header. */
export function DialogBody(props: DialogBodyProps) {
  return <p className="mx-0 my-(--mb-space-5) text-secondary" {...props} />;
}
