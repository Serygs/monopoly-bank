import type { ReactNode } from 'react';
import { cx } from './ui/class-names';
import { Eyebrow, Lede } from './ui/Text';

/* The title column (always the first child) may shrink below its content's width. */
const headerClass = cx(
  'grid gap-(--mb-layout-gap-compact) mb-(--mb-layout-section-gap-compact) [&>div:first-child]:min-w-0',
  'md:gap-(--mb-layout-gap-medium) md:mb-(--mb-layout-section-gap-medium)',
  'lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-(--mb-layout-gap-wide) lg:mb-(--mb-layout-section-gap-wide)',
);
const titleClass =
  'm-0 max-w-[20ch] font-display text-display leading-tight font-bold tracking-display text-primary wrap-anywhere';
/*
 * `page-header-back` and `page-header-actions` stay as hooks for the game heading and the
 * saved-games hero.
 */
const actionsClass = cx(
  'page-header-actions grid grid-cols-[repeat(auto-fit,minmax(min(100%,8.5rem),1fr))] items-start gap-(--mb-space-2)',
  '[&_.button]:min-w-0 [&_.button]:whitespace-normal md:[&_.button]:flex-initial',
  'md:flex md:flex-wrap md:justify-start',
  'lg:max-w-[32rem] lg:self-center lg:justify-end',
);

interface PageHeaderProps {
  title: string;
  eyebrow?: string;
  description?: ReactNode;
  backAction?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/** Shared page-level hierarchy; actions remain in one DOM order at every layout size. */
export function PageHeader({
  title,
  eyebrow,
  description,
  backAction,
  actions,
  className = '',
  children,
}: PageHeaderProps) {
  return (
    <section className={cx(headerClass, className)}>
      <div>
        {backAction !== undefined && (
          <div className="page-header-back mb-(--mb-space-3)">{backAction}</div>
        )}
        {eyebrow !== undefined && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 className={titleClass}>{title}</h1>
        {description !== undefined && <Lede as="div">{description}</Lede>}
        {children}
      </div>
      {actions !== undefined && <div className={actionsClass}>{actions}</div>}
    </section>
  );
}
