import { describe, expect, it } from 'vitest';
import type { BoardSnapshot } from '../board/types.js';
import {
  defaultGameRules,
  type Game,
  type GameProperty,
  type Player,
  type Transaction,
} from '../types/monopoly.js';
import {
  buildProperty,
  InsufficientFundsError,
  ReversalBlockedByLaterOperationError,
  reverseTransaction,
  sellBuilding,
} from './banking.js';
import { buildGameSettings } from './game-rules.js';
import {
  BuildMortgagedGroupError,
  BuildRequiresFullGroupError,
  BuildUnevenError,
  canBuild,
  canSellBuilding,
  InvalidBuildTargetError,
  MaxBuildingsError,
  NoBuildingsError,
  PropertyNotOwnedError,
  TileNotBuildableError,
  type PropertyContext,
} from './property.js';
import { findReversalDependency } from './reversal.js';

const settings = buildGameSettings(15_000_000, 'monopoly-ru-2012');
const board = settings.board as BoardSnapshot;
const game: Game = {
  id: 'game-1',
  name: 'Board game',
  startingBalance: 15_000_000,
  passGoReward: 2_000_000,
  currency: 'M',
  paymentMode: 'FAST',
  rules: defaultGameRules,
  settings,
  status: 'ACTIVE',
  createdAt: '',
  updatedAt: '',
};
const p1 = 'player-1';
const p2 = 'player-2';

function players(balances: readonly number[]): Player[] {
  return balances.map((balance, index) => ({
    id: `player-${index + 1}`,
    gameId: game.id,
    name: `Player ${index + 1}`,
    color: `color-${index + 1}`,
    balance,
    createdAt: '',
  }));
}

/** Player 1 holds the whole brown group with the given houses; everything else is free. */
function context(
  zhitna = 0,
  nagatinska = 0,
  extra: Record<string, Partial<GameProperty>> = {},
  useBoard: BoardSnapshot = board,
): PropertyContext {
  const owned: Record<string, Partial<GameProperty>> = {
    zhitna: { ownerPlayerId: p1, houses: zhitna, ...extra.zhitna },
    nagatinska: { ownerPlayerId: p1, houses: nagatinska, ...extra.nagatinska },
  };
  for (const [tileId, values] of Object.entries(extra))
    if (owned[tileId] === undefined) owned[tileId] = values;
  return {
    board: useBoard,
    registry: useBoard.tiles.map((tile) => ({
      gameId: game.id,
      tileId: tile.id,
      ownerPlayerId: null,
      mortgaged: false,
      houses: 0,
      ...owned[tile.id],
    })),
  };
}

const build = (property: PropertyContext, tileId = 'zhitna', balance = 15_000_000) =>
  buildProperty({ game, players: players([balance, 1_000_000]), playerId: p1, tileId, property });
const sell = (property: PropertyContext, tileId = 'zhitna') =>
  sellBuilding({
    game,
    players: players([1_000_000, 1_000_000]),
    playerId: p1,
    tileId,
    property,
  });

describe('building a house', () => {
  it('charges one house cost to the bank and adds one building', () => {
    const result = build(context());
    expect(result.transaction).toMatchObject({
      type: 'PROPERTY_BUILD',
      amount: 500_000,
      totalAmount: 500_000,
      tileId: 'zhitna',
      participants: [{ playerId: p1, balanceDelta: -500_000 }],
    });
    expect(result.transaction.registryChanges).toEqual([
      {
        tileId: 'zhitna',
        before: { ownerPlayerId: p1, mortgaged: false, houses: 0 },
        after: { ownerPlayerId: p1, mortgaged: false, houses: 1 },
      },
    ]);
  });

  it('builds the hotel as the fifth building for one more house cost', () => {
    const result = build(context(4, 4));
    expect(result.transaction.amount).toBe(500_000);
    expect(result.transaction.registryChanges?.[0]?.after.houses).toBe(5);
  });

  it('requires even building across the group', () => {
    expect(() => build(context(1, 0))).toThrow(BuildUnevenError);
    expect(() => build(context(1, 0), 'nagatinska')).not.toThrow();
    expect(() => build(context(1, 1))).not.toThrow();
    expect(() => build(context(2, 1), 'nagatinska')).not.toThrow();
  });

  it('refuses a fifth-plus building', () => {
    expect(() => build(context(5, 5))).toThrow(MaxBuildingsError);
  });

  it('requires the whole colour group', () => {
    expect(() => build(context(0, 0, { nagatinska: { ownerPlayerId: p2 } }))).toThrow(
      BuildRequiresFullGroupError,
    );
    expect(() => build(context(0, 0, { nagatinska: { ownerPlayerId: null } }))).toThrow(
      BuildRequiresFullGroupError,
    );
  });

  it('refuses when any tile of the group is mortgaged', () => {
    expect(() => build(context(0, 0, { nagatinska: { mortgaged: true } }))).toThrow(
      BuildMortgagedGroupError,
    );
    expect(() => build(context(0, 0, { zhitna: { mortgaged: true } }))).toThrow(
      BuildMortgagedGroupError,
    );
  });

  it('is for the owner and for streets only', () => {
    expect(() =>
      buildProperty({
        game,
        players: players([15_000_000, 1_000_000]),
        playerId: p2,
        tileId: 'zhitna',
        property: context(),
      }),
    ).toThrow(PropertyNotOwnedError);
    const railway = board.tiles.find((tile) => tile.type === 'railway')!;
    expect(() => build(context(0, 0, { [railway.id]: { ownerPlayerId: p1 } }), railway.id)).toThrow(
      TileNotBuildableError,
    );
  });

  it('refuses without the money and writes nothing', () => {
    expect(() => build(context(), 'zhitna', 499_999)).toThrow(InsufficientFundsError);
  });

  it('can be previewed with canBuild', () => {
    const { registry } = context(1, 0);
    expect(canBuild(board, registry, 'zhitna', p1)).toBe(false);
    expect(canBuild(board, registry, 'nagatinska', p1)).toBe(true);
    expect(canBuild(board, registry, 'unknown', p1)).toBe(false);
  });
});

