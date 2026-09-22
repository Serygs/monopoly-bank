import { useRef, useState } from 'react';
import type { CreatePaymentRequestResponse, PropertyOperationResponse, PropertyRentRequest } from '../../shared/contracts/api';
import { buildHouses, sellBuildings } from '../../shared/domain/property';
import { hotelHouseLevel, type BoardSpace, type Currency, type PaymentMode, type Player } from '../../shared/types/monopoly';
import { monopolyBankApi, MonopolyBankApiError } from '../api/monopoly-bank-api';
import { apiErrorMessage } from '../i18n/api-errors';
import { useLanguage } from '../i18n/language-context';
import { boardSpaceName } from '../utils/board-space-name';
import { formatMoney } from '../utils/money';
import { actionTitle, buildableCounts, propertyCommand, propertyOf, rentFor, spaceActions, vetOperation, type SpaceAction, type SpaceActionContext, type SpaceActionKind } from '../utils/property-view';
import { Dialog } from './Dialog';
import { PlayerPicker } from './PlayerPicker';
import { GroupBadge } from './SpacePicker';

export type PropertyActionResult = PropertyOperationResponse | CreatePaymentRequestResponse;

interface PropertyActionDialogProps {
  gameId: string;
  space: BoardSpace;
  context: SpaceActionContext;
  currency: Currency;
  paymentMode: PaymentMode;
  onClose: () => void;
  onAuction: (space: BoardSpace) => void;
  onCompleted: (result: PropertyActionResult, label: string) => void;
}

type DiceMode = 'LAST' | 'MANUAL';

/**
 * Tap a deed, see what it costs or earns, pick the one action that applies,
 * confirm. Every figure comes from the shared domain, so what the sheet shows
 * is what the server commits.
 */
