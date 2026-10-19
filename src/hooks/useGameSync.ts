import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { GameDetails, PaymentRequest } from '../../shared/contracts/api';
import { isLiveServerEvent, type LiveServerEvent } from '../../shared/contracts/live';
import type { Transaction } from '../../shared/types/monopoly';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { applyLiveEvent, withClientGameDetails } from '../pages/game/game-page-helpers';
import type { LiveStatus } from '../pages/game/GameHeader';
import { acceptsLiveVersion } from '../utils/live-version';

const HEARTBEAT_INTERVAL_MS = 20_000;
const POLL_INTERVAL_MS = 15_000;
const STALE_AFTER_MS = 30_000;
const REFRESH_THROTTLE_MS = 2000;
const REFRESH_DONE_MS = 1500;
const MAX_LIVE_TRANSACTIONS = 50;
const PING = 'ping';
const PONG = 'pong';

export type RefreshState = 'idle' | 'busy' | 'done' | 'error';

export interface RefreshControl {
  state: RefreshState;
  run: () => void;
}

type SetDetails = Dispatch<SetStateAction<GameDetails | null>>;

interface SyncState {
  lastVersion: number;
  lastMessageAt: number;
  socket: WebSocket | null;
  inFlight: Promise<void> | null;
  pending: boolean;
}

function initialSync(): SyncState {
  return {
    lastVersion: 0,
    lastMessageAt: Date.now(),
    socket: null,
    inFlight: null,
    pending: false,
  };
}

function liveUrl(gameId: string): URL {
  const url = new URL(`/api/games/${encodeURIComponent(gameId)}/live`, window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url;
}

function reconnectDelay(attempts: number): number {
  const base = Math.min(1000 * 2 ** (attempts - 1), 10_000);
  return Math.round(base * (0.7 + Math.random() * 0.6));
}

interface LiveListener {
  onStatus: (status: LiveStatus) => void;
  onSocket: (socket: WebSocket | null) => void;
  onOpen: () => void;
  onMessage: (data: unknown) => void;
}

interface Connection {
  closed: boolean;
  retry: number | undefined;
  heartbeat: number | undefined;
  socket: WebSocket | null;
  attempts: number;
}

function stopHeartbeat(state: Connection): void {
  if (state.heartbeat === undefined) return;
  window.clearInterval(state.heartbeat);
  state.heartbeat = undefined;
}

function connect(state: Connection, gameId: string, listener: LiveListener): void {
  if (state.closed) return;
  listener.onStatus(state.attempts === 0 ? 'connecting' : 'reconnecting');
  const socket = new WebSocket(liveUrl(gameId));
  state.socket = socket;
  listener.onSocket(socket);
  socket.onopen = () => {
    if (state.socket !== socket) return;
    state.attempts = 0;
    listener.onStatus('live');
    state.heartbeat = window.setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send(PING);
    }, HEARTBEAT_INTERVAL_MS);
    listener.onOpen();
  };
  socket.onmessage = (message) => {
    if (state.socket === socket) listener.onMessage(message.data);
  };
  socket.onclose = () => {
    stopHeartbeat(state);
    if (state.closed || state.socket !== socket) return;
    listener.onStatus('offline');
    state.attempts += 1;
    state.retry = window.setTimeout(
      () => connect(state, gameId, listener),
      reconnectDelay(state.attempts),
    );
  };
  socket.onerror = () => {
    if (state.socket === socket) socket.close();
  };
}

function startLiveConnection(gameId: string, listener: LiveListener): () => void {
  const state: Connection = {
    closed: false,
    retry: undefined,
    heartbeat: undefined,
    socket: null,
    attempts: 0,
  };
  connect(state, gameId, listener);
  return () => {
    state.closed = true;
    if (state.retry !== undefined) window.clearTimeout(state.retry);
    stopHeartbeat(state);
    state.socket?.close();
    listener.onSocket(null);
  };
}

function isHealthy(sync: SyncState): boolean {
  return (
    sync.socket !== null &&
    sync.socket.readyState === WebSocket.OPEN &&
    Date.now() - sync.lastMessageAt <= STALE_AFTER_MS
  );
}

function useRefresh(resync: () => Promise<void>): RefreshControl {
  const [state, setState] = useState<RefreshState>('idle');
  const lastRequestAt = useRef(0);
  const busy = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current);
    },
    [],
  );
  const run = useCallback(() => {
    const now = Date.now();
    if (busy.current || now - lastRequestAt.current < REFRESH_THROTTLE_MS) return;
    lastRequestAt.current = now;
    busy.current = true;
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    setState('busy');
    void resync().then(
      () => {
        busy.current = false;
        setState('done');
        timer.current = window.setTimeout(() => setState('idle'), REFRESH_DONE_MS);
      },
      () => {
        busy.current = false;
        setState('error');
      },
    );
  }, [resync]);
  return { state, run };
}

