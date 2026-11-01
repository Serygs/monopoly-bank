import type { CSSProperties } from 'react';
import type { PropertyStripCard } from '../../utils/property-view';
import { cx } from '../ui/class-names';

export interface PropertyStripProps {
  cards: readonly PropertyStripCard[];
  className?: string;
}

/*
 * A held card is a solid bar in its group colour, a free one a pale bar. The viewer's own cards
 * get a ring in the owner's player colour, offset by a gap so it reads on a bar of the same
 * colour; ringed strips space their bars wider so neighbouring rings do not merge.
 */
const barClass = 'block h-[14px] w-[6px] flex-none rounded-[2px] bg-(color:--strip-card-color)';
const freeBarClass = 'opacity-30 forced-colors:opacity-100';
const ringBarClass =
  'outline-[length:1.5px] outline-offset-[1px] outline-(color:--strip-ring-color) outline-solid';

/**
 * A row of small vertical bars, one per property card, in the order given. Purely visual: the
 * caller states the same facts in text (card count, accessible name).
 */
export function PropertyStrip({ cards, className }: PropertyStripProps) {
  if (cards.length === 0) return null;
  const ringed = cards.some((card) => card.ring !== undefined);
  return (
    <span
      aria-hidden="true"
      data-testid="property-strip"
      className={cx(
        'flex flex-wrap items-center',
        ringed ? 'gap-x-[5px] gap-y-[6px] p-[3px]' : 'gap-[3px]',
        className,
      )}
    >
      {cards.map((card) => (
        <span
          key={card.tileId}
          data-owned={card.owned}
          data-ring={card.ring === undefined ? undefined : true}
          className={cx(
            barClass,
            !card.owned && freeBarClass,
            card.ring !== undefined && ringBarClass,
          )}
          style={
            {
              '--strip-card-color': card.color,
              ...(card.ring === undefined ? {} : { '--strip-ring-color': card.ring }),
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}
