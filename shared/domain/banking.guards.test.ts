import { describe, expect, it } from 'vitest';
import {
  defaultGameRules,
  type Game,
  type Player,
  type PropertyChange,
  type Transaction,
} from '../types/monopoly.js';
import {
  allToPlayer,
  auctionPayment,
  bankToPlayer,
  declareBankruptcy,
  passGo,
  playerToAll,
  playerToBank,
  playerToPlayer,
  reverseTransaction,
  toJackpot,
  type BankingOperationResult,
} from './banking.js';
import { buildGameSettings } from './game-rules.js';

const game: Game = {
  id: 'g',
  name: 'G',
  startingBalance: 1000,
  passGoReward: 200,
  currency: 'K',
  paymentMode: 'FAST',
  rules: { ...defaultGameRules, freeParkingJackpot: true },
  settings: buildGameSettings(1000),
  status: 'ACTIVE',
  createdAt: '',
  updatedAt: '',
};

const player = (
  id: string,
  balance = 1000,
  status: Player['status'] = 'ACTIVE',
  gameId = 'g',
): Player => ({ id, gameId, name: id, color: '#000', balance, status, createdAt: '' });

const table = (): Player[] => [player('a'), player('b'), player('c')];

type Operation = (game: Game, players: readonly Player[], amount: number) => BankingOperationResult;

const operations: ReadonlyArray<[string, Operation]> = [
  [
    'playerToPlayer',
    (g, players, amount) =>
      playerToPlayer({
        game: g,
        players,
        sourcePlayerId: 'a',
        destinationPlayerId: 'b',
        amount,
      }),
  ],
  [
    'playerToBank',
    (g, players, amount) => playerToBank({ game: g, players, playerId: 'a', amount }),
  ],
  [
    'bankToPlayer',
    (g, players, amount) => bankToPlayer({ game: g, players, playerId: 'a', amount }),
  ],
  [
    'playerToAll',
    (g, players, amount) =>
      playerToAll({ game: g, players, payerPlayerId: 'a', amountPerPlayer: amount }),
  ],
  [
    'allToPlayer',
    (g, players, amount) =>
      allToPlayer({ game: g, players, recipientPlayerId: 'a', amountPerPlayer: amount }),
  ],
  ['toJackpot', (g, players, amount) => toJackpot({ game: g, players, playerId: 'a', amount })],
  [
    'auctionPayment',
    (g, players, amount) =>
      auctionPayment({ game: g, players, playerId: 'a', amount, lotName: 'Lot' }),
  ],
  [
    'passGo',
    (g, players, amount) =>
      passGo({ game: { ...g, passGoReward: amount }, players, playerId: 'a' }),
  ],
];

const refusal = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
};

