import type { MutableRefObject, SetStateAction } from 'react';
import { describe, expect, it } from 'vitest';
import type { GameDetails } from '../../../shared/contracts/api';
import type { LiveServerEvent } from '../../../shared/contracts/live';
import type { Game, Player, Transaction } from '../../../shared/types/monopoly';
import { MonopolyBankApiError } from '../../api/monopoly-bank-api';
import { translate, type Translate } from '../../i18n/translations';
import { formatMoney } from '../../utils/money';
import {
  applyLiveEvent,
  insufficientMessage,
  preflightFundsError,
  previewBalances,
  walletActionTone,
  withClientGameDetails,
} from './game-page-helpers';

const t: Translate = (key, values) => translate('en', key, values);

const game: Game = {
  id: 'g1',
  name: 'Friday night',
  startingBalance: 1_500,
  passGoReward: 200,
  currency: 'USD',
  paymentMode: 'FAST',
  status: 'ACTIVE',
  createdAt: '2026-09-28T10:00:00.000Z',
  updatedAt: '2026-09-28T10:00:00.000Z',
};

function player(id: string, name: string, balance: number): Player {
  return { id, gameId: 'g1', name, color: '#000000', balance, createdAt: '' };
}

const alice = player('p1', 'Alice', 1_000);
const bob = player('p2', 'Bob', 500);
const carol = player('p3', 'Carol', 100);
const players = [alice, bob, carol];

function transaction(id: string): Transaction {
  return {
    id,
    gameId: 'g1',
    type: 'PLAYER_TO_BANK',
    amount: 50,
    totalAmount: 50,
    comment: null,
    createdAt: '2026-09-28T11:00:00.000Z',
    participants: [{ playerId: 'p1', balanceDelta: -50 }],
  };
}

function details(overrides: Partial<GameDetails> = {}): GameDetails {
  return { game, players, ...overrides };
}

/** Minimal stand-in for React state: applies value and updater-function actions in order. */
function stateCell<T>(initial: T) {
  const cell = {
    value: initial,
    set: (action: SetStateAction<T>) => {
      cell.value =
        typeof action === 'function' ? (action as (current: T) => T)(cell.value) : action;
    },
  };
  return cell;
}

function liveHarness(initialDetails: GameDetails | null, initialHistory: Transaction[] | null) {
  const detailsCell = stateCell<GameDetails | null>(initialDetails);
  const historyCell = stateCell<Transaction[] | null>(initialHistory);
  const historyCache: MutableRefObject<Map<string, Transaction[]>> = { current: new Map() };
  const apply = (event: LiveServerEvent) =>
    applyLiveEvent(event, detailsCell.set, historyCell.set, historyCache);
  return { detailsCell, historyCell, historyCache, apply };
}

describe('withClientGameDetails', () => {
  it('returns the server details unchanged when there is no client state yet', () => {
    const server = details({ canManage: false });
    expect(withClientGameDetails(server, null)).toBe(server);
  });

  it('keeps client-only fields from the current details', () => {
    const current = details({
      canManage: true,
      joinCode: 'ABC123',
      controlledWallets: [{ playerId: 'p1', kind: 'PRIMARY' }],
      controlledPlayerIds: ['p1'],
    });
    const server = details({ players: [alice, bob], canManage: false });
    expect(withClientGameDetails(server, current)).toEqual({
      ...server,
      canManage: true,
      joinCode: 'ABC123',
      controlledWallets: [{ playerId: 'p1', kind: 'PRIMARY' }],
      controlledPlayerIds: ['p1'],
    });
  });

  it('prefers controlled wallets supplied by the server', () => {
    const current = details({
      controlledWallets: [{ playerId: 'p1', kind: 'PRIMARY' }],
      controlledPlayerIds: ['p1'],
    });
    const server = details({
      controlledWallets: [{ playerId: 'p2', kind: 'LOCAL' }],
      controlledPlayerIds: ['p2'],
    });
    const merged = withClientGameDetails(server, current);
    expect(merged.controlledWallets).toEqual([{ playerId: 'p2', kind: 'LOCAL' }]);
    expect(merged.controlledPlayerIds).toEqual(['p2']);
  });
});

