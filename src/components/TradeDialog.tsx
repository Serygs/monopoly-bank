import { useRef, useState } from 'react';
import type { CreateTradeRequest, MortgageResolution, TradeActionResponse, TradeOffer } from '../../shared/contracts/api';
import { unmortgageCost } from '../../shared/domain/property';
import type { BoardSpace, Currency, Game, GameProperty, Player } from '../../shared/types/monopoly';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { apiErrorMessage } from '../i18n/api-errors';
import { useLanguage } from '../i18n/language-context';
import { boardSpaceName } from '../utils/board-space-name';
import { formatMoney } from '../utils/money';
import { propertyOf, spacesOwnedBy, type BoardState } from '../utils/property-view';
import { AmountSelector } from './AmountSelector';
import { Dialog } from './Dialog';
import { PlayerPicker } from './PlayerPicker';
import { SpacePicker } from './SpacePicker';

interface TradeDialogProps {
  gameId: string;
  game: Game;
  proposer: Player;
  players: Player[];
  state: BoardState;
  currency: Currency;
  onClose: () => void;
  onProposed: (result: TradeActionResponse) => void;
}

/**
 * Both sides of an offer: cash and deeds from the proposer, cash and deeds from
 * the responder. A mortgaged deed needs the receiver's choice between paying
 * the interest and redeeming it; a deed with buildings cannot move at all.
 */
