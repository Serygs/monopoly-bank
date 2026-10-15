import type { Currency, Player } from '../../../shared/types/monopoly';
import { PlayerRow } from '../../components/game/PlayerRow';
import { cx } from '../../components/ui/class-names';
import { playerNameWithGameId } from '../../utils/player-display';

export interface PlayerPickerProps {
  label: string;
  players: Player[];
  gamePlayers: Player[];
  value: string;
  currency: Currency;
  onChange: (id: string) => void;
}

/*
 * Recipient choices: a card per player (swatch, name, balance below the name), selected by
 * `aria-pressed`; one column below `md`.
 */
const pickerClass = cx(
  'mx-0 my-[18px] border-0 p-0 max-md:my-(--mb-space-3) [&>legend]:mb-[10px] [&>legend]:font-semibold [&>legend]:text-primary',
  'max-md:[&>legend]:mb-(--mb-space-2) max-md:[&>legend]:text-small max-md:[&>legend]:text-secondary',
  '[&>div]:grid [&>div]:grid-cols-[repeat(auto-fit,minmax(155px,1fr))] [&>div]:gap-[8px]',
  // Compact: one row of chips that scrolls sideways.
  'max-md:[&>div]:flex max-md:[&>div]:snap-x max-md:[&>div]:overflow-x-auto max-md:[&>div]:overscroll-x-contain max-md:[&>div]:pb-[2px] max-md:[&>div]:[scrollbar-width:none] max-md:[&>div::-webkit-scrollbar]:hidden',
  'max-md:[&_button]:min-w-[150px] max-md:[&_button]:shrink-0 max-md:[&_button]:snap-start',
  '[&_button]:grid [&_button]:min-h-[56px] [&_button]:grid-cols-[auto_1fr] [&_button]:items-center [&_button]:gap-x-[8px] [&_button]:rounded-[11px]',
  '[&_button]:border [&_button]:border-border [&_button]:bg-surface-elevated [&_button]:p-[10px] [&_button]:text-left [&_button]:font-semibold [&_button]:text-primary',
  '[&_button]:transition-[color,background-color,border-color,box-shadow,transform] [&_button]:duration-(--mb-duration-fast) [&_button]:ease-standard',
  '[&_button:disabled]:cursor-not-allowed [&_button:disabled]:opacity-48',
  '[&_button[aria-pressed=true]]:border-accent [&_button[aria-pressed=true]]:bg-surface-subtle [&_button[aria-pressed=true]]:shadow-[inset_0_0_0_1px_var(--mb-color-accent)]',
  '[&_small]:col-start-2 [&_small]:font-regular [&_small]:text-secondary',
);

/** The only recipient: arrow, swatch, name and balance on one line. */
const soleClass = cx(
  'my-(--mb-space-3) flex items-center gap-(--mb-space-2) rounded-[11px] border border-border bg-surface-subtle p-[10px] font-semibold text-primary',
  '[&_small]:ms-auto [&_small]:font-regular [&_small]:text-secondary',
);

export function PlayerPicker({
  label,
  players,
  gamePlayers,
  value,
  currency,
  onChange,
}: PlayerPickerProps) {
  // A single possible recipient needs no choosing: show it as one read-only line.
  const [only] = players;
  if (players.length === 1 && only !== undefined)
    return (
      <div className={soleClass} role="group" aria-label={label}>
        <span aria-hidden="true">→</span>
        <PlayerRow
          player={only}
          currency={currency}
          name={playerNameWithGameId(only, gamePlayers)}
        />
      </div>
    );
  return (
    <fieldset className={pickerClass}>
      <legend>{label}</legend>
      <div>
        {players.map((candidate) => (
          <button
            type="button"
            key={candidate.id}
            aria-pressed={value === candidate.id}
            onClick={() => onChange(candidate.id)}
          >
            <PlayerRow
              player={candidate}
              currency={currency}
              name={playerNameWithGameId(candidate, gamePlayers)}
            />
          </button>
        ))}
      </div>
    </fieldset>
  );
}
