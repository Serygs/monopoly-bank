import type { Currency, Player } from '../../../shared/types/monopoly';
import { Avatar } from '../AvatarPicker';
import { MoneyValue } from '../ui';

export interface PlayerRowProps {
  player: Pick<Player, 'name' | 'color' | 'balance'>;
  currency: Currency;
  /** Displayed name; defaults to `player.name` (e.g. pass `playerNameWithGameId`). */
  name?: string;
  /** Emoji or image data URL. Without it the row shows the player's colour swatch. */
  avatar?: string;
}

/**
 * Avatar (or colour swatch), name and balance of one player. Renders the row's content only;
 * the caller owns the container element (e.g. the `player-choice` button).
 */
export function PlayerRow({ player, currency, name = player.name, avatar }: PlayerRowProps) {
  return (
    <>
      {avatar === undefined ? (
        <span className="player-color" style={{ backgroundColor: player.color }} />
      ) : (
        <Avatar avatar={avatar} label={name} />
      )}
      <span>{name}</span>
      <small>
        <MoneyValue amount={player.balance} currency={currency} />
      </small>
    </>
  );
}
