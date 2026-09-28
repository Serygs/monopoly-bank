import type { HTMLAttributes } from 'react';
import { cx } from './class-names';

export type NoticeTone = 'error' | 'success' | 'info';

export interface NoticeProps extends Omit<HTMLAttributes<HTMLElement>, 'role'> {
  tone: NoticeTone;
  /** Element to render; a `section` or `div` holds copy plus an action. */
  as?: 'p' | 'div' | 'section';
}

/** Feedback message: errors are announced assertively (`alert`), the rest politely (`status`). */
export function Notice({ tone, as: Element = 'p', className, ...props }: NoticeProps) {
  return (
    <Element
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx('notice', tone !== 'info' && `notice-${tone}`, className)}
      {...props}
    />
  );
}