export function PropertyActionDialog({ gameId, space, context, currency, paymentMode, onClose, onAuction, onCompleted }: PropertyActionDialogProps) {
  const { t } = useLanguage();
  const [action, setAction] = useState<SpaceAction | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [count, setCount] = useState(1);
  const [payerId, setPayerId] = useState('');
  const [diceMode, setDiceMode] = useState<DiceMode>('LAST');
  const [diceInput, setDiceInput] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const commandIdRef = useRef<string | null>(null);

  const { players, state, actor } = context;
  const property = propertyOf(state.properties, space.id);
  const owner = property.ownerPlayerId === null ? null : players.find((player) => player.id === property.ownerPlayerId) ?? null;
  const name = boardSpaceName(space, t);
  const actions = spaceActions(context, space);
  const money = (value: number) => formatMoney(value, currency);
  const isUtility = space.kind === 'UTILITY';

  const payer = action?.kind === 'CHARGE_RENT' ? players.find((player) => player.id === payerId) ?? null : action?.kind === 'PAY_RENT' ? actor : null;
  const lastRoll = payer?.lastRollTotal ?? null;
  const manualDice = /^\d{1,2}$/.test(diceInput) ? Number(diceInput) : null;
  const diceValid = manualDice !== null && manualDice >= 2 && manualDice <= 12;
  const diceTotal = !isUtility ? undefined : diceMode === 'LAST' ? lastRoll ?? undefined : diceValid ? manualDice : undefined;
  const counts = action?.kind === 'BUILD' ? buildableCounts(context, space, 'BUILD') : action?.kind === 'SELL_BUILDINGS' ? buildableCounts(context, space, 'SELL') : [];
  const amount = action === null || actor === null ? null : previewAmount(action.kind, { context, space, actor, count, diceTotal, payer });
  const valid = action !== null && amount !== null && (action.kind !== 'CHARGE_RENT' || payer !== null) && (!isUtility || !(action.kind === 'PAY_RENT' || action.kind === 'CHARGE_RENT') || diceTotal !== undefined);

  const select = (next: SpaceAction) => {
    if (next.kind === 'AUCTION') { onAuction(space); return; }
    setAction(next); setConfirming(false); setCount(1); setPayerId(''); setDiceMode(actor?.lastRollTotal === null || actor?.lastRollTotal === undefined ? 'MANUAL' : 'LAST'); setDiceInput(''); setError(null); commandIdRef.current = null;
  };
  const back = () => { if (confirming) setConfirming(false); else setAction(null); setError(null); };

  const submit = async () => {
    if (action === null || actor === null || !valid || submitting) return;
    setSubmitting(true); setError(null);
    const commandId = commandIdRef.current ?? crypto.randomUUID();
    commandIdRef.current = commandId;
    const optionalComment = comment.trim() === '' ? {} : { comment: comment.trim() };
    const rent = (payerPlayerId: string, chargedByOwner: boolean): PropertyRentRequest => ({ boardSpaceId: space.id, payerPlayerId, ...(chargedByOwner ? { chargedByOwner } : {}), ...(diceTotal === undefined ? {} : { diceTotal }), ...optionalComment });
    try {
      const request = { boardSpaceId: space.id, playerId: actor.id, ...optionalComment };
      const result: PropertyActionResult = action.kind === 'PURCHASE' ? await monopolyBankApi.purchaseProperty(gameId, request, commandId)
        : action.kind === 'PAY_RENT' ? await monopolyBankApi.chargeRent(gameId, rent(actor.id, false), commandId)
          : action.kind === 'CHARGE_RENT' ? await monopolyBankApi.chargeRent(gameId, rent(payerId, true), commandId)
            : action.kind === 'BUILD' ? await monopolyBankApi.buildHouses(gameId, { ...request, count }, commandId)
              : action.kind === 'SELL_BUILDINGS' ? await monopolyBankApi.sellBuildings(gameId, { ...request, count }, commandId)
                : action.kind === 'MORTGAGE' ? await monopolyBankApi.mortgageProperty(gameId, request, commandId)
                  : await monopolyBankApi.unmortgageProperty(gameId, request, commandId);
      onCompleted(result, actionTitle(action.kind, null, t));
    } catch (caught) {
      setError(caught);
    } finally {
      setSubmitting(false);
    }
  };

  const title = action === null ? name : actionTitle(action.kind, null, t);
  const errorMessage = error === null ? null : apiErrorMessage(error, t, 'unableRecordTransaction');
  return <Dialog title={title} closeLabel={t('closeDialog', { title })} onClose={onClose} className="space-sheet" eyebrow={action === null ? undefined : name}>
    {errorMessage !== null && <p className="notice notice-error" role="alert">{errorMessage}{error instanceof MonopolyBankApiError && typeof error.details?.currentBalance === 'number' && typeof error.details.requiredAmount === 'number' ? ` ${t('balanceRequirement', { current: money(error.details.currentBalance), required: money(error.details.requiredAmount) })}` : ''}</p>}
    {action === null ? <>
      <div className="space-sheet-heading"><GroupBadge group={space.colorGroup} /><span className="muted">{owner === null ? t('spaceUnowned') : t('spaceOwnedBy', { name: owner.name })}</span></div>
      <section className="confirmation space-facts"><dl>
        <div><dt>{t('spacePrice')}</dt><dd>{money(space.price)}</dd></div>
        <div><dt>{t('spaceMortgageValue')}</dt><dd>{money(space.mortgageValue)}</dd></div>
        {space.houseCost !== null && <div><dt>{t('spaceHouseCost')}</dt><dd>{money(space.houseCost)}</dd></div>}
        {owner !== null && !property.mortgaged && !isUtility && <div className="confirmation-available"><dt>{t('spaceCurrentRent')}</dt><dd>{money(rentFor(context, space) ?? 0)}</dd></div>}
      </dl></section>
      <RentTable space={space} currency={currency} single={state.board.utilityMultiplierSingle} pair={state.board.utilityMultiplierPair} />
      {actor === null ? <p className="muted">{t('reasonNoWallet')}</p> : <div className="space-actions">{actions.map((candidate) => <div key={candidate.kind}><button className={`button ${candidate.kind === 'PURCHASE' || candidate.kind === 'PAY_RENT' ? 'button-primary' : 'button-secondary'} space-action`} type="button" disabled={!candidate.enabled} data-action={candidate.kind} onClick={() => select(candidate)}>{actionTitle(candidate.kind, candidate.amount === null ? null : money(candidate.amount), t)}</button>{!candidate.enabled && candidate.reason !== null && <p className="field-hint space-action-reason">{t(candidate.reason, candidate.reasonValues)}</p>}</div>)}</div>}
    </> : confirming ? <>
      <p className="dialog-intro">{t('confirmationIntro')}</p>
      <section className="confirmation"><dl>
        <div><dt>{t('operation')}</dt><dd>{actionTitle(action.kind, null, t)}</dd></div>
        <div><dt>{t('actor')}</dt><dd>{actor?.name}</dd></div>
        {action.kind === 'PAY_RENT' && owner !== null && <div><dt>{t('destination')}</dt><dd>{owner.name}</dd></div>}
        {action.kind === 'CHARGE_RENT' && payer !== null && <div><dt>{t('source')}</dt><dd>{payer.name}</dd></div>}
        {(action.kind === 'BUILD' || action.kind === 'SELL_BUILDINGS') && <div><dt>{action.kind === 'BUILD' ? t('buildingsToBuild') : t('buildingsToSell')}</dt><dd>{count}</dd></div>}
        {isUtility && diceTotal !== undefined && <div><dt>{t('diceTotalLabel')}</dt><dd>{diceTotal}</dd></div>}
        <div className="confirmation-available"><dt>{t('amount')}</dt><dd>{amount === null ? '—' : money(amount)}</dd></div>
        {comment.trim() !== '' && <div><dt>{t('comment')}</dt><dd>{comment.trim()}</dd></div>}
      </dl></section>
      {paymentMode === 'CONFIRMATION' && (action.kind === 'PAY_RENT' || action.kind === 'CHARGE_RENT') && <p className="muted">{t('rentConfirmationNote')}</p>}
      <div className="dialog-actions"><button className="button button-secondary" type="button" disabled={submitting} onClick={back}>{t('back')}</button><button className="button button-primary" type="button" disabled={submitting || !valid} data-testid="space-action-confirm" onClick={() => void submit()}>{submitting ? t('recording') : errorMessage === null ? t('confirmTransaction') : t('tryAgain')}</button></div>
    </> : <>
      {action.kind === 'CHARGE_RENT' && <PlayerPicker label={t('rentPayer')} players={players.filter((candidate) => candidate.id !== actor?.id && candidate.status !== 'BANKRUPT')} gamePlayers={players} value={payerId} currency={currency} onChange={(id) => { setPayerId(id); const chosen = players.find((player) => player.id === id); setDiceMode(chosen?.lastRollTotal === null || chosen?.lastRollTotal === undefined ? 'MANUAL' : 'LAST'); }} />}
      {isUtility && (action.kind === 'PAY_RENT' || action.kind === 'CHARGE_RENT') && <fieldset className="dice-choice"><legend>{t('diceTotalLabel')}</legend><div className="dice-choice-options"><button type="button" className={`button button-secondary${diceMode === 'LAST' ? ' selected' : ''}`} aria-pressed={diceMode === 'LAST'} disabled={lastRoll === null} onClick={() => setDiceMode('LAST')}>{lastRoll === null ? t('rentNoLastRoll') : t('rentUseLastRoll', { total: lastRoll })}</button><button type="button" className={`button button-secondary${diceMode === 'MANUAL' ? ' selected' : ''}`} aria-pressed={diceMode === 'MANUAL'} onClick={() => setDiceMode('MANUAL')}>{t('rentEnterDice')}</button></div>{diceMode === 'MANUAL' && <label className="dialog-field">{t('diceTotalLabel')}<input type="number" inputMode="numeric" min={2} max={12} step={1} value={diceInput} aria-invalid={diceInput !== '' && !diceValid} onChange={(event) => setDiceInput(event.target.value)} /></label>}</fieldset>}
      {(action.kind === 'BUILD' || action.kind === 'SELL_BUILDINGS') && <fieldset className="count-picker"><legend>{action.kind === 'BUILD' ? t('buildingsToBuild') : t('buildingsToSell')}</legend><div>{counts.map((option) => <button type="button" key={option} className={`button button-secondary${count === option ? ' selected' : ''}`} aria-pressed={count === option} onClick={() => setCount(option)}>{option === hotelHouseLevel - property.houses && action.kind === 'BUILD' && property.houses + option === hotelHouseLevel ? t('hotelBadge') : option}</button>)}</div></fieldset>}
      <p className="pass-go-value" data-testid="space-action-amount">{amount === null ? (isUtility ? t('diceTotalLabel') : t('actionUnavailable')) : t('amountTotalHint', { amount: money(amount) })}</p>
      <label className="dialog-field">{t('comment')} <span className="field-note">{t('optional')}</span><input value={comment} maxLength={500} onChange={(event) => setComment(event.target.value)} /></label>
      <div className="dialog-actions"><button className="button button-quiet" type="button" onClick={back}>{t('back')}</button><button className="button button-primary" type="button" disabled={!valid} data-testid="space-action-review" onClick={() => setConfirming(true)}>{t('reviewTransaction')}</button></div>
    </>}
  </Dialog>;
}

