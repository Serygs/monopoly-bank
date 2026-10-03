import type { HTMLAttributes } from 'react';
import { banknotePanelClass, cx } from './class-names';

export type CardVariant = 'game' | 'banknote';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  variant: CardVariant;
  as?: 'section' | 'article' | 'div';
}

/*
 * `game-card` stays as the hook for `liquid-glass-effects.ts` (its pointer tilt and highlight stay
 * in `liquid-glass.css`) and the e2e suite. Both styles replace the border colour, so the hover
 * border never showed; Liquid Glass also keeps its own shadow on hover.
 */
const gameCardClass = cx(
  'game-card relative grid min-w-0 gap-(--mb-space-4) overflow-visible rounded-card border border-border',
  'bg-surface-elevated p-[clamp(var(--mb-space-4),3vw,var(--mb-space-5))] text-primary shadow-sm',
  '[transition:border-color_var(--mb-duration-fast)_var(--mb-ease-standard),box-shadow_var(--mb-duration-normal)_var(--mb-ease-standard),transform_var(--mb-duration-normal)_var(--mb-ease-standard)]',
  'before:absolute before:inset-x-0 before:top-0 before:h-[3px] before:rounded-t-card-large before:bg-highlight',
  // An open overflow menu lifts its card above the next row.
  'has-[.overflow-menu-trigger[aria-expanded=true]]:z-10',
  'classic:fine-pointer:hover:shadow-hover fine-pointer:hover:transform-[translateY(-2px)]',
  'motion-reduce:transform-none!',
  'classic:border-[rgb(88_111_95/0.35)] classic:bg-[#fff9ea] classic:dark:bg-surface-elevated',
  'glass:isolate glass:overflow-hidden glass:border-[rgb(255_255_255/0.62)] glass:bg-[rgb(255_255_255/0.5)] glass:shadow-md',
  'glass:dark:bg-[rgb(40_49_62/0.62)] glass:*:relative glass:*:z-1',
  'glass:has-[.overflow-menu-trigger[aria-expanded=true]]:overflow-visible',
  'glass:before:pointer-events-none glass:before:h-[2px]',
  'glass:before:[background:linear-gradient(90deg,rgb(255_255_255/0.72),color-mix(in_srgb,var(--mb-color-accent)_66%,transparent),rgb(255_255_255/0.18))]',
  'glass:max-md:backdrop-blur-[16px] glass:max-md:backdrop-saturate-[1.24] glass:forced-colors:backdrop-filter-none',
) as string;

const cardClassNames: Record<CardVariant, string> = {
  game: gameCardClass,
  banknote: banknotePanelClass,
};

/** List and section card surfaces (`game-card`, banknote panel). */
export function Card({ variant, as: Element = 'section', className, ...props }: CardProps) {
  return <Element className={cx(cardClassNames[variant], className)} {...props} />;
}
