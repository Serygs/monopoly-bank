import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameDetails, LedgerStatistics, PaymentRequest } from '../../shared/contracts/api';
import type { Game, Player, Transaction } from '../../shared/types/monopoly';
import { ActivityScreen } from './ActivityScreen';
import { StatisticsScreen } from './StatisticsScreen';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { DiceRoller } from '../components/DiceRoller';
import { TableCalculator } from '../components/TableCalculator';
import { Dialog } from '../components/Dialog';
import { GameBottomNav } from '../components/game/GameBottomNav';
import { cx } from '../components/ui/class-names';
import { Button, Notice, PageShell, StatPill, useFeedback } from '../components/ui';
import type { DevicePreferences } from '../utils/preferences';
import { useWakeLock } from '../hooks/useWakeLock';
import { playPaymentFeedback, vibrate } from '../utils/feedback';
import { apiErrorMessage } from '../i18n/api-errors';
import { useLanguage } from '../i18n/language-context';
import { isLiveServerEvent } from '../../shared/contracts/live';
import { canReverseTransaction } from '../../shared/domain/reversal';
import { acceptsLiveVersion } from '../utils/live-version';
import { BankingDialog } from './game/BankingDialog';
import { BankruptcyDialog } from './game/BankruptcyDialog';
import { FinishGameDialog } from './game/FinishGameDialog';
import { GameHeader, type LiveStatus } from './game/GameHeader';
import { HistoryDialog } from './game/HistoryDialog';
import { ReverseTransactionDialog } from './game/ReverseTransactionDialog';
import { InviteDialog } from './game/InviteDialog';
import { PaymentInbox } from './game/PaymentInbox';
import { WalletsSection } from './game/WalletsSection';
import {
  applyLiveEvent,
  filterTransactionsForPlayer,
  withClientGameDetails,
} from './game/game-page-helpers';

/** The lobby banner sits further from the wallets than a plain notice; `!` beats Notice's margin. */
const stateBannerClass = 'mb-(--mb-space-6)!';

/** Keeps content clear of the compact bottom navigation and the home indicator. */
const navPaddingClass = 'max-md:pb-[calc(88px+var(--mb-app-safe-bottom))]';

/** Dice and calculator: stacked below `md`, side by side from `md`. */
const gameToolsClass =
  'mt-[24px] grid grid-cols-1 gap-(--mb-space-4) md:grid-cols-2 md:gap-(--mb-layout-gap-medium) lg:gap-(--mb-layout-gap-wide)';

interface Props {
  gameId: string;
  onBack: () => void;
  preferences: DevicePreferences;
  offline: boolean;
  onPaymentFlowChange: (open: boolean) => void;
}