interface Options {
  gameId: string;
  enabled: boolean;
  setDetails: SetDetails;
  setLiveTransactions: Dispatch<SetStateAction<Transaction[]>>;
  setPaymentRequests: Dispatch<SetStateAction<PaymentRequest[]>>;
  loadPaymentRequests: () => void;
}

export function useGameSync({
  gameId,
  enabled,
  setDetails,
  setLiveTransactions,
  setPaymentRequests,
  loadPaymentRequests,
}: Options): { liveStatus: LiveStatus; refresh: RefreshControl } {
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('connecting');
  const sync = useRef<SyncState>(initialSync());
  const resync = useCallback((): Promise<void> => {
    const current = sync.current;
    if (current.inFlight !== null) {
      current.pending = true;
      return current.inFlight;
    }
    const run = async () => {
      const { stateVersion } = await monopolyBankApi.getGameVersion(gameId);
      if (stateVersion === current.lastVersion) return;
      if (stateVersion < current.lastVersion) {
        current.socket?.close();
        return;
      }
      const game = await monopolyBankApi.getGame(gameId);
      const active = game.game.status === 'ACTIVE';
      const [tradeRequests, paymentRequests] = active
        ? await Promise.all([
            monopolyBankApi.listTradeRequests(gameId),
            monopolyBankApi.listPaymentRequests(gameId),
          ])
        : [undefined, undefined];
      if (current.lastVersion > stateVersion) return;
      setDetails((previous) =>
        withClientGameDetails(
          tradeRequests === undefined ? game : { ...game, tradeRequests },
          previous,
        ),
      );
      if (paymentRequests !== undefined) setPaymentRequests(paymentRequests);
      current.lastVersion = stateVersion;
    };
    const loop = async () => {
      do {
        current.pending = false;
        await run();
      } while (current.pending);
    };
    const flight = loop().finally(() => {
      current.inFlight = null;
      current.pending = false;
    });
    current.inFlight = flight;
    return flight;
  }, [gameId, setDetails, setPaymentRequests]);
  const refresh = useRefresh(resync);
  useEffect(() => {
    if (!enabled) return;
    sync.current = initialSync();
    const requestResync = () => void resync().catch(() => undefined);
    const loadTradeRequests = () =>
      void monopolyBankApi.listTradeRequests(gameId).then(
        (tradeRequests) =>
          setDetails((current) => (current === null ? current : { ...current, tradeRequests })),
        () => undefined,
      );
    const handleEvent = (event: LiveServerEvent) => {
      const state = sync.current;
      if (event.type === 'GAME_SNAPSHOT') {
        state.lastVersion = event.state.stateVersion;
        applyLiveEvent(event, setDetails);
        return;
      }
      if (event.type === 'PRESENCE_UPDATED' || event.type === 'HEARTBEAT') {
        if (event.stateVersion > state.lastVersion) requestResync();
        return;
      }
      if (!acceptsLiveVersion(state.lastVersion, event.stateVersion)) {
        requestResync();
        return;
      }
      state.lastVersion = Math.max(state.lastVersion, event.stateVersion);
      applyLiveEvent(event, setDetails);
      if (event.type === 'GAME_COMMITTED') {
        const { transaction } = event;
        setLiveTransactions((current) =>
          [transaction, ...current.filter((item) => item.id !== transaction.id)].slice(
            0,
            MAX_LIVE_TRANSACTIONS,
          ),
        );
      }
      if (event.type === 'PAYMENT_REQUESTS_UPDATED') loadPaymentRequests();
      if (event.type === 'TRADE_REQUESTS_UPDATED') loadTradeRequests();
    };
    const onMessage = (data: unknown) => {
      sync.current.lastMessageAt = Date.now();
      if (data === PONG) return;
      try {
        const event: unknown = JSON.parse(String(data));
        if (isLiveServerEvent(event)) handleEvent(event);
        else requestResync();
      } catch {
        requestResync();
      }
    };
    const onOpen = () => {
      sync.current.lastMessageAt = Date.now();
      requestResync();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') requestResync();
    };
    const poll = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || isHealthy(sync.current)) return;
      requestResync();
    }, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', requestResync);
    window.addEventListener('pageshow', requestResync);
    const onSocket = (socket: WebSocket | null) => {
      sync.current.socket = socket;
    };
    const stop = startLiveConnection(gameId, {
      onStatus: setLiveStatus,
      onSocket,
      onOpen,
      onMessage,
    });
    return () => {
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', requestResync);
      window.removeEventListener('pageshow', requestResync);
      stop();
    };
  }, [gameId, enabled, resync, setDetails, setLiveTransactions, loadPaymentRequests]);
  return { liveStatus, refresh };
}
