import type { PlayerController } from '../../../shared/contracts/api';
import type { Currency, Player } from '../../../shared/types/monopoly';
import { Button } from '../../components/ui';
import { useLanguage } from '../../i18n/language-context';
import { controllerLabel } from './game-page-helpers';
import { WalletCard } from './WalletCard';

export interface WalletsSectionProps {
  players: Player[];
  currency: Currency;
  controlledWallets: PlayerController[];
  activeControlledWalletId: string | null;
  activeWallet: Player | null;
  otherPlayers: Player[];
  canMutate: boolean;
  onSelectWallet: (playerId: string) => void;
  onOpenWallet: (player: Player) => void;
}

/** "Player wallets" section: wallet switcher, the controlled wallet and everyone else's. */
export function WalletsSection({
  players,
  currency,
  controlledWallets,
  activeControlledWalletId,
  activeWallet,
  otherPlayers,
  canMutate,
  onSelectWallet,
  onOpenWallet,
}: WalletsSectionProps) {
  const { t } = useLanguage();
  return (
    <section className="wallets-section" aria-labelledby="player-wallets-title">
      <header className="wallets-heading">
        <h2 id="player-wallets-title">{t('playerWallets')}</h2>
      </header>
      {controlledWallets.length > 0 && (
        <fieldset className="wallet-switcher">
          <legend>{t('walletSwitcher')}</legend>
          <div>
            {controlledWallets.map((wallet) => {
              const player = players.find((candidate) => candidate.id === wallet.playerId);
              if (player === undefined) return null;
              return (
                <Button
                  variant="secondary"
                  key={wallet.playerId}
                  aria-pressed={activeControlledWalletId === wallet.playerId}
                  onClick={() => onSelectWallet(wallet.playerId)}
                >
                  {controllerLabel(wallet.kind, t)}: {player.name}
                </Button>
              );
            })}
          </div>
        </fieldset>
      )}
      <div className={`wallet-layout${activeWallet === null ? ' wallet-layout-readonly' : ''}`}>
        {activeWallet !== null && (
          <section
            className="wallet-group wallet-group-controlled"
            aria-label={t('walletTitle', { name: activeWallet.name })}
          >
            <h3>{t('yourWallet')}</h3>
            <WalletCard
              player={activeWallet}
              players={players}
              currency={currency}
              active
              gameActive={canMutate}
              prominent
              onOpen={() => onOpenWallet(activeWallet)}
            />
          </section>
        )}
        <div className="wallet-group wallet-group-others">
          {activeWallet !== null && <h3>{t('otherPlayers')}</h3>}
          <div className="wallet-grid">
            {otherPlayers.map((player) => (
              <WalletCard
                key={player.id}
                player={player}
                players={players}
                currency={currency}
                active={false}
                gameActive={canMutate}
                onOpen={() => onOpenWallet(player)}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
