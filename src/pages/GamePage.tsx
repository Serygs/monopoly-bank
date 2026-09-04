import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CreateTransactionRequest, GameDetails } from '../../shared/contracts/api';
import type { Currency, Player, Transaction, TransactionType } from '../../shared/types/monopoly';
import { MonopolyBankApiError, monopolyBankApi } from '../api/monopoly-bank-api';
import { DiceRoller } from '../components/DiceRoller';
import { AmountSelector } from '../components/AmountSelector';
import { TableCalculator } from '../components/TableCalculator';
import type { DevicePreferences } from '../utils/preferences';
import { playPaymentFeedback, vibrate } from '../utils/feedback';
import { apiErrorMessage } from '../i18n/api-errors';
import { useLanguage } from '../i18n/language-context';
import type { Language, Translate } from '../i18n/translations';
import { formatMoney, formatMoneyDelta } from '../utils/money';
import { playerTransactionAmount, transactionAmount, transactionDescription } from '../utils/transaction-history';

type ActionType = CreateTransactionRequest['type'];
interface Props { gameId: string; onBack: () => void; preferences: DevicePreferences; }

const actions: ActionType[] = [
  'PLAYER_TO_PLAYER',
  'PAY_RENT',
  'PLAYER_TO_BANK',
  'BANK_TO_PLAYER',
  'PLAYER_TO_ALL',
  'ALL_TO_PLAYER',
  'PASS_GO',
];

export function GamePage({ gameId, onBack, preferences }: Props) {
  const { language, locale, t } = useLanguage();
  const [details, setDetails] = useState<GameDetails | null>(null);
  const [error, setError] = useState<unknown | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [history, setHistory] = useState<Transaction[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPlayer, setHistoryPlayer] = useState<Player | null>(null);
  const [historyError, setHistoryError] = useState<unknown | null>(null);
  const [notice, setNotice] = useState<ActionType | null>(null);

  useEffect(() => {
    let active = true;
    void monopolyBankApi.getGame(gameId).then(
      (game) => { if (active) setDetails(game); },
      (caught: unknown) => { if (active) setError(caught); },
    );
    return () => { active = false; };
  }, [gameId]);

  const loadHistory = async (player: Player | null = null) => {
    setHistoryOpen(true);
    setHistoryPlayer(player);
    setHistory(null);
    setHistoryError(null);
    try {
      setHistory(player === null
        ? await monopolyBankApi.listTransactions(gameId)
        : await monopolyBankApi.listPlayerTransactions(gameId, player.id));
    } catch (caught) {
      setHistoryError(caught);
    }
  };

  if (error !== null) {
    return <main className="page"><section className="notice notice-error" role="alert"><p>{apiErrorMessage(error, t, 'unableLoadGame')}</p><button className="button button-secondary" type="button" onClick={onBack}>{t('savedGames')}</button></section></main>;
  }
  if (details === null) {
    return <main className="page"><p className="status" role="status">{t('loadingGame')}</p></main>;
  }

  return <main className="page">
    <section className="page-heading game-heading">
      <div><p className="eyebrow">{t('activeGame')}</p><h1>{details.game.name}</h1><p className="lede">{t('configuredPassGoReward', { amount: formatMoney(details.game.passGoReward, details.game.currency) })}</p></div>
      <div className="header-actions"><button className="button button-secondary" type="button" onClick={() => void loadHistory()}>{t('history')}</button><button className="button button-quiet" type="button" onClick={onBack}>{t('savedGames')}</button></div>
    </section>
    {notice !== null && <section className="notice notice-success" role="status"><p>{t('recorded', { action: actionLabel(notice, t) })}</p><button className="button button-quiet" type="button" onClick={() => setNotice(null)}>{t('dismiss')}</button></section>}
    <section className="wallet-grid" aria-label={t('playerWallets')}>
      {details.players.map((player) => <button className="wallet-card wallet-card-button" type="button" key={player.id} style={{ borderTopColor: player.color }} aria-label={t('walletAria', { name: player.name, balance: formatMoney(player.balance, details.game.currency) })} onClick={() => setSelectedPlayer(player)}><span className="player-color" style={{ backgroundColor: player.color }} aria-hidden="true" /><span className="wallet-name">{player.name}</span><strong>{formatMoney(player.balance, details.game.currency)}</strong><span className="wallet-action">{t('walletAction')}</span></button>)}
    </section>
    <DiceRoller />
    <TableCalculator />
    {selectedPlayer !== null && <BankingDialog gameId={gameId} player={selectedPlayer} players={details.players} passGoReward={details.game.passGoReward} currency={details.game.currency} favoriteAmounts={details.favoriteAmounts ?? []} recentAmounts={details.recentAmounts ?? []} onToggleFavorite={(amount) => void monopolyBankApi.toggleFavoriteAmount(gameId, amount).then((favoriteAmounts) => setDetails((current) => current === null ? current : { ...current, favoriteAmounts }))} onClose={() => setSelectedPlayer(null)} onViewHistory={(player) => { setSelectedPlayer(null); void loadHistory(player); }} onCompleted={(players, action, amount) => { playPaymentFeedback(preferences.sound); vibrate(35, preferences.vibration); setDetails({ ...details, players, recentAmounts: amount === null ? details.recentAmounts : [amount, ...(details.recentAmounts ?? []).filter((value) => value !== amount)].slice(0, 5) }); setSelectedPlayer(null); setNotice(action); }} />}
    {historyOpen && <HistoryDialog history={history} player={historyPlayer} players={details.players} currency={details.game.currency} error={historyError} language={language} locale={locale} onClose={() => { setHistoryOpen(false); setHistory(null); setHistoryError(null); }} onRetry={() => void loadHistory(historyPlayer)} />}
  </main>;
}