describe('applyLiveEvent', () => {
  it('replaces details, history and the "all" cache from a snapshot', () => {
    const snapshotTransactions = [transaction('t1')];
    const { detailsCell, historyCell, historyCache, apply } = liveHarness(
      details({ canManage: true, joinCode: 'JOIN' }),
      null,
    );
    apply({
      type: 'GAME_SNAPSHOT',
      state: {
        stateVersion: 3,
        details: details({ players: [alice] }),
        transactions: snapshotTransactions,
      },
    });
    expect(detailsCell.value?.players).toEqual([alice]);
    expect(detailsCell.value?.canManage).toBe(true);
    expect(detailsCell.value?.joinCode).toBe('JOIN');
    expect(historyCell.value).toBe(snapshotTransactions);
    expect(historyCache.current.get('all')).toBe(snapshotTransactions);
  });

  it('updates only game and players on a lobby update', () => {
    const { detailsCell, apply } = liveHarness(details({ favoriteAmounts: [100] }), null);
    const lobbyGame = { ...game, status: 'LOBBY' as const };
    apply({
      type: 'LOBBY_UPDATED',
      stateVersion: 2,
      details: { game: lobbyGame, players: [bob] },
    });
    expect(detailsCell.value).toEqual(
      details({ game: lobbyGame, players: [bob], favoriteAmounts: [100] }),
    );
  });

  it('ignores lobby and commit updates before the game has loaded', () => {
    const { detailsCell, apply } = liveHarness(null, null);
    apply({ type: 'LOBBY_UPDATED', stateVersion: 2, details: { game, players } });
    apply({
      type: 'GAME_COMMITTED',
      stateVersion: 3,
      transaction: transaction('t1'),
      players,
    });
    expect(detailsCell.value).toBeNull();
  });

  it('applies committed balances, clears the cache and prepends the transaction once', () => {
    const existing = transaction('t1');
    const committed = { ...transaction('t2'), amount: 75 };
    const { detailsCell, historyCell, historyCache, apply } = liveHarness(details(), [
      transaction('t2'),
      existing,
    ]);
    historyCache.current.set('all', [existing]);
    historyCache.current.set('player:p1', [existing]);
    const nextPlayers = [player('p1', 'Alice', 925), bob, carol];
    apply({
      type: 'GAME_COMMITTED',
      stateVersion: 4,
      transaction: committed,
      players: nextPlayers,
    });
    expect(detailsCell.value?.players).toBe(nextPlayers);
    expect(historyCache.current.size).toBe(0);
    expect(historyCell.value).toEqual([committed, existing]);
  });

  it('leaves unloaded history untouched on commit', () => {
    const { historyCell, apply } = liveHarness(details(), null);
    apply({ type: 'GAME_COMMITTED', stateVersion: 4, transaction: transaction('t1'), players });
    expect(historyCell.value).toBeNull();
  });

  it('merges finished-game details with client-only fields', () => {
    const { detailsCell, apply } = liveHarness(details({ canManage: true }), null);
    const finished = details({ game: { ...game, status: 'FINISHED' } });
    apply({ type: 'GAME_FINISHED', stateVersion: 5, details: finished });
    expect(detailsCell.value?.game.status).toBe('FINISHED');
    expect(detailsCell.value?.canManage).toBe(true);
  });

  it.each([
    { type: 'PAYMENT_REQUESTS_UPDATED', stateVersion: 6 },
    { type: 'PRESENCE_UPDATED', stateVersion: 6, connectedActors: 2 },
    { type: 'HEARTBEAT', stateVersion: 6 },
  ] satisfies LiveServerEvent[])('does not touch state for $type', (event) => {
    const initial = details();
    const history = [transaction('t1')];
    const { detailsCell, historyCell, historyCache, apply } = liveHarness(initial, history);
    historyCache.current.set('all', history);
    apply(event);
    expect(detailsCell.value).toBe(initial);
    expect(historyCell.value).toBe(history);
    expect(historyCache.current.get('all')).toBe(history);
  });
});

describe('previewBalances', () => {
  it('moves the amount between two players', () => {
    const preview = previewBalances(
      { type: 'PLAYER_TO_PLAYER', sourcePlayerId: 'p1', destinationPlayerId: 'p2', amount: 300 },
      players,
      200,
    );
    expect(preview.map(({ delta, after }) => ({ delta, after }))).toEqual([
      { delta: -300, after: 700 },
      { delta: 300, after: 800 },
      { delta: 0, after: 100 },
    ]);
  });

  it('debits or credits only the wallet for bank payments', () => {
    expect(
      previewBalances({ type: 'PLAYER_TO_BANK', playerId: 'p2', amount: 50 }, players, 200).map(
        ({ delta }) => delta,
      ),
    ).toEqual([0, -50, 0]);
    expect(
      previewBalances({ type: 'BANK_TO_PLAYER', playerId: 'p3', amount: 40 }, players, 200).map(
        ({ delta }) => delta,
      ),
    ).toEqual([0, 0, 40]);
  });

  it('charges the payer once per other player when paying everyone', () => {
    const preview = previewBalances(
      { type: 'PLAYER_TO_ALL', payerPlayerId: 'p1', amountPerPlayer: 25 },
      players,
      200,
    );
    expect(preview.map(({ delta }) => delta)).toEqual([-50, 25, 25]);
    expect(preview.reduce((sum, { delta }) => sum + delta, 0)).toBe(0);
  });

  it('collects from every other player when everyone pays one player', () => {
    const preview = previewBalances(
      { type: 'ALL_TO_PLAYER', recipientPlayerId: 'p2', amountPerPlayer: 10 },
      players,
      200,
    );
    expect(preview.map(({ delta, after }) => [delta, after])).toEqual([
      [-10, 990],
      [20, 520],
      [-10, 90],
    ]);
  });

  it('credits the Pass GO reward to the player', () => {
    const preview = previewBalances({ type: 'PASS_GO', playerId: 'p3' }, players, 200);
    expect(preview.map(({ player: affected, after }) => [affected.id, after])).toEqual([
      ['p1', 1_000],
      ['p2', 500],
      ['p3', 300],
    ]);
  });
});

