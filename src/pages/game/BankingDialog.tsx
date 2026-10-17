import { useRef, useState, type ReactNode } from 'react';
import {
  defaultGameRules,
  type Auction,
  type BankLoanCooldown,
  type Currency,
  type GameProperty,
  type GameRules,
  type GameSettings,
  type InterestRatePercent,
  type Loan,
  type Mortgage,
  type Player,
} from '../../../shared/types/monopoly';
import { buildGameSettings } from '../../../shared/domain/game-rules';
import { normalizePropertyName, redemptionCost } from '../../../shared/domain/mortgage';
import { sellRefund } from '../../../shared/domain/property';
import { MonopolyBankApiError, monopolyBankApi } from '../../api/monopoly-bank-api';
import { AmountSelector } from '../../components/AmountSelector';
import { Dialog } from '../../components/Dialog';
import { useBuildingLabel } from '../../components/game/property-labels';
import { WalletMenu } from '../../components/game/WalletMenu';
import {
  Button,
  DialogActions,
  Field,
  FieldError,
  FieldHint,
  MoneyValue,
  Notice,
  Toggle,
} from '../../components/ui';
import { cx } from '../../components/ui/class-names';
import { apiErrorMessage } from '../../i18n/api-errors';
import { useLanguage } from '../../i18n/language-context';
import {
  activeBankLoan,
  activeLoansAsBorrower,
  loanInterest,
  loanOutstanding,
} from '../../utils/loans';
import { auctionReserveFor } from '../../utils/auction';
import { formatMoney } from '../../utils/money';
import { presetAmounts } from '../../utils/quick-amounts';
import {
  buildableTiles,
  freeTiles,
  isDiceSum,
  mortgageableTiles,
  rentableTiles,
  rentDue,
  sellableTiles,
  tileRent,
  tileViews,
  type TileView,
} from '../../utils/property-view';
import { Confirmation } from './Confirmation';
import {
  actionDescription,
  actionLabel,
  advancedWalletActions,
  buildRequest,
  insufficientMessage,
  isPositiveInteger,
  preflightFundsError,
  preflightShortfall,
  previewBalances,
  primaryWalletActions,
  walletActionTone,
  type ActionType,
} from './game-page-helpers';
import { InterestRatePicker, LoanPicker } from './LoanFields';
import { MortgageDetails, RedemptionPicker } from './MortgageFields';
import { PlayerPicker } from './PlayerPicker';
import { TilePicker, type TilePickerItem } from './TilePicker';

export interface BankingDialogProps {
  gameId: string;
  player: Player;
  players: Player[];
  passGoReward: number;
  currency: Currency;
  /** Scales the quick amounts; without it they fall back to fixed round amounts. */
  startingBalance?: number;
  /** The game's house rules; omitted rules are off. */
  rules?: GameRules;
  /** Amounts derived at creation (taxes, jail fine); older games have none, so no fixed payments. */
  settings?: GameSettings | null;
  /** Every property currently mortgaged in the game. */
  mortgages?: Mortgage[];
  /** The loans still being repaid. */
  loans?: Loan[];
  /** Players who repaid a bank loan recently (bank-loans rule). */
  bankLoanCooldowns?: BankLoanCooldown[];
  /** The Free Parking pot (jackpot rule); what a collection pays out in full. */
  jackpot?: number;
  /** Open straight on repaying the player's bank loan (the overdue "Settle loan" prompt). */
  settleOnOpen?: boolean;
  /** Board games: the property registry; the tile pickers list only valid choices from it. */
  properties?: GameProperty[];
  /** Open straight on this action (the tile sheet's quick entry). */
  initialAction?: ActionType;
  /** The tile the quick entry started from; preselected in the tile picker. */
  initialTileId?: string;
  /** The running or just-closed auction (auctions rule): its leading bid is reserved cash. */
  auction?: Auction | null;
  /** Opens the start-auction prompt for this wallet, with a suggested property name. */
  onStartAuction?: (lotName: string) => void;
  /** Board games: opens the trade dialog for this wallet. */
  onStartTrade?: () => void;
  favoriteAmounts: number[];
  recentAmounts: number[];
  onToggleFavorite: (amount: number) => void;
  onClose: () => void;
  onBankrupt: () => void;
  onViewHistory: (player: Player) => void;
  onCompleted: (
    players: Player[],
    action: ActionType,
    amount: number | null,
    mortgages?: Mortgage[],
    loans?: Loan[],
    bankLoanCooldowns?: BankLoanCooldown[],
    jackpot?: number,
    properties?: GameProperty[],
  ) => void;
  /** A payment or loan request was created; a loan request names the lender being asked. */
  onPaymentRequested: (action: ActionType, lenderName?: string) => void;
}

/** Inverse balance plate: the label in the highlight colour over the balance figure. */
const balanceClass = cx(
  'relative mx-0 mt-[18px] mb-[14px] grid gap-[4px] overflow-hidden rounded-[14px] border border-accent bg-surface-inverse px-[18px] py-[16px] shadow-balance-inset',
  '*:relative *:z-1 [&_span]:text-small [&_span]:font-semibold [&_span]:text-highlight',
  '[&_strong]:font-money [&_strong]:text-money-xl [&_strong]:leading-[0.98] [&_strong]:font-bold [&_strong]:tracking-[-0.05em] [&_strong]:text-on-inverse [&_strong]:tabular-nums [&_strong]:wrap-anywhere',
);

/** Centred, capped-width danger action on its own row (in the single column below `md`). */
/* What the payer is missing, with the way out when no amount change will help. */
const shortfallClass =
  'mt-(--mb-space-2) flex flex-wrap items-center justify-between gap-(--mb-space-3) [&>p]:m-0 [&>p]:font-semibold [&>p]:text-danger';
