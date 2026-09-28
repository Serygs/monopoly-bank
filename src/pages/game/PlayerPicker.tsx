import type { Currency, Player } from '../../../shared/types/monopoly';
import { PlayerRow } from '../../components/game/PlayerRow';
import { playerNameWithGameId } from '../../utils/player-display';

export interface PlayerPickerProps {
  label: string;
  players: Player[];
  gamePlayers: Player[];
  value: string;
  currency: Currency;
  onChange: (id: string) => void;
}

export function PlayerPicker({
  label,
  players,
  gamePlayers,
  value,
  currency,
  onChange,
}: PlayerPickerProps) {
  return (
    <fieldset className="player-picker">
      <legend>{label}</legend>
      <div>
        {players.map((candidate) => (
          <button
            className={`player-choice${value === candidate.id ? ' selected' : ''}`}
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
