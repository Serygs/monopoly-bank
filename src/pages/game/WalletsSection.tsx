import type { PlayerController } from '../../../shared/contracts/api';
import type { Currency, Loan, Player } from '../../../shared/types/monopoly';
import { Button } from '../../components/ui';
import { cx } from '../../components/ui/class-names';
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
  /** Active player loans, shown on each wallet card. */
  loans?: Loan[];
  onSelectWallet: (playerId: string) => void;
  onOpenWallet: (player: Player) => void;
}

/*
 * `wallets-section` stays for the e2e overflow check. In Classic Bank the pressed switch gets an
 * accent ring through its parent variant; the Button's own hover and pressed states (higher
 * specificity) still win, and each style keeps its secondary border and Liquid Glass its fill.
 */
const switcherClass = cx(
  'mx-0 mt-0 mb-(--mb-space-5) rounded-card border border-border bg-surface-subtle p-(--mb-space-3)',
  '[&>legend]:px-(--mb-space-2) [&>legend]:text-small [&>legend]:font-semibold [&>legend]:text-secondary',
  '[&>div]:flex [&>div]:flex-wrap [&>div]:gap-(--mb-space-2)',
  'classic:[&_[aria-pressed=true]]:bg-surface-elevated classic:[&_[aria-pressed=true]]:shadow-[inset_0_0_0_1px_var(--mb-color-accent)]',
);

/* A read-only layout drops to one column at `md` only; the `lg` columns apply to both. */
const layoutClass = cx(
  'grid min-w-0 gap-(--mb-layout-gap-compact) md:items-stretch md:gap-(--mb-layout-gap-medium)',
  'lg:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.7fr)] lg:gap-(--mb-layout-gap-wide)',
);
const groupClass =
  'min-w-0 [&>h3]:mx-0 [&>h3]:mt-0 [&>h3]:mb-(--mb-space-3) [&>h3]:text-small [&>h3]:font-semibold [&>h3]:text-secondary';

/** One-line rows below `md`; from there two columns once the group is 20rem wide, always from `lg`. */
const gridClass =
  'grid grid-cols-1 gap-(--mb-space-2) md:gap-(--mb-space-3) md:@min-[20rem]:grid-cols-2 lg:grid-cols-2 lg:gap-(--mb-space-4)';

/** "Player wallets" section: wallet switcher, the controlled wallet and everyone else's. */
export function WalletsSection({
  players,
  currency,
  controlledWallets,
  activeControlledWalletId,
  activeWallet,
  otherPlayers,
  canMutate,
  loans = [],
  onSelectWallet,
  onOpenWallet,
}: WalletsSectionProps) {
  const { t } = useLanguage();
  return (
    <section
      className="wallets-section mt-(--mb-space-7) max-md:mt-(--mb-space-4)"
      aria-labelledby="player-wallets-title"
    >
      <header className="mb-(--mb-space-4) max-md:sr-only flex items-end justify-between gap-(--mb-space-4)">
        <h2 id="player-wallets-title">{t('playerWallets')}</h2>
      </header>
      {controlledWallets.length > 0 && (
        <fieldset className={cx(switcherClass, controlledWallets.length === 1 && 'max-md:hidden')}>
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
      <div
        className={cx(
          layoutClass,
          activeWallet === null
            ? 'md:grid-cols-1'
            : 'md:grid-cols-[minmax(17rem,0.9fr)_minmax(0,1.6fr)]',
        )}
      >
        {activeWallet !== null && (
          <section
            className={cx(groupClass, 'md:grid md:grid-rows-[auto_1fr] md:[&_.wallet-card]:h-full')}
            aria-label={t('walletTitle', { name: activeWallet.name })}
          >
            <h3 className="max-md:sr-only">{t('yourWallet')}</h3>
            <WalletCard
              player={activeWallet}
              players={players}
              currency={currency}
              active
              gameActive={canMutate}
              prominent

              loans={loans}
              onOpen={() => onOpenWallet(activeWallet)}
            />
          </section>
        )}
        <div className={cx(groupClass, '@container')}>
          {activeWallet !== null && <h3>{t('otherPlayers')}</h3>}
          <div className={gridClass}>
            {otherPlayers.map((player) => (
              <WalletCard
                key={player.id}
                player={player}
                players={players}
                currency={currency}
                active={false}
                loans={loans}
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
