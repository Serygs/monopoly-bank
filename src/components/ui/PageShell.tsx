import type { HTMLAttributes } from 'react';
import { cx } from './class-names';

export type PageShellVariant = 'default' | 'auth';
export type AuthCardTone = 'plain' | 'banknote' | 'join';

export interface PageShellProps extends HTMLAttributes<HTMLElement> {
  /** `auth` is the narrow centred page that wraps its content in one auth card. */
  variant?: PageShellVariant;
  /** Auth card treatment; ignored by the default variant. */
  card?: AuthCardTone;
}

const authCardClassNames: Record<AuthCardTone, string> = {
  plain: 'auth-card',
  banknote: 'banknote-panel auth-card',
  join: 'auth-card join-card',
};

/** Page-level `<main>` landmark shared by every screen. */
export function PageShell({
  variant = 'default',
  card = 'plain',
  className,
  children,
  ...props
}: PageShellProps) {
  const auth = variant === 'auth';
  return (
    <main className={cx('page', auth && 'page-narrow auth-page', className)} {...props}>
      {auth ? <section className={authCardClassNames[card]}>{children}</section> : children}
    </main>
  );
}