function RentTable({ space, currency, single, pair }: { space: BoardSpace; currency: Currency; single: number; pair: number }) {
  const { t } = useLanguage();
  if (space.kind === 'UTILITY') return <p className="muted">{t('utilityRentHint', { single, pair })}</p>;
  const labels = space.kind === 'RAILROAD'
    ? space.rents.map((_, index) => t('rentLevelRailroads', { count: index + 1 }))
    : space.rents.map((_, index) => (index === 0 ? t('rentLevelBase') : index === hotelHouseLevel ? t('hotelBadge') : t('housesCount', { count: index })));
  return <section className="rent-table" aria-label={t('spaceRentTable')}><h3>{t('spaceRentTable')}</h3><dl>{space.rents.map((rent, index) => <div key={index}><dt>{labels[index]}</dt><dd>{formatMoney(rent, currency)}</dd></div>)}</dl></section>;
}

function previewAmount(kind: SpaceActionKind, input: { context: SpaceActionContext; space: BoardSpace; actor: Player; count: number; diceTotal: number | undefined; payer: Player | null }): number | null {
  const { context, space, actor, count, diceTotal } = input;
  const base = propertyCommand(context);
  switch (kind) {
    case 'PURCHASE': return space.price;
    case 'PAY_RENT':
    case 'CHARGE_RENT': return rentFor(context, space, diceTotal);
    case 'BUILD': return vetOperation(() => buildHouses({ ...base, playerId: actor.id, boardSpaceId: space.id, count }).transaction.totalAmount).amount;
    case 'SELL_BUILDINGS': return vetOperation(() => sellBuildings({ ...base, playerId: actor.id, boardSpaceId: space.id, count }).transaction.totalAmount).amount;
    case 'MORTGAGE': return space.mortgageValue;
    case 'UNMORTGAGE': return spaceActions(context, space).find((action) => action.kind === 'UNMORTGAGE')?.amount ?? null;
    case 'AUCTION': return null;
  }
}