export function TradeDialog({ gameId, proposer, players, state, currency, onClose, onProposed }: TradeDialogProps) {
  const { t } = useLanguage();
  const [responderId, setResponderId] = useState('');
  const [cashFromProposer, setCashFromProposer] = useState('');
  const [cashFromResponder, setCashFromResponder] = useState('');
  const [fromProposer, setFromProposer] = useState<string[]>([]);
  const [fromResponder, setFromResponder] = useState<string[]>([]);
  const [resolutions, setResolutions] = useState<Record<string, MortgageResolution>>({});
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const commandIdRef = useRef<string | null>(null);

  const responder = players.find((player) => player.id === responderId) ?? null;
  const proposerSpaces = spacesOwnedBy(state, proposer.id);
  const responderSpaces = responder === null ? [] : spacesOwnedBy(state, responder.id);
  const money = (value: number) => formatMoney(value, currency);
  const cashOf = (value: string) => (/^\d+$/.test(value) && Number(value) > 0 ? Number(value) : 0);
  const spaceById = (id: string) => state.boardSpaces.find((space) => space.id === id);
  const mortgagedMoving = [...fromProposer, ...fromResponder].filter((id) => propertyOf(state.properties, id).mortgaged);
  const missingResolution = mortgagedMoving.some((id) => resolutions[id] === undefined);
  const empty = cashOf(cashFromProposer) === 0 && cashOf(cashFromResponder) === 0 && fromProposer.length === 0 && fromResponder.length === 0;
  const valid = responder !== null && !empty && !missingResolution;
  const blocked = (_space: BoardSpace, property: GameProperty) => (property.houses > 0 ? t('deedHasBuildings') : null);
  const toggle = (list: string[], set: (next: string[]) => void) => (id: string) => { set(list.includes(id) ? list.filter((value) => value !== id) : [...list, id]); commandIdRef.current = null; };
  const offers = (ids: string[]): TradeOffer[] => ids.map((boardSpaceId) => (resolutions[boardSpaceId] === undefined ? { boardSpaceId } : { boardSpaceId, mortgageResolution: resolutions[boardSpaceId] }));
  const describe = (cash: number, ids: string[]) => { const parts = [...(cash > 0 ? [money(cash)] : []), ...ids.map((id) => { const space = spaceById(id); return space === undefined ? id : boardSpaceName(space, t); })]; return parts.length === 0 ? t('tradeNothing') : parts.join(', '); };

  const submit = async () => {
    if (!valid || responder === null || submitting) return;
    setSubmitting(true); setError(null);
    const commandId = commandIdRef.current ?? crypto.randomUUID();
    commandIdRef.current = commandId;
    const request: CreateTradeRequest = {
      proposerPlayerId: proposer.id,
      responderPlayerId: responder.id,
      ...(cashOf(cashFromProposer) > 0 ? { cashFromProposer: cashOf(cashFromProposer) } : {}),
      ...(cashOf(cashFromResponder) > 0 ? { cashFromResponder: cashOf(cashFromResponder) } : {}),
      ...(fromProposer.length > 0 ? { propertiesFromProposer: offers(fromProposer) } : {}),
      ...(fromResponder.length > 0 ? { propertiesFromResponder: offers(fromResponder) } : {}),
      ...(comment.trim() === '' ? {} : { comment: comment.trim() }),
    };
    try { onProposed(await monopolyBankApi.proposeTrade(gameId, request, commandId)); } catch (caught) { setError(caught); } finally { setSubmitting(false); }
  };

  const title = t('proposeTrade');
  return <Dialog title={title} closeLabel={t('closeDialog', { title })} onClose={onClose} className="trade-dialog">
    {error !== null && <p className="notice notice-error" role="alert">{apiErrorMessage(error, t, 'unableTrade')}</p>}
    <PlayerPicker label={t('tradeWith')} players={players.filter((player) => player.id !== proposer.id && player.status !== 'BANKRUPT')} gamePlayers={players} value={responderId} currency={currency} onChange={(id) => { setResponderId(id); setFromResponder([]); commandIdRef.current = null; }} />
    {responder !== null && <div className="trade-sides">
      <TradeSide title={t('youGive')} cash={cashFromProposer} onCash={(value) => { setCashFromProposer(value); commandIdRef.current = null; }} spaces={proposerSpaces} properties={state.properties} selected={fromProposer} onToggle={toggle(fromProposer, setFromProposer)} blocked={blocked} currency={currency} />
      <TradeSide title={t('youGet')} cash={cashFromResponder} onCash={(value) => { setCashFromResponder(value); commandIdRef.current = null; }} spaces={responderSpaces} properties={state.properties} selected={fromResponder} onToggle={toggle(fromResponder, setFromResponder)} blocked={blocked} currency={currency} />
    </div>}
    {mortgagedMoving.map((id) => { const space = spaceById(id); if (space === undefined) return null; const interest = Math.ceil((space.mortgageValue * state.board.unmortgageInterestPercent) / 100); const cost = unmortgageCost(space.mortgageValue, state.board.unmortgageInterestPercent); return <fieldset className="mortgage-resolution" key={id}><legend>{t('mortgageResolutionLabel', { name: boardSpaceName(space, t) })}</legend><p className="field-hint">{t('mortgageResolutionHint', { interest: money(interest), cost: money(cost) })}</p><div className="dice-choice-options"><button type="button" className={`button button-secondary${resolutions[id] === 'PAY_INTEREST' ? ' selected' : ''}`} aria-pressed={resolutions[id] === 'PAY_INTEREST'} onClick={() => setResolutions((current) => ({ ...current, [id]: 'PAY_INTEREST' }))}>{t('payInterest', { amount: money(interest) })}</button><button type="button" className={`button button-secondary${resolutions[id] === 'REDEEM' ? ' selected' : ''}`} aria-pressed={resolutions[id] === 'REDEEM'} onClick={() => setResolutions((current) => ({ ...current, [id]: 'REDEEM' }))}>{t('redeemMortgage', { amount: money(cost) })}</button></div></fieldset>; })}
    {responder !== null && <section className="confirmation trade-summary"><h3>{t('tradeSummary')}</h3><dl><div><dt>{t('youGive')}</dt><dd>{describe(cashOf(cashFromProposer), fromProposer)}</dd></div><div><dt>{t('youGet')}</dt><dd>{describe(cashOf(cashFromResponder), fromResponder)}</dd></div></dl>{empty && <p className="field-hint">{t('tradeEmptyHint')}</p>}</section>}
    <label className="dialog-field">{t('comment')} <span className="field-note">{t('optional')}</span><input value={comment} maxLength={500} onChange={(event) => setComment(event.target.value)} /></label>
    <div className="dialog-actions"><button className="button button-secondary" type="button" disabled={submitting} onClick={onClose}>{t('cancel')}</button><button className="button button-primary" type="button" disabled={!valid || submitting} onClick={() => void submit()}>{submitting ? t('recording') : t('sendTrade')}</button></div>
  </Dialog>;
}

function TradeSide({ title, cash, onCash, spaces, properties, selected, onToggle, blocked, currency }: { title: string; cash: string; onCash: (value: string) => void; spaces: BoardSpace[]; properties: GameProperty[]; selected: string[]; onToggle: (id: string) => void; blocked: (space: BoardSpace, property: GameProperty) => string | null; currency: Currency }) {
  const { t } = useLanguage();
  const [cashOpen, setCashOpen] = useState(false);
  const cashValue = /^\d+$/.test(cash) && Number(cash) > 0 ? formatMoney(Number(cash), currency) : t('tradeNothing');
  return <section className="trade-side"><h3>{title}</h3>
    <details className="trade-cash" open={cashOpen} onToggle={(event) => setCashOpen(event.currentTarget.open)}><summary>{t('tradeCash')}: <strong>{cashValue}</strong></summary>{cashOpen && <AmountSelector value={cash} onChange={onCash} currency={currency} />}</details>
    <SpacePicker label={t('tradeDeeds')} spaces={spaces} properties={properties} selectedIds={selected} onToggle={onToggle} disabledReason={blocked} emptyLabel={t('noDeeds')} />
  </section>;
}
