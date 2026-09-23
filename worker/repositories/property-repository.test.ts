import { describe, expect, it } from 'vitest';

import { D1PropertyRepository } from './property-repository.js';

const boardRow = { id: 'board-classic', name: 'Classic', owner_user_id: null, source_board_id: null, jail_fee: 50, unmortgage_interest_percent: 10, house_bank_limit: 32, hotel_bank_limit: 12, utility_multiplier_single: 4, utility_multiplier_pair: 10, created_at: '2026-01-01' };
const street = { id: 'space-01', board_index: 1, kind: 'STREET', color_group: 'BROWN', translation_key: 'boardSpaceMediterraneanAvenue', custom_name: null, price: 60, mortgage_value: 30, house_cost: 50, rent_base: 2, rent_house_1: 10, rent_house_2: 30, rent_house_3: 90, rent_house_4: 160, rent_hotel: 250 };
const railroad = { ...street, id: 'space-05', board_index: 5, kind: 'RAILROAD', color_group: 'RAILROAD', translation_key: 'boardSpaceReadingRailroad', price: 200, mortgage_value: 100, house_cost: null, rent_base: 25, rent_house_1: 50, rent_house_2: 100, rent_house_3: 200, rent_house_4: null, rent_hotel: null };
const utility = { ...street, id: 'space-12', board_index: 12, kind: 'UTILITY', color_group: 'UTILITY', translation_key: 'boardSpaceElectricCompany', price: 150, mortgage_value: 75, house_cost: null, rent_base: null, rent_house_1: null, rent_house_2: null, rent_house_3: null, rent_house_4: null, rent_hotel: null };

