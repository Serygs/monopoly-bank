import type { HTMLAttributes } from 'react';
import { cx } from './class-names';

export type GlassSurfaceVariant = 'card' | 'panel' | 'popover';

export interface GlassSurfaceProps extends HTMLAttributes<HTMLElement> {
  /**
   * `panel` is a top-level glass layer (sheets, nav, tools), `card` sits inside one and never
   * blurs, `popover` is the near-opaque menu surface.
   */
  variant?: GlassSurfaceVariant;
  /** Card only: blur the backdrop. Only for a card that is not inside another glass layer. */
  blur?: boolean;
  /** Adds the thin tint layer under text-heavy content. */
  tinted?: boolean;
  as?: 'section' | 'article' | 'div' | 'aside';
}

const variantClass: Record<GlassSurfaceVariant, string> = {
  card: 'glass-card rounded-surface',
  panel: 'glass-panel rounded-surface',
  popover: 'glass-popover rounded-compact',
};

/**
 * The one glass surface. Liquid Glass styles come from `glass.css` tokens; Classic Bank gets a
 * plain elevated surface with the same radius vocabulary.
 */
export function GlassSurface({
  variant = 'card',
  blur = false,
  tinted = false,
  as: Element = 'div',
  className,
  ...props
}: GlassSurfaceProps) {
  return (
    <Element
      className={cx(
        'border border-border bg-surface-elevated text-primary',
        variantClass[variant],
        variant === 'card' && blur && 'glass-card-blur',
        tinted && 'glass-tint-layer',
        className,
      )}
      {...props}
    />
  );
}
