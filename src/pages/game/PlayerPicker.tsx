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
  'mx-0 my-[18px] border-0 p-0 [&>legend]:mb-[10px] [&>legend]:font-semibold [&>legend]:text-primary',
  '[&>div]:grid [&>div]:grid-cols-[repeat(auto-fit,minmax(155px,1fr))] [&>div]:gap-[8px] max-md:[&>div]:grid-cols-1',
  '[&_button]:grid [&_button]:min-h-[56px] [&_button]:grid-cols-[auto_1fr] [&_button]:items-center [&_button]:gap-x-[8px] [&_button]:rounded-[11px]',
  '[&_button]:border [&_button]:border-border [&_button]:bg-surface-elevated [&_button]:p-[10px] [&_button]:text-left [&_button]:font-semibold [&_button]:text-primary',
  '[&_button]:transition-[color,background-color,border-color,box-shadow,transform] [&_button]:duration-(--mb-duration-fast) [&_button]:ease-standard',
  '[&_button:disabled]:cursor-not-allowed [&_button:disabled]:opacity-48',
  '[&_button[aria-pressed=true]]:border-accent [&_button[aria-pressed=true]]:bg-surface-subtle [&_button[aria-pressed=true]]:shadow-[inset_0_0_0_1px_var(--mb-color-accent)]',
  '[&_small]:col-start-2 [&_small]:font-regular [&_small]:text-secondary',
);

export function PlayerPicker({
  label,
  players,
  gamePlayers,
  value,
  currency,
  onChange,
}: PlayerPickerProps) {
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
