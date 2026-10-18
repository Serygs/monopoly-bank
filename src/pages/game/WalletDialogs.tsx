import type { ComponentProps } from 'react';
import type { Player } from '../../../shared/types/monopoly';
import { monopolyBankApi } from '../../api/monopoly-bank-api';
import { useFeedback } from '../../components/ui';
import { useLanguage } from '../../i18n/language-context';
import type { TranslationKey } from '../../i18n/translations';
import { playPaymentFeedback, vibrate } from '../../utils/feedback';
import { BankingDialog } from './BankingDialog';
import { BankruptcyDialog } from './BankruptcyDialog';
import type { GameContext } from './game-context';
import { applyBankingResponse, type ActionType } from './game-page-helpers';

const completionMessage: Partial<Record<ActionType, TranslationKey>> = {
  PROPERTY_PURCHASE: 'propertyBought',
  PROPERTY_BUILD: 'buildingBuilt',
  PROPERTY_SELL_BUILDING: 'buildingSold',
  PAY_RENT: 'rentPaid',
  MORTGAGE: 'mortgageRecorded',
  MORTGAGE_REDEMPTION: 'redemptionRecorded',
  LOAN_REPAYMENT: 'loanRepaid',
  BANK_LOAN: 'bankLoanRecorded',
  JACKPOT_PAYOUT: 'jackpotCollected',
};

type BankingProps = ComponentProps<typeof BankingDialog>;
type Completed = Parameters<BankingProps['onCompleted']>;

function useWalletCompletion(ctx: GameContext) {
  const { t } = useLanguage();
  const notify = useFeedback();
  const { details, preferences, setDetails, dialogs } = ctx;
  const closeWallet = () => dialogs.wallet.setSelectedPlayer(null);
  const completed = (
    ...[players, action, amount, mortgages, loans, cooldowns, jackpot, changed]: Completed
  ) => {
    playPaymentFeedback(preferences.sound);
    vibrate(35, preferences.vibration);
    const applied = applyBankingResponse(details, {
      players,
      mortgages,
      loans,
      bankLoanCooldowns: cooldowns,
      jackpot,
      properties: changed,
    });
    const recent =
      amount === null
        ? details.recentAmounts
        : [amount, ...(details.recentAmounts ?? []).filter((value) => value !== amount)].slice(
            0,
            5,
          );
    setDetails({ ...applied, recentAmounts: recent });
    closeWallet();
    notify({ tone: 'success', message: t(completionMessage[action] ?? 'paymentSent') });
  };
  const requested = (action: ActionType, lenderName?: string) => {
    ctx.loadPaymentRequests();
    closeWallet();
    const message =
      action === 'LOAN_ISSUE'
        ? t('loanRequestSent', { name: lenderName ?? t('playerFallback') })
        : t('paymentRequestCreated');
    notify({ tone: 'success', message });
  };
  return { onCompleted: completed, onPaymentRequested: requested };
}

function bankingDataProps(ctx: GameContext, player: Player) {
  const { gameId, details, view, dialogs } = ctx;
  const { walletIntent, settleLoanOnOpen } = dialogs.wallet;
  const rules = details.game.rules;
  return {
    gameId,
    player,
    players: details.players,
    passGoReward: details.game.passGoReward,
    currency: details.game.currency,
    startingBalance: details.game.startingBalance,
    rules,
    settings: details.game.settings,
    mortgages: details.mortgages ?? [],
    properties: view.properties,
    initialAction: walletIntent?.action,
    initialTileId: walletIntent?.tileId,
    loans: details.loans ?? [],
    bankLoanCooldowns: details.bankLoanCooldowns ?? [],
    jackpot: details.jackpot ?? 0,
    settleOnOpen: settleLoanOnOpen,
    auction: rules.auctions ? (details.auction ?? null) : null,
    favoriteAmounts: details.favoriteAmounts ?? [],
    recentAmounts: details.recentAmounts ?? [],
  };
}

function bankingActionProps(ctx: GameContext, player: Player) {
  const { gameId, setDetails, dialogs } = ctx;
  const { setSelectedPlayer, setBankruptPlayer } = dialogs.wallet;
  const handOff = (open: () => void) => () => {
    open();
    setSelectedPlayer(null);
  };
  return {
    onStartAuction: (lotName: string) => {
      dialogs.prompts.setAuctionPrompt({ player, lotName });
      setSelectedPlayer(null);
    },
    onStartTrade: handOff(() => dialogs.prompts.setTradePrompt({ player, tileId: '' })),
    onToggleFavorite: (amount: number) =>
      void monopolyBankApi
        .toggleFavoriteAmount(gameId, amount)
        .then((favoriteAmounts) =>
          setDetails((current) => (current === null ? current : { ...current, favoriteAmounts })),
        ),
    onClose: () => setSelectedPlayer(null),
    onBankrupt: handOff(() => setBankruptPlayer(player)),
    onViewHistory: (target: Player) => {
      setSelectedPlayer(null);
      dialogs.activity.setScope('ALL');
      dialogs.activity.setPlayerId(target.id);
      dialogs.activity.setOpen(true);
    },
  };
}

function BankingHost({ ctx }: { ctx: GameContext }) {
  const completion = useWalletCompletion(ctx);
  const player = ctx.dialogs.wallet.selectedPlayer;
  if (player === null) return null;
  return (
    <BankingDialog
      {...bankingDataProps(ctx, player)}
      {...bankingActionProps(ctx, player)}
      {...completion}
    />
  );
}

function BankruptcyHost({ ctx }: { ctx: GameContext }) {
  const { gameId, details, view, dialogs, setDetails } = ctx;
  const { bankruptPlayer, setBankruptPlayer, setSelectedPlayer } = dialogs.wallet;
  if (bankruptPlayer === null) return null;
  const hasBankLoan =
    details.game.rules.bankLoans &&
    (details.loans ?? []).some(
      (loan) =>
        loan.lenderKind === 'BANK' &&
        loan.state === 'ACTIVE' &&
        loan.borrowerPlayerId === bankruptPlayer.id,
    );
  return (
    <BankruptcyDialog
      gameId={gameId}
      player={bankruptPlayer}
      players={details.players}
      hasBankLoan={hasBankLoan}
      board={view.board}
      properties={view.properties}
      currency={details.game.currency}
      onOpenWallet={(wallet) => {
        setBankruptPlayer(null);
        setSelectedPlayer(wallet);
      }}
      onClose={() => setBankruptPlayer(null)}
      onCompleted={(players, mortgages, loans, bankLoanCooldowns, jackpot, properties) => {
        setDetails(
          applyBankingResponse(
            details,
            { players, mortgages, loans, bankLoanCooldowns, jackpot, properties },
            'replace',
          ),
        );
        setBankruptPlayer(null);
      }}
    />
  );
}

export function WalletDialogs({ ctx }: { ctx: GameContext }) {
  return (
    <>
      <BankingHost ctx={ctx} />
      <BankruptcyHost ctx={ctx} />
    </>
  );
}
