import { useRef, useState } from 'react';
import type { PropertyOperationResponse } from '../../shared/contracts/api';
import type { BoardSpace, Currency, Player } from '../../shared/types/monopoly';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { apiErrorMessage } from '../i18n/api-errors';
import { useLanguage } from '../i18n/language-context';
import { boardSpaceName } from '../utils/board-space-name';
import { formatMoney } from '../utils/money';
import { AmountSelector } from './AmountSelector';
import { Dialog } from './Dialog';
import { PlayerPicker } from './PlayerPicker';
import { GroupBadge } from './SpacePicker';

interface AuctionDialogProps {
  gameId: string;
  space: BoardSpace;
  players: Player[];
  currency: Currency;
  onClose: () => void;
  onCompleted: (result: PropertyOperationResponse) => void;
}

/** The table held the auction; this only records who won and for how much. The bid is not capped by the catalogue. */
export function AuctionDialog({ gameId, space, players, currency, onClose, onCompleted }: AuctionDialogProps) {
  const { t } = useLanguage();
  const [winnerId, setWinnerId] = useState('');
  const [price, setPrice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const commandIdRef = useRef<string | null>(null);
  const winner = players.find((player) => player.id === winnerId) ?? null;
  const priceValue = Number(price);
  const valid = winner !== null && /^\d+$/.test(price) && Number.isSafeInteger(priceValue) && priceValue > 0;
  const title = t('auctionTitle', { name: boardSpaceName(space, t) });
  const submit = async () => {
    if (!valid || winner === null || submitting) return;
    setSubmitting(true); setError(null);
    const commandId = commandIdRef.current ?? crypto.randomUUID();
    commandIdRef.current = commandId;
    try { onCompleted(await monopolyBankApi.recordAuction(gameId, { boardSpaceId: space.id, winnerPlayerId: winner.id, price: priceValue }, commandId)); } catch (caught) { setError(caught); } finally { setSubmitting(false); }
  };
  return <Dialog title={title} closeLabel={t('closeDialog', { title })} onClose={onClose} className="space-sheet">
    <div className="space-sheet-heading"><GroupBadge group={space.colorGroup} /><span className="muted">{t('spacePrice')}: {formatMoney(space.price, currency)}</span></div>
    <p className="dialog-intro">{t('auctionDescription')}</p>
    {error !== null && <p className="notice notice-error" role="alert">{apiErrorMessage(error, t, 'unableRecordTransaction')}</p>}
    <PlayerPicker label={t('auctionWinner')} players={players.filter((player) => player.status !== 'BANKRUPT')} gamePlayers={players} value={winnerId} currency={currency} onChange={(id) => { setWinnerId(id); commandIdRef.current = null; }} />
    <p className="field-hint">{t('auctionPrice')}</p>
    <AmountSelector value={price} onChange={(next) => { setPrice(next); commandIdRef.current = null; }} currency={currency} />
    <div className="dialog-actions"><button className="button button-secondary" type="button" disabled={submitting} onClick={onClose}>{t('cancel')}</button><button className="button button-primary" type="button" disabled={!valid || submitting} onClick={() => void submit()}>{submitting ? t('recording') : t('recordAuction')}</button></div>
  </Dialog>;
}
