import type { CSSProperties } from 'react';
import type { Currency, Player } from '../../../shared/types/monopoly';
import { useLanguage } from '../../i18n/language-context';
import { formatMoney } from '../../utils/money';
import { playerNameWithGameId } from '../../utils/player-display';

export interface WalletCardProps {
  player: Player;
  players: Player[];
  currency: Currency;
  active: boolean;
  gameActive: boolean;
  prominent?: boolean;
  onOpen: () => void;
}

export function WalletCard({
  player,
  players,
  currency,
  active,
  gameActive,
  prominent = false,
  onOpen,
}: WalletCardProps) {
  const { t } = useLanguage();
  const playerName = playerNameWithGameId(player, players);
  const unavailable = !gameActive || player.status === 'BANKRUPT';
  const interactive = active && !unavailable;
  const balance = formatMoney(player.balance, currency);
  const balanceLengthClass =
    balance.length > 18
      ? ' wallet-balance-very-long'
      : balance.length > 12
        ? ' wallet-balance-long'
        : '';
  const cardStyle = { '--wallet-player-color': player.color } as CSSProperties;
  const content = (
    <>
      <span className="wallet-card-heading">
        <span
          className="player-color"
          style={{ backgroundColor: player.color }}
          aria-hidden="true"
        />
        <span className="wallet-name">{playerName}</span>
        <span className="wallet-card-badges">
          {active && <span className="wallet-active-indicator">{t('activeWallet')}</span>}
          {player.status === 'BANKRUPT' && (
            <span className="wallet-bankrupt-indicator">{t('bankrupt')}</span>
          )}
        </span>
      </span>
      <strong className={`wallet-balance${balanceLengthClass}`}>{balance}</strong>
      <span className="wallet-card-footer">
        <span>{interactive ? t('walletAction') : t('walletReadOnly')}</span>
        {interactive && <span aria-hidden="true">→</span>}
      </span>
    </>
  );
  const accessibleLabel = t(interactive ? 'walletAria' : 'walletReadOnlyAria', {
    name: playerName,
    balance,
  });
  if (!active)
    return (
      <article
        className="wallet-card wallet-card-readonly"
        style={cardStyle}
        aria-label={accessibleLabel}
      >
        {content}
      </article>
    );
  return (
    <button
      className={`wallet-card wallet-card-button wallet-card-active${prominent ? ' wallet-card-prominent' : ''}`}
      type="button"
      disabled={unavailable}
      style={cardStyle}
      aria-label={accessibleLabel}
      onClick={onOpen}
    >
      {content}
    </button>
  );
}
