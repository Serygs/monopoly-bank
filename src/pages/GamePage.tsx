import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameDetails, LedgerStatistics, PaymentRequest } from '../../shared/contracts/api';
import type { Game, Player, Transaction } from '../../shared/types/monopoly';
import { ActivityScreen } from './ActivityScreen';
import { StatisticsScreen } from './StatisticsScreen';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { DiceRoller } from '../components/DiceRoller';
import { TableCalculator } from '../components/TableCalculator';
import { Button, Notice, PageShell, StatPill } from '../components/ui';
import type { DevicePreferences } from '../utils/preferences';
import { playPaymentFeedback, vibrate } from '../utils/feedback';
import { apiErrorMessage } from '../i18n/api-errors';
import { useLanguage } from '../i18n/language-context';
import { isLiveServerEvent } from '../../shared/contracts/live';
import { acceptsLiveVersion } from '../utils/live-version';
import { BankingDialog } from './game/BankingDialog';
import { BankruptcyDialog } from './game/BankruptcyDialog';
import { FinishGameDialog } from './game/FinishGameDialog';
import { GameHeader, type LiveStatus } from './game/GameHeader';
import { HistoryDialog } from './game/HistoryDialog';
import { InviteDialog } from './game/InviteDialog';
import { PaymentInbox } from './game/PaymentInbox';
import { WalletsSection } from './game/WalletsSection';
import {
  actionLabel,
  applyLiveEvent,
  withClientGameDetails,
  type ActionType,
} from './game/game-page-helpers';

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
  const [historyPlayer, setHistoryPlayer] = useState<Player | null>(null);
  const [historyError, setHistoryError] = useState<unknown | null>(null);
  const historyCache = useRef(new Map<string, Transaction[]>());
  const [notice, setNotice] = useState<ActionType | null>(null);
  const [summary, setSummary] = useState<
    ({ game: Game; winners: Player[] } & LedgerStatistics) | null
  >(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [statisticsOpen, setStatisticsOpen] = useState(false);
  const [bankruptPlayer, setBankruptPlayer] = useState<Player | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [activeWalletId, setActiveWalletId] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('connecting');
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequest[]>([]);
  const [paymentRequestNotice, setPaymentRequestNotice] = useState(false);
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

  useEffect(() => {
    if (details?.game.status !== 'ACTIVE' || offline) {
      return;
    }
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
            applyLiveEvent(event, setDetails, setHistory, historyCache);
            return;
          }
          if (!acceptsLiveVersion(lastAppliedVersion.current, event.stateVersion)) {
            nextSocket.close(4001, 'State version gap: resync required.');
            return;
          }
          if (event.stateVersion > lastAppliedVersion.current)
            lastAppliedVersion.current = event.stateVersion;
          applyLiveEvent(event, setDetails, setHistory, historyCache);
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
      const playerTransactions = allTransactions.filter((transaction) =>
        transaction.participants.some((participant) => participant.playerId === player.id),
      );
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
  const otherPlayers = details.players.filter((player) => player.id !== activeWallet?.id);
  const canMutate = details.game.status === 'ACTIVE' && !offline;

  return (
    <PageShell className="game-page">
      <GameHeader
        game={details.game}
        canManage={details.canManage}
        liveStatus={liveStatus}
        offline={offline}
        onBack={onBack}
        onOpenActivity={() => setActivityOpen(true)}
        onOpenStatistics={() =>
          void monopolyBankApi.getGameSummary(gameId).then((result) => {
            setSummary(result);
            setStatisticsOpen(true);
          })
        }
        onInvite={() => setInviteOpen(true)}
        onFinish={() => setFinishing(true)}
      />
      {details.game.status === 'LOBBY' && (
        <Notice tone="success" as="section" className="game-state-banner">
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
      {notice !== null && (
        <Notice tone="success" as="section">
          <p>{t('recorded', { action: actionLabel(notice, t) })}</p>
          <Button variant="quiet" onClick={() => setNotice(null)}>
            {t('dismiss')}
          </Button>
        </Notice>
      )}
      {paymentRequestNotice && (
        <Notice tone="success" as="section">
          <p>{t('paymentRequestCreated')}</p>
          <Button variant="quiet" onClick={() => setPaymentRequestNotice(false)}>
            {t('dismiss')}
          </Button>
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
        onSelectWallet={setActiveWalletId}
        onOpenWallet={setSelectedPlayer}
      />
      {canMutate && (
        <PaymentInbox
          requests={paymentRequests}
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
                current === null ? current : { ...current, players: result.players },
              );
            }
          }}
        />
      )}
      {details.game.status === 'ACTIVE' && (
        <div className="game-tools">
          <DiceRoller />
          <TableCalculator />
        </div>
      )}
      {activityOpen && (
        <ActivityScreen
          gameId={gameId}
          players={details.players}
          currency={details.game.currency}
          liveTransactions={liveTransactions}
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
          onCompleted={(players, action, amount) => {
            historyCache.current.clear();
            playPaymentFeedback(preferences.sound);
            vibrate(35, preferences.vibration);
            setDetails({
              ...details,
              players,
              recentAmounts:
                amount === null
                  ? details.recentAmounts
                  : [
                      amount,
                      ...(details.recentAmounts ?? []).filter((value) => value !== amount),
                    ].slice(0, 5),
            });
            setSelectedPlayer(null);
            setNotice(action);
          }}
          onPaymentRequested={() => {
            loadPaymentRequests();
            setSelectedPlayer(null);
            setPaymentRequestNotice(true);
          }}
        />
      )}
      {bankruptPlayer !== null && (
        <BankruptcyDialog
          gameId={gameId}
          player={bankruptPlayer}
          players={details.players}
          onClose={() => setBankruptPlayer(null)}
          onCompleted={(players) => {
            historyCache.current.clear();
            setDetails({ ...details, players });
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
            setHistoryOpen(false);
            setHistory(null);
            setHistoryError(null);
          }}
          onRetry={() => void loadHistory(historyPlayer)}
        />
      )}
    </PageShell>
  );
}
