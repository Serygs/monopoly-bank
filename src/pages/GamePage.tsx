import { useCallback, useEffect, useRef, useState, type CSSProperties, type MutableRefObject } from 'react';
import type { CreateInvitationResponse, CreateTransactionRequest, GameDetails, LedgerStatistics, PaymentRequest, PlayerControllerKind } from '../../shared/contracts/api';
import type { Currency, Game, Player, Transaction, TransactionType } from '../../shared/types/monopoly';
import { ActivityScreen } from './ActivityScreen';
import { StatisticsScreen } from './StatisticsScreen';
import type { FinalGameSummary } from '../../shared/domain/game-summary';
import { MonopolyBankApiError, monopolyBankApi } from '../api/monopoly-bank-api';
import { DiceRoller } from '../components/DiceRoller';
import { Dialog } from '../components/Dialog';
import { PageHeader } from '../components/PageHeader';
import { AmountSelector } from '../components/AmountSelector';
import { TableCalculator } from '../components/TableCalculator';
import type { DevicePreferences } from '../utils/preferences';
import { playPaymentFeedback, vibrate } from '../utils/feedback';
import { apiErrorMessage } from '../i18n/api-errors';
import { useLanguage } from '../i18n/language-context';
import type { Language, Translate } from '../i18n/translations';
import { formatMoney, formatMoneyDelta } from '../utils/money';
import { playerNameWithGameId } from '../utils/player-display';
import { playerTransactionAmount, transactionAmount, transactionDescription } from '../utils/transaction-history';
import { isLiveServerEvent, type LiveServerEvent } from '../../shared/contracts/live';
import { createLocalQr } from '../utils/local-qr';
import { acceptsLiveVersion } from '../utils/live-version';
import { gameStatusTranslationKey } from '../utils/game-status';

type ActionType = CreateTransactionRequest['type'];
interface Props { gameId: string; onBack: () => void; preferences: DevicePreferences; offline: boolean; onPaymentFlowChange: (open: boolean) => void; }

const primaryWalletActions: ActionType[] = ['PLAYER_TO_PLAYER', 'PLAYER_TO_BANK', 'BANK_TO_PLAYER', 'PASS_GO'];
const advancedWalletActions: ActionType[] = ['PLAYER_TO_ALL', 'ALL_TO_PLAYER'];

function walletActionTone(action: ActionType): 'income' | 'expense' {
  return action === 'BANK_TO_PLAYER' || action === 'ALL_TO_PLAYER' || action === 'PASS_GO'
    ? 'income'
    : 'expense';
}

