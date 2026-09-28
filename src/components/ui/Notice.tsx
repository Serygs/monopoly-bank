import type { HTMLAttributes } from 'react';
import { cx } from './class-names';

export type NoticeTone = 'error' | 'success' | 'info';

export interface NoticeProps extends Omit<HTMLAttributes<HTMLElement>, 'role'> {
  tone: NoticeTone;
  /** Element to render; a `section` or `div` holds copy plus an action. */
  as?: 'p' | 'div' | 'section';
}

/** Copy and action side by side; stacked full-width below `md`. */
const noticeClass =
  'mb-(--mb-space-4) flex items-center justify-between gap-(--mb-space-4) rounded-card border p-(--mb-space-5) max-md:flex-col max-md:items-stretch [&_p]:m-0 max-md:[&_.button]:w-full';

const noticeToneClass: Record<NoticeTone, string> = {
  info: 'border-border bg-surface-elevated text-primary',
  success: 'border-status-border bg-status-surface text-status-text',
  error: 'border-danger-border bg-danger-soft text-danger',
};

/** Feedback message: errors are announced assertively (`alert`), the rest politely (`status`). */
export function Notice({ tone, as: Element = 'p', className, ...props }: NoticeProps) {
  return (
    <Element
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx(noticeClass, noticeToneClass[tone], className)}
      {...props}
    />
  );
}
