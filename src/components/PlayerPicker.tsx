import type { Currency, Player } from '../../shared/types/monopoly';
import { formatMoney } from '../utils/money';
import { playerNameWithGameId } from '../utils/player-display';

export function PlayerPicker({ label, players, gamePlayers, value, currency, onChange }: { label: string; players: readonly Player[]; gamePlayers: readonly Player[]; value: string; currency: Currency; onChange: (id: string) => void }) {
  return <fieldset className="player-picker"><legend>{label}</legend><div>{players.map((candidate) => <button className={`player-choice${value === candidate.id ? ' selected' : ''}`} type="button" key={candidate.id} aria-pressed={value === candidate.id} onClick={() => onChange(candidate.id)}><span className="player-color" style={{ backgroundColor: candidate.color }} /><span>{playerNameWithGameId(candidate, gamePlayers)}</span><small>{formatMoney(candidate.balance, currency)}</small></button>)}</div></fieldset>;
}