export function GamePage({ gameId, onBack, preferences, offline, onPaymentFlowChange }: Props) {
  const { language, locale, t } = useLanguage();
  const [details, setDetails] = useState<GameDetails | null>(null);
  const [error, setError] = useState<unknown | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [history, setHistory] = useState<Transaction[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPlayer, setHistoryPlayer] = useState<Player | null>(null);
  const [historyError, setHistoryError] = useState<unknown | null>(null);
  const historyCache = useRef(new Map<string, Transaction[]>());
  const [notice, setNotice] = useState<ActionType | null>(null);
  const [summary, setSummary] = useState<({ game: Game; winners: Player[] } & LedgerStatistics) | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [statisticsOpen, setStatisticsOpen] = useState(false);
  const [bankruptPlayer, setBankruptPlayer] = useState<Player | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [activeWalletId, setActiveWalletId] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<'connecting' | 'reconnecting' | 'live' | 'offline'>('connecting');
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequest[]>([]);
  const [paymentRequestNotice, setPaymentRequestNotice] = useState(false);
  const [liveTransactions, setLiveTransactions] = useState<Transaction[]>([]);
  const lastAppliedVersion = useRef(0);
  useEffect(() => { onPaymentFlowChange(selectedPlayer !== null || bankruptPlayer !== null); return () => onPaymentFlowChange(false); }, [selectedPlayer, bankruptPlayer, onPaymentFlowChange]);

  useEffect(() => {
    let active = true;
    void monopolyBankApi.getGame(gameId).then(
      (game) => { if (active) setDetails(game); },
      (caught: unknown) => { if (active) setError(caught); },
    );
    return () => { active = false; };
  }, [gameId]);

  const loadPaymentRequests = useCallback(() => void monopolyBankApi.listPaymentRequests(gameId).then(setPaymentRequests, () => undefined), [gameId]);
  useEffect(() => { if (details?.game.status === 'ACTIVE' && !offline) loadPaymentRequests(); }, [details?.game.status, loadPaymentRequests, offline]);

  useEffect(() => {
    if (details?.game.status !== 'ACTIVE' || offline) {
      return;
    }
    let closed = false; let retry: number | undefined; let heartbeat: number | undefined; let socket: WebSocket | null = null; let attempts = 0;
    const connect = () => {
      if (closed) return;
      setLiveStatus(attempts === 0 ? 'connecting' : 'reconnecting');
      const url = new URL(`/api/games/${encodeURIComponent(gameId)}/live`, window.location.origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const nextSocket = new WebSocket(url);
      socket = nextSocket;
      nextSocket.onopen = () => { if (socket === nextSocket) { attempts = 0; setLiveStatus('live'); heartbeat = window.setInterval(() => { if (nextSocket.readyState === WebSocket.OPEN) nextSocket.send(JSON.stringify({ type: 'HEARTBEAT' })); }, 20_000); } };
      nextSocket.onmessage = (message) => { if (socket !== nextSocket) return; try { const event: unknown = JSON.parse(String(message.data)); if (!isLiveServerEvent(event)) return; if (event.type === 'GAME_SNAPSHOT') { lastAppliedVersion.current = event.state.stateVersion; applyLiveEvent(event, setDetails, setHistory, historyCache); return; } if (!acceptsLiveVersion(lastAppliedVersion.current, event.stateVersion)) { nextSocket.close(4001, 'State version gap: resync required.'); return; } if (event.stateVersion > lastAppliedVersion.current) lastAppliedVersion.current = event.stateVersion; applyLiveEvent(event, setDetails, setHistory, historyCache); if (event.type === 'GAME_COMMITTED') setLiveTransactions((current) => [event.transaction, ...current.filter((item) => item.id !== event.transaction.id)].slice(0, 50)); if (event.type === 'PAYMENT_REQUESTS_UPDATED') loadPaymentRequests(); } catch { /* Ignore malformed network data. */ } };
      nextSocket.onclose = () => { if (heartbeat !== undefined) { window.clearInterval(heartbeat); heartbeat = undefined; } if (closed || socket !== nextSocket) return; setLiveStatus('offline'); attempts += 1; const base = Math.min(1000 * 2 ** (attempts - 1), 10_000); retry = window.setTimeout(connect, Math.round(base * (0.7 + Math.random() * 0.6))); };
      nextSocket.onerror = () => { if (socket === nextSocket) nextSocket.close(); };
    };
    connect();
    return () => { closed = true; if (retry !== undefined) window.clearTimeout(retry); if (heartbeat !== undefined) window.clearInterval(heartbeat); socket?.close(); };
  }, [gameId, details?.game.status, loadPaymentRequests, offline]);

  const loadHistory = async (player: Player | null = null) => {
    const scope = player === null ? 'all' : `player:${player.id}`;
    setHistoryOpen(true);
    setHistoryPlayer(player);
    setHistoryError(null);
    const cached = historyCache.current.get(scope);
    if (cached !== undefined) {
      setHistory(cached);
      return;
    }
    const allTransactions = historyCache.current.get('all');
    if (player !== null && allTransactions !== undefined) {
      const playerTransactions = allTransactions.filter((transaction) => transaction.participants.some((participant) => participant.playerId === player.id));
      historyCache.current.set(scope, playerTransactions);
      setHistory(playerTransactions);
      return;
    }
    setHistory(null);
    try {
      const transactions = player === null
        ? await monopolyBankApi.listTransactions(gameId)
        : await monopolyBankApi.listPlayerTransactions(gameId, player.id);
      historyCache.current.set(scope, transactions);
      setHistory(transactions);
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
  const controlledWallets = details.controlledWallets ?? [];
  const activeControlledWalletId = controlledWallets.some((wallet) => wallet.playerId === activeWalletId) ? activeWalletId : controlledWallets[0]?.playerId ?? null;
  const activeWallet = details.players.find((player) => player.id === activeControlledWalletId) ?? null;
  const otherPlayers = details.players.filter((player) => player.id !== activeWallet?.id);
  const canMutate = details.game.status === 'ACTIVE' && !offline;

  return <main className="page game-page">
    <PageHeader className="game-heading" eyebrow={t(gameStatusTranslationKey(details.game.status))} title={details.game.name} description={<span className="game-pass-go"><span>{t('passGoRewardLabel')}:</span><strong>{formatMoney(details.game.passGoReward, details.game.currency)}</strong></span>} backAction={<button className="button button-quiet game-back-link" type="button" onClick={onBack}><span aria-hidden="true">←</span>{t('savedGames')}</button>} actions={<div className="game-page-actions"><button className="button button-secondary" type="button" disabled={offline} onClick={() => setActivityOpen(true)}>{t('activity')}</button><button className="button button-secondary" type="button" disabled={offline} onClick={() => void monopolyBankApi.getGameSummary(gameId).then((result) => { setSummary(result); setStatisticsOpen(true); })}>{t('statistics')}</button>{details.canManage && details.game.status === 'LOBBY' && <button className="button button-secondary" type="button" disabled={offline} onClick={() => setInviteOpen(true)}>{t('invitePlayers')}</button>}{details.canManage && details.game.status === 'ACTIVE' && <button className="button button-danger" type="button" disabled={offline} onClick={() => setFinishing(true)}>{t('finishGame')}</button>}</div>}>
      {details.game.status === 'ACTIVE' && <span className={`live-status live-status-${liveStatus}`} role="status">{liveStatus === 'live' ? t('connectionLive') : liveStatus === 'connecting' ? t('connectionConnecting') : liveStatus === 'reconnecting' ? t('connectionReconnecting') : t('connectionOffline')}</span>}
    </PageHeader>
    {details.game.status === 'LOBBY' && <section className="notice notice-success game-state-banner" role="status"><p>{t('waitingForPlayers')} — {t('startGameHint')}</p>{details.canManage && <button className="button button-primary" type="button" disabled={offline || details.players.length < 2} onClick={() => void monopolyBankApi.startGame(gameId).then(setDetails)}>{t('startGame')}</button>}</section>}
    {notice !== null && <section className="notice notice-success" role="status"><p>{t('recorded', { action: actionLabel(notice, t) })}</p><button className="button button-quiet" type="button" onClick={() => setNotice(null)}>{t('dismiss')}</button></section>}
    {paymentRequestNotice && <section className="notice notice-success" role="status"><p>{t('paymentRequestCreated')}</p><button className="button button-quiet" type="button" onClick={() => setPaymentRequestNotice(false)}>{t('dismiss')}</button></section>}
    <section className="wallets-section" aria-labelledby="player-wallets-title">
      <header className="wallets-heading"><h2 id="player-wallets-title">{t('playerWallets')}</h2></header>
      {controlledWallets.length > 0 && <fieldset className="wallet-switcher"><legend>{t('walletSwitcher')}</legend><div>{controlledWallets.map((wallet) => { const player = details.players.find((candidate) => candidate.id === wallet.playerId); if (player === undefined) return null; return <button className="button button-secondary" type="button" key={wallet.playerId} aria-pressed={activeControlledWalletId === wallet.playerId} onClick={() => setActiveWalletId(wallet.playerId)}>{controllerLabel(wallet.kind, t)}: {player.name}</button>; })}</div></fieldset>}
      <div className={`wallet-layout${activeWallet === null ? ' wallet-layout-readonly' : ''}`}>
        {activeWallet !== null && <section className="wallet-group wallet-group-controlled" aria-label={t('walletTitle', { name: activeWallet.name })}><h3>{t('yourWallet')}</h3><WalletCard player={activeWallet} players={details.players} currency={details.game.currency} active gameActive={canMutate} prominent onOpen={() => setSelectedPlayer(activeWallet)} /></section>}
        <div className="wallet-group wallet-group-others">{activeWallet !== null && <h3>{t('otherPlayers')}</h3>}<div className="wallet-grid">{otherPlayers.map((player) => <WalletCard key={player.id} player={player} players={details.players} currency={details.game.currency} active={false} gameActive={canMutate} onOpen={() => setSelectedPlayer(player)} />)}</div></div>
      </div>
    </section>
    {canMutate && <PaymentInbox requests={paymentRequests} players={details.players} currency={details.game.currency} onAction={async (request, action) => { const commandId = crypto.randomUUID(); const result = action === 'accept' ? await monopolyBankApi.acceptPaymentRequest(gameId, request.id, commandId) : await monopolyBankApi.declinePaymentRequest(gameId, request.id, commandId); setPaymentRequests((current) => current.filter((item) => item.id !== request.id)); if (result.transaction !== undefined) { historyCache.current.clear(); playPaymentFeedback(preferences.sound); vibrate(35, preferences.vibration); setDetails((current) => current === null ? current : { ...current, players: result.players }); } }} />}
    {details.game.status === 'ACTIVE' && <div className="game-tools"><DiceRoller /><TableCalculator /></div>}
    {activityOpen && <ActivityScreen gameId={gameId} players={details.players} currency={details.game.currency} liveTransactions={liveTransactions} onClose={() => setActivityOpen(false)} />}
    {statisticsOpen && summary !== null && <StatisticsScreen summary={summary} currency={details.game.currency} onClose={() => setStatisticsOpen(false)} />}
    {selectedPlayer !== null && <BankingDialog gameId={gameId} player={selectedPlayer} players={details.players} passGoReward={details.game.passGoReward} currency={details.game.currency} favoriteAmounts={details.favoriteAmounts ?? []} recentAmounts={details.recentAmounts ?? []} onToggleFavorite={(amount) => void monopolyBankApi.toggleFavoriteAmount(gameId, amount).then((favoriteAmounts) => setDetails((current) => current === null ? current : { ...current, favoriteAmounts }))} onClose={() => setSelectedPlayer(null)} onBankrupt={() => { setBankruptPlayer(selectedPlayer); setSelectedPlayer(null); }} onViewHistory={(player) => { setSelectedPlayer(null); void loadHistory(player); }} onCompleted={(players, action, amount) => { historyCache.current.clear(); playPaymentFeedback(preferences.sound); vibrate(35, preferences.vibration); setDetails({ ...details, players, recentAmounts: amount === null ? details.recentAmounts : [amount, ...(details.recentAmounts ?? []).filter((value) => value !== amount)].slice(0, 5) }); setSelectedPlayer(null); setNotice(action); }} onPaymentRequested={() => { loadPaymentRequests(); setSelectedPlayer(null); setPaymentRequestNotice(true); }} />}
    {bankruptPlayer !== null && <BankruptcyDialog gameId={gameId} player={bankruptPlayer} players={details.players} onClose={() => setBankruptPlayer(null)} onCompleted={(players) => { historyCache.current.clear(); setDetails({ ...details, players }); setBankruptPlayer(null); }} />}
    {inviteOpen && <InviteDialog gameId={gameId} onClose={() => setInviteOpen(false)} />}
    {finishing && <FinishGameDialog players={details.players} currency={details.game.currency} gameId={gameId} onFinished={(finished) => { setDetails((current) => withClientGameDetails(finished, current)); setFinishing(false); }} onClose={() => setFinishing(false)} />}
    {historyOpen && <HistoryDialog history={history} player={historyPlayer} players={details.players} currency={details.game.currency} error={historyError} language={language} locale={locale} onClose={() => { setHistoryOpen(false); setHistory(null); setHistoryError(null); }} onRetry={() => void loadHistory(historyPlayer)} />}
  </main>;
}

function BankingDialog({ gameId, player, players, passGoReward, currency, favoriteAmounts, recentAmounts, onToggleFavorite, onClose, onBankrupt, onViewHistory, onCompleted, onPaymentRequested }: {
  gameId: string;
  player: Player;
  players: Player[];
  passGoReward: number;
  currency: Currency;
  favoriteAmounts: number[];
  recentAmounts: number[];
  onToggleFavorite: (amount: number) => void;
  onClose: () => void;
  onBankrupt: () => void;
  onViewHistory: (player: Player) => void;
  onCompleted: (players: Player[], action: ActionType, amount: number | null) => void;
  onPaymentRequested: () => void;
}) {
  const { t } = useLanguage();
  const [action, setAction] = useState<ActionType | null>(null);
  const [targetId, setTargetId] = useState('');
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const submittingRef = useRef(false);
  const commandIdRef = useRef<string | null>(null);
  const target = players.find((candidate) => candidate.id === targetId) ?? null;
  const amountValue = Number(amount);
  const request = action === null ? null : buildRequest(action, player.id, targetId, amountValue, comment);
  const preview = request === null ? [] : previewBalances(request, players, passGoReward);
  const targetRequired = action === 'PLAYER_TO_PLAYER';
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

  const reviewQuickAmount = (nextAmount: number) => {
    changeAmount(String(nextAmount));
    if (action === 'PLAYER_TO_PLAYER' && target !== null && preflightFundsError(action, player, players, nextAmount, currency, t) === null) {
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
      else onCompleted(result.players, action, action === 'PASS_GO' ? null : result.transaction.amount);
    } catch (caught) {
      setError(caught);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const title = action === null ? t('walletTitle', { name: player.name }) : actionLabel(action, t);
  const transactionError = error === null ? null : insufficientMessage(error, players, currency, t) ?? apiErrorMessage(error, t, 'unableRecordTransaction');

  return <Dialog title={title} closeLabel={t('closeDialog', { title })} onClose={onClose} className="banking-sheet">
    {transactionError !== null && <p className="notice notice-error" role="alert">{transactionError}</p>}
    {action === null ? <>
      <section className="wallet-sheet-balance" aria-label={t('walletBalanceAria', { name: player.name, balance: formatMoney(player.balance, currency) })}>
        <span>{t('availableBalance')}</span><strong>{formatMoney(player.balance, currency)}</strong>
      </section>
      <p className="dialog-intro">{t('walletSheetIntro')}</p>
      <div className="action-grid wallet-action-grid">{primaryWalletActions.map((item) => <button className={`button wallet-action-button wallet-action-${walletActionTone(item)} action-button`} type="button" key={item} onClick={() => selectAction(item)}>{actionLabel(item, t)}</button>)}</div>
      <details className="wallet-advanced-actions"><summary>{t('advancedActions')}</summary><div className="action-grid">{advancedWalletActions.map((item) => <button className={`button wallet-action-button wallet-action-${walletActionTone(item)} action-button`} type="button" key={item} onClick={() => selectAction(item)}>{actionLabel(item, t)}</button>)}<button className="button button-danger bankruptcy-action" type="button" onClick={onBankrupt}>{t('declareBankrupt')}</button></div><button className="button button-quiet player-history-button" type="button" onClick={() => onViewHistory(player)}>{t('viewPlayerHistory', { name: player.name })}</button></details>
    </> : confirming ? <>
      <p className="dialog-intro">{t('confirmationIntro')}</p>
      <Confirmation action={action} player={player} target={target} amount={amountValue} passGoReward={passGoReward} currency={currency} preview={preview} comment={comment} />
      <div className="dialog-actions"><button className="button button-secondary" type="button" disabled={submitting} onClick={() => setConfirming(false)}>{t('back')}</button><button className="button button-primary" type="button" disabled={submitting} onClick={() => void submit()}>{submitting ? t('recording') : transactionError === null ? t('confirmTransaction') : t('tryAgain')}</button></div>
    </> : <>
      <p className="dialog-intro">{actionDescription(action, player.name, t)}</p>
      {targetRequired && <PlayerPicker label={t('chooseRecipient')} players={players.filter((candidate) => candidate.id !== player.id)} gamePlayers={players} value={targetId} currency={currency} onChange={changeTarget} />}
      {amountRequired && <><AmountSelector value={amount} onChange={changeAmount} currency={currency} favorites={favoriteAmounts} recent={recentAmounts} onToggleFavorite={onToggleFavorite} onQuickAmountSelect={reviewQuickAmount} /><span className="field-hint">{isPositiveInteger(amount) ? formatMoney(amountValue, currency) : t('enterPositiveInteger')}</span></>}
      {fundsError !== null && <p className="field-error" role="alert">{fundsError}</p>}
      {action === 'PASS_GO' && <p className="pass-go-value">{t('passGoReceives', { amount: formatMoney(passGoReward, currency) })}</p>}
      <label className="dialog-field">{t('comment')} <span className="field-note">{t('optional')}</span><input value={comment} maxLength={500} onChange={(event) => changeComment(event.target.value)} /></label>
      <div className="dialog-actions"><button className="button button-quiet" type="button" onClick={() => selectAction(null)}>{t('back')}</button><button className="button button-primary" type="button" disabled={!valid} onClick={() => setConfirming(true)}>{t('reviewTransaction')}</button></div>
    </>}
  </Dialog>;
}

function WalletCard({ player, players, currency, active, gameActive, prominent = false, onOpen }: { player: Player; players: Player[]; currency: Currency; active: boolean; gameActive: boolean; prominent?: boolean; onOpen: () => void }) {
  const { t } = useLanguage();
  const playerName = playerNameWithGameId(player, players);
  const unavailable = !gameActive || player.status === 'BANKRUPT';
  const interactive = active && !unavailable;
  const balance = formatMoney(player.balance, currency);
  const balanceLengthClass = balance.length > 18 ? ' wallet-balance-very-long' : balance.length > 12 ? ' wallet-balance-long' : '';
  const cardStyle = { '--wallet-player-color': player.color } as CSSProperties;
  const content = <>
    <span className="wallet-card-heading"><span className="player-color" style={{ backgroundColor: player.color }} aria-hidden="true" /><span className="wallet-name">{playerName}</span><span className="wallet-card-badges">{active && <span className="wallet-active-indicator">{t('activeWallet')}</span>}{player.status === 'BANKRUPT' && <span className="wallet-bankrupt-indicator">{t('bankrupt')}</span>}</span></span>
    <strong className={`wallet-balance${balanceLengthClass}`}>{balance}</strong>
    <span className="wallet-card-footer"><span>{interactive ? t('walletAction') : t('walletReadOnly')}</span>{interactive && <span aria-hidden="true">→</span>}</span>
  </>;
  const accessibleLabel = t(interactive ? 'walletAria' : 'walletReadOnlyAria', { name: playerName, balance });
  if (!active) return <article className="wallet-card wallet-card-readonly" style={cardStyle} aria-label={accessibleLabel}>{content}</article>;
  return <button className={`wallet-card wallet-card-button wallet-card-active${prominent ? ' wallet-card-prominent' : ''}`} type="button" disabled={unavailable} style={cardStyle} aria-label={accessibleLabel} onClick={onOpen}>{content}</button>;
}

function PaymentInbox({ requests, players, currency, onAction }: { requests: PaymentRequest[]; players: Player[]; currency: Currency; onAction: (request: PaymentRequest, action: 'accept' | 'decline') => Promise<void> }) {
  const { t, locale } = useLanguage();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<unknown | null>(null);
  const act = async (request: PaymentRequest, action: 'accept' | 'decline') => { setBusyId(request.id); setError(null); try { await onAction(request, action); } catch (caught) { setError(caught); } finally { setBusyId(null); } };
  return <section className="payment-inbox" aria-labelledby="payment-inbox-title"><header><h2 id="payment-inbox-title">{t('paymentInbox')}</h2><span className="status-pill">{requests.length}</span></header>{error !== null && <p className="notice notice-error" role="alert">{apiErrorMessage(error, t, 'unableRecordTransaction')}</p>}{requests.length === 0 ? <p className="muted">{t('noPaymentRequests')}</p> : <ol>{requests.map((request) => { const creator = players.find((player) => player.id === request.creatorPlayerId); return <li key={request.id}><div><strong>{t('paymentRequestFrom', { name: creator?.name ?? t('playerFallback'), amount: formatMoney(request.amount, currency) })}</strong><small>{t('paymentRequestExpires', { time: new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(request.expiresAt)) })}</small></div><div className="dialog-actions"><button className="button button-primary" type="button" disabled={busyId !== null} onClick={() => void act(request, 'accept')}>{t('acceptPayment')}</button><button className="button button-secondary" type="button" disabled={busyId !== null} onClick={() => void act(request, 'decline')}>{t('declinePayment')}</button></div></li>; })}</ol>}</section>;
}

function BankruptcyDialog({ gameId, player, players, onClose, onCompleted }: { gameId: string; player: Player; players: Player[]; onClose: () => void; onCompleted: (players: Player[]) => void }) {
  const { t } = useLanguage();
  const [creditorId, setCreditorId] = useState<string | null>(null); const [confirming, setConfirming] = useState(false); const [error, setError] = useState<string | null>(null);
  const creditor = players.find((candidate) => candidate.id === creditorId) ?? null;
  const title = t('declareBankruptcyTitle', { name: player.name });
  const submit = async () => { try { const result = await monopolyBankApi.declareBankruptcy(gameId, { playerId: player.id, ...(creditorId === null ? {} : { creditorPlayerId: creditorId }) }); onCompleted(result.players); } catch (caught) { setError(apiErrorMessage(caught, t, 'unableRecordTransaction')); } };
  return <Dialog title={title} closeLabel={t('closeDialog', { title })} onClose={onClose}>{confirming ? <><p className="dialog-intro">{creditor === null ? t('bankruptcyToBank') : t('bankruptcyToPlayer', { name: player.name, creditor: creditor.name })} {t('bankruptcyIrreversible')}</p>{error !== null && <p className="notice notice-error" role="alert">{error}</p>}<div className="dialog-actions"><button className="button button-secondary" type="button" onClick={() => setConfirming(false)}>{t('back')}</button><button className="button button-danger" type="button" onClick={() => void submit()}>{t('confirmBankruptcy')}</button></div></> : <><p className="dialog-intro">{t('chooseBankruptcyDestination', { name: player.name })}</p><div className="action-grid"><button className={`button button-secondary${creditorId === null ? ' selected' : ''}`} type="button" onClick={() => setCreditorId(null)}>{t('toBank')}</button>{players.filter((candidate) => candidate.id !== player.id && candidate.status !== 'BANKRUPT').map((candidate) => <button className={`button button-secondary${creditorId === candidate.id ? ' selected' : ''}`} type="button" key={candidate.id} onClick={() => setCreditorId(candidate.id)}>{t('toPlayer', { name: candidate.name })}</button>)}</div><div className="dialog-actions"><button className="button button-secondary" type="button" onClick={onClose}>{t('cancel')}</button><button className="button button-danger" type="button" onClick={() => setConfirming(true)}>{t('reviewBankruptcy')}</button></div></>}</Dialog>;
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
  return <Dialog title={title} closeLabel={t('closeDialog', { title })} onClose={onClose}>
    {error !== null ? <><p className="notice notice-error" role="alert">{apiErrorMessage(error, t, 'unableLoadHistory')}</p><button className="button button-secondary" type="button" onClick={onRetry}>{t('tryAgain')}</button></>
      : history === null ? <p className="status" role="status">{t('loadingHistory')}</p>
        : history.length === 0 ? <p className="muted">{t('noTransactions')}</p>
          : <ol className="history-list">{history.map((transaction) => <li key={transaction.id}><strong>{transactionDescription(transaction, players, language)}</strong><span className={player === null ? '' : 'player-history-amount'}>{player === null ? transactionAmount(transaction, currency, language) : playerTransactionAmount(transaction, player.id, currency)}</span><small>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(transaction.createdAt))}</small>{transaction.comment !== null && <em>{transaction.comment}</em>}</li>)}</ol>}
  </Dialog>;
}

function applyLiveEvent(event: LiveServerEvent, setDetails: React.Dispatch<React.SetStateAction<GameDetails | null>>, setHistory: React.Dispatch<React.SetStateAction<Transaction[] | null>>, historyCache: MutableRefObject<Map<string, Transaction[]>>) {
  if (event.type === 'GAME_SNAPSHOT') { historyCache.current.set('all', event.state.transactions); setDetails((current) => withClientGameDetails(event.state.details, current)); setHistory(event.state.transactions); return; }
  if (event.type === 'LOBBY_UPDATED') { setDetails((current) => current === null ? current : { ...current, game: event.details.game, players: event.details.players }); return; }
  if (event.type === 'GAME_COMMITTED') { historyCache.current.clear(); setDetails((current) => current === null ? current : { ...current, players: event.players }); setHistory((current) => current === null ? current : [event.transaction, ...current.filter((transaction) => transaction.id !== event.transaction.id)]); return; }
  if (event.type === 'GAME_FINISHED') setDetails((current) => withClientGameDetails(event.details, current));
}

function withClientGameDetails(details: GameDetails, current: GameDetails | null): GameDetails {
  return current === null ? details : { ...details, canManage: current.canManage, joinCode: current.joinCode, controlledWallets: details.controlledWallets ?? current.controlledWallets, controlledPlayerIds: details.controlledPlayerIds ?? current.controlledPlayerIds };
}

function controllerLabel(kind: PlayerControllerKind, t: Translate): string { return kind === 'PRIMARY' ? t('primaryWallet') : t('localWallet'); }

function PlayerPicker({ label, players, gamePlayers, value, currency, onChange }: { label: string; players: Player[]; gamePlayers: Player[]; value: string; currency: Currency; onChange: (id: string) => void }) {
  return <fieldset className="player-picker"><legend>{label}</legend><div>{players.map((candidate) => <button className={`player-choice${value === candidate.id ? ' selected' : ''}`} type="button" key={candidate.id} aria-pressed={value === candidate.id} onClick={() => onChange(candidate.id)}><span className="player-color" style={{ backgroundColor: candidate.color }} /><span>{playerNameWithGameId(candidate, gamePlayers)}</span><small>{formatMoney(candidate.balance, currency)}</small></button>)}</div></fieldset>;
}

function Confirmation({ action, player, target, amount, passGoReward, currency, preview, comment }: { action: ActionType; player: Player; target: Player | null; amount: number; passGoReward: number; currency: Currency; preview: { player: Player; after: number; delta: number }[]; comment: string }) {
  const { t } = useLanguage();
  const total = action === 'PLAYER_TO_ALL' || action === 'ALL_TO_PLAYER' ? amount * (preview.length - 1) : action === 'PASS_GO' ? passGoReward : amount;
  const resultingBalance = preview.find(({ player: affected }) => affected.id === player.id)?.after ?? player.balance;
  return <section className="confirmation"><dl><div><dt>{t('actor')}</dt><dd>{player.name}</dd></div><div><dt>{t('operation')}</dt><dd>{transactionLabel(action, t)}</dd></div><div><dt>{t('source')}</dt><dd>{sourceFor(action, player, t)}</dd></div><div><dt>{t('destination')}</dt><dd>{destinationFor(action, player, target, t)}</dd></div><div><dt>{t('amount')}</dt><dd>{formatMoney(action === 'PASS_GO' ? passGoReward : amount, currency)}{action === 'PLAYER_TO_ALL' || action === 'ALL_TO_PLAYER' ? ` ${t('perPlayer')}` : ''}</dd></div><div><dt>{t('total')}</dt><dd>{formatMoney(total, currency)}</dd></div><div className="confirmation-available"><dt>{t('resultingAvailableBalance')}</dt><dd>{formatMoney(resultingBalance, currency)}</dd></div>{comment.trim() !== '' && <div><dt>{t('comment')}</dt><dd>{comment.trim()}</dd></div>}</dl><h3>{t('resultingBalances')}</h3><ul className="balance-preview">{preview.map(({ player: affected, after, delta }) => <li key={affected.id}><span><i style={{ backgroundColor: affected.color }} />{affected.name}</span><strong>{formatMoney(after, currency)} <small>({formatMoneyDelta(delta, currency)})</small></strong></li>)}</ul></section>;
}

function buildRequest(action: ActionType, playerId: string, targetId: string, amount: number, comment: string): CreateTransactionRequest | null {
  const optionalComment = comment.trim() === '' ? {} : { comment: comment.trim() };
  switch (action) {
    case 'PLAYER_TO_PLAYER': return targetId === '' ? null : { type: action, sourcePlayerId: playerId, destinationPlayerId: targetId, amount, ...optionalComment };
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
      case 'PLAYER_TO_PLAYER': if (player.id === request.sourcePlayerId) delta = -request.amount; if (player.id === request.destinationPlayerId) delta = request.amount; break;
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
  return ({ PLAYER_TO_PLAYER: t('payPlayer'), PLAYER_TO_BANK: t('payBank'), BANK_TO_PLAYER: t('bankPayment'), PLAYER_TO_ALL: t('payEveryone'), ALL_TO_PLAYER: t('everyonePaysMe'), PASS_GO: t('passGo') })[type];
}

function actionDescription(action: ActionType, name: string, t: Translate): string {
  const key = ({ PLAYER_TO_PLAYER: 'actionPayPlayer', PLAYER_TO_BANK: 'actionPayBank', BANK_TO_PLAYER: 'actionReceiveBank', PLAYER_TO_ALL: 'actionPayEveryone', ALL_TO_PLAYER: 'actionEveryonePays', PASS_GO: 'actionPassGo' } as const)[action];
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
  if (action === 'PLAYER_TO_PLAYER') return target?.name ?? t('selectedPlayer');
  return player.name;
}

function transactionLabel(type: TransactionType, t: Translate): string {
  return ({ PLAYER_TO_PLAYER: t('playerPayment'), PLAYER_TO_BANK: t('paidBank'), BANK_TO_PLAYER: t('receivedFromBank'), PLAYER_TO_ALL: t('paidEveryone'), ALL_TO_PLAYER: t('everyonePaidPlayer'), PAY_RENT: t('paidRent'), PASS_GO: t('passedGo'), BANKRUPTCY_TRANSFER: t('bankruptcyTransfer') })[type];
}

function isPositiveInteger(value: string) { return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0; }

function InviteDialog({ gameId, onClose }: { gameId: string; onClose: () => void }) {
  const { locale, t } = useLanguage();
  const [invite, setInvite] = useState<CreateInvitationResponse | null>(null); const [error, setError] = useState<unknown>(null); const [creating, setCreating] = useState(false); const [copied, setCopied] = useState(false); const [revoked, setRevoked] = useState(false);
  const create = async () => {
    if (window.location.protocol !== 'https:') { setError(new Error('HTTPS_REQUIRED')); return; }
    setCreating(true); setError(null); setRevoked(false);
    try { setInvite(await monopolyBankApi.createInvitation(gameId)); } catch (caught) { setError(caught); } finally { setCreating(false); }
  };
  const link = invite === null ? null : `${window.location.origin}/games/join#invite=${encodeURIComponent(invite.invitationToken)}`;
  const copy = async () => { if (link === null) return; if (navigator.clipboard !== undefined) await navigator.clipboard.writeText(link); else window.prompt(t('copyInviteLink'), link); setCopied(true); };
  const share = async () => { if (link !== null && typeof navigator.share === 'function') await navigator.share({ title: t('invitePlayers'), text: t('inviteShareText'), url: link }); };
  const revoke = async () => { setCreating(true); setError(null); try { await monopolyBankApi.revokeInvitations(gameId); setInvite(null); setRevoked(true); } catch (caught) { setError(caught); } finally { setCreating(false); } };
  const qr = link === null ? null : createLocalQr(link);
  return <Dialog title={t('invitePlayers')} closeLabel={t('closeDialog', { title: t('invitePlayers') })} onClose={onClose}><p className="dialog-intro">{t('inviteDescription')}</p>{invite === null ? <button className="button button-primary" type="button" disabled={creating} onClick={() => void create()}>{creating ? t('pleaseWait') : revoked ? t('createNewInvite') : t('createInviteLink')}</button> : <section className="invite-ticket"><div className="invite-ticket-copy"><span className="status-pill">{t('inviteUnlisted')}</span><p className="invite-short-code">{invite.shortCode}</p><p>{t('inviteExpiresAt', { time: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(invite.expiresAt)) })}</p></div>{qr !== null && <LocalQr matrix={qr} label={t('inviteQrLabel')} />}<div className="dialog-actions"><button className="button button-primary" type="button" onClick={() => void copy()}>{t('copyInviteLink')}</button>{typeof navigator.share === 'function' && <button className="button button-secondary" type="button" onClick={() => void share()}>{t('shareInvite')}</button>}<button className="button button-secondary" type="button" disabled={creating} onClick={() => void create()}>{t('rotateInvite')}</button><button className="button button-danger" type="button" disabled={creating} onClick={() => void revoke()}>{t('revokeInvite')}</button></div>{copied && <p className="notice notice-success" role="status">{t('inviteLinkCopied')}</p>}</section>}{revoked && <p className="notice notice-success" role="status">{t('inviteRevoked')}</p>}{error !== null && <p className="notice notice-error" role="alert">{error instanceof Error && error.message === 'HTTPS_REQUIRED' ? t('inviteRequiresHttps') : apiErrorMessage(error, t, 'unableJoinGame')}</p>}</Dialog>;
}

function FinishGameDialog({ gameId, players, currency, onFinished, onClose }: { gameId: string; players: Player[]; currency: Currency; onFinished: (details: GameDetails) => void; onClose: () => void }) {
  const { t } = useLanguage(); const [winnerIds, setWinnerIds] = useState<string[]>([]); const [saving, setSaving] = useState(false); const [error, setError] = useState(false); const leader = [...players].sort((a, b) => b.balance - a.balance || a.id.localeCompare(b.id))[0];
  const toggle = (id: string) => setWinnerIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const finish = async () => { setSaving(true); setError(false); try { onFinished(await monopolyBankApi.finishGame(gameId, { winnerPlayerIds: winnerIds })); } catch { setError(true); setSaving(false); } };
  return <Dialog title={t('finishGame')} closeLabel={t('closeDialog', { title: t('finishGame') })} onClose={onClose} closeDisabled={saving}><p className="dialog-intro">{t('finishGameDescription')}</p><p className="muted">{t('finishWinnerHint')}</p>{leader !== undefined && <p className="cash-leader-inline"><strong>{t('cashLeader')}:</strong> {leader.name} · {formatMoney(leader.balance, currency)}</p>}<fieldset className="winner-picker"><legend>{t('chooseWinners')}</legend>{players.map((player) => <label key={player.id}><input type="checkbox" checked={winnerIds.includes(player.id)} onChange={() => toggle(player.id)} /> <i style={{ backgroundColor: player.color }} /> {player.name}</label>)}</fieldset>{error && <p className="notice notice-error" role="alert">{t('unableLoadGame')}</p>}<div className="dialog-actions"><button className="button button-secondary" type="button" disabled={saving} onClick={onClose}>{t('cancel')}</button><button className="button button-quiet" type="button" disabled={saving} onClick={() => { setWinnerIds([]); void finish(); }}>{t('finishNoWinner')}</button><button className="button button-danger" type="button" disabled={saving} onClick={() => void finish()}>{t('finishGame')}</button></div></Dialog>;
}

function LocalQr({ matrix, label }: { matrix: boolean[][]; label: string }) {
  const size = matrix.length;
  return <svg className="invite-qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>{matrix.map((row, y) => row.map((dark, x) => dark && <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />))}</svg>;
}

export function GameSummaryScreen({ summary, players, currency, onClose }: { summary: ({ game: Game; winners: Player[] } & FinalGameSummary); players: Player[]; currency: Currency; onClose: () => void }) {
  const { t } = useLanguage();
  const winnerIds = new Set(summary.winners.map((player) => player.id));
  const metrics = new Map(summary.players.map((metric) => [metric.playerId, metric]));
  const nameFor = (id: string | null) => id === null ? t('notDecided') : players.find((player) => player.id === id)?.name ?? t('notDecided');
  const cards = [[t('totalTransferred'), summary.totalMoneyTransferred], [t('playerToPlayerTransferred'), summary.playerToPlayerTotal], [t('paidToBank'), summary.paidToBank], [t('summaryReceivedFromBank'), summary.receivedFromBank], [t('largestTransaction'), summary.largestTransaction]] as const;
  return <section className="banknote-panel summary-screen"><header className="summary-heading"><div><p className="eyebrow">{t('finalSummary')}</p><h2>{summary.game.name}</h2><p><strong>{t('winners')}:</strong> {summary.winners.length === 0 ? t('notDecided') : summary.winners.map((player) => player.name).join(', ')}</p></div><button className="button button-quiet" type="button" onClick={onClose}>{t('close')}</button></header><dl className="summary-metrics">{cards.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{formatMoney(value, currency)}</dd></div>)}</dl><dl className="summary-extremes"><div><dt>{t('highestSender')}</dt><dd>{nameFor(summary.biggestSenderId)}</dd></div><div><dt>{t('lowestSender')}</dt><dd>{nameFor(summary.leastSenderId)}</dd></div></dl><section><h3>{t('playerResults')}</h3><ol className="summary-player-results">{players.map((player) => { const metric = metrics.get(player.id); const outcome = player.status === 'BANKRUPT' ? t('bankrupt') : winnerIds.has(player.id) ? t('winner') : t('lost'); return <li key={player.id} style={{ borderInlineStartColor: player.color }}><div><strong>{player.name}</strong><span>{outcome}</span></div><dl><div><dt>{t('finalBalance')}</dt><dd>{formatMoney(player.balance, currency)}</dd></div><div><dt>{t('sent')}</dt><dd>{formatMoney(metric?.sent ?? 0, currency)}</dd></div><div><dt>{t('received')}</dt><dd>{formatMoney(metric?.received ?? 0, currency)}</dd></div></dl></li>; })}</ol></section></section>;
}

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
  if (action === 'PLAYER_TO_PLAYER' || action === 'PLAYER_TO_BANK') {
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
