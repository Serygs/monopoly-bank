import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { GameDetails } from '../../shared/contracts/api';
import { isLiveServerEvent, type LiveServerEvent } from '../../shared/contracts/live';
import type { Transaction } from '../../shared/types/monopoly';
import { applyLiveEvent } from '../pages/game/game-page-helpers';
import type { LiveStatus } from '../pages/game/GameHeader';
import { acceptsLiveVersion } from '../utils/live-version';

const HEARTBEAT_INTERVAL_MS = 20_000;
const MAX_LIVE_TRANSACTIONS = 50;
const VERSION_GAP_CLOSE_CODE = 4001;

interface LiveListener {
  onStatus: (status: LiveStatus) => void;
  onEvent: (event: LiveServerEvent, socket: WebSocket) => void;
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

function startHeartbeat(socket: WebSocket): number {
  return window.setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'HEARTBEAT' }));
  }, HEARTBEAT_INTERVAL_MS);
}

function deliver(data: unknown, socket: WebSocket, listener: LiveListener): void {
  try {
    const event: unknown = JSON.parse(String(data));
    if (isLiveServerEvent(event)) listener.onEvent(event, socket);
  } catch {
    return;
  }
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
  socket.onopen = () => {
    if (state.socket !== socket) return;
    state.attempts = 0;
    listener.onStatus('live');
    state.heartbeat = startHeartbeat(socket);
  };
  socket.onmessage = (message) => {
    if (state.socket === socket) deliver(message.data, socket, listener);
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
  };
}

interface Options {
  gameId: string;
  enabled: boolean;
  setDetails: Dispatch<SetStateAction<GameDetails | null>>;
  setLiveTransactions: Dispatch<SetStateAction<Transaction[]>>;
  loadPaymentRequests: () => void;
}

export function useGameLiveConnection({
  gameId,
  enabled,
  setDetails,
  setLiveTransactions,
  loadPaymentRequests,
}: Options): LiveStatus {
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('connecting');
  const lastAppliedVersion = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    const handleEvent = (event: LiveServerEvent, socket: WebSocket) => {
      if (event.type === 'GAME_SNAPSHOT') {
        lastAppliedVersion.current = event.state.stateVersion;
        applyLiveEvent(event, setDetails);
        return;
      }
      if (!acceptsLiveVersion(lastAppliedVersion.current, event.stateVersion)) {
        socket.close(VERSION_GAP_CLOSE_CODE, 'State version gap: resync required.');
        return;
      }
      lastAppliedVersion.current = Math.max(lastAppliedVersion.current, event.stateVersion);
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
    };
    return startLiveConnection(gameId, { onStatus: setLiveStatus, onEvent: handleEvent });
  }, [gameId, enabled, setDetails, setLiveTransactions, loadPaymentRequests]);
  return liveStatus;
}
