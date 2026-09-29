import type { HTMLAttributes } from 'react';
import { eyebrowClass, ledeClass, mutedClass } from './class-names';

/* The shared text styles are fixed; a caller that needs another look writes its own element. */
type TextProps = Omit<HTMLAttributes<HTMLParagraphElement>, 'className'>;

/** Small uppercase kicker above a heading (keeps the `eyebrow` hook class). */
export function Eyebrow(props: TextProps) {
  return <p className={eyebrowClass} {...props} />;
}

/** Introductory copy under a page or card heading (keeps the `lede` hook class). */
export function Lede({ as: Element = 'p', ...props }: TextProps & { as?: 'p' | 'div' }) {
  return <Element className={ledeClass} {...props} />;
}

/** Quiet supporting copy. */
export function MutedText(props: TextProps) {
  return <p className={mutedClass} {...props} />;
}