describe.each(operations)('%s guards', (_name, run) => {
  it('refuses a game that is not active', () => {
    for (const status of ['LOBBY', 'FINISHED'] as const)
      expect(refusal(() => run({ ...game, status }, table(), 10))).toMatchObject({
        code: 'GAME_FINISHED',
        status: 409,
        reason: `game status is ${status}`,
      });
  });

  it('refuses a table of fewer than two or more than six players', () => {
    const expected = {
      code: 'GAME_FINISHED',
      reason: 'a game must contain between 2 and 6 players',
    };
    expect(refusal(() => run(game, [player('a')], 10))).toMatchObject(expected);
    expect(refusal(() => run(game, [], 10))).toMatchObject(expected);
    const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => player(id));
    expect(refusal(() => run(game, seven, 10))).toMatchObject(expected);
  });

  it('accepts a table of exactly two and exactly six players', () => {
    expect(() => run(game, [player('a'), player('b')], 10)).not.toThrow();
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => player(id));
    expect(() => run(game, six, 10)).not.toThrow();
  });

  it('refuses a player from another game', () => {
    expect(
      refusal(() => run(game, [player('a'), player('b', 1000, 'ACTIVE', 'other')], 10)),
    ).toMatchObject({ code: 'GAME_FINISHED', reason: 'player "b" belongs to another game' });
  });

  it('refuses a balance that is negative, fractional or not a safe integer', () => {
    for (const balance of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])
      expect(refusal(() => run(game, [player('a'), player('b', balance)], 10))).toMatchObject({
        code: 'GAME_FINISHED',
        reason: 'player "b" has an invalid balance',
      });
  });

  it('accepts a bankrupt player whose wallet is empty', () => {
    expect(() =>
      run(game, [player('a'), player('b'), player('c', 0, 'BANKRUPT')], 10),
    ).not.toThrow();
  });

  it('refuses the same player twice', () => {
    expect(refusal(() => run(game, [player('a'), player('a')], 10))).toMatchObject({
      code: 'GAME_FINISHED',
      reason: 'player "a" appears more than once',
    });
  });

  it('refuses an amount that is zero, negative, fractional or too large', () => {
    for (const amount of [0, -5, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])
      expect(refusal(() => run(game, table(), amount))).toMatchObject({
        code: 'INVALID_AMOUNT',
        status: 400,
        message: 'Amount must be a positive safe integer.',
        details: { field: 'amount' },
      });
  });

  it('refuses a player who is not at the table', () => {
    expect(refusal(() => run(game, [player('b'), player('c')], 10))).toMatchObject({
      code: 'PLAYER_NOT_FOUND',
      status: 404,
      message: 'Player not found.',
    });
  });

  it('refuses a bankrupt player even when the wallet holds the money', () => {
    expect(
      refusal(() => run(game, [player('a', 1000, 'BANKRUPT'), player('b'), player('c')], 10)),
    ).toMatchObject({ code: 'PLAYER_BANKRUPT', details: { playerId: 'a' } });
  });
});

describe('funds boundaries', () => {
  it.each([
    ['playerToPlayer', 1],
    ['playerToBank', 1],
    ['toJackpot', 1],
    ['auctionPayment', 1],
  ])('%s allows spending exactly the whole wallet and refuses one unit more', (name) => {
    const run = operations.find(([label]) => label === name)?.[1];
    if (run === undefined) throw new Error(name);
    const exact = run(game, [player('a', 100), player('b')], 100);
    expect(exact.affectedPlayers[0]).toMatchObject({ balanceBefore: 100, balanceAfter: 0 });
    expect(refusal(() => run(game, [player('a', 100), player('b')], 101))).toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
      status: 409,
      message: 'Player does not have enough funds.',
      details: { playerId: 'a', currentBalance: 100, requiredAmount: 101, shortfall: 1 },
    });
  });

  it('charges a payment to everyone the whole sum and refuses a wallet that falls short by one', () => {
    const three = [player('a', 40), player('b'), player('c')];
    expect(
      playerToAll({ game, players: three, payerPlayerId: 'a', amountPerPlayer: 20 }),
    ).toMatchObject({
      transaction: { amount: 20, totalAmount: 40 },
    });
    expect(
      refusal(() => playerToAll({ game, players: three, payerPlayerId: 'a', amountPerPlayer: 21 })),
    ).toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
      details: { currentBalance: 40, requiredAmount: 42, shortfall: 2 },
    });
  });

  it('collects from everyone only while each payer can cover the share', () => {
    const three = [player('a'), player('b', 50), player('c', 49)];
    expect(
      refusal(() =>
        allToPlayer({ game, players: three, recipientPlayerId: 'a', amountPerPlayer: 50 }),
      ),
    ).toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
      details: { playerId: 'c', currentBalance: 49, requiredAmount: 50 },
    });
    const result = allToPlayer({
      game,
      players: three,
      recipientPlayerId: 'a',
      amountPerPlayer: 49,
    });
    expect(result.transaction.totalAmount).toBe(98);
  });
});