describe('selling a building', () => {
  it('pays back half the house cost and removes one building', () => {
    const result = sell(context(2, 2));
    expect(result.transaction).toMatchObject({
      type: 'PROPERTY_SELL_BUILDING',
      amount: 250_000,
      participants: [{ playerId: p1, balanceDelta: 250_000 }],
    });
    expect(result.transaction.registryChanges?.[0]?.after.houses).toBe(1);
  });

  it('turns a hotel back into four houses', () => {
    expect(sell(context(5, 4)).transaction.registryChanges?.[0]?.after.houses).toBe(4);
  });

  it('rounds the refund down', () => {
    const odd: BoardSnapshot = {
      ...board,
      tiles: board.tiles.map((tile) =>
        tile.group === 'brown' ? { ...tile, houseCost: 333_333 } : tile,
      ),
    };
    expect(sell(context(1, 1, {}, odd)).transaction.amount).toBe(166_666);
  });

  it('requires even selling and a building to sell', () => {
    expect(() => sell(context(1, 2))).toThrow(BuildUnevenError);
    expect(() => sell(context(1, 2), 'nagatinska')).not.toThrow();
    expect(() => sell(context(0, 0))).toThrow(NoBuildingsError);
  });

  it('is for the owner', () => {
    expect(canSellBuilding(board, context(1, 1).registry, 'zhitna', p2)).toBe(false);
  });
});