function BankingDialog({ gameId, player, players, passGoReward, currency, favoriteAmounts, recentAmounts, onToggleFavorite, onClose, onViewHistory, onCompleted }: {
  gameId: string;
  player: Player;
  players: Player[];
  passGoReward: number;
  currency: Currency;
  favoriteAmounts: number[];
  recentAmounts: number[];
  onToggleFavorite: (amount: number) => void;
  onClose: () => void;
  onViewHistory: (player: Player) => void;
  onCompleted: (players: Player[], action: ActionType, amount: number | null) => void;
}) {
  const { t } = useLanguage();
  const [action, setAction] = useState<ActionType | null>(null);
  const [targetId, setTargetId] = useState('');
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const target = players.find((candidate) => candidate.id === targetId) ?? null;
  const amountValue = Number(amount);
  const request = action === null ? null : buildRequest(action, player.id, targetId, amountValue, comment);
  const preview = request === null ? [] : previewBalances(request, players, passGoReward);
  const targetRequired = action === 'PLAYER_TO_PLAYER' || action === 'PAY_RENT';
  const amountRequired = action !== 'PASS_GO';
  const fundsError = preflightFundsError(action, player, players, amountValue, currency, t);
  const valid = request !== null
    && (!targetRequired || target !== null && target.id !== player.id)
    && (!amountRequired || isPositiveInteger(amount))
    && fundsError === null;

  const selectAction = (next: ActionType | null) => {
    setAction(next);
    setTargetId('');
    setAmount('');
    setComment('');
    setConfirming(false);
    setError(null);
  };

  const submit = async () => {
    if (request === null || !valid || action === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await monopolyBankApi.createTransaction(gameId, request);
      onCompleted(result.players, action, action === 'PASS_GO' ? null : result.transaction.amount);
    } catch (caught) {
      setConfirming(false);
      setError(caught);
    } finally {
      setSubmitting(false);
    }
  };

  const title = action === null ? t('walletTitle', { name: player.name }) : actionLabel(action, t);
  const transactionError = error === null ? null : insufficientMessage(error, players, currency, t) ?? apiErrorMessage(error, t, 'unableRecordTransaction');

  return <Dialog title={title} onClose={onClose}>
    {transactionError !== null && <p className="notice notice-error" role="alert">{transactionError}</p>}
    {action === null ? <>
      <div className="action-grid">{actions.map((item) => <button className="button button-secondary action-button" type="button" key={item} onClick={() => selectAction(item)}>{actionLabel(item, t)}</button>)}</div>
      <button className="button button-quiet player-history-button" type="button" onClick={() => onViewHistory(player)}>{t('viewPlayerHistory', { name: player.name })}</button>
    </> : confirming ? <>
      <p className="dialog-intro">{t('confirmationIntro')}</p>
      <Confirmation action={action} player={player} target={target} amount={amountValue} passGoReward={passGoReward} currency={currency} preview={preview} comment={comment} />
      <div className="dialog-actions"><button className="button button-secondary" type="button" disabled={submitting} onClick={onClose}>{t('cancel')}</button><button className="button button-primary" type="button" disabled={submitting} onClick={() => void submit()}>{submitting ? t('recording') : t('confirmTransaction')}</button></div>
    </> : <>
      <p className="dialog-intro">{actionDescription(action, player.name, t)}</p>
      {targetRequired && <PlayerPicker label={t('chooseRecipient')} players={players.filter((candidate) => candidate.id !== player.id)} value={targetId} currency={currency} onChange={setTargetId} />}
      {amountRequired && <><AmountSelector value={amount} onChange={setAmount} currency={currency} favorites={favoriteAmounts} recent={recentAmounts} onToggleFavorite={onToggleFavorite} /><span className="field-hint">{isPositiveInteger(amount) ? formatMoney(amountValue, currency) : t('enterPositiveInteger')}</span></>}
      {fundsError !== null && <p className="field-error" role="alert">{fundsError}</p>}
      {action === 'PASS_GO' && <p className="pass-go-value">{t('passGoReceives', { amount: formatMoney(passGoReward, currency) })}</p>}
      <label className="dialog-field">{t('comment')} <span className="field-note">{t('optional')}</span><input value={comment} maxLength={500} onChange={(event) => setComment(event.target.value)} /></label>
      <div className="dialog-actions"><button className="button button-quiet" type="button" onClick={() => selectAction(null)}>{t('back')}</button><button className="button button-primary" type="button" disabled={!valid} onClick={() => setConfirming(true)}>{t('reviewTransaction')}</button></div>
    </>}
  </Dialog>;
}

