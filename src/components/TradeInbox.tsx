import { useState } from 'react';
import type { PropertyTrade } from '../../shared/contracts/api';
import type { TradeResolution } from '../../shared/contracts/live';
import type { BoardSpace, Currency, Player } from '../../shared/types/monopoly';
import { apiErrorMessage } from '../i18n/api-errors';
import { useLanguage } from '../i18n/language-context';
import { boardSpaceName } from '../utils/board-space-name';
import { formatMoney } from '../utils/money';

interface TradeInboxProps {
  trades: PropertyTrade[];
  players: Player[];
  boardSpaces: BoardSpace[];
  /** Wallets this device controls: their incoming offers can be accepted or declined, their outgoing ones cancelled. */
  controlledPlayerIds: string[];
  currency: Currency;
  canPropose: boolean;
  onPropose: () => void;
  onAction: (trade: PropertyTrade, action: TradeResolution) => Promise<void>;
}

/** Pending offers next to the payment inbox; refreshed on every `TRADES_UPDATED`. */
export function TradeInbox({ trades, players, boardSpaces, controlledPlayerIds, currency, canPropose, onPropose, onAction }: TradeInboxProps) {
  const { t, locale } = useLanguage();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<unknown | null>(null);
  const pending = trades.filter((trade) => trade.state === 'PENDING');
  const nameOf = (id: string) => players.find((player) => player.id === id)?.name ?? t('playerFallback');
  const gives = (trade: PropertyTrade, playerId: string) => {
    const cash = playerId === trade.proposerPlayerId ? trade.cashFromProposer : trade.cashFromResponder;
    const deeds = trade.items.filter((item) => item.fromPlayerId === playerId).map((item) => { const space = boardSpaces.find((candidate) => candidate.id === item.boardSpaceId); return space === undefined ? item.boardSpaceId : boardSpaceName(space, t); });
    const parts = [...(cash > 0 ? [formatMoney(cash, currency)] : []), ...deeds];
    return t('tradeGives', { name: nameOf(playerId), items: parts.length === 0 ? t('tradeNothing') : parts.join(', ') });
  };
  const act = async (trade: PropertyTrade, action: TradeResolution) => { setBusyId(trade.id); setError(null); try { await onAction(trade, action); } catch (caught) { setError(caught); } finally { setBusyId(null); } };
  return <section className="payment-inbox trade-inbox banknote-panel" data-testid="trade-inbox" aria-labelledby="trade-inbox-title">
    <header><h2 id="trade-inbox-title">{t('tradeInbox')}</h2><div className="dialog-actions"><span className="status-pill">{pending.length}</span>{canPropose && <button className="button button-secondary" type="button" onClick={onPropose}>{t('proposeTrade')}</button>}</div></header>
    {error !== null && <p className="notice notice-error" role="alert">{apiErrorMessage(error, t, 'unableTrade')}</p>}
    {pending.length === 0 ? <p className="muted">{t('noTrades')}</p> : <ol>{pending.map((trade) => {
      const incoming = controlledPlayerIds.includes(trade.responderPlayerId);
      const outgoing = controlledPlayerIds.includes(trade.proposerPlayerId);
      return <li key={trade.id}><div><strong>{incoming ? t('tradeIncoming', { name: nameOf(trade.proposerPlayerId) }) : outgoing ? t('tradeOutgoing', { name: nameOf(trade.responderPlayerId) }) : `${nameOf(trade.proposerPlayerId)} ↔ ${nameOf(trade.responderPlayerId)}`}</strong><span>{gives(trade, trade.proposerPlayerId)}</span><span>{gives(trade, trade.responderPlayerId)}</span>{trade.items.some((item) => item.mortgageResolution !== null) && <small>{trade.items.filter((item) => item.mortgageResolution !== null).map((item) => `${boardSpaceName(boardSpaces.find((space) => space.id === item.boardSpaceId) ?? { translationKey: item.boardSpaceId, customName: null }, t)}: ${item.mortgageResolution === 'REDEEM' ? t('redeemMortgage', { amount: '' }).replace(/\s*\(\)\s*$/u, '') : t('payInterest', { amount: '' }).replace(/\s*\(\)\s*$/u, '')}`).join(' · ')}</small>}<small>{t('paymentRequestExpires', { time: new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(trade.expiresAt)) })}</small></div>
        {(incoming || outgoing) && <div className="dialog-actions">{incoming && <><button className="button button-primary" type="button" disabled={busyId !== null} onClick={() => void act(trade, 'accept')}>{t('acceptTrade')}</button><button className="button button-secondary" type="button" disabled={busyId !== null} onClick={() => void act(trade, 'decline')}>{t('declineTrade')}</button></>}{outgoing && !incoming && <button className="button button-secondary" type="button" disabled={busyId !== null} onClick={() => void act(trade, 'cancel')}>{t('cancelTrade')}</button>}</div>}
      </li>;
    })}</ol>}
  </section>;
}