export function GamePage({ gameId, onBack, preferences, offline, onPaymentFlowChange }: Props) {
  const { language, locale, t } = useLanguage();
  const [details, setDetails] = useState<GameDetails | null>(null);
  const [error, setError] = useState<unknown | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [history, setHistory] = useState<Transaction[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reversing, setReversing] = useState<Transaction | null>(null);
  const [historyPlayer, setHistoryPlayer] = useState<Player | null>(null);
  const [historyError, setHistoryError] = useState<unknown | null>(null);
  const historyCache = useRef(new Map<string, Transaction[]>());
  const historyPlayerId = useRef<string | null>(null);
  const notify = useFeedback();
  const [summary, setSummary] = useState<
    ({ game: Game; winners: Player[] } & LedgerStatistics) | null
  >(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [statisticsOpen, setStatisticsOpen] = useState(false);
  const [bankruptPlayer, setBankruptPlayer] = useState<Player | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [activeWalletId, setActiveWalletId] = useState<string | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('connecting');
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequest[]>([]);
  const [liveTransactions, setLiveTransactions] = useState<Transaction[]>([]);
  const lastAppliedVersion = useRef(0);
  useEffect(() => {
    onPaymentFlowChange(selectedPlayer !== null || bankruptPlayer !== null);
    return () => onPaymentFlowChange(false);
  }, [selectedPlayer, bankruptPlayer, onPaymentFlowChange]);

  useEffect(() => {
    let active = true;
    void monopolyBankApi.getGame(gameId).then(
      (game) => {
        if (active) setDetails(game);
      },
      (caught: unknown) => {
        if (active) setError(caught);
      },
    );
    return () => {
      active = false;
    };
  }, [gameId]);

  const loadPaymentRequests = useCallback(
    () =>
      void monopolyBankApi.listPaymentRequests(gameId).then(setPaymentRequests, () => undefined),
    [gameId],
  );
  useEffect(() => {
    if (details?.game.status === 'ACTIVE' && !offline) loadPaymentRequests();
  }, [details?.game.status, loadPaymentRequests, offline]);

  useWakeLock(preferences.keepScreenAwake && details?.game.status === 'ACTIVE');

  const shouldConnectLive = details !== null && details.game.status !== 'FINISHED' && !offline;
  useEffect(() => {
    if (!shouldConnectLive) return;
    let closed = false;
    let retry: number | undefined;
    let heartbeat: number | undefined;
    let socket: WebSocket | null = null;
    let attempts = 0;
    const connect = () => {
      if (closed) return;
      setLiveStatus(attempts === 0 ? 'connecting' : 'reconnecting');
      const url = new URL(`/api/games/${encodeURIComponent(gameId)}/live`, window.location.origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const nextSocket = new WebSocket(url);
      socket = nextSocket;
      nextSocket.onopen = () => {
        if (socket === nextSocket) {
          attempts = 0;
          setLiveStatus('live');
          heartbeat = window.setInterval(() => {
            if (nextSocket.readyState === WebSocket.OPEN)
              nextSocket.send(JSON.stringify({ type: 'HEARTBEAT' }));
          }, 20_000);
        }
      };
      nextSocket.onmessage = (message) => {
        if (socket !== nextSocket) return;
        try {
          const event: unknown = JSON.parse(String(message.data));
          if (!isLiveServerEvent(event)) return;
          if (event.type === 'GAME_SNAPSHOT') {
            lastAppliedVersion.current = event.state.stateVersion;
            applyLiveEvent(event, setDetails, setHistory, historyCache, historyPlayerId.current);
            return;
          }
          if (!acceptsLiveVersion(lastAppliedVersion.current, event.stateVersion)) {
            nextSocket.close(4001, 'State version gap: resync required.');
            return;
          }
          if (event.stateVersion > lastAppliedVersion.current)
            lastAppliedVersion.current = event.stateVersion;
          applyLiveEvent(event, setDetails, setHistory, historyCache, historyPlayerId.current);
          if (event.type === 'GAME_COMMITTED')
            setLiveTransactions((current) =>
              [
                event.transaction,
                ...current.filter((item) => item.id !== event.transaction.id),
              ].slice(0, 50),
            );
          if (event.type === 'PAYMENT_REQUESTS_UPDATED') loadPaymentRequests();
        } catch {
          /* Ignore malformed network data. */
        }
      };
      nextSocket.onclose = () => {
        if (heartbeat !== undefined) {
          window.clearInterval(heartbeat);
          heartbeat = undefined;
        }
        if (closed || socket !== nextSocket) return;
        setLiveStatus('offline');
        attempts += 1;
        const base = Math.min(1000 * 2 ** (attempts - 1), 10_000);
        retry = window.setTimeout(connect, Math.round(base * (0.7 + Math.random() * 0.6)));
      };
      nextSocket.onerror = () => {
        if (socket === nextSocket) nextSocket.close();
      };
    };
    connect();
    return () => {
      closed = true;
      if (retry !== undefined) window.clearTimeout(retry);
      if (heartbeat !== undefined) window.clearInterval(heartbeat);
      socket?.close();
    };
  }, [gameId, loadPaymentRequests, shouldConnectLive]);

  const loadHistory = async (player: Player | null = null) => {
    const scope = player === null ? 'all' : `player:${player.id}`;
    historyPlayerId.current = player?.id ?? null;
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
      const playerTransactions = filterTransactionsForPlayer(allTransactions, player.id);
      historyCache.current.set(scope, playerTransactions);
      setHistory(playerTransactions);
      return;
    }
    setHistory(null);
    try {
      const transactions =
        player === null
          ? await monopolyBankApi.listTransactions(gameId)
          : await monopolyBankApi.listPlayerTransactions(gameId, player.id);
      historyCache.current.set(scope, transactions);
      setHistory(transactions);
    } catch (caught) {
      setHistoryError(caught);
    }
  };

  const openStatistics = () =>
    void monopolyBankApi.getGameSummary(gameId).then((result) => {
      setSummary(result);
      setStatisticsOpen(true);
    });

  if (error !== null) {
    return (
      <PageShell>
        <Notice tone="error" as="section">
          <p>{apiErrorMessage(error, t, 'unableLoadGame')}</p>
          <Button variant="secondary" onClick={onBack}>
            {t('savedGames')}
          </Button>
        </Notice>
      </PageShell>
    );
  }
  if (details === null) {
    return (
      <PageShell>
        <StatPill variant="status" live>
          {t('loadingGame')}
        </StatPill>
      </PageShell>
    );
  }
  const controlledWallets = details.controlledWallets ?? [];
  const activeControlledWalletId = controlledWallets.some(
    (wallet) => wallet.playerId === activeWalletId,
  )
    ? activeWalletId
    : (controlledWallets[0]?.playerId ?? null);
  const activeWallet =
    details.players.find((player) => player.id === activeControlledWalletId) ?? null;
  const otherPlayers = details.players
    .filter((player) => player.id !== activeWallet?.id)
    .sort((a, b) => Number(a.status === 'BANKRUPT') - Number(b.status === 'BANKRUPT'));
  const canMutate = details.game.status === 'ACTIVE' && !offline;
  const showNav = details.game.status !== 'LOBBY';
  const confirmationMode = details.game.paymentMode === 'CONFIRMATION';
  // A loan request always waits for the lender, whatever the payment mode.
  const inboxRequests = confirmationMode
    ? paymentRequests
    : paymentRequests.filter((request) => request.kind === 'LOAN');
  /** The owner may reverse anything; a player only their own recent transactions (the Worker checks too). */
  const canReverse = (transaction: Transaction): boolean =>
    canMutate &&
    canReverseTransaction({
      transaction,
      isOwner: details.canManage === true,
      controlledPlayerIds: details.controlledPlayerIds ?? [],
      now: Date.now(),
    });

  return (
    <PageShell className={showNav ? navPaddingClass : undefined}>
      <GameHeader
        game={details.game}
        canManage={details.canManage}
        liveStatus={liveStatus}
        offline={offline}
        onBack={onBack}
        onOpenActivity={() => setActivityOpen(true)}
        onOpenStatistics={openStatistics}
        onInvite={() => setInviteOpen(true)}
        onFinish={() => setFinishing(true)}
      />
      {details.game.status === 'LOBBY' && (
        <Notice tone="success" as="section" className={stateBannerClass}>
          <p>
            {t('waitingForPlayers')} — {t('startGameHint')}
          </p>
          {details.canManage && (
            <Button
              variant="primary"
              disabled={offline || details.players.length < 2}
              onClick={() => void monopolyBankApi.startGame(gameId).then(setDetails)}
            >
              {t('startGame')}
            </Button>
          )}
        </Notice>
      )}
      <WalletsSection
        players={details.players}
        currency={details.game.currency}
        controlledWallets={controlledWallets}
        activeControlledWalletId={activeControlledWalletId}
        activeWallet={activeWallet}
        otherPlayers={otherPlayers}
        canMutate={canMutate}
        loans={details.game.rules.playerLoans ? (details.loans ?? []) : []}
        onSelectWallet={setActiveWalletId}
        onOpenWallet={setSelectedPlayer}
      />
      {canMutate && (confirmationMode || inboxRequests.length > 0) && (
        <PaymentInbox
          requests={inboxRequests}
          players={details.players}
          currency={details.game.currency}
          onAction={async (request, action) => {
            const commandId = crypto.randomUUID();
            const result =
              action === 'accept'
                ? await monopolyBankApi.acceptPaymentRequest(gameId, request.id, commandId)
                : await monopolyBankApi.declinePaymentRequest(gameId, request.id, commandId);
            setPaymentRequests((current) => current.filter((item) => item.id !== request.id));
            if (result.transaction !== undefined) {
              historyCache.current.clear();
              playPaymentFeedback(preferences.sound);
              vibrate(35, preferences.vibration);
              setDetails((current) =>
                current === null
                  ? current
                  : {
                      ...current,
                      players: result.players,
                      ...(result.loans === undefined ? {} : { loans: result.loans }),
                    },
              );
            }
          }}
        />
      )}
      {details.game.status === 'ACTIVE' && (
        <div className={cx(gameToolsClass, 'max-md:hidden')}>
          <DiceRoller
            gameId={gameId}
            players={details.players}
            rollerPlayerId={activeWallet?.id ?? null}
          />
          <TableCalculator />
        </div>
      )}
      {toolsOpen && details.game.status === 'ACTIVE' && (
        <Dialog
          title={t('navTools')}
          closeLabel={t('closeDialog', { title: t('navTools') })}
          onClose={() => setToolsOpen(false)}
        >
          <div className="mt-(--mb-space-4) grid gap-(--mb-space-4)">
            <DiceRoller
              gameId={gameId}
              players={details.players}
              rollerPlayerId={activeWallet?.id ?? null}
            />
            <TableCalculator />
          </div>
        </Dialog>
      )}
      {showNav && (
        <GameBottomNav
          pendingRequests={canMutate ? inboxRequests.length : 0}
          payDisabled={!canMutate || activeWallet === null || activeWallet.status === 'BANKRUPT'}
          activityDisabled={offline}
          toolsDisabled={details.game.status !== 'ACTIVE'}
          onOpenTools={() => setToolsOpen(true)}
          onPay={() => {
            if (activeWallet !== null) setSelectedPlayer(activeWallet);
          }}
          onOpenActivity={() => setActivityOpen(true)}
          onOpenStatistics={openStatistics}
        />
      )}
      {activityOpen && (
        <ActivityScreen
          gameId={gameId}
          players={details.players}
          currency={details.game.currency}
          liveTransactions={liveTransactions}
          showPending={confirmationMode}
          onClose={() => setActivityOpen(false)}
        />
      )}
      {statisticsOpen && summary !== null && (
        <StatisticsScreen
          summary={summary}
          currency={details.game.currency}
          onClose={() => setStatisticsOpen(false)}
        />
      )}
      {selectedPlayer !== null && (
        <BankingDialog
          gameId={gameId}
          player={selectedPlayer}
          players={details.players}
          passGoReward={details.game.passGoReward}
          currency={details.game.currency}
          startingBalance={details.game.startingBalance}
          rules={details.game.rules}
          settings={details.game.settings}
          mortgages={details.mortgages ?? []}
          loans={details.loans ?? []}
          favoriteAmounts={details.favoriteAmounts ?? []}
          recentAmounts={details.recentAmounts ?? []}
          onToggleFavorite={(amount) =>
            void monopolyBankApi
              .toggleFavoriteAmount(gameId, amount)
              .then((favoriteAmounts) =>
                setDetails((current) =>
                  current === null ? current : { ...current, favoriteAmounts },
                ),
              )
          }
          onClose={() => setSelectedPlayer(null)}
          onBankrupt={() => {
            setBankruptPlayer(selectedPlayer);
            setSelectedPlayer(null);
          }}
          onViewHistory={(player) => {
            setSelectedPlayer(null);
            void loadHistory(player);
          }}
          onCompleted={(players, action, amount, mortgages, loans) => {
            historyCache.current.clear();
            playPaymentFeedback(preferences.sound);
            vibrate(35, preferences.vibration);
            setDetails({
              ...details,
              players,
              ...(mortgages === undefined ? {} : { mortgages }),
              ...(loans === undefined ? {} : { loans }),
              recentAmounts:
                amount === null
                  ? details.recentAmounts
                  : [
                      amount,
                      ...(details.recentAmounts ?? []).filter((value) => value !== amount),
                    ].slice(0, 5),
            });
            setSelectedPlayer(null);
            notify({
              tone: 'success',
              message: t(
                action === 'MORTGAGE'
                  ? 'mortgageRecorded'
                  : action === 'MORTGAGE_REDEMPTION'
                    ? 'redemptionRecorded'
                    : action === 'LOAN_REPAYMENT'
                      ? 'loanRepaid'
                      : 'paymentSent',
              ),
            });
          }}
          onPaymentRequested={(action, lenderName) => {
            loadPaymentRequests();
            setSelectedPlayer(null);
            notify({
              tone: 'success',
              message:
                action === 'LOAN_ISSUE'
                  ? t('loanRequestSent', { name: lenderName ?? t('playerFallback') })
                  : t('paymentRequestCreated'),
            });
          }}
        />
      )}
      {bankruptPlayer !== null && (
        <BankruptcyDialog
          gameId={gameId}
          player={bankruptPlayer}
          players={details.players}
          onClose={() => setBankruptPlayer(null)}
          onCompleted={(players, mortgages) => {
            historyCache.current.clear();
            setDetails({
              ...details,
              players,
              ...(mortgages === undefined ? {} : { mortgages }),
            });
            setBankruptPlayer(null);
          }}
        />
      )}
      {inviteOpen && <InviteDialog gameId={gameId} onClose={() => setInviteOpen(false)} />}
      {finishing && (
        <FinishGameDialog
          players={details.players}
          currency={details.game.currency}
          gameId={gameId}
          onFinished={(finished) => {
            setDetails((current) => withClientGameDetails(finished, current));
            setFinishing(false);
          }}
          onClose={() => setFinishing(false)}
        />
      )}
      {historyOpen && (
        <HistoryDialog
          history={history}
          player={historyPlayer}
          players={details.players}
          currency={details.game.currency}
          error={historyError}
          language={language}
          locale={locale}
          onClose={() => {
            historyPlayerId.current = null;
            setHistoryOpen(false);
            setHistory(null);
            setHistoryError(null);
          }}
          onRetry={() => void loadHistory(historyPlayer)}
          canReverse={canReverse}
          onReverse={setReversing}
        />
      )}
      {reversing !== null && (
        <ReverseTransactionDialog
          gameId={gameId}
          transaction={reversing}
          players={details.players}
          currency={details.game.currency}
          language={language}
          onClose={() => setReversing(null)}
          onReversed={(players) => {
            historyCache.current.clear();
            setDetails({ ...details, players });
            setReversing(null);
            void loadHistory(historyPlayer);
            notify({ tone: 'success', message: t('reversalRecorded') });
          }}
        />
      )}
    </PageShell>
  );
}