function HistoryDialog({ history, player, players, currency, error, language, locale, onClose, onRetry }: {
  history: Transaction[] | null;
  player: Player | null;
  players: Player[];
  currency: Currency;
  error: unknown | null;
  language: Language;
  locale: string;
  onClose: () => void;
  onRetry: () => void;
}) {
  const { t } = useLanguage();
  const title = player === null ? t('gameHistory') : t('playerHistory', { name: player.name });
  return <Dialog title={title} onClose={onClose}>
    {error !== null ? <><p className="notice notice-error" role="alert">{apiErrorMessage(error, t, 'unableLoadHistory')}</p><button className="button button-secondary" type="button" onClick={onRetry}>{t('tryAgain')}</button></>
      : history === null ? <p className="status" role="status">{t('loadingHistory')}</p>
        : history.length === 0 ? <p className="muted">{t('noTransactions')}</p>
          : <ol className="history-list">{history.map((transaction) => <li key={transaction.id}><strong>{transactionDescription(transaction, players, language)}</strong><span className={player === null ? '' : 'player-history-amount'}>{player === null ? transactionAmount(transaction, currency, language) : playerTransactionAmount(transaction, player.id, currency)}</span><small>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(transaction.createdAt))}</small>{transaction.comment !== null && <em>{transaction.comment}</em>}</li>)}</ol>}
  </Dialog>;
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useLanguage();
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => { dialog.current?.focus(); }, []);
  return <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}><section ref={dialog} className="dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }} onMouseDown={(event) => event.stopPropagation()}><header><h2>{title}</h2><button className="button button-quiet" type="button" onClick={onClose} aria-label={t('closeDialog', { title })}>{t('close')}</button></header>{children}</section></div>;
}