describe('preflightFundsError', () => {
  const requirement = (current: number, required: number) =>
    `${t('insufficientFunds')} ${t('balanceRequirement', {
      current: formatMoney(current, 'USD'),
      required: formatMoney(required, 'USD'),
    })}`;

  it('ignores amounts that are not positive safe integers', () => {
    for (const amount of [0, -5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])
      expect(preflightFundsError('PLAYER_TO_BANK', carol, players, amount, 'USD', t)).toBeNull();
  });

  it.each(['PLAYER_TO_PLAYER', 'PLAYER_TO_BANK'] as const)(
    'reports the shortfall for %s',
    (action) => {
      expect(preflightFundsError(action, carol, players, 100, 'USD', t)).toBeNull();
      expect(preflightFundsError(action, carol, players, 101, 'USD', t)).toBe(
        requirement(100, 101),
      );
    },
  );

  it('requires the payer to cover every other player when paying everyone', () => {
    expect(preflightFundsError('PLAYER_TO_ALL', bob, players, 250, 'USD', t)).toBeNull();
    expect(preflightFundsError('PLAYER_TO_ALL', bob, players, 251, 'USD', t)).toBe(
      requirement(500, 502),
    );
  });

  it('names every other player who cannot afford their share', () => {
    expect(preflightFundsError('ALL_TO_PLAYER', alice, players, 100, 'USD', t)).toBeNull();
    expect(preflightFundsError('ALL_TO_PLAYER', alice, players, 600, 'USD', t)).toBe(
      t('cannotAfford', { names: 'Bob, Carol', amount: formatMoney(600, 'USD') }),
    );
    expect(preflightFundsError('ALL_TO_PLAYER', carol, players, 600, 'USD', t)).toBe(
      t('cannotAfford', { names: 'Bob', amount: formatMoney(600, 'USD') }),
    );
  });

  it.each([null, 'BANK_TO_PLAYER', 'PASS_GO'] as const)('never blocks %s', (action) => {
    expect(preflightFundsError(action, carol, players, 1_000_000, 'USD', t)).toBeNull();
  });
});

describe('insufficientMessage', () => {
  it('ignores errors other than INSUFFICIENT_FUNDS', () => {
    expect(insufficientMessage(new Error('boom'), players, 'USD', t)).toBeNull();
    expect(
      insufficientMessage(
        new MonopolyBankApiError({ code: 'NOT_FOUND', message: 'missing' }),
        players,
        'USD',
        t,
      ),
    ).toBeNull();
  });

  it('names the player and the balance requirement', () => {
    const error = new MonopolyBankApiError({
      code: 'INSUFFICIENT_FUNDS',
      message: 'Insufficient funds',
      details: { playerId: 'p2', currentBalance: 500, requiredAmount: 700 },
    });
    expect(insufficientMessage(error, players, 'USD', t)).toBe(
      `${t('playerInsufficientFunds', { name: 'Bob' })} ${t('balanceRequirement', {
        current: formatMoney(500, 'USD'),
        required: formatMoney(700, 'USD'),
      })}`,
    );
  });
});

describe('walletActionTone', () => {
  it('marks money coming in as income and money going out as expense', () => {
    expect(walletActionTone('BANK_TO_PLAYER')).toBe('income');
    expect(walletActionTone('ALL_TO_PLAYER')).toBe('income');
    expect(walletActionTone('PASS_GO')).toBe('income');
    expect(walletActionTone('PLAYER_TO_PLAYER')).toBe('expense');
    expect(walletActionTone('PLAYER_TO_BANK')).toBe('expense');
    expect(walletActionTone('PLAYER_TO_ALL')).toBe('expense');
  });
});
