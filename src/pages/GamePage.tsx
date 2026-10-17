import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AuctionResponse,
  GameDetails,
  LedgerStatistics,
  PaymentRequest,
} from '../../shared/contracts/api';
import type { Game, Player, Transaction } from '../../shared/types/monopoly';
import { RulesScreen } from './RulesScreen';
import { ActivityScreen } from './ActivityScreen';
import { StatisticsScreen } from './StatisticsScreen';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { DiceRoller } from '../components/DiceRoller';
import { TableCalculator } from '../components/TableCalculator';
import { Dialog } from '../components/Dialog';
import { DialogNavContext } from '../components/dialog-nav-context';
import { formatMoney } from '../utils/money';
import { PropertyScreen } from './PropertyScreen';
import {
  cardsOwnedBy,
  cardsValue,
  mergeProperties,
  tileViews,
  type TileIntent,
} from '../utils/property-view';
import { GameBottomNav, type GameNavDestination } from '../components/game/GameBottomNav';
import { cx } from '../components/ui/class-names';
import { Button, Notice, PageShell, StatPill, useFeedback } from '../components/ui';
import type { DevicePreferences } from '../utils/preferences';
import { useWakeLock } from '../hooks/useWakeLock';
import { playPaymentFeedback, vibrate } from '../utils/feedback';
import { apiErrorMessage } from '../i18n/api-errors';
import { useLanguage } from '../i18n/language-context';
import { isLiveServerEvent } from '../../shared/contracts/live';
import { newerAuction } from '../utils/auction';
import { acceptsLiveVersion } from '../utils/live-version';
import { AuctionDialog } from './game/AuctionDialog';
import { BankingDialog } from './game/BankingDialog';
import { BankruptcyDialog } from './game/BankruptcyDialog';
import { FinishGameDialog } from './game/FinishGameDialog';
import { GameHeader, type LiveStatus } from './game/GameHeader';
import { ReverseTransactionDialog } from './game/ReverseTransactionDialog';
import { InviteDialog } from './game/InviteDialog';
import { PaymentInbox } from './game/PaymentInbox';
import { StartAuctionDialog } from './game/StartAuctionDialog';
import { WalletsSection } from './game/WalletsSection';
import {
  applyLiveEvent,
  type ActionType,
  splitPaymentRequests,
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
  const { language, t } = useLanguage();
  const [details, setDetails] = useState<GameDetails | null>(null);
  const [error, setError] = useState<unknown | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [reversing, setReversing] = useState<Transaction | null>(null);
  const [activityScope, setActivityScope] = useState<'ALL' | 'MINE'>('ALL');
  // Bumped after a reversal so the open Activity ledger reloads.
  const [activityVersion, setActivityVersion] = useState(0);
  const notify = useFeedback();
  const [summary, setSummary] = useState<
    ({ game: Game; winners: Player[] } & LedgerStatistics) | null
  >(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [statisticsOpen, setStatisticsOpen] = useState(false);
  const [propertyOpen, setPropertyOpen] = useState(false);
  const [bankruptPlayer, setBankruptPlayer] = useState<Player | null>(null);
  const [settleLoanOnOpen, setSettleLoanOnOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeError, setRemoveError] = useState<unknown>(null);
  const removePlayer = async (playerId: string) => {
    setRemoveError(null);
    try {
      setDetails(
        withClientGameDetails(await monopolyBankApi.removeLobbyPlayer(gameId, playerId), details),
      );
    } catch (caught) {
      setRemoveError(caught);
    }
  };
  const [activeWalletId, setActiveWalletId] = useState<string | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('connecting');
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequest[]>([]);
  const [liveTransactions, setLiveTransactions] = useState<Transaction[]>([]);
  const lastAppliedVersion = useRef(0);
  // The wallet putting a property up for auction, with the suggested name.
  const [auctionPrompt, setAuctionPrompt] = useState<{
    player: Player;
    lotName: string;
    tileId?: string;
  } | null>(null);
  // Board games: the property-sheet action that opened the wallet dialog, read once when it opens.
  const [walletIntent, setWalletIntent] = useState<{ action: ActionType; tileId: string } | null>(
    null,
  );
  // The auction (id and state) whose dialog the viewer closed, so it does not reopen by itself.
  const [dismissedAuction, setDismissedAuction] = useState<string | null>(null);
  // The quick-entry intent only lives while the wallet dialog it opened is open.
  if (selectedPlayer === null && walletIntent !== null) setWalletIntent(null);
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

  /** Applies an auction answer: the newest auction, and the balances when it settled a sale. */
  const applyAuctionResponse = useCallback((response: AuctionResponse) => {
    if (response.transaction !== undefined) {
      const settled = response.transaction;
      setLiveTransactions((current) =>
        [settled, ...current.filter((item) => item.id !== settled.id)].slice(0, 50),
      );
    }
    setDetails((current) =>
      current === null
        ? current
        : {
            ...current,
            ...(response.players === undefined ? {} : { players: response.players }),
            auction: newerAuction(current.auction ?? null, response.auction),
          },
    );
  }, []);
  const refreshAuction = useCallback(
    () => void monopolyBankApi.getAuction(gameId).then(applyAuctionResponse, () => undefined),
    [gameId, applyAuctionResponse],
  );
  // Without the socket nobody tells this device about bids, so ask every 2 seconds while one may run.
  const auctionPolling =
    details?.game.rules.auctions === true &&
    details.game.status === 'ACTIVE' &&
    !offline &&
    liveStatus !== 'live';
  useEffect(() => {
    if (!auctionPolling) return;
    const timer = window.setInterval(refreshAuction, 2000);
    return () => window.clearInterval(timer);
  }, [auctionPolling, refreshAuction]);

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
            applyLiveEvent(event, setDetails);
            return;
          }
          if (!acceptsLiveVersion(lastAppliedVersion.current, event.stateVersion)) {
            nextSocket.close(4001, 'State version gap: resync required.');
            return;
          }
          if (event.stateVersion > lastAppliedVersion.current)
            lastAppliedVersion.current = event.stateVersion;
          applyLiveEvent(event, setDetails);
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

  /** Closes the sheet behind the bottom navigation, so choosing another item replaces it. */
  const closeNavSheets = () => {
    setActivityOpen(false);
    setStatisticsOpen(false);
    setPropertyOpen(false);
    setToolsOpen(false);
    setSelectedPlayer(null);
  };
  const openStatistics = () =>
    void monopolyBankApi.getGameSummary(gameId).then((result) => {
      setSummary(result);
      closeNavSheets();
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
  // The list also holds requests the viewer's wallets made; only the incoming ones need an answer.
  const { incoming, outgoingLoans: outgoingLoanRequests } = splitPaymentRequests(
    paymentRequests,
    details.controlledPlayerIds ?? controlledWallets.map((wallet) => wallet.playerId),
  );
  // A loan request always waits for the lender, whatever the payment mode.
  const inboxRequests = confirmationMode
    ? incoming
    : incoming.filter((request) => request.kind === 'LOAN');
  const rules = details.game.rules;
  // Each rule only shows its own loans.
  const visibleLoans = (details.loans ?? []).filter((loan) =>
    loan.lenderKind === 'BANK' ? rules.bankLoans : rules.playerLoans,
  );
  // Board games only: the property registry of the viewer's wallets.
  const board = details.game.settings?.board ?? null;
  const properties = details.properties ?? [];
  const controlledIds =
    details.controlledPlayerIds ?? controlledWallets.map((wallet) => wallet.playerId);
  /** The property sheet's quick entry: the same wallet dialog and auction prompt as the wallet menu. */
  const startTileIntent = (intent: TileIntent) => {
    const wallet = details.players.find((candidate) => candidate.id === intent.playerId);
    if (wallet === undefined) return;
    setPropertyOpen(false);
    if (intent.kind === 'AUCTION') {
      setAuctionPrompt({ player: wallet, lotName: '', tileId: intent.tileId });
      return;
    }
    setWalletIntent({ action: intent.kind, tileId: intent.tileId });
    setSelectedPlayer(wallet);
  };
  const myCards = board === null ? [] : cardsOwnedBy(tileViews(board, properties), controlledIds);
  const activeNav: GameNavDestination | null = toolsOpen
    ? 'tools'
    : activityOpen
      ? 'activity'
      : statisticsOpen
        ? 'statistics'
        : propertyOpen
          ? 'property'
          : selectedPlayer !== null
            ? 'pay'
            : null;
  // Rendered on the page and again inside every open dialog (see `DialogNavContext`).
  const bottomNav = (
    <GameBottomNav
      active={activeNav}
      onClose={closeNavSheets}
      pendingRequests={canMutate ? inboxRequests.length : 0}
      property={
        board === null
          ? undefined
          : {
              count: myCards.length,
              onOpen: () => {
                closeNavSheets();
                setPropertyOpen(true);
              },
            }
      }
      payDisabled={!canMutate || activeWallet === null || activeWallet.status === 'BANKRUPT'}
      activityDisabled={offline}
      toolsDisabled={details.game.status !== 'ACTIVE'}
      onOpenTools={() => {
        closeNavSheets();
        setToolsOpen(true);
      }}
      onPay={() => {
        if (activeWallet === null) return;
        closeNavSheets();
        setSelectedPlayer(activeWallet);
      }}
      onOpenActivity={() => {
        closeNavSheets();
        setActivityOpen(true);
      }}
      onOpenStatistics={openStatistics}
    />
  );

  return (
    <DialogNavContext.Provider value={showNav ? bottomNav : null}>
      <PageShell className={showNav ? navPaddingClass : undefined}>
        <GameHeader
          game={details.game}
          jackpot={details.jackpot}
          canManage={details.canManage}
          liveStatus={liveStatus}
          offline={offline}
          onBack={onBack}
          onOpenActivity={() => setActivityOpen(true)}
          onOpenStatistics={openStatistics}
          onOpenRules={() => setRulesOpen(true)}
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
        {details.game.status === 'LOBBY' && details.canManage && (
          <section aria-label={t('lobbyPlayersTitle')} className="grid gap-(--mb-space-2)">
            {details.players
              .filter((player) => !(details.controlledPlayerIds ?? []).includes(player.id))
              .map((player) => (
                <Button
                  key={player.id}
                  variant="quiet"
                  disabled={offline}
                  onClick={() => void removePlayer(player.id)}
                >
                  {t('removePlayer', { name: player.name })}
                </Button>
              ))}
            {removeError !== null && (
              <Notice tone="error">{apiErrorMessage(removeError, t, 'unableRemovePlayer')}</Notice>
            )}
          </section>
        )}
        <WalletsSection
          players={details.players}
          currency={details.game.currency}
          controlledWallets={controlledWallets}
          activeControlledWalletId={activeControlledWalletId}
          activeWallet={activeWallet}
          otherPlayers={otherPlayers}
          canMutate={canMutate}
          loans={visibleLoans}
          auction={rules.auctions ? (details.auction ?? null) : null}
          property={
            board === null
              ? undefined
              : {
                  count: myCards.length,
                  value: formatMoney(cardsValue(myCards), details.game.currency),
                  onOpen: () => {
                    closeNavSheets();
                    setPropertyOpen(true);
                  },
                }
          }
          onSelectWallet={setActiveWalletId}
          onOpenWallet={(player) => {
            setSettleLoanOnOpen(false);
            setSelectedPlayer(player);
          }}
          onSettleLoan={(player) => {
            setSettleLoanOnOpen(true);
            setSelectedPlayer(player);
          }}
        />
        {canMutate &&
          (confirmationMode || inboxRequests.length > 0 || outgoingLoanRequests.length > 0) && (
            <PaymentInbox
              requests={inboxRequests}
              outgoing={outgoingLoanRequests}
              players={details.players}
              currency={details.game.currency}
              onAction={async (request, action) => {
                const commandId = crypto.randomUUID();
                const result =
                  action === 'accept'
                    ? await monopolyBankApi.acceptPaymentRequest(gameId, request.id, commandId)
                    : action === 'cancel'
                      ? await monopolyBankApi.cancelPaymentRequest(gameId, request.id, commandId)
                      : await monopolyBankApi.declinePaymentRequest(gameId, request.id, commandId);
                setPaymentRequests((current) => current.filter((item) => item.id !== request.id));
                if (result.transaction !== undefined) {
                  playPaymentFeedback(preferences.sound);
                  vibrate(35, preferences.vibration);
                  setDetails((current) =>
                    current === null
                      ? current
                      : {
                          ...current,
                          players: result.players,
                          ...(result.loans === undefined ? {} : { loans: result.loans }),
                          ...(result.bankLoanCooldowns === undefined
                            ? {}
                            : { bankLoanCooldowns: result.bankLoanCooldowns }),
                          ...(result.jackpot === undefined ? {} : { jackpot: result.jackpot }),
                          ...(result.properties === undefined
                            ? {}
                            : {
                                properties: mergeProperties(current.properties, result.properties),
                              }),
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
        {showNav && bottomNav}
        {rulesOpen && <RulesScreen game={details.game} onClose={() => setRulesOpen(false)} />}
        {activityOpen && (
          <ActivityScreen
            gameId={gameId}
            players={details.players}
            currency={details.game.currency}
            liveTransactions={liveTransactions}
            showPending={confirmationMode}
            initialScope={activityScope}
            refreshKey={activityVersion}
            board={board}
            reversal={
              canMutate
                ? {
                    isOwner: details.canManage === true,
                    controlledPlayerIds: details.controlledPlayerIds ?? [],
                    onReverse: setReversing,
                  }
                : undefined
            }
            onClose={() => setActivityOpen(false)}
          />
        )}
        {propertyOpen && board !== null && (
          <PropertyScreen
            board={board}
            properties={properties}
            players={details.players}
            currency={details.game.currency}
            controlledPlayerIds={controlledIds}
            actorPlayerId={canMutate ? (activeWallet?.id ?? null) : null}
            auctionsAvailable={rules.auctions && details.auction?.state !== 'ACTIVE'}
            onIntent={canMutate ? startTileIntent : undefined}
            onClose={() => setPropertyOpen(false)}
          />
        )}
        {statisticsOpen && summary !== null && (
          <StatisticsScreen
            summary={summary}
            currency={details.game.currency}
            loans={visibleLoans}
            finished={details.game.status === 'FINISHED'}
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
            properties={properties}
            initialAction={walletIntent?.action}
            initialTileId={walletIntent?.tileId}
            loans={details.loans ?? []}
            bankLoanCooldowns={details.bankLoanCooldowns ?? []}
            jackpot={details.jackpot ?? 0}
            settleOnOpen={settleLoanOnOpen}
            auction={rules.auctions ? (details.auction ?? null) : null}
            onStartAuction={(lotName) => {
              setAuctionPrompt({ player: selectedPlayer, lotName });
              setSelectedPlayer(null);
            }}
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
              // The history now lives in the Activity ledger: "Mine" for a wallet the viewer controls.
              setSelectedPlayer(null);
              setActivityScope(details.controlledPlayerIds?.includes(player.id) ? 'MINE' : 'ALL');
              setActivityOpen(true);
            }}
            onCompleted={(
              players,
              action,
              amount,
              mortgages,
              loans,
              bankLoanCooldowns,
              jackpot,
              changedProperties,
            ) => {
              playPaymentFeedback(preferences.sound);
              vibrate(35, preferences.vibration);
              setDetails({
                ...details,
                players,
                ...(mortgages === undefined ? {} : { mortgages }),
                ...(loans === undefined ? {} : { loans }),
                ...(bankLoanCooldowns === undefined ? {} : { bankLoanCooldowns }),
                ...(jackpot === undefined ? {} : { jackpot }),
                ...(changedProperties === undefined
                  ? {}
                  : { properties: mergeProperties(details.properties, changedProperties) }),
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
                  action === 'PROPERTY_PURCHASE'
                    ? 'propertyBought'
                    : action === 'PROPERTY_BUILD'
                      ? 'buildingBuilt'
                      : action === 'PROPERTY_SELL_BUILDING'
                        ? 'buildingSold'
                        : action === 'PAY_RENT'
                          ? 'rentPaid'
                          : action === 'MORTGAGE'
                            ? 'mortgageRecorded'
                            : action === 'MORTGAGE_REDEMPTION'
                              ? 'redemptionRecorded'
                              : action === 'LOAN_REPAYMENT'
                                ? 'loanRepaid'
                                : action === 'BANK_LOAN'
                                  ? 'bankLoanRecorded'
                                  : action === 'JACKPOT_PAYOUT'
                                    ? 'jackpotCollected'
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
            hasBankLoan={
              rules.bankLoans &&
              (details.loans ?? []).some(
                (loan) =>
                  loan.lenderKind === 'BANK' &&
                  loan.state === 'ACTIVE' &&
                  loan.borrowerPlayerId === bankruptPlayer.id,
              )
            }
            onClose={() => setBankruptPlayer(null)}
            onCompleted={(players, mortgages, loans, bankLoanCooldowns, jackpot) => {
              setDetails({
                ...details,
                players,
                ...(mortgages === undefined ? {} : { mortgages }),
                ...(loans === undefined ? {} : { loans }),
                ...(bankLoanCooldowns === undefined ? {} : { bankLoanCooldowns }),
                ...(jackpot === undefined ? {} : { jackpot }),
              });
              setBankruptPlayer(null);
            }}
          />
        )}
        {rules.auctions &&
          details.auction?.state === 'ACTIVE' &&
          dismissedAuction === `${details.auction.id}:ACTIVE` && (
            <Notice tone="info" as="section">
              <p>{details.auction.lotName}</p>
              <Button variant="secondary" onClick={() => setDismissedAuction(null)}>
                {t('auctionDialogTitle')}
              </Button>
            </Notice>
          )}
        {auctionPrompt !== null && (
          <StartAuctionDialog
            gameId={gameId}
            initiator={auctionPrompt.player}
            initialLotName={auctionPrompt.lotName}
            board={board}
            properties={properties}
            currency={details.game.currency}
            initialTileId={auctionPrompt.tileId}
            onClose={() => setAuctionPrompt(null)}
            onStarted={(response) => {
              applyAuctionResponse(response);
              setAuctionPrompt(null);
              setDismissedAuction(null);
            }}
          />
        )}
        {rules.auctions &&
          details.auction !== null &&
          details.auction !== undefined &&
          details.game.status !== 'LOBBY' &&
          dismissedAuction !== `${details.auction.id}:${details.auction.state}` && (
            <AuctionDialog
              gameId={gameId}
              auction={details.auction}
              players={details.players}
              controlledPlayerIds={
                details.controlledPlayerIds ?? controlledWallets.map((wallet) => wallet.playerId)
              }
              currency={details.game.currency}
              settings={details.game.settings}
              canMutate={canMutate}
              onClose={() =>
                details.auction &&
                setDismissedAuction(`${details.auction.id}:${details.auction.state}`)
              }
              onUpdated={applyAuctionResponse}
              onRefresh={refreshAuction}
            />
          )}
        {inviteOpen && (
          <InviteDialog joinCode={details.joinCode} onClose={() => setInviteOpen(false)} />
        )}
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
        {reversing !== null && (
          <ReverseTransactionDialog
            gameId={gameId}
            transaction={reversing}
            players={details.players}
            currency={details.game.currency}
            language={language}
            onClose={() => setReversing(null)}
            onReversed={(players) => {
              setDetails({ ...details, players });
              setReversing(null);
              setActivityVersion((version) => version + 1);
              notify({ tone: 'success', message: t('reversalRecorded') });
            }}
          />
        )}
      </PageShell>
    </DialogNavContext.Provider>
  );
}
