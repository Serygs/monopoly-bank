import { useRef, useState, type ReactNode } from 'react';
import {
  defaultGameRules,
  type Currency,
  type GameRules,
  type GameSettings,
  type Mortgage,
  type Player,
} from '../../../shared/types/monopoly';
import { normalizePropertyName, redemptionCost } from '../../../shared/domain/mortgage';
import { monopolyBankApi } from '../../api/monopoly-bank-api';
import { AmountSelector } from '../../components/AmountSelector';
import { Dialog } from '../../components/Dialog';
import { WalletActionGrid } from '../../components/game/WalletActionGrid';
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
  type ActionType,
} from './game-page-helpers';
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
  ) => void;
  onPaymentRequested: () => void;
}

/** Inverse balance plate: the label in the highlight colour over the balance figure. */
const balanceClass = cx(
  'relative mx-0 mt-[18px] mb-[14px] grid gap-[4px] overflow-hidden rounded-[14px] border border-accent bg-surface-inverse px-[18px] py-[16px] shadow-balance-inset',
  '*:relative *:z-1 [&_span]:text-small [&_span]:font-semibold [&_span]:text-highlight',
  '[&_strong]:font-money [&_strong]:text-money-xl [&_strong]:leading-[0.98] [&_strong]:font-bold [&_strong]:tracking-[-0.05em] [&_strong]:text-on-inverse [&_strong]:tabular-nums [&_strong]:wrap-anywhere',
);

const advancedClass = cx(
  'mt-[16px] border-t border-border [&_.action-grid]:mt-[4px]',
  '[&>summary]:cursor-pointer [&>summary]:px-0 [&>summary]:pt-[16px] [&>summary]:pb-[10px] [&>summary]:font-bold [&>summary]:text-accent open:[&>summary]:text-primary',
);

/** Centred, capped-width danger action on its own row (in the single column below `md`). */
/* What the payer is missing, with the way out when no amount change will help. */
const shortfallClass =
  'mt-(--mb-space-2) flex flex-wrap items-center justify-between gap-(--mb-space-3) [&>p]:m-0 [&>p]:font-semibold [&>p]:text-danger';