function PlayerPicker({ label, players, value, currency, onChange }: { label: string; players: Player[]; value: string; currency: Currency; onChange: (id: string) => void }) {
  return <fieldset className="player-picker"><legend>{label}</legend><div>{players.map((candidate) => <button className={`player-choice${value === candidate.id ? ' selected' : ''}`} type="button" key={candidate.id} aria-pressed={value === candidate.id} onClick={() => onChange(candidate.id)}><span className="player-color" style={{ backgroundColor: candidate.color }} />{candidate.name}<small>{formatMoney(candidate.balance, currency)}</small></button>)}</div></fieldset>;
}

function Confirmation({ action, player, target, amount, passGoReward, currency, preview, comment }: { action: ActionType; player: Player; target: Player | null; amount: number; passGoReward: number; currency: Currency; preview: { player: Player; after: number; delta: number }[]; comment: string }) {
  const { t } = useLanguage();
  const total = action === 'PLAYER_TO_ALL' || action === 'ALL_TO_PLAYER' ? amount * (preview.length - 1) : action === 'PASS_GO' ? passGoReward : amount;
  return <section className="confirmation"><dl><div><dt>{t('operation')}</dt><dd>{transactionLabel(action, t)}</dd></div><div><dt>{t('source')}</dt><dd>{sourceFor(action, player, t)}</dd></div><div><dt>{t('destination')}</dt><dd>{destinationFor(action, player, target, t)}</dd></div><div><dt>{t('amount')}</dt><dd>{formatMoney(action === 'PASS_GO' ? passGoReward : amount, currency)}{action === 'PLAYER_TO_ALL' || action === 'ALL_TO_PLAYER' ? ` ${t('perPlayer')}` : ''}</dd></div><div><dt>{t('total')}</dt><dd>{formatMoney(total, currency)}</dd></div>{comment.trim() !== '' && <div><dt>{t('comment')}</dt><dd>{comment.trim()}</dd></div>}</dl><h3>{t('resultingBalances')}</h3><ul className="balance-preview">{preview.map(({ player: affected, after, delta }) => <li key={affected.id}><span><i style={{ backgroundColor: affected.color }} />{affected.name}</span><strong>{formatMoney(after, currency)} <small>({formatMoneyDelta(delta, currency)})</small></strong></li>)}</ul></section>;
}

function buildRequest(action: ActionType, playerId: string, targetId: string, amount: number, comment: string): CreateTransactionRequest | null {
  const optionalComment = comment.trim() === '' ? {} : { comment: comment.trim() };
  switch (action) {
    case 'PLAYER_TO_PLAYER':
    case 'PAY_RENT': return targetId === '' ? null : { type: action, sourcePlayerId: playerId, destinationPlayerId: targetId, amount, ...optionalComment };
    case 'PLAYER_TO_BANK':
    case 'BANK_TO_PLAYER': return { type: action, playerId, amount, ...optionalComment };
    case 'PLAYER_TO_ALL': return { type: action, payerPlayerId: playerId, amountPerPlayer: amount, ...optionalComment };
    case 'ALL_TO_PLAYER': return { type: action, recipientPlayerId: playerId, amountPerPlayer: amount, ...optionalComment };
    case 'PASS_GO': return { type: action, playerId, ...optionalComment };
  }
}

function previewBalances(request: CreateTransactionRequest, players: Player[], passGoReward: number) {
  return players.map((player) => {
    let delta = 0;
    switch (request.type) {
      case 'PLAYER_TO_PLAYER':
      case 'PAY_RENT': if (player.id === request.sourcePlayerId) delta = -request.amount; if (player.id === request.destinationPlayerId) delta = request.amount; break;
      case 'PLAYER_TO_BANK': if (player.id === request.playerId) delta = -request.amount; break;
      case 'BANK_TO_PLAYER': if (player.id === request.playerId) delta = request.amount; break;
      case 'PLAYER_TO_ALL': if (player.id === request.payerPlayerId) delta = -request.amountPerPlayer * (players.length - 1); else delta = request.amountPerPlayer; break;
      case 'ALL_TO_PLAYER': if (player.id === request.recipientPlayerId) delta = request.amountPerPlayer * (players.length - 1); else delta = -request.amountPerPlayer; break;
      case 'PASS_GO': if (player.id === request.playerId) delta = passGoReward; break;
    }
    return { player, delta, after: player.balance + delta };
  });
}

