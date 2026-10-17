import { describe, expect, it } from 'vitest';
import type { BoardSnapshot } from '../board/types.js';
import {
  defaultGameRules,
  type Game,
  type GameProperty,
  type Mortgage,
  type Player,
  type Transaction,
} from '../types/monopoly.js';
import {
  auctionPayment,
  BankruptcyCreditorShortError,
  declareBankruptcy,
  InsufficientFundsError,
  mortgageTile,
  payRent,
  PlayerBankruptError,
  propertyPurchase,
  redeemMortgage,
  ReversalBlockedByLaterOperationError,
  reverseTransaction,
  SameSourceAndDestinationError,
  TransactionNotReversibleError,
} from './banking.js';
import { buildGameSettings } from './game-rules.js';
import {
  DiceSumError,
  PropertyAlreadyOwnedError,
  PropertyHasBuildingsError,
  PropertyMortgagedError,
  PropertyNotOwnedError,
  TileNotFoundError,
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

function property(
  overrides: Record<string, Partial<Omit<GameProperty, 'gameId' | 'tileId'>>> = {},
): PropertyContext {
  return {
    board,
    registry: board.tiles.map((tile) => ({
      gameId: game.id,
      tileId: tile.id,
      ownerPlayerId: null,
      mortgaged: false,
      houses: 0,
      ...overrides[tile.id],
    })),
  };
}

const p1 = 'player-1';
const p2 = 'player-2';

describe('propertyPurchase', () => {
  it('debits the snapshot price and gives the tile to the buyer', () => {
    const result = propertyPurchase({
      game,
      players: players([5_000_000, 5_000_000]),
      playerId: p1,
      tileId: 'zhitna',
      property: property(),
    });
    expect(result.transaction).toMatchObject({
      type: 'PROPERTY_PURCHASE',
      amount: 600_000,
      totalAmount: 600_000,
      tileId: 'zhitna',
      participants: [{ playerId: p1, balanceDelta: -600_000 }],
    });
    expect(result.transaction.registryChanges).toEqual([
      {
        tileId: 'zhitna',
        before: { ownerPlayerId: null, mortgaged: false, houses: 0 },
        after: { ownerPlayerId: p1, mortgaged: false, houses: 0 },
      },
    ]);
  });

  it('refuses a tile that has an owner', () => {
    expect(() =>
      propertyPurchase({
        game,
        players: players([5_000_000, 5_000_000]),
        playerId: p1,
        tileId: 'zhitna',
        property: property({ zhitna: { ownerPlayerId: p2 } }),
      }),
    ).toThrow(PropertyAlreadyOwnedError);
  });

  it('refuses an unknown tile', () => {
    expect(() =>
      propertyPurchase({
        game,
        players: players([5_000_000, 5_000_000]),
        playerId: p1,
        tileId: 'nowhere',
        property: property(),
      }),
    ).toThrow(TileNotFoundError);
  });

  it('refuses a buyer who cannot pay and a bankrupt buyer', () => {
    expect(() =>
      propertyPurchase({
        game,
        players: players([599_999, 5_000_000]),
        playerId: p1,
        tileId: 'zhitna',
        property: property(),
      }),
    ).toThrow(InsufficientFundsError);
    const bankrupt = players([5_000_000, 5_000_000]);
    bankrupt[0] = { ...bankrupt[0]!, status: 'BANKRUPT' };
    expect(() =>
      propertyPurchase({
        game,
        players: bankrupt,
        playerId: p1,
        tileId: 'zhitna',
        property: property(),
      }),
    ).toThrow(PlayerBankruptError);
  });
});

describe('mortgageTile', () => {
  it('pays the snapshot mortgage value and marks the tile mortgaged', () => {
    const result = mortgageTile({
      game,
      players: players([1_000_000, 1_000_000]),
      playerId: p1,
      tileId: 'zhitna',
      property: property({ zhitna: { ownerPlayerId: p1 } }),
    });
    expect(result.transaction).toMatchObject({
      type: 'MORTGAGE',
      amount: 300_000,
      comment: 'Житна вул.',
      tileId: 'zhitna',
      newMortgage: {
        playerId: p1,
        propertyName: 'Житна вул.',
        mortgageValue: 300_000,
        tileId: 'zhitna',
      },
    });
    expect(result.transaction.registryChanges?.[0]?.after.mortgaged).toBe(true);
    expect(result.affectedPlayers[0]?.balanceAfter).toBe(1_300_000);
  });

  it('refuses a tile the player does not own, one already mortgaged and one with buildings', () => {
    const base = { game, players: players([1_000_000, 1_000_000]), playerId: p1, tileId: 'zhitna' };
    expect(() => mortgageTile({ ...base, property: property() })).toThrow(PropertyNotOwnedError);
    expect(() =>
      mortgageTile({ ...base, property: property({ zhitna: { ownerPlayerId: p2 } }) }),
    ).toThrow(PropertyNotOwnedError);
    expect(() =>
      mortgageTile({
        ...base,
        property: property({ zhitna: { ownerPlayerId: p1, mortgaged: true } }),
      }),
    ).toThrow(PropertyMortgagedError);
    expect(() =>
      mortgageTile({
        ...base,
        property: property({
          zhitna: { ownerPlayerId: p1 },
          nagatinska: { ownerPlayerId: p1, houses: 1 },
        }),
      }),
    ).toThrow(PropertyHasBuildingsError);
  });
});

describe('redeemMortgage on a tile', () => {
  const mortgage: Mortgage = {
    id: 'mortgage-1',
    gameId: game.id,
    playerId: p1,
    propertyName: 'Житна вул.',
    tileId: 'zhitna',
    mortgageValue: 300_000,
    createdAt: '',
  };

  it('costs value plus 10% and clears the registry flag', () => {
    const result = redeemMortgage({
      game,
      players: players([1_000_000, 1_000_000]),
      playerId: p1,
      mortgage,
      property: property({ zhitna: { ownerPlayerId: p1, mortgaged: true } }),
    });
    expect(result.transaction).toMatchObject({
      type: 'MORTGAGE_REDEMPTION',
      amount: 330_000,
      tileId: 'zhitna',
    });
    expect(result.transaction.registryChanges?.[0]).toMatchObject({
      before: { mortgaged: true },
      after: { mortgaged: false },
    });
  });

  it('refuses when the player cannot pay', () => {
    expect(() =>
      redeemMortgage({
        game,
        players: players([329_999, 1_000_000]),
        playerId: p1,
        mortgage,
        property: property({ zhitna: { ownerPlayerId: p1, mortgaged: true } }),
      }),
    ).toThrow(InsufficientFundsError);
  });

  it('refuses when the registry no longer shows the player holding it mortgaged', () => {
    expect(() =>
      redeemMortgage({
        game,
        players: players([1_000_000, 1_000_000]),
        playerId: p1,
        mortgage,
        property: property({ zhitna: { ownerPlayerId: p1 } }),
      }),
    ).toThrow(PropertyNotOwnedError);
  });
});

describe('payRent', () => {
  it('moves the rent from the payer to the owner', () => {
    const result = payRent({
      game,
      players: players([1_000_000, 100_000]),
      payerPlayerId: p1,
      tileId: 'zhitna',
      property: property({ zhitna: { ownerPlayerId: p2 }, nagatinska: { ownerPlayerId: p2 } }),
    });
    expect(result.transaction).toMatchObject({
      type: 'PAY_RENT',
      amount: 40_000,
      totalAmount: 40_000,
      tileId: 'zhitna',
      participants: [
        { playerId: p1, balanceDelta: -40_000 },
        { playerId: p2, balanceDelta: 40_000 },
      ],
    });
    expect(result.transaction.registryChanges).toBeUndefined();
  });

  it('takes the dice sum of a utility', () => {
    const result = payRent({
      game,
      players: players([1_000_000, 100_000]),
      payerPlayerId: p1,
      tileId: 'power_plant',
      diceSum: 9,
      property: property({ power_plant: { ownerPlayerId: p2 } }),
    });
    expect(result.transaction.amount).toBe(36);
  });

  it('rejects a missing or an unexpected dice sum', () => {
    const owned = property({ power_plant: { ownerPlayerId: p2 }, zhitna: { ownerPlayerId: p2 } });
    const base = { game, players: players([1_000_000, 100_000]), payerPlayerId: p1 };
    expect(() => payRent({ ...base, tileId: 'power_plant', property: owned })).toThrow(
      DiceSumError,
    );
    expect(() => payRent({ ...base, tileId: 'zhitna', diceSum: 5, property: owned })).toThrow(
      DiceSumError,
    );
  });

  it('refuses an unowned tile, a mortgaged tile and the owner paying themselves', () => {
    const base = {
      game,
      players: players([1_000_000, 100_000]),
      payerPlayerId: p1,
      tileId: 'zhitna',
    };
    expect(() => payRent({ ...base, property: property() })).toThrow(PropertyNotOwnedError);
    expect(() =>
      payRent({ ...base, property: property({ zhitna: { ownerPlayerId: p2, mortgaged: true } }) }),
    ).toThrow(PropertyMortgagedError);
    expect(() =>
      payRent({ ...base, property: property({ zhitna: { ownerPlayerId: p1 } }) }),
    ).toThrow(SameSourceAndDestinationError);
  });

  it('refuses a payer who cannot cover the rent and changes nothing', () => {
    expect(() =>
      payRent({
        game,
        players: players([39_999, 100_000]),
        payerPlayerId: p1,
        tileId: 'zhitna',
        property: property({ zhitna: { ownerPlayerId: p2 }, nagatinska: { ownerPlayerId: p2 } }),
      }),
    ).toThrow(InsufficientFundsError);
  });
});

describe('auctionPayment with a tile', () => {
  it('hands the unowned tile to the winner', () => {
    const result = auctionPayment({
      game,
      players: players([5_000_000, 5_000_000]),
      playerId: p2,
      amount: 700_000,
      lotName: 'Житна вул.',
      tileId: 'zhitna',
      property: property(),
    });
    expect(result.transaction.tileId).toBe('zhitna');
    expect(result.transaction.registryChanges?.[0]?.after.ownerPlayerId).toBe(p2);
  });

  it('refuses a tile that gained an owner meanwhile', () => {
    expect(() =>
      auctionPayment({
        game,
        players: players([5_000_000, 5_000_000]),
        playerId: p2,
        amount: 700_000,
        lotName: 'Житна вул.',
        tileId: 'zhitna',
        property: property({ zhitna: { ownerPlayerId: p1 } }),
      }),
    ).toThrow(PropertyAlreadyOwnedError);
  });

  it('stays a plain payment without a tile', () => {
    const result = auctionPayment({
      game,
      players: players([5_000_000, 5_000_000]),
      playerId: p2,
      amount: 700_000,
      lotName: 'Free text',
    });
    expect(result.transaction.registryChanges).toBeUndefined();
    expect(result.transaction.tileId).toBeUndefined();
  });
});

describe('reversing registry operations', () => {
  const purchase: Transaction = {
    id: 'tx-purchase',
    gameId: game.id,
    type: 'PROPERTY_PURCHASE',
    amount: 600_000,
    totalAmount: 600_000,
    comment: null,
    createdAt: '',
    tileId: 'zhitna',
    participants: [{ playerId: p1, balanceDelta: -600_000 }],
  };
  const originalChanges = [
    {
      tileId: 'zhitna',
      before: { ownerPlayerId: null, mortgaged: false, houses: 0 },
      after: { ownerPlayerId: p1, mortgaged: false, houses: 0 },
    },
  ];

  it('returns the money and the tile to the bank with the inverse change', () => {
    const result = reverseTransaction({
      game,
      players: players([1_000_000, 1_000_000]),
      original: purchase,
      originalRegistryChanges: originalChanges,
    });
    expect(result.transaction).toMatchObject({
      type: 'REVERSAL',
      reversesTransactionId: 'tx-purchase',
      tileId: 'zhitna',
      participants: [{ playerId: p1, balanceDelta: 600_000 }],
    });
    expect(result.transaction.registryChanges).toEqual([
      {
        tileId: 'zhitna',
        before: originalChanges[0]?.after,
        after: originalChanges[0]?.before,
      },
    ]);
  });

  it('cannot reverse a purchase whose registry changes are missing', () => {
    expect(() =>
      reverseTransaction({ game, players: players([1_000_000, 1_000_000]), original: purchase }),
    ).toThrow(TransactionNotReversibleError);
  });

  it('is blocked by a later registry operation on the same tile', () => {
    const later: Transaction = {
      id: 'tx-mortgage',
      gameId: game.id,
      type: 'MORTGAGE',
      amount: 300_000,
      totalAmount: 300_000,
      comment: null,
      createdAt: '',
      tileId: 'zhitna',
      participants: [{ playerId: p2, balanceDelta: 300_000 }],
    };
    expect(findReversalDependency(purchase, [later])).toBe(later);
    expect(() =>
      reverseTransaction({
        game,
        players: players([1_000_000, 1_000_000]),
        original: purchase,
        originalRegistryChanges: originalChanges,
        later: [later],
      }),
    ).toThrow(ReversalBlockedByLaterOperationError);
  });

  it('ignores a later operation on another tile or one that was reversed itself', () => {
    const other: Transaction = {
      id: 'tx-other',
      gameId: game.id,
      type: 'PROPERTY_PURCHASE',
      amount: 1,
      totalAmount: 1,
      comment: null,
      createdAt: '',
      tileId: 'nagatinska',
      participants: [{ playerId: p2, balanceDelta: -1 }],
    };
    expect(findReversalDependency(purchase, [other])).toBeNull();
    expect(
      findReversalDependency(purchase, [
        { ...other, tileId: 'zhitna', reversedByTransactionId: 'r' },
      ]),
    ).toBeNull();
  });

  it('keeps a free-text mortgage and redemption non-reversible', () => {
    for (const type of ['MORTGAGE', 'MORTGAGE_REDEMPTION'] as const) {
      const { tileId: _tileId, ...freeText } = purchase;
      expect(() =>
        reverseTransaction({
          game,
          players: players([1_000_000, 1_000_000]),
          original: { ...freeText, type },
        }),
      ).toThrow(TransactionNotReversibleError);
    }
  });

  const mortgageTx: Transaction = {
    ...purchase,
    id: 'tx-mortgage',
    type: 'MORTGAGE',
    amount: 300_000,
    totalAmount: 300_000,
    participants: [{ playerId: p1, balanceDelta: 300_000 }],
  };
  const mortgageChanges = [
    {
      tileId: 'zhitna',
      before: { ownerPlayerId: p1, mortgaged: false, houses: 0 },
      after: { ownerPlayerId: p1, mortgaged: true, houses: 0 },
    },
  ];

  it('reverses a board mortgage: money back, flag off, mortgage row cancelled', () => {
    const result = reverseTransaction({
      game,
      players: players([1_000_000, 1_000_000]),
      original: mortgageTx,
      originalRegistryChanges: mortgageChanges,
    });
    expect(result.transaction).toMatchObject({
      type: 'REVERSAL',
      participants: [{ playerId: p1, balanceDelta: -300_000 }],
      mortgageReversal: { kind: 'CANCEL', mortgageId: 'tx-mortgage' },
    });
    expect(result.transaction.registryChanges?.[0]?.after.mortgaged).toBe(false);
  });

  it('refuses to reverse a mortgage when the player no longer holds the money', () => {
    expect(() =>
      reverseTransaction({
        game,
        players: players([100_000, 1_000_000]),
        original: mortgageTx,
        originalRegistryChanges: mortgageChanges,
      }),
    ).toThrow(InsufficientFundsError);
  });

  it('reverses a board redemption: money back, flag on, mortgage row restored', () => {
    const redemption: Transaction = {
      ...mortgageTx,
      id: 'tx-redeem',
      type: 'MORTGAGE_REDEMPTION',
      amount: 330_000,
      totalAmount: 330_000,
      participants: [{ playerId: p1, balanceDelta: -330_000 }],
    };
    const changes = [
      {
        tileId: 'zhitna',
        before: mortgageChanges[0]!.after,
        after: mortgageChanges[0]!.before,
      },
    ];
    const result = reverseTransaction({
      game,
      players: players([1_000_000, 1_000_000]),
      original: redemption,
      originalRegistryChanges: changes,
      redeemedMortgageId: 'tx-mortgage',
    });
    expect(result.transaction).toMatchObject({
      participants: [{ playerId: p1, balanceDelta: 330_000 }],
      mortgageReversal: { kind: 'RESTORE', mortgageId: 'tx-mortgage' },
    });
    expect(result.transaction.registryChanges?.[0]?.after.mortgaged).toBe(true);
    // Without the mortgage row the redemption cannot be put back in step.
    expect(() =>
      reverseTransaction({
        game,
        players: players([1_000_000, 1_000_000]),
        original: redemption,
        originalRegistryChanges: changes,
      }),
    ).toThrow(TransactionNotReversibleError);
  });

  it('blocks reversing a mortgage once it was redeemed, and a redemption once re-mortgaged', () => {
    const redemption: Transaction = {
      ...mortgageTx,
      id: 'tx-redeem',
      type: 'MORTGAGE_REDEMPTION',
      participants: [{ playerId: p1, balanceDelta: -330_000 }],
    };
    expect(findReversalDependency(mortgageTx, [redemption])).toBe(redemption);
    const again: Transaction = { ...mortgageTx, id: 'tx-again' };
    expect(findReversalDependency(redemption, [again])).toBe(again);
  });

  it('blocks reversing a purchase while rent was paid on a tile of its colour group', () => {
    const rent: Transaction = {
      ...purchase,
      id: 'tx-rent',
      type: 'PAY_RENT',
      tileId: 'nagatinska',
      participants: [
        { playerId: p2, balanceDelta: -40_000 },
        { playerId: p1, balanceDelta: 40_000 },
      ],
    };
    // Without the board the check cannot know the group, the Worker passes it.
    expect(findReversalDependency(purchase, [rent])).toBeNull();
    expect(findReversalDependency(purchase, [rent], ['zhitna', 'nagatinska'])).toBe(rent);
    expect(findReversalDependency(purchase, [rent], ['other'])).toBeNull();
    expect(() =>
      reverseTransaction({
        game,
        players: players([1_000_000, 1_000_000]),
        original: purchase,
        originalRegistryChanges: originalChanges,
        later: [rent],
        groupTileIds: ['zhitna', 'nagatinska'],
      }),
    ).toThrow(ReversalBlockedByLaterOperationError);
  });

  it('settles a tile auction as a PROPERTY_PURCHASE at the winning bid', () => {
    const result = auctionPayment({
      game,
      players: players([1_000_000, 1_000_000]),
      playerId: p1,
      amount: 700_000,
      lotName: 'Житна',
      tileId: 'zhitna',
      property: property(),
    });
    expect(result.transaction).toMatchObject({
      type: 'PROPERTY_PURCHASE',
      amount: 700_000,
      tileId: 'zhitna',
    });
    expect(result.transaction.priceOverridden).toBeUndefined();
  });

  it('buys at an overridden price and marks it, but not at the list price', () => {
    const base = {
      game,
      players: players([1_000_000, 1_000_000]),
      playerId: p1,
      tileId: 'zhitna',
      property: property(),
    };
    const list = propertyPurchase(base).transaction;
    const overridden = propertyPurchase({ ...base, priceOverride: 250_000 }).transaction;
    expect(overridden).toMatchObject({ amount: 250_000, priceOverridden: true });
    expect(
      propertyPurchase({ ...base, priceOverride: list.amount }).transaction.priceOverridden,
    ).toBe(undefined);
    expect(() => propertyPurchase({ ...base, priceOverride: 0 })).toThrow();
    expect(() => propertyPurchase({ ...base, priceOverride: 2_000_000 })).toThrow(
      InsufficientFundsError,
    );
  });

  it('reverses rent like a player payment', () => {
    const rent: Transaction = {
      ...purchase,
      id: 'tx-rent',
      type: 'PAY_RENT',
      amount: 40_000,
      totalAmount: 40_000,
      participants: [
        { playerId: p1, balanceDelta: -40_000 },
        { playerId: p2, balanceDelta: 40_000 },
      ],
    };
    const result = reverseTransaction({
      game,
      players: players([1_000_000, 1_000_000]),
      original: rent,
    });
    expect(result.transaction.registryChanges).toBeUndefined();
    expect(result.transaction.participants).toEqual([
      { playerId: p1, balanceDelta: 40_000 },
      { playerId: p2, balanceDelta: -40_000 },
    ]);
  });
});

describe('bankruptcy of a tile owner', () => {
  const ownership = {
    zhitna: { ownerPlayerId: p1 },
    nagatinska: { ownerPlayerId: p1, mortgaged: true },
    riga_rail: { ownerPlayerId: p2 },
  };

  it('passes the tiles to the creditor, keeping the mortgage flag', () => {
    const result = declareBankruptcy({
      game,
      players: players([1_000_000, 1_000_000, 1_000_000]),
      playerId: p1,
      creditorPlayerId: p2,
      property: property(ownership),
    });
    const changes = result.transaction.registryChanges ?? [];
    expect(changes.map((change) => change.tileId).sort()).toEqual(['nagatinska', 'zhitna']);
    expect(changes.find((change) => change.tileId === 'nagatinska')?.after).toEqual({
      ownerPlayerId: p2,
      mortgaged: true,
      houses: 0,
    });
  });

  it('returns the tiles to the bank unmortgaged when the bank is the creditor', () => {
    const result = declareBankruptcy({
      game,
      players: players([1_000_000, 1_000_000, 1_000_000]),
      playerId: p1,
      property: property(ownership),
    });
    for (const change of result.transaction.registryChanges ?? [])
      expect(change.after).toEqual({ ownerPlayerId: null, mortgaged: false, houses: 0 });
  });

  it('writes no registry changes for a legacy game', () => {
    const result = declareBankruptcy({
      game,
      players: players([1_000_000, 1_000_000, 1_000_000]),
      playerId: p1,
    });
    expect(result.transaction.registryChanges).toBeUndefined();
  });
});

describe('bankruptcy with buildings and mortgages', () => {
  const bankrupt = (
    balances: readonly number[],
    overrides: Record<string, Partial<GameProperty>>,
    creditorPlayerId: string | null = p2,
  ) =>
    declareBankruptcy({
      game,
      players: players(balances),
      playerId: p1,
      ...(creditorPlayerId === null ? {} : { creditorPlayerId }),
      property: property(overrides),
    });
  // Brown houses cost 500_000, so each building sold back pays 250_000.
  const built = {
    zhitna: { ownerPlayerId: p1, houses: 2 },
    nagatinska: { ownerPlayerId: p1, houses: 1 },
  };

  it('sells every building to the bank first: the proceeds go to the creditor with the cash', () => {
    const result = bankrupt([100_000, 1_000_000, 1_000_000], built);
    expect(result.transaction).toMatchObject({
      type: 'BANKRUPTCY_TRANSFER',
      amount: 100_000 + 3 * 250_000,
      participants: [
        { playerId: p1, balanceDelta: -100_000 },
        { playerId: p2, balanceDelta: 100_000 + 3 * 250_000 },
      ],
    });
    for (const change of result.transaction.registryChanges ?? []) {
      expect(change.after.houses).toBe(0);
      expect(change.after.ownerPlayerId).toBe(p2);
    }
    expect(
      result.transaction.registryChanges?.map((change) => change.before.houses).sort(),
    ).toEqual([1, 2]);
  });

  it('counts a hotel as five buildings', () => {
    const result = bankrupt([0, 1_000_000, 1_000_000], {
      zhitna: { ownerPlayerId: p1, houses: 5 },
      nagatinska: { ownerPlayerId: p1, houses: 4 },
    });
    expect(result.transaction.amount).toBe(9 * 250_000);
    // No cash of their own: the bankrupt player has no balance change, only the creditor does.
    expect(result.transaction.participants).toEqual([{ playerId: p2, balanceDelta: 9 * 250_000 }]);
  });

  it('puts the proceeds in the bank loan debt before the creditor', () => {
    const loan = {
      id: 'loan-1',
      gameId: game.id,
      lenderKind: 'BANK' as const,
      lenderPlayerId: null,
      borrowerPlayerId: p1,
      principal: 600_000,
      repaidAmount: 0,
      state: 'ACTIVE' as const,
      createdAt: '',
    };
    const result = declareBankruptcy({
      game,
      players: players([100_000, 1_000_000, 1_000_000]),
      playerId: p1,
      creditorPlayerId: p2,
      property: property(built),
      bankLoan: { loan, suggestedRatePercent: 0 },
    });
    expect(result.transaction.bankLoanSettlement).toMatchObject({
      outcome: 'REPAID',
      paidPrincipal: 600_000,
    });
    // 100_000 cash + 750_000 proceeds - 600_000 to the bank.
    expect(result.transaction.participants[1]).toEqual({ playerId: p2, balanceDelta: 250_000 });
  });

  it('charges the creditor 10% of the mortgage value for each inherited mortgaged tile', () => {
    const result = bankrupt([100_000, 1_000_000, 1_000_000], {
      zhitna: { ownerPlayerId: p1, mortgaged: true },
      nagatinska: { ownerPlayerId: p1, mortgaged: true },
    });
    // 60_000 in fees (30_000 each) out of the creditor's 100_000 share.
    expect(result.transaction.participants).toEqual([
      { playerId: p1, balanceDelta: -100_000 },
      { playerId: p2, balanceDelta: 100_000 - 60_000 },
    ]);
    expect(result.transaction.registryChanges?.every((change) => change.after.mortgaged)).toBe(
      true,
    );
  });

  it('can charge a creditor more than they receive, from their own cash', () => {
    const result = bankrupt([0, 1_000_000, 1_000_000], {
      zhitna: { ownerPlayerId: p1, mortgaged: true },
    });
    expect(result.transaction.participants).toEqual([{ playerId: p2, balanceDelta: -30_000 }]);
  });

  it('rejects before anything is written when the creditor cannot pay the fees', () => {
    const attempt = () =>
      bankrupt([10_000, 10_000, 1_000_000], { zhitna: { ownerPlayerId: p1, mortgaged: true } });
    expect(attempt).toThrow(BankruptcyCreditorShortError);
    try {
      attempt();
    } catch (error) {
      // 10_000 own cash + 10_000 share = 20_000 available against a 30_000 fee.
      expect((error as BankruptcyCreditorShortError).details).toEqual({
        creditorPlayerId: p2,
        required: 30_000,
        available: 20_000,
        shortfall: 10_000,
      });
    }
  });

  it('charges no fee when the bank is the creditor: tiles return unowned, unmortgaged, unbuilt', () => {
    const result = bankrupt(
      [100_000, 1_000_000, 1_000_000],
      {
        zhitna: { ownerPlayerId: p1, mortgaged: true, houses: 0 },
        nagatinska: { ownerPlayerId: p1, houses: 0 },
      },
      null,
    );
    expect(result.transaction.participants).toEqual([{ playerId: p1, balanceDelta: -100_000 }]);
    for (const change of result.transaction.registryChanges ?? [])
      expect(change.after).toEqual({ ownerPlayerId: null, mortgaged: false, houses: 0 });
  });

  it('records the sale proceeds of a bank bankruptcy in the amount, with one change per tile', () => {
    const result = bankrupt([50_000, 1_000_000, 1_000_000], built, null);
    expect(result.transaction.amount).toBe(50_000 + 3 * 250_000);
    expect(result.transaction.registryChanges).toHaveLength(2);
  });
});
