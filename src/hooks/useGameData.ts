import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { AuctionResponse, GameDetails, PaymentRequest } from '../../shared/contracts/api';
import type { Transaction } from '../../shared/types/monopoly';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import type { LiveStatus } from '../pages/game/GameHeader';
import { newerAuction } from '../utils/auction';
import { useGameLiveConnection } from './useGameLiveConnection';
import { useWakeLock } from './useWakeLock';

const MAX_LIVE_TRANSACTIONS = 50;
const SEEDED_TRANSACTIONS = 4;
const AUCTION_POLL_MS = 2000;

type SetDetails = Dispatch<SetStateAction<GameDetails | null>>;
type SetTransactions = Dispatch<SetStateAction<Transaction[]>>;

function useGameDetails(gameId: string) {
  const [details, setDetails] = useState<GameDetails | null>(null);
  const [error, setError] = useState<unknown | null>(null);
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
  return { details, setDetails, error };
}

function usePaymentRequests(gameId: string, enabled: boolean) {
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequest[]>([]);
  const loadPaymentRequests = useCallback(
    () =>
      void monopolyBankApi.listPaymentRequests(gameId).then(setPaymentRequests, () => undefined),
    [gameId],
  );
  useEffect(() => {
    if (enabled) loadPaymentRequests();
  }, [enabled, loadPaymentRequests]);
  return { paymentRequests, setPaymentRequests, loadPaymentRequests };
}

function useSeededTransactions(gameId: string, enabled: boolean): Transaction[] {
  const [seeded, setSeeded] = useState<Transaction[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void monopolyBankApi.getActivity(gameId, 'ALL').then(
      (page) => {
        if (active) setSeeded(page.transactions.slice(0, SEEDED_TRANSACTIONS));
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [gameId, enabled]);
  return seeded;
}

function useAuctionSync(
  gameId: string,
  setDetails: SetDetails,
  setLiveTransactions: SetTransactions,
  polling: boolean,
) {
  const applyAuctionResponse = useCallback(
    (response: AuctionResponse) => {
      const settled = response.transaction;
      if (settled !== undefined)
        setLiveTransactions((current) =>
          [settled, ...current.filter((item) => item.id !== settled.id)].slice(
            0,
            MAX_LIVE_TRANSACTIONS,
          ),
        );
      setDetails((current) =>
        current === null
          ? current
          : {
              ...current,
              ...(response.players === undefined ? {} : { players: response.players }),
              auction: newerAuction(current.auction ?? null, response.auction),
            },
      );
    },
    [setDetails, setLiveTransactions],
  );
  const refreshAuction = useCallback(
    () => void monopolyBankApi.getAuction(gameId).then(applyAuctionResponse, () => undefined),
    [gameId, applyAuctionResponse],
  );
  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(refreshAuction, AUCTION_POLL_MS);
    return () => window.clearInterval(timer);
  }, [polling, refreshAuction]);
  return { applyAuctionResponse, refreshAuction };
}

export function useGameData(gameId: string, offline: boolean, keepScreenAwake: boolean) {
  const { details, setDetails, error } = useGameDetails(gameId);
  const [liveTransactions, setLiveTransactions] = useState<Transaction[]>([]);
  const status = details?.game.status;
  const { paymentRequests, setPaymentRequests, loadPaymentRequests } = usePaymentRequests(
    gameId,
    status === 'ACTIVE' && !offline,
  );
  const seededTransactions = useSeededTransactions(gameId, status === 'ACTIVE' && !offline);
  const liveStatus: LiveStatus = useGameLiveConnection({
    gameId,
    enabled: details !== null && status !== 'FINISHED' && !offline,
    setDetails,
    setLiveTransactions,
    loadPaymentRequests,
  });
  const auctionPolling =
    details?.game.rules.auctions === true &&
    status === 'ACTIVE' &&
    !offline &&
    liveStatus !== 'live';
  const auction = useAuctionSync(gameId, setDetails, setLiveTransactions, auctionPolling);
  useWakeLock(keepScreenAwake && status === 'ACTIVE');
  return {
    details,
    setDetails,
    error,
    paymentRequests,
    setPaymentRequests,
    loadPaymentRequests,
    liveTransactions,
    seededTransactions,
    liveStatus,
    ...auction,
  };
}