function actionLabel(type: ActionType, t: Translate): string {
  return ({ PLAYER_TO_PLAYER: t('payPlayer'), PAY_RENT: t('payRent'), PLAYER_TO_BANK: t('payBank'), BANK_TO_PLAYER: t('receiveFromBank'), PLAYER_TO_ALL: t('payEveryone'), ALL_TO_PLAYER: t('everyonePaysMe'), PASS_GO: t('passGo') })[type];
}

function actionDescription(action: ActionType, name: string, t: Translate): string {
  const key = ({ PLAYER_TO_PLAYER: 'actionPayPlayer', PAY_RENT: 'actionPayRent', PLAYER_TO_BANK: 'actionPayBank', BANK_TO_PLAYER: 'actionReceiveBank', PLAYER_TO_ALL: 'actionPayEveryone', ALL_TO_PLAYER: 'actionEveryonePays', PASS_GO: 'actionPassGo' } as const)[action];
  return t(key, { name });
}

function sourceFor(action: ActionType, player: Player, t: Translate): string {
  if (action === 'BANK_TO_PLAYER' || action === 'PASS_GO') return t('bank');
  if (action === 'ALL_TO_PLAYER') return t('allOtherPlayers');
  return player.name;
}

function destinationFor(action: ActionType, player: Player, target: Player | null, t: Translate): string {
  if (action === 'PLAYER_TO_BANK') return t('bank');
  if (action === 'PLAYER_TO_ALL') return t('allOtherPlayers');
  if (action === 'PLAYER_TO_PLAYER' || action === 'PAY_RENT') return target?.name ?? t('selectedPlayer');
  return player.name;
}

function transactionLabel(type: TransactionType, t: Translate): string {
  return ({ PLAYER_TO_PLAYER: t('playerPayment'), PLAYER_TO_BANK: t('paidBank'), BANK_TO_PLAYER: t('receivedFromBank'), PLAYER_TO_ALL: t('paidEveryone'), ALL_TO_PLAYER: t('everyonePaidPlayer'), PAY_RENT: t('paidRent'), PASS_GO: t('passedGo'), BANKRUPTCY_TRANSFER: 'Bankruptcy transfer' })[type];
}

function isPositiveInteger(value: string) { return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0; }

function preflightFundsError(action: ActionType | null, player: Player, players: Player[], amount: number, currency: Currency, t: Translate) {
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  if (action === 'PLAYER_TO_ALL') {
    const required = amount * (players.length - 1);
    return player.balance < required ? `${t('insufficientFunds')} ${t('balanceRequirement', { current: formatMoney(player.balance, currency), required: formatMoney(required, currency) })}` : null;
  }
  if (action === 'ALL_TO_PLAYER') {
    const payers = players.filter((candidate) => candidate.id !== player.id && candidate.balance < amount);
    return payers.length === 0 ? null : t('cannotAfford', { names: payers.map((payer) => payer.name).join(', '), amount: formatMoney(amount, currency) });
  }
  if (action === 'PLAYER_TO_PLAYER' || action === 'PAY_RENT' || action === 'PLAYER_TO_BANK') {
    return player.balance < amount ? `${t('insufficientFunds')} ${t('balanceRequirement', { current: formatMoney(player.balance, currency), required: formatMoney(amount, currency) })}` : null;
  }
  return null;
}

function insufficientMessage(error: unknown, players: Player[], currency: Currency, t: Translate) {
  if (!(error instanceof MonopolyBankApiError) || error.code !== 'INSUFFICIENT_FUNDS') return null;
  const current = error.details?.currentBalance;
  const required = error.details?.requiredAmount;
  const playerId = error.details?.playerId;
  const player = typeof playerId === 'string' ? players.find((candidate) => candidate.id === playerId) : undefined;
  const prefix = player === undefined ? t('insufficientFunds') : t('playerInsufficientFunds', { name: player.name });
  return typeof current === 'number' && typeof required === 'number'
    ? `${prefix} ${t('balanceRequirement', { current: formatMoney(current, currency), required: formatMoney(required, currency) })}`
    : prefix;
}