describe('D1PropertyRepository', () => {
  it('loads the board, its spaces, the ownership rows and the bank in one batch', async () => {
    const database = new FakeDatabase([
      [{ ...boardRow, houses_available: 30, hotels_available: 12 }],
      [street, railroad, utility],
      [{ board_space_id: 'space-01', owner_player_id: 'ada', houses: 2, mortgaged: 0 }, { board_space_id: 'space-05', owner_player_id: null, houses: 0, mortgaged: 0 }],
    ]);
    const slice = await new D1PropertyRepository(database as unknown as D1Database).loadPropertySlice('game-1');

    expect(database.batches).toHaveLength(1);
    expect(database.batches[0]).toHaveLength(3);
    expect(database.batches[0].every((statement) => statement.values[0] === 'game-1')).toBe(true);
    expect(database.batches[0][0].query).toContain('INNER JOIN board_definitions ON board_definitions.id = games.board_id');
    expect(slice?.board).toEqual({ id: 'board-classic', name: 'Classic', jailFee: 50, unmortgageInterestPercent: 10, houseBankLimit: 32, hotelBankLimit: 12, utilityMultiplierSingle: 4, utilityMultiplierPair: 10 });
    expect(slice?.board).not.toHaveProperty('ownerUserId');
    expect(slice?.buildingBank).toEqual({ housesAvailable: 30, hotelsAvailable: 12 });
    expect(slice?.properties).toEqual([{ boardSpaceId: 'space-01', ownerPlayerId: 'ada', houses: 2, mortgaged: false }, { boardSpaceId: 'space-05', ownerPlayerId: null, houses: 0, mortgaged: false }]);
  });

  it('collapses the six rent columns into the levels each kind of space has', async () => {
    const database = new FakeDatabase([[{ ...boardRow, houses_available: 32, hotels_available: 12 }], [street, railroad, utility], []]);
    const slice = await new D1PropertyRepository(database as unknown as D1Database).loadPropertySlice('game-1');
    expect(slice?.boardSpaces.map((space) => space.rents)).toEqual([[2, 10, 30, 90, 160, 250], [25, 50, 100, 200], []]);
    expect(slice?.boardSpaces[1]).toMatchObject({ kind: 'RAILROAD', houseCost: null, customName: null });
  });

  it('returns null for a game that never opted into a board', async () => {
    const database = new FakeDatabase([[], [], []]);
    await expect(new D1PropertyRepository(database as unknown as D1Database).loadPropertySlice('game-legacy')).resolves.toBeNull();
  });

  it('writes a board copy and all of its spaces in one batch, mapping rents back onto the six columns', async () => {
    const database = new FakeDatabase([]);
    await new D1PropertyRepository(database as unknown as D1Database).createBoard({
      board: { id: 'board-copy', name: 'Kyiv', ownerUserId: 'user-1', sourceBoardId: 'board-classic', jailFee: 50, unmortgageInterestPercent: 10, houseBankLimit: 32, hotelBankLimit: 12, utilityMultiplierSingle: 4, utilityMultiplierPair: 10 },
      spaces: [
        { id: 'copy-01', boardIndex: 1, kind: 'STREET', colorGroup: 'BROWN', translationKey: 'boardSpaceMediterraneanAvenue', customName: 'Khreshchatyk', price: 60, mortgageValue: 30, houseCost: 50, rents: [2, 10, 30, 90, 160, 250] },
        { id: 'copy-05', boardIndex: 5, kind: 'RAILROAD', colorGroup: 'RAILROAD', translationKey: 'boardSpaceReadingRailroad', customName: 'Central station', price: 200, mortgageValue: 100, houseCost: null, rents: [25, 50, 100, 200] },
      ],
    });
    expect(database.batches).toHaveLength(1);
    expect(database.batches[0]).toHaveLength(3);
    expect(database.batches[0][0].values).toEqual(['board-copy', 'Kyiv', 'user-1', 'board-classic', 50, 10, 32, 12, 4, 10]);
    expect(database.batches[0][1].values).toEqual(['copy-01', 'board-copy', 1, 'STREET', 'BROWN', 'boardSpaceMediterraneanAvenue', 'Khreshchatyk', 60, 30, 50, 2, 10, 30, 90, 160, 250]);
    expect(database.batches[0][2].values).toEqual(['copy-05', 'board-copy', 5, 'RAILROAD', 'RAILROAD', 'boardSpaceReadingRailroad', 'Central station', 200, 100, null, 25, 50, 100, 200, null, null]);
  });

  it('checks board visibility through game membership rather than ownership alone', async () => {
    const database = new FakeDatabase([]);
    database.firstResult = { value: 1 };
    await expect(new D1PropertyRepository(database as unknown as D1Database).isBoardVisibleThroughGame('board-copy', 'user-2')).resolves.toBe(true);
    const statement = database.statements.at(-1);
    expect(statement?.query).toContain('INNER JOIN game_members ON game_members.game_id = games.id');
    expect(statement?.values).toEqual(['board-copy', 'user-2']);
  });
});

class FakeDatabase {
  readonly batches: FakeStatement[][] = [];
  readonly statements: FakeStatement[] = [];
  firstResult: unknown = null;
  private readonly batchResults: unknown[][];
  constructor(batchResults: unknown[][]) { this.batchResults = batchResults; }
  prepare(query: string): FakeStatement { const statement = new FakeStatement(query, this); this.statements.push(statement); return statement; }
  async batch(statements: FakeStatement[]): Promise<Array<{ results: unknown[] }>> { this.batches.push(statements); return statements.map((_, index) => ({ results: this.batchResults[index] ?? [] })); }
}

class FakeStatement {
  values: unknown[] = [];
  constructor(readonly query: string, private readonly database: FakeDatabase) {}
  bind(...values: unknown[]): this { this.values = values; return this; }
  async first<T>(): Promise<T | null> { return this.database.firstResult as T | null; }
  async all<T>(): Promise<{ results: T[] }> { return { results: [] }; }
  async run(): Promise<{ meta: { changes: number } }> { return { meta: { changes: 1 } }; }
}