describe('reversing buildings', () => {
  const buildTx: Transaction = {
    id: 'tx-build',
    gameId: game.id,
    type: 'PROPERTY_BUILD',
    amount: 500_000,
    totalAmount: 500_000,
    comment: null,
    createdAt: '',
    tileId: 'zhitna',
    participants: [{ playerId: p1, balanceDelta: -500_000 }],
  };
  const buildChanges = [
    {
      tileId: 'zhitna',
      before: { ownerPlayerId: p1, mortgaged: false, houses: 0 },
      after: { ownerPlayerId: p1, mortgaged: false, houses: 1 },
    },
  ];

  it('returns the money and removes the building', () => {
    const result = reverseTransaction({
      game,
      players: players([1_000_000, 1_000_000]),
      original: buildTx,
      originalRegistryChanges: buildChanges,
    });
    expect(result.transaction.participants).toEqual([{ playerId: p1, balanceDelta: 500_000 }]);
    expect(result.transaction.registryChanges?.[0]?.after.houses).toBe(0);
  });

  it('reversing a sale takes the refund back and restores the building', () => {
    const saleTx: Transaction = {
      ...buildTx,
      id: 'tx-sell',
      type: 'PROPERTY_SELL_BUILDING',
      amount: 250_000,
      totalAmount: 250_000,
      participants: [{ playerId: p1, balanceDelta: 250_000 }],
    };
    const result = reverseTransaction({
      game,
      players: players([1_000_000, 1_000_000]),
      original: saleTx,
      originalRegistryChanges: [
        { tileId: 'zhitna', before: buildChanges[0]!.after, after: buildChanges[0]!.before },
      ],
    });
    expect(result.transaction.participants).toEqual([{ playerId: p1, balanceDelta: -250_000 }]);
    expect(result.transaction.registryChanges?.[0]?.after.houses).toBe(1);
  });

  it('cannot be reversed without its registry changes', () => {
    expect(() =>
      reverseTransaction({ game, players: players([1_000_000, 1_000_000]), original: buildTx }),
    ).toThrow();
  });

  it('is blocked by later building, rent or mortgage on the colour group', () => {
    const later = (type: Transaction['type'], tileId: string): Transaction => ({
      ...buildTx,
      id: `later-${type}-${tileId}`,
      type,
      tileId,
      participants: [{ playerId: p2, balanceDelta: 1 }],
    });
    const group = ['zhitna', 'nagatinska'];
    for (const type of [
      'PROPERTY_BUILD',
      'PROPERTY_SELL_BUILDING',
      'PAY_RENT',
      'MORTGAGE',
    ] as const) {
      const blocker = later(type, 'nagatinska');
      expect(findReversalDependency(buildTx, [blocker], group)).toBe(blocker);
      expect(findReversalDependency(buildTx, [blocker], [])).toBeNull();
    }
    expect(findReversalDependency(buildTx, [later('PAY_RENT', 'other')], group)).toBeNull();
    expect(() =>
      reverseTransaction({
        game,
        players: players([1_000_000, 1_000_000]),
        original: buildTx,
        originalRegistryChanges: buildChanges,
        later: [later('PROPERTY_BUILD', 'nagatinska')],
        groupTileIds: group,
      }),
    ).toThrow(ReversalBlockedByLaterOperationError);
  });

  it('a later build on the group blocks reversing the purchase that completed it', () => {
    const purchase: Transaction = { ...buildTx, id: 'tx-purchase', type: 'PROPERTY_PURCHASE' };
    const later: Transaction = { ...buildTx, id: 'tx-b', tileId: 'nagatinska' };
    expect(findReversalDependency(purchase, [later], ['zhitna', 'nagatinska'])).toBe(later);
  });
});

