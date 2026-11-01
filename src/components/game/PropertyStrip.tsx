import type { CSSProperties } from 'react';
import type { PropertyStripCard } from '../../utils/property-view';
import { cx } from '../ui/class-names';

export interface PropertyStripProps {
  cards: readonly PropertyStripCard[];
  className?: string;
}

/*
 * A held card is a solid bar in its group colour. A free one is a pale fill inside a thin outline
 * of the same colour, so light groups (yellow, pink) do not fade into the surface. The viewer's own
 * cards get a ring in the owner's player colour, offset by a gap so it reads on a bar of the same
 * colour. A wider gap where the colour group changes lets the groups be counted at a glance;
 * ringed strips space their bars wider so neighbouring rings stay apart.
 */
const barClass = 'block h-[16px] w-[6px] flex-none rounded-[2px]';
const ownedBarClass = 'bg-(color:--strip-card-color)';
const freeBarClass = cx(
  'bg-[color-mix(in_srgb,var(--strip-card-color)_38%,transparent)]',
  'shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--strip-card-color)_72%,transparent)]',
  'forced-colors:border forced-colors:border-[CanvasText]',
);
const ringBarClass =
  'outline-[length:1.5px] outline-offset-[1px] outline-(color:--strip-ring-color) outline-solid';
const spacing = {
  ringed: { strip: 'gap-y-[7px] p-[3px]', card: 'ms-[4px]', group: 'ms-[9px]' },
  plain: { strip: 'gap-y-[4px]', card: 'ms-[3px]', group: 'ms-[7px]' },
};

/**
 * A row of small vertical bars, one per property card, in the order given. Purely visual: the
 * caller states the same facts in text (card count, accessible name).
 */
export function PropertyStrip({ cards, className }: PropertyStripProps) {
  if (cards.length === 0) return null;
  const space = spacing[cards.some((card) => card.ring !== undefined) ? 'ringed' : 'plain'];
  return (
    <span
      aria-hidden="true"
      data-testid="property-strip"
      className={cx('flex flex-wrap items-center', space.strip, className)}
    >
      {cards.map((card, index) => {
        const previous = cards[index - 1];
        const groupStart = previous !== undefined && previous.group !== card.group;
        return (
          <span
            key={card.tileId}
            data-owned={card.owned}
            data-ring={card.ring === undefined ? undefined : true}
            data-group-start={groupStart ? true : undefined}
            className={cx(
              barClass,
              card.owned ? ownedBarClass : freeBarClass,
              card.ring !== undefined && ringBarClass,
              previous !== undefined && (groupStart ? space.group : space.card),
            )}
            style={
              {
                '--strip-card-color': card.color,
                ...(card.ring === undefined ? {} : { '--strip-ring-color': card.ring }),
              } as CSSProperties
            }
          />
        );
      })}
    </span>
  );
}