const bankruptcyClass = 'col-span-full w-[min(100%,270px)] justify-self-center max-md:col-auto';

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
  const [action, setAction] = useState<ActionType | null>(null);
  const [targetId, setTargetId] = useState('');
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [commentOpen, setCommentOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [exactLanding, setExactLanding] = useState(false);
  const [propertyName, setPropertyName] = useState('');
  const [noBuildings, setNoBuildings] = useState(false);
  const [mortgageId, setMortgageId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const submittingRef = useRef(false);
  const commandIdRef = useRef<string | null>(null);
  const balancePresets = startingBalance === undefined ? [] : presetAmounts(startingBalance);
  const presets = balancePresets.length > 0 ? balancePresets : undefined;
  const targetRequired = action === 'PLAYER_TO_PLAYER';
  const recipients = players.filter((candidate) => candidate.id !== player.id);
  // With one possible recipient there is nothing to choose, so it is selected for the player.
  const soleRecipient = targetRequired && recipients.length === 1 ? recipients[0] : undefined;
  const effectiveTargetId = targetId !== '' ? targetId : (soleRecipient?.id ?? '');
  const target = players.find((candidate) => candidate.id === effectiveTargetId) ?? null;
  const amountValue = Number(amount);
  // The name is sent and shown as the server will store it: trimmed, spaces collapsed.
  const tidyName = normalizePropertyName(propertyName) ?? propertyName.trim();
  const playerMortgages = mortgages.filter((item) => item.playerId === player.id);
  const selectedMortgage = playerMortgages.find((item) => item.id === mortgageId) ?? null;
  const redemptionAmount =
    selectedMortgage === null ? 0 : redemptionCost(selectedMortgage.mortgageValue);
  // Paying rent to a player: tell the payer which properties of that player are mortgaged.
  const targetMortgages = mortgages.filter((item) => item.playerId === effectiveTargetId);
  const request =
    action === null
      ? null
      : buildRequest(action, player.id, effectiveTargetId, amountValue, comment, {
          exactLanding,
          propertyName: tidyName,
          mortgageId,
        });
  const reward = exactLanding ? passGoReward * 2 : passGoReward;
  const preview =
    request === null ? [] : previewBalances(request, players, reward, redemptionAmount);
  const amountRequired = action !== 'PASS_GO';
  const isMortgageAction = action === 'MORTGAGE' || action === 'MORTGAGE_REDEMPTION';
  const fundsError = preflightFundsError(action, player, players, amountValue, currency, t);
  const shortfall = preflightShortfall(action, player, players, amountValue);
  const valid =
    request !== null &&
    (!targetRequired || (target !== null && target.id !== player.id)) &&
    (!amountRequired || isPositiveInteger(amount)) &&
    (action !== 'MORTGAGE' || (normalizePropertyName(propertyName) !== null && noBuildings)) &&
    (action !== 'MORTGAGE_REDEMPTION' || selectedMortgage !== null) &&
    fundsError === null;

  const selectAction = (next: ActionType | null, exact = false) => {
    setAction(next);
    setExactLanding(exact);
    setPropertyName('');
    setNoBuildings(false);
    setMortgageId('');
    setTargetId('');
    setAmount('');
    // The doubled reward says why in the history; the player can still edit the note.
    setComment(exact ? t('passGoExactComment') : '');
    setCommentOpen(false);
    // Pass GO has no inputs, so it opens directly on the confirmation.
    setConfirming(next === 'PASS_GO');
    setError(null);
    commandIdRef.current = null;
  };

  const changeAmount = (nextAmount: string) => {
    setAmount(nextAmount);
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

  /** A tax or fine from the game's settings: fill the amount and its name, then review it. */
  const reviewFixedPayment = (label: string, fixedAmount: number) => {
    changeAmount(String(fixedAmount));
    setComment(label);
    if (player.balance >= fixedAmount) setConfirming(true);
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
      if ('paymentRequests' in result) onPaymentRequested();
      else
        onCompleted(
          result.players,
          action,
          action === 'PASS_GO' || isMortgageAction ? null : result.transaction.amount,
          result.mortgages,
        );
    } catch (caught) {
      setError(caught);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const title = action === null ? t('walletTitle', { name: player.name }) : actionLabel(action, t);
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
              balance: formatMoney(player.balance, currency),
            })}
          >
            <span>{t('availableBalance')}</span>
            <strong>
              <MoneyValue amount={player.balance} currency={currency} />
            </strong>
          </section>
          <WalletActionGrid
            actions={primaryWalletActions}
            onSelect={selectAction}
            extraActions={
              rules.doubleRewardOnExactGo
                ? [
                    {
                      key: 'PASS_GO_EXACT',
                      label: t('passGoExact'),
                      tone: 'income',
                      onSelect: () => selectAction('PASS_GO', true),
                    },
                  ]
                : []
            }
          />
          <details className={advancedClass}>
            <summary>{t('advancedActions')}</summary>
            <WalletActionGrid
              actions={advancedWalletActions.filter(
                (item) => item !== 'MORTGAGE_REDEMPTION' || playerMortgages.length > 0,
              )}
              onSelect={selectAction}
            >
              <Button variant="danger" className={bankruptcyClass} onClick={onBankrupt}>
                {t('declareBankrupt')}
              </Button>
            </WalletActionGrid>
            <Button variant="quiet" className="mt-[14px]" onClick={() => onViewHistory(player)}>
              {t('viewPlayerHistory', { name: player.name })}
            </Button>
          </details>
        </>
      ) : confirming ? (
        <>
          <StepBody>
            <p className="sr-only">{t('confirmationIntro')}</p>
            {errorNotice}
            <Confirmation
              action={action}
              player={player}
              target={target}
              amount={amountValue}
              passGoReward={reward}
              currency={currency}
              preview={preview}
              comment={comment}
              propertyName={action === 'MORTGAGE' ? tidyName : selectedMortgage?.propertyName}
            />
            {action === 'PASS_GO' && <div className="mt-(--mb-space-3)">{commentField}</div>}
          </StepBody>
          <DialogActions className={stepFooterClass}>
            <Button
              variant="secondary"
              disabled={submitting}
              onClick={() => (action === 'PASS_GO' ? selectAction(null) : setConfirming(false))}
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
            {action === 'MORTGAGE' && <FieldHint>{t('mortgageValueHint')}</FieldHint>}
            {amountRequired && action !== 'MORTGAGE_REDEMPTION' && (
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
                      onClick={() => reviewFixedPayment(t(key), fixedAmount)}
                    >
                      {t(key)} · <MoneyValue amount={fixedAmount} currency={currency} />
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {fundsError !== null && (
              <FieldError as="p" announce>
                {fundsError}
              </FieldError>
            )}
            {shortfall !== null && (
              <div className={shortfallClass}>
                <p>{t('shortBy', { amount: formatMoney(shortfall, currency) })}</p>
                <Button variant="danger" onClick={onBankrupt}>
                  {t('declareBankrupt')}
                </Button>
              </div>
            )}
            {!isMortgageAction && <div className="mt-(--mb-space-2)">{commentField}</div>}
          </StepBody>
          <DialogActions className={stepFooterClass}>
            <Button variant="secondary" onClick={() => selectAction(null)}>
              {t('back')}
            </Button>
            <Button variant="primary" disabled={!valid} onClick={() => setConfirming(true)}>
              {t('reviewTransaction')}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
