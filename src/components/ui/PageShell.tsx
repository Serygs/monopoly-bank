import type { HTMLAttributes } from 'react';
import { cx, glassPanelClass } from './class-names';

export type PageShellVariant = 'default' | 'auth';
export type AuthCardTone = 'plain' | 'banknote' | 'join';

export interface PageShellProps extends HTMLAttributes<HTMLElement> {
  /** `auth` is the narrow centred page that wraps its content in one auth card. */
  variant?: PageShellVariant;
  /** Auth card treatment; ignored by the default variant. */
  card?: AuthCardTone;
}

const authCardClass = cx(
  'w-[min(100%,36rem)] rounded-card-large border border-border bg-surface-elevated shadow-md',
  'p-[clamp(var(--mb-space-5),6vw,var(--mb-space-8))]',
  '[&_h1]:m-0 [&_h1]:wrap-anywhere [&_.lede]:mt-(--mb-space-4) [&_.lede]:mb-(--mb-space-7)',
  glassPanelClass,
) as string;

/* The banknote tone only adds its text colour: `.auth-card` always outranked its background. */
const authCardClassNames: Record<AuthCardTone, string> = {
  plain: authCardClass,
  banknote: `${authCardClass} text-primary`,
  join: authCardClass,
};

/*
 * `page` stays as a hook: its safe-area padding (`env(safe-area-inset-*)`) remains in
 * `layout.css`. The shared `h2` typography sits under `:where()`, so a heading's own utilities
 * (the game card, the profile summary) override it without `!`.
 */
const pageClass = cx(
  'page mx-auto w-[min(100%,var(--mb-layout-content-max))]',
  '[:where(&)_h2]:m-0 [:where(&)_h2]:font-display [:where(&)_h2]:text-heading-lg [:where(&)_h2]:leading-[1.2] [:where(&)_h2]:tracking-[-0.025em] [:where(&)_h2]:text-primary',
);
const authPageClass = cx(
  'grid max-w-(--mb-layout-content-narrow) items-start justify-items-center',
  'min-h-[calc(100dvh_-_var(--mb-layout-header-height-compact))]',
  'md:min-h-[calc(100dvh_-_var(--mb-layout-header-height-medium))]',
  'lg:min-h-[calc(100dvh_-_var(--mb-layout-header-height-wide))]',
);

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
    <main className={cx(pageClass, auth && authPageClass, className)} {...props}>
      {auth ? <section className={authCardClassNames[card]}>{children}</section> : children}
    </main>
  );
}