describe('bank payments to a player', () => {
  it('allow exactly 4 000 000 and refuse one unit more', () => {
    expect(
      bankToPlayer({ game, players: table(), playerId: 'a', amount: 4_000_000 }).transaction.amount,
    ).toBe(4_000_000);
    expect(
      refusal(() => bankToPlayer({ game, players: table(), playerId: 'a', amount: 4_000_001 })),
    ).toMatchObject({
      code: 'BANK_TO_PLAYER_LIMIT_EXCEEDED',
      status: 400,
      details: { field: 'amount', amount: 4_000_001, max: 4_000_000 },
    });
  });

  it('check that the amount is valid before checking the limit', () => {
    expect(
      refusal(() => bankToPlayer({ game, players: table(), playerId: 'a', amount: 0.5 })),
    ).toMatchObject({
      code: 'INVALID_AMOUNT',
    });
  });
});

describe('players who cannot take part', () => {
  it('a payment to a bankrupt player is refused and one from a bankrupt player too', () => {
    const players = [player('a'), player('b', 1000, 'BANKRUPT'), player('c')];
    expect(
      refusal(() =>
        playerToPlayer({
          game,
          players,
          sourcePlayerId: 'a',
          destinationPlayerId: 'b',
          amount: 10,
        }),
      ),
    ).toMatchObject({ code: 'PLAYER_BANKRUPT', details: { playerId: 'b' } });
    expect(
      refusal(() =>
        playerToPlayer({
          game,
          players,
          sourcePlayerId: 'b',
          destinationPlayerId: 'a',
          amount: 10,
        }),
      ),
    ).toMatchObject({ code: 'PLAYER_BANKRUPT', details: { playerId: 'b' } });
  });

  it('a payment from a player to themselves is refused', () => {
    expect(
      refusal(() =>
        playerToPlayer({
          game,
          players: table(),
          sourcePlayerId: 'a',
          destinationPlayerId: 'a',
          amount: 10,
        }),
      ),
    ).toMatchObject({
      code: 'SAME_SOURCE_AND_DESTINATION',
      status: 400,
      message: 'The source and destination players must be different.',
    });
  });

  it('a payment to everyone skips a bankrupt player and charges only the active ones', () => {
    const players = [player('a'), player('b'), player('c', 0, 'BANKRUPT')];
    const result = playerToAll({ game, players, payerPlayerId: 'a', amountPerPlayer: 30 });
    expect(result.transaction.totalAmount).toBe(30);
    expect(result.affectedPlayers.map((change) => [change.player.id, change.balanceDelta])).toEqual(
      [
        ['a', -30],
        ['b', 30],
      ],
    );
  });

  it('a collection from everyone skips a bankrupt player', () => {
    const players = [player('a'), player('b'), player('c', 0, 'BANKRUPT')];
    const result = allToPlayer({ game, players, recipientPlayerId: 'a', amountPerPlayer: 30 });
    expect(result.transaction.totalAmount).toBe(30);
    expect(result.affectedPlayers.map((change) => [change.player.id, change.balanceDelta])).toEqual(
      [
        ['b', -30],
        ['a', 30],
      ],
    );
  });

  it.fails(
    'a payment to everyone with nobody else to pay is refused instead of recording a zero total',
    () => {
      const players = [player('a'), player('b', 0, 'BANKRUPT')];
      expect(() =>
        playerToAll({ game, players, payerPlayerId: 'a', amountPerPlayer: 30 }),
      ).toThrow();
    },
  );

  it.fails(
    'a collection from everyone with nobody else to pay is refused instead of recording a zero total',
    () => {
      const players = [player('a'), player('b', 0, 'BANKRUPT')];
      expect(() =>
        allToPlayer({ game, players, recipientPlayerId: 'a', amountPerPlayer: 30 }),
      ).toThrow();
    },
  );

  it('passing GO pays double only on an exact landing', () => {
    expect(passGo({ game, players: table(), playerId: 'a' }).transaction.amount).toBe(200);
    expect(
      passGo({ game, players: table(), playerId: 'a', exactLanding: true }).transaction.amount,
    ).toBe(400);
    expect(
      passGo({ game, players: table(), playerId: 'a', exactLanding: false }).transaction.amount,
    ).toBe(200);
  });
});