const bankruptcyClass = 'w-full';
const dangerZoneClass =
  'mt-(--mb-space-2) rounded-control border border-danger-border bg-danger-soft/40 p-(--mb-space-3)';

/*
 * The form and confirmation steps: a flex column whose body alone scrolls, so the footer sits
 * outside the scroll area and never overlaps the content. The shared compact `DialogActions`
 * (sticky, stacked) becomes a plain one-row footer: Back, then the wider primary action.
 */
const stepPanelClass = 'flex flex-col overflow-hidden!';
const stepBodyClass = 'min-h-0 flex-1 overflow-y-auto overscroll-contain pt-(--mb-space-3)';
const stepFooterClass = cx(
  'shrink-0 max-md:static! max-md:m-0! max-md:mt-(--mb-space-3)! max-md:flex-row! max-md:p-0!',
  'max-md:[&_.button]:w-auto! max-md:[&>:first-child]:flex-1 max-md:[&>:last-child]:flex-[2]',
);

function StepBody({ children }: { children: ReactNode }) {
  return <div className={stepBodyClass}>{children}</div>;
}

export function BankingDialog({
  gameId,
  player,
  players,
  passGoReward,
  currency,
  startingBalance,
  rules = defaultGameRules,
  settings = null,
  mortgages = [],
  properties = [],
  initialAction,
  initialTileId,
  loans = [],
  bankLoanCooldowns = [],
  jackpot = 0,
  settleOnOpen = false,
  auction = null,
  onStartAuction,
  onStartTrade,
  favoriteAmounts,
  recentAmounts,
  onToggleFavorite,
  onClose,
  onBankrupt,
  onViewHistory,
  onCompleted,
  onPaymentRequested,
}: BankingDialogProps) {
  const { t } = useLanguage();
  const buildingLabel = useBuildingLabel();
  const initialBankLoan = rules.bankLoans && settleOnOpen ? activeBankLoan(loans, player.id) : null;
  const board = settings?.board ?? null;
  // Quick entry from a redeemable tile: the player's active mortgage on it fixes the cost.
  const initialRedemption =
    board !== null && initialAction === 'MORTGAGE_REDEMPTION' && initialTileId !== undefined
      ? mortgages.find((item) => item.playerId === player.id && item.tileId === initialTileId)
      : undefined;
  const [action, setAction] = useState<ActionType | null>(
    initialBankLoan === null ? (board === null ? null : (initialAction ?? null)) : 'LOAN_REPAYMENT',
  );
  const [tileId, setTileId] = useState(
    initialAction === 'MORTGAGE_REDEMPTION' ? '' : (initialTileId ?? ''),
  );
  const [diceSum, setDiceSum] = useState('');
  const [exactGoChosen, setExactGoChosen] = useState(false);
  const [targetId, setTargetId] = useState('');
  const [amount, setAmount] = useState(
    initialBankLoan !== null
      ? String(loanOutstanding(initialBankLoan))
      : initialRedemption === undefined
        ? ''
        : String(redemptionCost(initialRedemption.mortgageValue)),
  );
  const [comment, setComment] = useState('');
  const [commentOpen, setCommentOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [exactLanding, setExactLanding] = useState(false);
  // An income-tax or luxury-tax chip was used: with the jackpot rule the money goes to the pot.
  const [payToPot, setPayToPot] = useState(false);
  const [propertyName, setPropertyName] = useState('');
  const [noBuildings, setNoBuildings] = useState(false);
  // A purchase at an agreed price instead of the list price needs an extra confirmation.
  const [overrideOn, setOverrideOn] = useState(false);
  const [overridePrice, setOverridePrice] = useState('');
  const [overrideConfirmed, setOverrideConfirmed] = useState(false);
  const [mortgageId, setMortgageId] = useState(initialRedemption?.id ?? '');
  const [loanId, setLoanId] = useState(initialBankLoan?.id ?? '');
  const [ratePercent, setRatePercent] = useState<InterestRatePercent | null>(null);
  // Rounds left in the cooldown while its warning is shown; null when there is nothing to warn about.
  const [cooldownRounds, setCooldownRounds] = useState<number | null>(null);
  const [cooldownAcknowledged, setCooldownAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const submittingRef = useRef(false);
  const commandIdRef = useRef<string | null>(null);
  const balancePresets = startingBalance === undefined ? [] : presetAmounts(startingBalance);
  const presets = balancePresets.length > 0 ? balancePresets : undefined;
  const jackpotRule = rules.freeParkingJackpot;
  const views = board === null ? [] : tileViews(board, properties);
  const tileAction =
    board !== null &&
    (action === 'PROPERTY_PURCHASE' ||
      action === 'MORTGAGE' ||
      action === 'PAY_RENT' ||
      action === 'PROPERTY_BUILD' ||
      action === 'PROPERTY_SELL_BUILDING');
  const selectedTile = views.find((view) => view.tile.id === tileId) ?? null;
  const diceSumValue = diceSum === '' ? undefined : Number(diceSum);
  const needsDiceSum = action === 'PAY_RENT' && selectedTile?.tile.type === 'utility';
  const rentAmount =
    action === 'PAY_RENT' && board !== null && selectedTile !== null
      ? rentDue(board, views, selectedTile, diceSumValue)
      : null;
  // The agreed price of a purchase, when it really differs from the list price on the card.
  const purchaseOverride =
    action === 'PROPERTY_PURCHASE' &&
    overrideOn &&
    selectedTile !== null &&
    isPositiveInteger(overridePrice) &&
    Number(overridePrice) !== selectedTile.tile.price
      ? Number(overridePrice)
      : undefined;
  // What the chosen tile costs or pays, from the game's board snapshot.
  const tileAmount =
    selectedTile === null
      ? 0
      : action === 'PROPERTY_PURCHASE'
        ? (purchaseOverride ?? selectedTile.tile.price)
        : action === 'PROPERTY_BUILD'
          ? (selectedTile.tile.houseCost ?? 0)
          : action === 'PROPERTY_SELL_BUILDING' && board !== null
            ? sellRefund(board, selectedTile.tile.id)
            : action === 'MORTGAGE'
              ? selectedTile.tile.mortgage
              : (rentAmount ?? 0);
  const targetRequired = action === 'PLAYER_TO_PLAYER' || action === 'LOAN_ISSUE';
  // A lender must still be playing; payments to anyone else are left to the Worker's checks.
  const recipients = players.filter(
    (candidate) =>
      candidate.id !== player.id && (action !== 'LOAN_ISSUE' || candidate.status !== 'BANKRUPT'),
  );
  // With one possible recipient there is nothing to choose, so it is selected for the player.
  const soleRecipient = targetRequired && recipients.length === 1 ? recipients[0] : undefined;
  // A collection always pays the whole pot, which the Worker reads again when it records it.
  const amountValue =
    action === 'JACKPOT_PAYOUT' ? jackpot : tileAction ? tileAmount : Number(amount);
  const requestAction: ActionType | null =
    action === 'PLAYER_TO_BANK' && payToPot && rules.freeParkingJackpot ? 'TO_JACKPOT' : action;
  const playerLoans = rules.playerLoans ? activeLoansAsBorrower(loans, player.id) : [];
  const bankLoan = rules.bankLoans ? activeBankLoan(loans, player.id) : null;
  const repayableLoans = bankLoan === null ? playerLoans : [...playerLoans, bankLoan];
  const selectedLoan = repayableLoans.find((item) => item.id === loanId) ?? null;
  const isBankRepayment = action === 'LOAN_REPAYMENT' && selectedLoan?.lenderKind === 'BANK';
  const effectiveRate: InterestRatePercent =
    ratePercent ?? selectedLoan?.rounds?.suggestedRatePercent ?? 0;
  const bankLoanMax =
    (settings ?? (startingBalance === undefined ? null : buildGameSettings(startingBalance)))
      ?.bankLoanMax ?? null;
  const cooldown = bankLoanCooldowns.find((item) => item.playerId === player.id) ?? null;
  const effectiveTargetId =
    action === 'LOAN_REPAYMENT'
      ? (selectedLoan?.lenderPlayerId ?? '')
      : action === 'PAY_RENT'
        ? (selectedTile?.ownerPlayerId ?? '')
        : targetId !== ''
          ? targetId
          : (soleRecipient?.id ?? '');
  const target = players.find((candidate) => candidate.id === effectiveTargetId) ?? null;
  const loanOwed = selectedLoan === null ? 0 : loanOutstanding(selectedLoan);
  const interest = isBankRepayment ? loanInterest(loanOwed, effectiveRate) : 0;
  const overRepayment = action === 'LOAN_REPAYMENT' && amountValue > loanOwed && loanOwed > 0;
  // The name is sent and shown as the server will store it: trimmed, spaces collapsed.
  const tidyName = normalizePropertyName(propertyName) ?? propertyName.trim();
  const playerMortgages = mortgages.filter((item) => item.playerId === player.id);
  const selectedMortgage = playerMortgages.find((item) => item.id === mortgageId) ?? null;
  const redemptionAmount =
    selectedMortgage === null ? 0 : redemptionCost(selectedMortgage.mortgageValue);
  // Paying rent to a player: tell the payer which properties of that player are mortgaged.
  const targetMortgages = mortgages.filter((item) => item.playerId === effectiveTargetId);
  const request =
    requestAction === null
      ? null
      : buildRequest(requestAction, player.id, effectiveTargetId, amountValue, comment, {
          exactLanding,
          ...(tileAction ? { tileId } : {}),
          ...(purchaseOverride === undefined ? {} : { priceOverride: purchaseOverride }),
          ...(needsDiceSum && diceSumValue !== undefined ? { diceSum: diceSumValue } : {}),
          propertyName: tidyName,
          mortgageId,
          loanId,
          ...(isBankRepayment ? { interestRatePercent: effectiveRate } : {}),
          acknowledgeCooldown: cooldownAcknowledged,
        });
  const reward = exactLanding ? passGoReward * 2 : passGoReward;
  const preview =
    request === null
      ? []
      : previewBalances(request, players, reward, redemptionAmount, loans, interest, jackpot, {
          amount: tileAmount,
          ownerPlayerId: selectedTile?.ownerPlayerId ?? null,
        });
  const amountRequired = action !== 'PASS_GO' && action !== 'JACKPOT_PAYOUT' && !tileAction;
  const isMortgageAction = action === 'MORTGAGE' || action === 'MORTGAGE_REDEMPTION';
  const isLoanAction =
    action === 'LOAN_ISSUE' || action === 'LOAN_REPAYMENT' || action === 'BANK_LOAN';
  const exceedsBankLoanMax =
    action === 'BANK_LOAN' && bankLoanMax !== null && amountValue > bankLoanMax;
  // What leaves the wallet: for a bank loan the interest comes on top of the principal.
  const payAmount = amountValue + interest;
  // Cash held back for a leading auction bid cannot be spent elsewhere.
  const reserved = auctionReserveFor(auction, player.id);
  const available = player.balance - reserved;
  const spender = reserved === 0 ? player : { ...player, balance: available };
  const fundsError = preflightFundsError(action, spender, players, payAmount, currency, t);
  const shortfall = preflightShortfall(action, spender, players, payAmount);
  const auctionBusy = auction?.state === 'ACTIVE';
  const canAuction = rules.auctions && onStartAuction !== undefined;
  const auctionLotSuggestion = comment.trim().slice(0, 60);
  const valid =
    request !== null &&
    (!targetRequired || (target !== null && target.id !== player.id)) &&
    (!amountRequired || isPositiveInteger(amount)) &&
    (!tileAction || selectedTile !== null) &&
    (action !== 'PROPERTY_PURCHASE' || !overrideOn || isPositiveInteger(overridePrice)) &&
    (action !== 'PAY_RENT' || (rentAmount !== null && rentAmount > 0)) &&
    (action !== 'MORTGAGE' ||
      tileAction ||
      (normalizePropertyName(propertyName) !== null && noBuildings)) &&
    (action !== 'MORTGAGE_REDEMPTION' || selectedMortgage !== null) &&
    (action !== 'LOAN_REPAYMENT' || (selectedLoan !== null && !overRepayment)) &&
    (action !== 'BANK_LOAN' || (bankLoan === null && !exceedsBankLoanMax)) &&
    (action !== 'JACKPOT_PAYOUT' || (rules.freeParkingJackpot && jackpot > 0)) &&
    fundsError === null;

  const selectAction = (next: ActionType | null, exact = false) => {
    setAction(next);
    setExactLanding(exact);
    setPayToPot(false);
    setPropertyName('');
    setNoBuildings(false);
    setOverrideOn(false);
    setOverridePrice('');
    setOverrideConfirmed(false);
    setMortgageId('');
    setTileId('');
    setDiceSum('');
    setLoanId('');
    setRatePercent(null);
    setCooldownRounds(null);
    setCooldownAcknowledged(false);
    setTargetId('');
    setAmount('');
    // The doubled reward says why in the history; the player can still edit the note.
    setComment(exact ? t('passGoExactComment') : '');
    setCommentOpen(false);
    // Pass GO and collecting the pot have no inputs, so they open directly on the confirmation.
    setConfirming(next === 'PASS_GO' || next === 'JACKPOT_PAYOUT');
    setError(null);
    commandIdRef.current = null;
  };

  const changeAmount = (nextAmount: string) => {
    setAmount(nextAmount);
    setPayToPot(false);
    setError(null);
    commandIdRef.current = null;
  };

  const changeTarget = (nextTargetId: string) => {
    setTargetId(nextTargetId);
    setError(null);
    commandIdRef.current = null;
  };

  const changeComment = (nextComment: string) => {
    setComment(nextComment);
    setError(null);
    commandIdRef.current = null;
  };

  const changeOverrideOn = (next: boolean) => {
    setOverrideOn(next);
    setOverrideConfirmed(false);
    setError(null);
    commandIdRef.current = null;
  };

  const changeOverridePrice = (next: string) => {
    setOverridePrice(next);
    setOverrideConfirmed(false);
    setError(null);
    commandIdRef.current = null;
  };

  const chooseTile = (view: TileView) => {
    setTileId(view.tile.id);
    setOverrideConfirmed(false);
    setDiceSum('');
    setError(null);
    commandIdRef.current = null;
  };

  const changeDiceSum = (next: string) => {
    setDiceSum(next.replace(/\D/g, '').slice(0, 2));
    setError(null);
    commandIdRef.current = null;
  };

  /** Picking a mortgage fixes the cost, so the amount follows it. */
  const chooseMortgage = (mortgage: Mortgage) => {
    setMortgageId(mortgage.id);
    changeAmount(String(redemptionCost(mortgage.mortgageValue)));
  };

  /** Picking a loan proposes repaying all of it; the amount can be lowered for a partial repayment. */
  const chooseLoan = (loan: Loan) => {
    setLoanId(loan.id);
    setRatePercent(null);
    changeAmount(String(loanOutstanding(loan)));
  };

  const chooseRate = (rate: InterestRatePercent) => {
    setRatePercent(rate);
    setError(null);
    commandIdRef.current = null;
  };

  /** Borrowing during the cooldown needs the warning confirmed first. */
  const review = () => {
    if (action === 'BANK_LOAN' && cooldown !== null && !cooldownAcknowledged)
      setCooldownRounds(cooldown.roundsLeft);
    else setConfirming(true);
  };

  const borrowAnyway = () => {
    setCooldownAcknowledged(true);
    setCooldownRounds(null);
    setConfirming(true);
    commandIdRef.current = null;
  };

  /** The overdue prompt: repay the bank loan right away. */
  const settleBankLoan = (loan: Loan) => {
    selectAction('LOAN_REPAYMENT');
    chooseLoan(loan);
  };

  /** A tax or fine from the game's settings: fill the amount and its name, then review it. */
  const reviewFixedPayment = (label: string, fixedAmount: number, toPot: boolean) => {
    changeAmount(String(fixedAmount));
    // Set after changeAmount, which clears it: only the tax chips pay the pot.
    setPayToPot(toPot);
    setComment(label);
    if (available >= fixedAmount) setConfirming(true);
  };

  const reviewQuickAmount = (nextAmount: number) => {
    changeAmount(String(nextAmount));
    if (
      action === 'PLAYER_TO_PLAYER' &&
      target !== null &&
      preflightFundsError(action, player, players, nextAmount, currency, t) === null
    ) {
      setConfirming(true);
    }
  };

  const submit = async () => {
    if (submittingRef.current || request === null || !valid || action === null) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const commandId = commandIdRef.current ?? crypto.randomUUID();
      commandIdRef.current = commandId;
      const result = await monopolyBankApi.createTransaction(gameId, request, commandId);
      if ('paymentRequests' in result) onPaymentRequested(action, target?.name);
      else
        onCompleted(
          result.players,
          action,
          action === 'PASS_GO' ||
            action === 'JACKPOT_PAYOUT' ||
            action === 'PROPERTY_PURCHASE' ||
            action === 'PROPERTY_BUILD' ||
            action === 'PROPERTY_SELL_BUILDING' ||
            action === 'PAY_RENT' ||
            isMortgageAction
            ? null
            : result.transaction.amount,
          result.mortgages,
          result.loans,
          result.bankLoanCooldowns,
          result.jackpot,
          result.properties,
        );
    } catch (caught) {
      if (caught instanceof MonopolyBankApiError && caught.code === 'BANK_LOAN_COOLDOWN') {
        // The Worker found a cooldown the client did not know about: warn, then retry acknowledged.
        const left = caught.details?.roundsLeft;
        setCooldownRounds(typeof left === 'number' ? left : 1);
        setCooldownAcknowledged(false);
        setConfirming(false);
        commandIdRef.current = null;
      } else setError(caught);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const money = (value: number) => formatMoney(value, currency);
  const ownerName = (view: TileView) =>
    players.find((candidate) => candidate.id === view.ownerPlayerId)?.name ?? '';
  const tileMortgages = playerMortgages.filter(
    (item) => item.tileId != null && views.some((view) => view.tile.id === item.tileId),
  );
  const buyItems: TilePickerItem[] = freeTiles(views).map((view) => ({
    view,
    caption: t('tilePickerPrice', { amount: money(view.tile.price) }),
  }));
  const mortgageItems: TilePickerItem[] = mortgageableTiles(views, player.id).map((view) => ({
    view,
    caption: t('tilePickerMortgageFor', { amount: money(view.tile.mortgage) }),
  }));
  const buildItems: TilePickerItem[] =
    board === null
      ? []
      : buildableTiles(board, views, player.id).map((view) => ({
          view,
          caption: t('tilePickerBuildFor', {
            amount: money(view.tile.houseCost ?? 0),
            level: buildingLabel(view.houses + 1) ?? '',
          }),
        }));
  const sellItems: TilePickerItem[] =
    board === null
      ? []
      : sellableTiles(board, views, player.id).map((view) => ({
          view,
          caption: t('tilePickerSellFor', {
            amount: money(sellRefund(board, view.tile.id)),
            level: buildingLabel(view.houses) ?? '',
          }),
        }));
  const redeemItems: TilePickerItem[] = tileMortgages.flatMap((item) => {
    const view = views.find((candidate) => candidate.tile.id === item.tileId);
    return view === undefined
      ? []
      : [
          {
            view,
            caption: t('tilePickerRedeemFor', {
              amount: money(redemptionCost(item.mortgageValue)),
            }),
          },
        ];
  });
  const rentItems: TilePickerItem[] =
    board === null
      ? []
      : rentableTiles(views, player.id).map((view) => {
          const rent = tileRent(board, views, view);
          return {
            view,
            caption:
              rent.kind === 'dice'
                ? t('tilePickerRentDice', { owner: ownerName(view), multiplier: rent.multiplier })
                : t('tilePickerRent', {
                    owner: ownerName(view),
                    amount: money(rent.kind === 'amount' ? rent.amount : 0),
                  }),
          };
        });
  const noComment =
    isMortgageAction ||
    isLoanAction ||
    action === 'PROPERTY_PURCHASE' ||
    action === 'PROPERTY_BUILD' ||
    action === 'PROPERTY_SELL_BUILDING' ||
    action === 'PAY_RENT';
  const confirmedPropertyName =
    selectedTile !== null && tileAction
      ? selectedTile.tile.name
      : action === 'MORTGAGE'
        ? tidyName
        : selectedMortgage?.propertyName;

  const title =
    requestAction === null
      ? t('walletTitle', { name: player.name })
      : actionLabel(requestAction, t);
  const transactionError =
    error === null
      ? null
      : (insufficientMessage(error, players, currency, t) ??
        apiErrorMessage(error, t, 'unableRecordTransaction'));

  const commentField =
    commentOpen || comment !== '' ? (
      <Field variant="dialog" label={t('comment')}>
        <input
          value={comment}
          maxLength={500}
          onChange={(event) => changeComment(event.target.value)}
        />
      </Field>
    ) : (
      <Button variant="quiet" className="justify-start! px-0!" onClick={() => setCommentOpen(true)}>
        <span aria-hidden="true">+</span> {t('addComment')}
      </Button>
    );
  const errorNotice = transactionError !== null && <Notice tone="error">{transactionError}</Notice>;

  return (
    <Dialog
      title={title}
      closeLabel={t('closeDialog', { title })}
      onClose={onClose}
      className={action === null ? undefined : stepPanelClass}
    >
      {action === null ? (
        <>
          {errorNotice}
          <section
            className={balanceClass}
            aria-label={t('walletBalanceAria', {
              name: player.name,
              balance: formatMoney(available, currency),
            })}
          >
            <span>{t('availableBalance')}</span>
            <strong>
              <MoneyValue amount={available} currency={currency} />
            </strong>
          </section>
          {reserved > 0 && (
            <FieldHint>
              {t('auctionReservedYours', { amount: formatMoney(reserved, currency) })}
            </FieldHint>
          )}
          {bankLoan?.rounds?.overdue === true && (
            <Notice tone="error" className="mb-(--mb-space-3)">
              <span className="block">
                {t('settleLoanPrompt', {
                  amount: formatMoney(loanOutstanding(bankLoan), currency),
                  round: bankLoan.rounds.round,
                })}
              </span>
              <Button
                variant="danger"
                className="mt-(--mb-space-2)"
                onClick={() => settleBankLoan(bankLoan)}
              >
                {t('settleLoan')}
              </Button>
            </Notice>
          )}
          <WalletMenu
            primary={(board === null
              ? primaryWalletActions
              : [
                  ...primaryWalletActions.slice(0, 1),
                  'PAY_RENT' as const,
                  ...primaryWalletActions.slice(1),
                ]
            ).map((item) => ({
              key: item,
              label: actionLabel(item, t),
              outgoing: walletActionTone(item) === 'expense',
              onSelect: () => selectAction(item, item === 'PASS_GO' && exactGoChosen),
            }))}
            exactGo={
              rules.doubleRewardOnExactGo
                ? { label: t('passGoExact'), checked: exactGoChosen, onChange: setExactGoChosen }
                : undefined
            }
            groups={[
              {
                key: 'property',
                label: t('walletGroupProperty'),
                icon: '🏠',
                items: [
                  ...(board !== null && buyItems.length > 0
                    ? [
                        {
                          key: 'PROPERTY_PURCHASE',
                          label: actionLabel('PROPERTY_PURCHASE', t),
                          outgoing: true,
                          onSelect: () => selectAction('PROPERTY_PURCHASE'),
                        },
                      ]
                    : []),
                  ...(board !== null && buildItems.length > 0
                    ? [
                        {
                          key: 'PROPERTY_BUILD',
                          label: actionLabel('PROPERTY_BUILD', t),
                          outgoing: true,
                          onSelect: () => selectAction('PROPERTY_BUILD'),
                        },
                      ]
                    : []),
                  ...(board !== null && sellItems.length > 0
                    ? [
                        {
                          key: 'PROPERTY_SELL_BUILDING',
                          label: actionLabel('PROPERTY_SELL_BUILDING', t),
                          onSelect: () => selectAction('PROPERTY_SELL_BUILDING'),
                        },
                      ]
                    : []),
                  ...(board === null || mortgageItems.length > 0
                    ? [
                        {
                          key: 'MORTGAGE',
                          label: actionLabel('MORTGAGE', t),
                          onSelect: () => selectAction('MORTGAGE'),
                        },
                      ]
                    : []),
                  ...((board === null ? playerMortgages.length : redeemItems.length) > 0
                    ? [
                        {
                          key: 'MORTGAGE_REDEMPTION',
                          label: actionLabel('MORTGAGE_REDEMPTION', t),
                          outgoing: true,
                          onSelect: () => selectAction('MORTGAGE_REDEMPTION'),
                        },
                      ]
                    : []),
                  ...(board !== null && onStartTrade !== undefined
                    ? [
                        {
                          key: 'PROPERTY_TRANSFER',
                          label: actionLabel('PROPERTY_TRANSFER', t),
                          onSelect: onStartTrade,
                        },
                      ]
                    : []),
                  ...(canAuction
                    ? [
                        {
                          key: 'AUCTION',
                          label: t('auctionPutUp'),
                          disabled: auctionBusy,
                          onSelect: () => onStartAuction(''),
                        },
                      ]
                    : []),
                ],
              },
              {
                key: 'loans',
                label: t('walletGroupLoans'),
                icon: '🤝',
                items: [
                  ...(rules.playerLoans
                    ? [
                        {
                          key: 'LOAN_ISSUE',
                          label: actionLabel('LOAN_ISSUE', t),
                          onSelect: () => selectAction('LOAN_ISSUE'),
                        },
                      ]
                    : []),
                  ...(rules.bankLoans
                    ? [
                        {
                          key: 'BANK_LOAN',
                          label: actionLabel('BANK_LOAN', t),
                          onSelect: () => selectAction('BANK_LOAN'),
                        },
                      ]
                    : []),
                  ...(repayableLoans.length > 0
                    ? [
                        {
                          key: 'LOAN_REPAYMENT',
                          label: actionLabel('LOAN_REPAYMENT', t),
                          outgoing: true,
                          onSelect: () => selectAction('LOAN_REPAYMENT'),
                        },
                      ]
                    : []),
                ],
              },
              {
                key: 'group',
                label: t('walletGroupGroup'),
                icon: '👥',
                items: advancedWalletActions
                  .filter((item) => item === 'PLAYER_TO_ALL' || item === 'ALL_TO_PLAYER')
                  .map((item) => ({
                    key: item,
                    label: actionLabel(item, t),
                    outgoing: walletActionTone(item) === 'expense',
                    onSelect: () => selectAction(item),
                  })),
              },
              {
                key: 'fund',
                label: t('walletGroupFund'),
                icon: '🅿️',
                items:
                  rules.freeParkingJackpot && jackpot > 0
                    ? [
                        {
                          key: 'JACKPOT_PAYOUT',
                          label: actionLabel('JACKPOT_PAYOUT', t),
                          onSelect: () => selectAction('JACKPOT_PAYOUT'),
                        },
                      ]
                    : [],
              },
            ]}
          >
            {canAuction && auctionBusy && <FieldHint>{t('auctionActionBusy')}</FieldHint>}
            {rules.freeParkingJackpot && jackpot > 0 && (
              <FieldHint>
                {t('jackpotPotHint', { amount: formatMoney(jackpot, currency) })}
              </FieldHint>
            )}
            <section className={dangerZoneClass} aria-label={t('walletDangerZone')}>
              <Button variant="danger" className={bankruptcyClass} onClick={onBankrupt}>
                {t('declareBankrupt')}
              </Button>
            </section>
            <Button variant="quiet" onClick={() => onViewHistory(player)}>
              {t('viewPlayerHistory', { name: player.name })}
            </Button>
          </WalletMenu>
        </>
      ) : cooldownRounds !== null ? (
        <>
          <StepBody>
            <Notice tone="info">{t('bankLoanCooldownWarning', { rounds: cooldownRounds })}</Notice>
          </StepBody>
          <DialogActions className={stepFooterClass}>
            <Button variant="secondary" onClick={() => setCooldownRounds(null)}>
              {t('back')}
            </Button>
            <Button variant="primary" onClick={borrowAnyway}>
              {t('borrowAnyway')}
            </Button>
          </DialogActions>
        </>
      ) : confirming ? (
        <>
          <StepBody>
            <p className="sr-only">{t('confirmationIntro')}</p>
            {errorNotice}
            <Confirmation
              action={requestAction ?? action}
              player={player}
              target={target}
              amount={amountValue}
              passGoReward={reward}
              currency={currency}
              preview={preview}
              comment={comment}
              propertyName={confirmedPropertyName}
              interest={interest}
              lenderIsBank={isBankRepayment}
              reserved={reserved}
            />
            {purchaseOverride !== undefined && selectedTile !== null && (
              <div className="mt-(--mb-space-3) grid gap-(--mb-space-3)">
                <Notice tone="info">
                  {t('priceOverrideWarning', {
                    price: money(purchaseOverride),
                    listPrice: money(selectedTile.tile.price),
                  })}
                </Notice>
                <Toggle
                  variant="inline"
                  label={t('priceOverrideConfirm')}
                  checked={overrideConfirmed}
                  onChange={setOverrideConfirmed}
                />
              </div>
            )}
            {action === 'PASS_GO' && <div className="mt-(--mb-space-3)">{commentField}</div>}
          </StepBody>
          <DialogActions className={stepFooterClass}>
            <Button
              variant="secondary"
              disabled={submitting}
              onClick={() =>
                action === 'PASS_GO' || action === 'JACKPOT_PAYOUT'
                  ? selectAction(null)
                  : setConfirming(false)
              }
            >
              {t('back')}
            </Button>
            <Button
              variant="primary"
              disabled={submitting || (purchaseOverride !== undefined && !overrideConfirmed)}
              onClick={() => void submit()}
            >
              {submitting
                ? t('recording')
                : transactionError === null
                  ? t('confirmTransaction')
                  : t('tryAgain')}
            </Button>
          </DialogActions>
        </>
      ) : (
        <>
          <StepBody>
            <p className="sr-only">{actionDescription(action, player.name, t)}</p>
            {errorNotice}
            {targetRequired && (
              <PlayerPicker
                label={t('chooseRecipient')}
                players={recipients}
                gamePlayers={players}
                value={effectiveTargetId}
                currency={currency}
                onChange={changeTarget}
              />
            )}
            {board === null && action === 'PLAYER_TO_PLAYER' && targetMortgages.length > 0 && (
              <Notice tone="info">
                {t('mortgagedRentHint', {
                  name: target?.name ?? '',
                  properties: targetMortgages.map((item) => item.propertyName).join(', '),
                })}
              </Notice>
            )}
            {board !== null && action === 'PROPERTY_PURCHASE' && (
              <TilePicker
                legend={t('tileChooseBuy')}
                items={buyItems}
                value={tileId}
                onChange={chooseTile}
              />
            )}
            {board !== null && action === 'PROPERTY_PURCHASE' && selectedTile !== null && (
              <div className="grid gap-(--mb-space-3)">
                <Toggle
                  variant="inline"
                  label={t('priceOverrideToggle')}
                  checked={overrideOn}
                  onChange={changeOverrideOn}
                />
                {overrideOn && (
                  <AmountSelector
                    value={overridePrice}
                    onChange={changeOverridePrice}
                    currency={currency}
                    presets={presets}
                  />
                )}
              </div>
            )}
            {board !== null && action === 'PROPERTY_BUILD' && (
              <TilePicker
                legend={t('tileChooseBuild')}
                items={buildItems}
                value={tileId}
                onChange={chooseTile}
              />
            )}
            {board !== null && action === 'PROPERTY_SELL_BUILDING' && (
              <TilePicker
                legend={t('tileChooseSellBuilding')}
                items={sellItems}
                value={tileId}
                onChange={chooseTile}
              />
            )}
            {board !== null && action === 'MORTGAGE' && (
              <TilePicker
                legend={t('tileChooseMortgage')}
                items={mortgageItems}
                value={tileId}
                onChange={chooseTile}
              />
            )}
            {board !== null && action === 'PAY_RENT' && (
              <>
                <TilePicker
                  legend={t('tileChooseRent')}
                  items={rentItems}
                  value={tileId}
                  onChange={chooseTile}
                />
                {needsDiceSum && (
                  <Field variant="dialog" label={t('rentDiceSum')}>
                    <input
                      value={diceSum}
                      inputMode="numeric"
                      autoComplete="off"
                      onChange={(event) => changeDiceSum(event.target.value)}
                    />
                  </Field>
                )}
                {needsDiceSum && diceSum !== '' && !isDiceSum(Number(diceSum)) && (
                  <FieldError as="p" announce>
                    {t('rentDiceSumInvalid')}
                  </FieldError>
                )}
                {selectedTile !== null && rentAmount !== null && (
                  <div className="flex items-baseline justify-between gap-(--mb-space-3)">
                    <span className="text-secondary">{t('rentAmountLabel')}</span>
                    <strong aria-live="polite">
                      <MoneyValue amount={rentAmount} currency={currency} />
                    </strong>
                  </div>
                )}
                <FieldHint>{t('rentComputedHint')}</FieldHint>
              </>
            )}
            {board === null && action === 'MORTGAGE' && (
              <MortgageDetails
                propertyName={propertyName}
                onPropertyNameChange={(name) => {
                  setPropertyName(name);
                  setError(null);
                  commandIdRef.current = null;
                }}
                noBuildings={noBuildings}
                onNoBuildingsChange={setNoBuildings}
              />
            )}
            {board !== null && action === 'MORTGAGE_REDEMPTION' && (
              <TilePicker
                legend={t('tileChooseRedeem')}
                items={redeemItems}
                value={selectedMortgage?.tileId ?? ''}
                onChange={(view) => {
                  const mortgage = tileMortgages.find((item) => item.tileId === view.tile.id);
                  if (mortgage !== undefined) chooseMortgage(mortgage);
                }}
              />
            )}
            {board === null && action === 'MORTGAGE_REDEMPTION' && (
              <RedemptionPicker
                mortgages={playerMortgages}
                currency={currency}
                value={mortgageId}
                onChange={chooseMortgage}
              />
            )}
            {action === 'LOAN_REPAYMENT' && (
              <LoanPicker
                loans={repayableLoans}
                players={players}
                currency={currency}
                value={loanId}
                onChange={chooseLoan}
              />
            )}
            {isBankRepayment && selectedLoan !== null && (
              <>
                <InterestRatePicker
                  value={effectiveRate}
                  suggested={selectedLoan.rounds?.suggestedRatePercent ?? 0}
                  round={selectedLoan.rounds?.round ?? 1}
                  onChange={chooseRate}
                />
                <FieldHint>
                  {t('bankLoanRepayHint', {
                    principal: formatMoney(loanOwed, currency),
                    interest: formatMoney(interest, currency),
                    total: formatMoney(loanOwed + interest, currency),
                  })}
                </FieldHint>
              </>
            )}
            {action === 'BANK_LOAN' && bankLoan !== null && (
              <Notice tone="info">{t('bankLoanAlreadyActive')}</Notice>
            )}
            {action === 'BANK_LOAN' && bankLoanMax !== null && (
              <FieldHint>
                {t('bankLoanMaxHint', { max: formatMoney(bankLoanMax, currency) })}
              </FieldHint>
            )}
            {board === null && action === 'MORTGAGE' && (
              <FieldHint>{t('mortgageValueHint')}</FieldHint>
            )}
            {board !== null && action === 'MORTGAGE' && (
              <FieldHint>{t('tileMortgageHint')}</FieldHint>
            )}
            {action === 'PROPERTY_BUILD' && <FieldHint>{t('tileBuildHint')}</FieldHint>}
            {action === 'PROPERTY_SELL_BUILDING' && (
              <FieldHint>{t('tileSellBuildingHint')}</FieldHint>
            )}
            {action === 'PROPERTY_PURCHASE' && !overrideOn && (
              <FieldHint>{t('tilePurchaseHint')}</FieldHint>
            )}
            {requestAction === 'TO_JACKPOT' && <FieldHint>{t('payToPotHint')}</FieldHint>}
            {amountRequired &&
              action !== 'MORTGAGE_REDEMPTION' &&
              (action !== 'LOAN_REPAYMENT' || (selectedLoan !== null && !isBankRepayment)) && (
                <AmountSelector
                  value={amount}
                  onChange={changeAmount}
                  currency={currency}
                  favorites={favoriteAmounts}
                  recent={recentAmounts}
                  presets={presets}
                  onToggleFavorite={onToggleFavorite}
                  onQuickAmountSelect={reviewQuickAmount}
                />
              )}
            {action === 'PLAYER_TO_BANK' && settings !== null && (
              <div className="grid gap-(--mb-space-2)" role="group" aria-label={t('fixedPayments')}>
                <span className="text-small font-semibold text-secondary">
                  {t('fixedPayments')}
                </span>
                <div className="flex flex-wrap gap-(--mb-space-2)">
                  {(
                    [
                      ['incomeTax', settings.incomeTax],
                      ['luxuryTax', settings.luxuryTax],
                      ['jailFine', settings.jailFine],
                    ] as const
                  ).map(([key, fixedAmount]) => (
                    <Button
                      key={key}
                      variant="secondary"
                      onClick={() =>
                        reviewFixedPayment(t(key), fixedAmount, key !== 'jailFine' && jackpotRule)
                      }
                    >
                      {t(key)} · <MoneyValue amount={fixedAmount} currency={currency} />
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {exceedsBankLoanMax && bankLoanMax !== null && (
              <FieldError as="p" announce>
                {t('bankLoanExceedsMax', { max: formatMoney(bankLoanMax, currency) })}
              </FieldError>
            )}
            {overRepayment && (
              <FieldError as="p" announce>
                {t('loanRepayExceeds', { amount: formatMoney(loanOwed, currency) })}
              </FieldError>
            )}
            {fundsError !== null && (
              <FieldError as="p" announce>
                {fundsError}
              </FieldError>
            )}
            {shortfall !== null && (
              <div className={shortfallClass}>
                <p>{t('shortBy', { amount: formatMoney(shortfall, currency) })}</p>
                <div className="flex flex-wrap gap-(--mb-space-2)">
                  {isBankRepayment && (
                    <>
                      <Button variant="secondary" onClick={() => selectAction('MORTGAGE')}>
                        {t('mortgageProperty')}
                      </Button>
                      <Button variant="secondary" onClick={() => selectAction('BANK_TO_PLAYER')}>
                        {t('sellBuildingsToBank')}
                      </Button>
                    </>
                  )}
                  {canAuction &&
                    !auctionBusy &&
                    (action === 'PLAYER_TO_BANK' || action === 'PLAYER_TO_PLAYER') && (
                      <Button
                        variant="secondary"
                        onClick={() => onStartAuction(auctionLotSuggestion)}
                      >
                        {t('auctionInstead')}
                      </Button>
                    )}
                  <Button variant="danger" onClick={onBankrupt}>
                    {t('declareBankrupt')}
                  </Button>
                </div>
              </div>
            )}
            {!noComment && <div className="mt-(--mb-space-2)">{commentField}</div>}
          </StepBody>
          <DialogActions className={stepFooterClass}>
            <Button variant="secondary" onClick={() => selectAction(null)}>
              {t('back')}
            </Button>
            <Button variant="primary" disabled={!valid} onClick={review}>
              {t('reviewTransaction')}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