describe('building a whole colour group at once', () => {
  const lightblue = ['varshavske', 'ogarova', 'persha_parkova'];
  /** Player 1 holds the light blue group with the given houses. */
  const group = (
    houses: readonly [number, number, number] = [0, 0, 0],
    extra: Record<string, Partial<GameProperty>> = {},
  ): PropertyContext => ({
    board,
    registry: board.tiles.map((tile) => {
      const index = lightblue.indexOf(tile.id);
      return {
        gameId: game.id,
        tileId: tile.id,
        ownerPlayerId: index === -1 ? null : p1,
        mortgaged: false,
        houses: index === -1 ? 0 : (houses[index] ?? 0),
        ...extra[tile.id],
      };
    }),
  });
  const buildMany = (
    property: PropertyContext,
    targets: Record<string, number>,
    balance = 15_000_000,
  ) =>
    buildProperty({
      game,
      players: players([balance, 1_000_000]),
      playerId: p1,
      targets,
      property,
    });
  const sellMany = (property: PropertyContext, targets: Record<string, number>) =>
    sellBuilding({
      game,
      players: players([1_000_000, 1_000_000]),
      playerId: p1,
      targets,
      property,
    });

  it('builds several streets as one operation with one diff per street', () => {
    const result = buildMany(group(), { varshavske: 1, ogarova: 1, persha_parkova: 1 });
    expect(result.transaction).toMatchObject({
      type: 'PROPERTY_BUILD',
      amount: 1_500_000,
      totalAmount: 1_500_000,
      tileId: 'varshavske',
      participants: [{ playerId: p1, balanceDelta: -1_500_000 }],
    });
    expect(result.transaction.registryChanges?.map((change) => change.tileId)).toEqual(lightblue);
    expect(result.affectedPlayers).toHaveLength(1);
  });

  it('prices every added building, hotel included', () => {
    const result = buildMany(group([3, 3, 3]), { varshavske: 5, ogarova: 4, persha_parkova: 4 });
    expect(result.transaction.amount).toBe(4 * 500_000);
    expect(result.transaction.registryChanges?.map((change) => change.after.houses)).toEqual([
      5, 4, 4,
    ]);
  });

  it('leaves streets out of the targets at their level', () => {
    const result = buildMany(group([1, 1, 1]), { varshavske: 2 });
    expect(result.transaction.registryChanges).toHaveLength(1);
  });

  it('validates the final state, not the order', () => {
    // Uneven in the middle of the plan, but 2/1/1 at the end.
    expect(() => buildMany(group([1, 1, 1]), { persha_parkova: 2 })).not.toThrow();
    expect(() => buildMany(group([0, 0, 0]), { varshavske: 2, ogarova: 0 })).toThrow(
      BuildUnevenError,
    );
    expect(() =>
      buildMany(group([0, 0, 0]), { varshavske: 1, ogarova: 1, persha_parkova: 0 }),
    ).not.toThrow();
  });

  it('refuses an uneven target and writes nothing', () => {
    expect(() => buildMany(group(), { varshavske: 2, ogarova: 1, persha_parkova: 0 })).toThrow(
      BuildUnevenError,
    );
  });

  it('allows any target when even building is off', () => {
    const loose: BoardSnapshot = { ...board, rules: { ...board.rules, buildEvenly: false } };
    const property = { ...group(), board: loose };
    expect(() => buildMany(property, { varshavske: 5 })).not.toThrow();
  });

  it('refuses when the group has a mortgaged tile', () => {
    expect(() =>
      buildMany(group([0, 0, 0], { ogarova: { mortgaged: true } }), { varshavske: 1 }),
    ).toThrow(BuildMortgagedGroupError);
  });

  it('refuses a partial group and a foreign street', () => {
    expect(() =>
      buildMany(group([0, 0, 0], { ogarova: { ownerPlayerId: p2 } }), { varshavske: 1 }),
    ).toThrow(BuildRequiresFullGroupError);
    expect(() =>
      buildMany(group([0, 0, 0], { ogarova: { ownerPlayerId: p2 } }), { ogarova: 1 }),
    ).toThrow(PropertyNotOwnedError);
  });

  it('refuses levels out of range, other groups, empty plans and wrong direction', () => {
    expect(() => buildMany(group(), { varshavske: 6 })).toThrow(InvalidBuildTargetError);
    expect(() => buildMany(group(), { varshavske: -1 })).toThrow(InvalidBuildTargetError);
    expect(() => buildMany(group(), { varshavske: 1.5 })).toThrow(InvalidBuildTargetError);
    expect(() => buildMany(group(), {})).toThrow(InvalidBuildTargetError);
    expect(() => buildMany(group([1, 1, 1]), { varshavske: 1 })).toThrow(InvalidBuildTargetError);
    expect(() => buildMany(group([2, 2, 2]), { varshavske: 1 })).toThrow(InvalidBuildTargetError);
    expect(() => buildMany(group(), { varshavske: 1, zhitna: 1 })).toThrow(InvalidBuildTargetError);
    expect(() => sellMany(group([1, 1, 1]), { varshavske: 2 })).toThrow(InvalidBuildTargetError);
  });

  it('checks the cash once for the whole plan', () => {
    expect(() =>
      buildMany(group(), { varshavske: 1, ogarova: 1, persha_parkova: 1 }, 1_499_999),
    ).toThrow(InsufficientFundsError);
    expect(() =>
      buildMany(group(), { varshavske: 1, ogarova: 1, persha_parkova: 1 }, 1_500_000),
    ).not.toThrow();
  });

  it('sells several buildings and refunds each', () => {
    const result = sellMany(group([2, 2, 2]), { varshavske: 1, ogarova: 1, persha_parkova: 1 });
    expect(result.transaction).toMatchObject({
      type: 'PROPERTY_SELL_BUILDING',
      amount: 3 * 250_000,
      participants: [{ playerId: p1, balanceDelta: 750_000 }],
    });
    expect(() => sellMany(group([2, 2, 2]), { varshavske: 0 })).toThrow(BuildUnevenError);
  });

  it('reverses a multi-street build as a unit', () => {
    const built = buildMany(group(), { varshavske: 1, ogarova: 1, persha_parkova: 1 });
    const original: Transaction = {
      id: 'tx-multi',
      gameId: game.id,
      type: 'PROPERTY_BUILD',
      amount: built.transaction.amount,
      totalAmount: built.transaction.totalAmount,
      comment: null,
      createdAt: '',
      participants: [{ playerId: p1, balanceDelta: -1_500_000 }],
      tileId: 'varshavske',
      tileIds: lightblue,
      reversesTransactionId: null,
      reversedByTransactionId: null,
    };
    const reversal = reverseTransaction({
      game,
      players: players([13_500_000, 1_000_000]),
      original,
      originalRegistryChanges: built.transaction.registryChanges ?? [],
      groupTileIds: lightblue,
    });
    expect(reversal.transaction.participants).toEqual([{ playerId: p1, balanceDelta: 1_500_000 }]);
    expect(reversal.transaction.registryChanges?.map((change) => change.after.houses)).toEqual([
      0, 0, 0,
    ]);
    // A later operation on any street of the group blocks it.
    const later: Transaction = {
      ...original,
      id: 'tx-later',
      type: 'PAY_RENT',
      tileId: 'ogarova',
      tileIds: undefined,
    };
    expect(findReversalDependency(original, [later], lightblue)).toBe(later);
  });
});