describe('total money in the game is conserved by transfers between players', () => {
  const total = (players: readonly Player[]) =>
    players.reduce((sum, item) => sum + item.balance, 0);
  const applied = (players: readonly Player[], result: BankingOperationResult): Player[] =>
    players.map((item) => {
      const change = result.affectedPlayers.find((candidate) => candidate.player.id === item.id);
      return change === undefined ? item : { ...item, balance: change.balanceAfter };
    });
  const amounts = [1, 2, 7, 10, 33, 100, 250, 333];
  const tables: Array<Player[]> = [
    [player('a', 1000), player('b', 1000)],
    [player('a', 1000), player('b', 500), player('c', 250)],
    [player('a', 400), player('b', 0), player('c', 400), player('d', 400, 'BANKRUPT')],
    ['a', 'b', 'c', 'd', 'e', 'f'].map((id, index) => player(id, 100 + index * 37)),
  ];

  it.each([
    [
      'playerToPlayer',
      (players: readonly Player[], amount: number) =>
        playerToPlayer({
          game,
          players,
          sourcePlayerId: 'a',
          destinationPlayerId: 'b',
          amount,
        }),
    ],
    [
      'playerToAll',
      (players: readonly Player[], amount: number) =>
        playerToAll({ game, players, payerPlayerId: 'a', amountPerPlayer: amount }),
    ],
    [
      'allToPlayer',
      (players: readonly Player[], amount: number) =>
        allToPlayer({ game, players, recipientPlayerId: 'a', amountPerPlayer: amount }),
    ],
  ])('%s keeps the sum of all balances and never leaves a negative one', (_name, run) => {
    for (const players of tables)
      for (const amount of amounts) {
        let result: BankingOperationResult;
        try {
          result = run(players, amount);
        } catch (error) {
          expect(error).toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
          continue;
        }
        const after = applied(players, result);
        expect(total(after)).toBe(total(players));
        for (const item of after) expect(item.balance).toBeGreaterThanOrEqual(0);
        expect(
          result.transaction.participants.reduce((sum, item) => sum + item.balanceDelta, 0),
        ).toBe(0);
        for (const change of result.affectedPlayers)
          expect(change.balanceAfter - change.balanceBefore).toBe(change.balanceDelta);
      }
  });

  it('moves money in or out of the game only through the bank', () => {
    const players = table();
    expect(
      playerToBank({ game, players, playerId: 'a', amount: 40 }).affectedPlayers.reduce(
        (sum, change) => sum + change.balanceDelta,
        0,
      ),
    ).toBe(-40);
    expect(
      bankToPlayer({ game, players, playerId: 'a', amount: 40 }).affectedPlayers.reduce(
        (sum, change) => sum + change.balanceDelta,
        0,
      ),
    ).toBe(40);
  });

  it('writes nothing when a payment is refused: the inputs are left untouched', () => {
    const players = [player('a', 10), player('b', 10)];
    const snapshot = JSON.stringify(players);
    expect(
      refusal(() =>
        playerToPlayer({
          game,
          players,
          sourcePlayerId: 'a',
          destinationPlayerId: 'b',
          amount: 11,
        }),
      ),
    ).toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    expect(JSON.stringify(players)).toBe(snapshot);
  });
});

