import type { HTMLAttributes } from 'react';
import { cx } from './class-names';

export type CardVariant = 'game' | 'banknote';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  variant: CardVariant;
  as?: 'section' | 'article' | 'div';
}

const cardClassNames: Record<CardVariant, string> = {
  game: 'game-card',
  banknote: 'banknote-panel',
};

/** List and section card surfaces (`game-card`, `banknote-panel`). */
export function Card({ variant, as: Element = 'section', className, ...props }: CardProps) {
  return <Element className={cx(cardClassNames[variant], className)} {...props} />;
}
