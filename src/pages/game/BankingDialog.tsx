import { useRef, useState, type ReactNode } from 'react';
import {
  defaultGameRules,
  type Auction,
  type BankLoanCooldown,
  type Currency,
  type GameRules,
  type GameSettings,
  type InterestRatePercent,
  type Loan,
  type Mortgage,
  type Player,
} from '../../../shared/types/monopoly';
import { buildGameSettings } from '../../../shared/domain/game-rules';
import { normalizePropertyName, redemptionCost } from '../../../shared/domain/mortgage';
import { MonopolyBankApiError, monopolyBankApi } from '../../api/monopoly-bank-api';
import { AmountSelector } from '../../components/AmountSelector';
import { Dialog } from '../../components/Dialog';
import { WalletMenu } from '../../components/game/WalletMenu';
import {
  Button,
  DialogActions,
  Field,
  FieldError,
  FieldHint,
  MoneyValue,
  Notice,
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
  /** The running or just-closed auction (auctions rule): its leading bid is reserved cash. */
  auction?: Auction | null;
  /** Opens the start-auction prompt for this wallet, with a suggested property name. */
  onStartAuction?: (lotName: string) => void;
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
  loans = [],
  bankLoanCooldowns = [],
  jackpot = 0,
  settleOnOpen = false,
  auction = null,
  onStartAuction,
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
  const initialBankLoan = rules.bankLoans && settleOnOpen ? activeBankLoan(loans, player.id) : null;
  const [action, setAction] = useState<ActionType | null>(
    initialBankLoan === null ? null : 'LOAN_REPAYMENT',
  );
  const [exactGoChosen, setExactGoChosen] = useState(false);
  const [targetId, setTargetId] = useState('');
  const [amount, setAmount] = useState(
    initialBankLoan === null ? '' : String(loanOutstanding(initialBankLoan)),
  );
  const [comment, setComment] = useState('');
  const [commentOpen, setCommentOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [exactLanding, setExactLanding] = useState(false);
  // An income-tax or luxury-tax chip was used: with the jackpot rule the money goes to the pot.
  const [payToPot, setPayToPot] = useState(false);
  const [propertyName, setPropertyName] = useState('');
  const [noBuildings, setNoBuildings] = useState(false);
  const [mortgageId, setMortgageId] = useState('');
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
  const targetRequired = action === 'PLAYER_TO_PLAYER' || action === 'LOAN_ISSUE';
  // A lender must still be playing; payments to anyone else are left to the Worker's checks.
  const recipients = players.filter(
    (candidate) =>
      candidate.id !== player.id && (action !== 'LOAN_ISSUE' || candidate.status !== 'BANKRUPT'),
  );
  // With one possible recipient there is nothing to choose, so it is selected for the player.
  const soleRecipient = targetRequired && recipients.length === 1 ? recipients[0] : undefined;
  // A collection always pays the whole pot, which the Worker reads again when it records it.
  const amountValue = action === 'JACKPOT_PAYOUT' ? jackpot : Number(amount);
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
      : previewBalances(request, players, reward, redemptionAmount, loans, interest, jackpot);
  const amountRequired = action !== 'PASS_GO' && action !== 'JACKPOT_PAYOUT';
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
    (action !== 'MORTGAGE' || (normalizePropertyName(propertyName) !== null && noBuildings)) &&
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
    setMortgageId('');
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
          action === 'PASS_GO' || action === 'JACKPOT_PAYOUT' || isMortgageAction
            ? null
            : result.transaction.amount,
          result.mortgages,
          result.loans,
          result.bankLoanCooldowns,
          result.jackpot,
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
            primary={primaryWalletActions.map((item) => ({
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
                  {
                    key: 'MORTGAGE',
                    label: actionLabel('MORTGAGE', t),
                    onSelect: () => selectAction('MORTGAGE'),
                  },
                  ...(playerMortgages.length > 0
                    ? [
                        {
                          key: 'MORTGAGE_REDEMPTION',
                          label: actionLabel('MORTGAGE_REDEMPTION', t),
                          outgoing: true,
                          onSelect: () => selectAction('MORTGAGE_REDEMPTION'),
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
              propertyName={action === 'MORTGAGE' ? tidyName : selectedMortgage?.propertyName}
              interest={interest}
              lenderIsBank={isBankRepayment}
              reserved={reserved}
            />
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
            <Button variant="primary" disabled={submitting} onClick={() => void submit()}>
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
            {action === 'PLAYER_TO_PLAYER' && targetMortgages.length > 0 && (
              <Notice tone="info">
                {t('mortgagedRentHint', {
                  name: target?.name ?? '',
                  properties: targetMortgages.map((item) => item.propertyName).join(', '),
                })}
              </Notice>
            )}
            {action === 'MORTGAGE' && (
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
            {action === 'MORTGAGE_REDEMPTION' && (
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
            {action === 'MORTGAGE' && <FieldHint>{t('mortgageValueHint')}</FieldHint>}
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
            {!isMortgageAction && !isLoanAction && (
              <div className="mt-(--mb-space-2)">{commentField}</div>
            )}
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