describe('declaring bankruptcy', () => {
  it('refuses a creditor who is bankrupt, unknown or the player themselves', () => {
    const players = [player('a', 100), player('b', 100, 'BANKRUPT'), player('c')];
    expect(
      refusal(() => declareBankruptcy({ game, players, playerId: 'a', creditorPlayerId: 'b' })),
    ).toMatchObject({ code: 'PLAYER_BANKRUPT', details: { playerId: 'b' } });
    expect(
      refusal(() => declareBankruptcy({ game, players, playerId: 'a', creditorPlayerId: 'ghost' })),
    ).toMatchObject({ code: 'PLAYER_NOT_FOUND' });
    expect(
      refusal(() => declareBankruptcy({ game, players, playerId: 'a', creditorPlayerId: 'a' })),
    ).toMatchObject({ code: 'SAME_SOURCE_AND_DESTINATION', status: 400 });
  });

  it('refuses a player who is already bankrupt', () => {
    expect(
      refusal(() =>
        declareBankruptcy({
          game,
          players: [player('a', 0, 'BANKRUPT'), player('b')],
          playerId: 'a',
        }),
      ),
    ).toMatchObject({ code: 'PLAYER_BANKRUPT', details: { playerId: 'a' } });
  });

  it('hands the whole wallet to the creditor and keeps the money in the game', () => {
    const players = [player('a', 300), player('b', 50), player('c')];
    const result = declareBankruptcy({ game, players, playerId: 'a', creditorPlayerId: 'b' });
    expect(result.transaction).toMatchObject({
      type: 'BANKRUPTCY_TRANSFER',
      amount: 300,
      totalAmount: 300,
      participants: [
        { playerId: 'a', balanceDelta: -300 },
        { playerId: 'b', balanceDelta: 300 },
      ],
    });
    expect(result.affectedPlayers.map((change) => change.balanceAfter)).toEqual([0, 350]);
  });

  it('returns the wallet to the bank when there is no creditor', () => {
    const result = declareBankruptcy({
      game,
      players: [player('a', 300), player('b'), player('c')],
      playerId: 'a',
    });
    expect(result.transaction.participants).toEqual([{ playerId: 'a', balanceDelta: -300 }]);
    expect(result.affectedPlayers).toHaveLength(1);
  });

  it('records an empty wallet as a one-unit transfer that moves nothing', () => {
    const result = declareBankruptcy({
      game,
      players: [player('a', 0), player('b'), player('c')],
      playerId: 'a',
      creditorPlayerId: 'b',
    });
    expect(result.transaction).toMatchObject({ amount: 1, totalAmount: 1, participants: [] });
    expect(result.affectedPlayers).toEqual([]);
  });
});

describe('reversing a stored transaction', () => {
  const stored = (patch: Partial<Transaction> = {}): Transaction => ({
    id: 't1',
    gameId: 'g',
    type: 'PLAYER_TO_PLAYER',
    amount: 50,
    totalAmount: 50,
    comment: null,
    createdAt: '',
    participants: [
      { playerId: 'a', balanceDelta: -50 },
      { playerId: 'b', balanceDelta: 50 },
    ],
    ...patch,
  });
  const reverse = (
    original: Transaction,
    extra: Partial<Parameters<typeof reverseTransaction>[0]> = {},
    players: readonly Player[] = table(),
  ) => reverseTransaction({ game, players, original, ...extra });
  const change = (tileId: string): PropertyChange => ({
    tileId,
    before: { ownerPlayerId: null, mortgaged: false, houses: 0 },
    after: { ownerPlayerId: 'a', mortgaged: false, houses: 0 },
  });

  it('moves exactly the original amounts back and links to the original', () => {
    const result = reverse(stored());
    expect(result.transaction).toMatchObject({
      type: 'REVERSAL',
      amount: 50,
      totalAmount: 50,
      reversesTransactionId: 't1',
      participants: [
        { playerId: 'a', balanceDelta: 50 },
        { playerId: 'b', balanceDelta: -50 },
      ],
    });
    expect(result.transaction).not.toHaveProperty('registryChanges');
    expect(result.transaction).not.toHaveProperty('mortgageReversal');
    expect(result.transaction).not.toHaveProperty('tileId');
  });

  it('turns a zero delta into a plain zero, never into minus zero', () => {
    const result = reverse(
      stored({
        type: 'PROPERTY_TRANSFER',
        participants: [
          { playerId: 'a', balanceDelta: 0 },
          { playerId: 'b', balanceDelta: 0 },
        ],
      }),
      { originalRegistryChanges: [change('x')] },
    );
    for (const item of result.transaction.participants)
      expect(Object.is(item.balanceDelta, 0)).toBe(true);
  });

  it('refuses when the payee no longer holds the money, with no change written', () => {
    expect(
      refusal(() => reverse(stored(), {}, [player('a'), player('b', 49), player('c')])),
    ).toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
      details: { playerId: 'b', currentBalance: 49, requiredAmount: 50 },
    });
    expect(() => reverse(stored(), {}, [player('a'), player('b', 50), player('c')])).not.toThrow();
  });

  it('refuses when a participant is bankrupt or has left the table', () => {
    expect(
      refusal(() =>
        reverse(stored(), {}, [player('a'), player('b', 1000, 'BANKRUPT'), player('c')]),
      ),
    ).toMatchObject({ code: 'PLAYER_BANKRUPT' });
    expect(refusal(() => reverse(stored(), {}, [player('a'), player('c')]))).toMatchObject({
      code: 'PLAYER_NOT_FOUND',
    });
  });

  it('refuses a transaction of another game, one already reversed and one of a final type', () => {
    expect(refusal(() => reverse(stored({ gameId: 'other' })))).toMatchObject({
      code: 'TRANSACTION_NOT_FOUND',
      status: 404,
      details: { transactionId: 't1' },
    });
    expect(refusal(() => reverse(stored({ reversedByTransactionId: 'r9' })))).toMatchObject({
      code: 'TRANSACTION_ALREADY_REVERSED',
      status: 409,
      details: { transactionId: 't1', reversalId: 'r9' },
    });
    expect(refusal(() => reverse(stored({ type: 'BANKRUPTCY_TRANSFER' })))).toMatchObject({
      code: 'TRANSACTION_NOT_REVERSIBLE',
      status: 409,
      details: { type: 'BANKRUPTCY_TRANSFER' },
    });
  });

  it('names the later operation that blocks it, and ignores a later one by other players', () => {
    const loan = stored({
      id: 't2',
      type: 'LOAN_ISSUE',
      participants: [
        { playerId: 'b', balanceDelta: 10 },
        { playerId: 'c', balanceDelta: -10 },
      ],
    });
    expect(refusal(() => reverse(stored(), { later: [loan] }))).toMatchObject({
      code: 'REVERSAL_BLOCKED_BY_LATER_OPERATION',
      status: 409,
      details: { transactionId: 't1', blockedBy: 't2', blockedByType: 'LOAN_ISSUE' },
    });
    const unrelated = stored({
      id: 't3',
      type: 'LOAN_ISSUE',
      participants: [
        { playerId: 'c', balanceDelta: 10 },
        { playerId: 'd', balanceDelta: -10 },
      ],
    });
    expect(() => reverse(stored(), { later: [unrelated] })).not.toThrow();
  });

  it('blocks a purchase through a rent paid on its colour group only when the group is given', () => {
    const purchase = stored({
      type: 'PROPERTY_PURCHASE',
      tileId: 'g1',
      participants: [{ playerId: 'a', balanceDelta: -50 }],
    });
    const rent = stored({
      id: 't2',
      type: 'PAY_RENT',
      tileId: 'g2',
      participants: [
        { playerId: 'd', balanceDelta: -5 },
        { playerId: 'e', balanceDelta: 5 },
      ],
    });
    const extra = { originalRegistryChanges: [change('g1')], later: [rent] };
    expect(() => reverse(purchase, extra)).not.toThrow();
    expect(
      refusal(() => reverse(purchase, { ...extra, groupTileIds: ['g1', 'g2'] })),
    ).toMatchObject({
      code: 'REVERSAL_BLOCKED_BY_LATER_OPERATION',
    });
  });

  it('refuses a registry-backed transaction whose registry changes are gone', () => {
    expect(
      refusal(() =>
        reverse(
          stored({
            type: 'PROPERTY_PURCHASE',
            participants: [{ playerId: 'a', balanceDelta: -50 }],
          }),
        ),
      ),
    ).toMatchObject({ code: 'TRANSACTION_NOT_REVERSIBLE' });
    expect(
      refusal(() =>
        reverse(
          stored({ type: 'PROPERTY_TRANSFER', participants: [{ playerId: 'a', balanceDelta: 0 }] }),
        ),
      ),
    ).toMatchObject({ code: 'TRANSACTION_NOT_REVERSIBLE' });
  });

  it.each([
    ['AUCTION_PAYMENT', -50],
    ['PROPERTY_BUILD', -50],
    ['PROPERTY_SELL_BUILDING', 50],
    ['MORTGAGE', 50],
    ['MORTGAGE_REDEMPTION', -50],
  ] as const)('refuses a %s on a tile when its registry changes are gone', (type, delta) => {
    expect(
      refusal(() =>
        reverse(
          stored({ type, tileId: 'x', participants: [{ playerId: 'a', balanceDelta: delta }] }),
          {
            redeemedMortgageId: 'm1',
          },
        ),
      ),
    ).toMatchObject({ code: 'TRANSACTION_NOT_REVERSIBLE' });
  });

  it('reverses a free-text auction payment that has no tile', () => {
    const result = reverse(
      stored({ type: 'AUCTION_PAYMENT', participants: [{ playerId: 'a', balanceDelta: -50 }] }),
    );
    expect(result.transaction.participants).toEqual([{ playerId: 'a', balanceDelta: 50 }]);
  });

  it('inverts the registry changes and keeps the tile for a registry-backed original', () => {
    const result = reverse(
      stored({
        type: 'PROPERTY_PURCHASE',
        tileId: 'x',
        participants: [{ playerId: 'a', balanceDelta: -50 }],
      }),
      { originalRegistryChanges: [change('x')] },
    );
    expect(result.transaction.tileId).toBe('x');
    expect(result.transaction.registryChanges).toEqual([
      {
        tileId: 'x',
        before: { ownerPlayerId: 'a', mortgaged: false, houses: 0 },
        after: { ownerPlayerId: null, mortgaged: false, houses: 0 },
      },
    ]);
  });

  it('puts a board mortgage back in step: cancelled when reversed, restored when a redemption is', () => {
    const mortgage = stored({
      id: 'm0',
      type: 'MORTGAGE',
      tileId: 'x',
      participants: [{ playerId: 'a', balanceDelta: 50 }],
    });
    expect(
      reverse(mortgage, { originalRegistryChanges: [change('x')] }).transaction.mortgageReversal,
    ).toEqual({
      kind: 'CANCEL',
      mortgageId: 'm0',
    });
    const redemption = stored({
      id: 'm1',
      type: 'MORTGAGE_REDEMPTION',
      tileId: 'x',
      participants: [{ playerId: 'a', balanceDelta: -50 }],
    });
    expect(
      reverse(redemption, { originalRegistryChanges: [change('x')], redeemedMortgageId: 'mid' })
        .transaction.mortgageReversal,
    ).toEqual({ kind: 'RESTORE', mortgageId: 'mid' });
    expect(
      refusal(() => reverse(redemption, { originalRegistryChanges: [change('x')] })),
    ).toMatchObject({
      code: 'TRANSACTION_NOT_REVERSIBLE',
      details: { type: 'MORTGAGE_REDEMPTION' },
    });
  });

  it('conserves the money of the table', () => {
    const players = table();
    const result = reverse(stored(), {}, players);
    const before = players.reduce((sum, item) => sum + item.balance, 0);
    const after = result.affectedPlayers.reduce(
      (sum, item) => sum + item.balanceAfter - item.balanceBefore,
      0,
    );
    expect(before + after).toBe(before);
  });
});
