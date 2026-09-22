import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'migrations/0018_board_catalog.sql'), 'utf8');

type SeededSpace = {
  id: string;
  boardIndex: number;
  kind: string;
  colorGroup: string;
  translationKey: string;
  customName: string | null;
  price: number;
  mortgageValue: number;
  houseCost: number | null;
  rents: (number | null)[];
};

// The row pattern pins the column order of the seed INSERT as well as its values:
// transposing two columns stops the row from matching and fails the row count.
const seedRowPattern = new RegExp(
  String.raw`^ {2}\('(board-classic-space-\d{2})', 'board-classic', (\d+), '(\w+)', '(\w+)', '(\w+)', ` +
    String.raw`(NULL|'[^']*'), (\d+), (\d+), (NULL|\d+), ` +
    String.raw`(NULL|\d+), (NULL|\d+), (NULL|\d+), (NULL|\d+), (NULL|\d+), (NULL|\d+)\)[,;]$`,
  'gm',
);

const nullableNumber = (value: string): number | null => (value === 'NULL' ? null : Number(value));

const seededSpaces: SeededSpace[] = [...source.matchAll(seedRowPattern)].map((row) => ({
  id: row[1],
  boardIndex: Number(row[2]),
  kind: row[3],
  colorGroup: row[4],
  translationKey: row[5],
  customName: row[6] === 'NULL' ? null : row[6].slice(1, -1),
  price: Number(row[7]),
  mortgageValue: Number(row[8]),
  houseCost: nullableNumber(row[9]),
  rents: [row[10], row[11], row[12], row[13], row[14], row[15]].map(nullableNumber),
}));

const spaceByIndex = new Map(seededSpaces.map((space) => [space.boardIndex, space]));

// Transcribed from plan/board-catalog-reference.md: price, house cost and the six
// rent levels (base / 1 / 2 / 3 / 4 houses / hotel) of every street.
const expectedStreets: { boardIndex: number; translationKey: string; colorGroup: string; price: number; houseCost: number; rents: number[] }[] = [
  { boardIndex: 1, translationKey: 'boardSpaceMediterraneanAvenue', colorGroup: 'BROWN', price: 60, houseCost: 50, rents: [2, 10, 30, 90, 160, 250] },
  { boardIndex: 3, translationKey: 'boardSpaceBalticAvenue', colorGroup: 'BROWN', price: 60, houseCost: 50, rents: [4, 20, 60, 180, 320, 450] },
  { boardIndex: 6, translationKey: 'boardSpaceOrientalAvenue', colorGroup: 'LIGHT_BLUE', price: 100, houseCost: 50, rents: [6, 30, 90, 270, 400, 550] },
  { boardIndex: 8, translationKey: 'boardSpaceVermontAvenue', colorGroup: 'LIGHT_BLUE', price: 100, houseCost: 50, rents: [6, 30, 90, 270, 400, 550] },
  { boardIndex: 9, translationKey: 'boardSpaceConnecticutAvenue', colorGroup: 'LIGHT_BLUE', price: 120, houseCost: 50, rents: [8, 40, 100, 300, 450, 600] },
  { boardIndex: 11, translationKey: 'boardSpaceStCharlesPlace', colorGroup: 'PINK', price: 140, houseCost: 100, rents: [10, 50, 150, 450, 625, 750] },
  { boardIndex: 13, translationKey: 'boardSpaceStatesAvenue', colorGroup: 'PINK', price: 140, houseCost: 100, rents: [10, 50, 150, 450, 625, 750] },
  { boardIndex: 14, translationKey: 'boardSpaceVirginiaAvenue', colorGroup: 'PINK', price: 160, houseCost: 100, rents: [12, 60, 180, 500, 700, 900] },
  { boardIndex: 16, translationKey: 'boardSpaceStJamesPlace', colorGroup: 'ORANGE', price: 180, houseCost: 100, rents: [14, 70, 200, 550, 750, 950] },
  { boardIndex: 18, translationKey: 'boardSpaceTennesseeAvenue', colorGroup: 'ORANGE', price: 180, houseCost: 100, rents: [14, 70, 200, 550, 750, 950] },
  { boardIndex: 19, translationKey: 'boardSpaceNewYorkAvenue', colorGroup: 'ORANGE', price: 200, houseCost: 100, rents: [16, 80, 220, 600, 800, 1000] },
  { boardIndex: 21, translationKey: 'boardSpaceKentuckyAvenue', colorGroup: 'RED', price: 220, houseCost: 150, rents: [18, 90, 250, 700, 875, 1050] },
  { boardIndex: 23, translationKey: 'boardSpaceIndianaAvenue', colorGroup: 'RED', price: 220, houseCost: 150, rents: [18, 90, 250, 700, 875, 1050] },
  { boardIndex: 24, translationKey: 'boardSpaceIllinoisAvenue', colorGroup: 'RED', price: 240, houseCost: 150, rents: [20, 100, 300, 750, 925, 1100] },
  { boardIndex: 26, translationKey: 'boardSpaceAtlanticAvenue', colorGroup: 'YELLOW', price: 260, houseCost: 150, rents: [22, 110, 330, 800, 975, 1150] },
  { boardIndex: 27, translationKey: 'boardSpaceVentnorAvenue', colorGroup: 'YELLOW', price: 260, houseCost: 150, rents: [22, 110, 330, 800, 975, 1150] },
  { boardIndex: 29, translationKey: 'boardSpaceMarvinGardens', colorGroup: 'YELLOW', price: 280, houseCost: 150, rents: [24, 120, 360, 850, 1025, 1200] },
  { boardIndex: 31, translationKey: 'boardSpacePacificAvenue', colorGroup: 'GREEN', price: 300, houseCost: 200, rents: [26, 130, 390, 900, 1100, 1275] },
  { boardIndex: 32, translationKey: 'boardSpaceNorthCarolinaAvenue', colorGroup: 'GREEN', price: 300, houseCost: 200, rents: [26, 130, 390, 900, 1100, 1275] },
  { boardIndex: 34, translationKey: 'boardSpacePennsylvaniaAvenue', colorGroup: 'GREEN', price: 320, houseCost: 200, rents: [28, 150, 450, 1000, 1200, 1400] },
  { boardIndex: 37, translationKey: 'boardSpaceParkPlace', colorGroup: 'DARK_BLUE', price: 350, houseCost: 200, rents: [35, 175, 500, 1100, 1300, 1500] },
  { boardIndex: 39, translationKey: 'boardSpaceBoardwalk', colorGroup: 'DARK_BLUE', price: 400, houseCost: 200, rents: [50, 200, 600, 1400, 1700, 2000] },
];

// Railroads share one price and one rent ladder, keyed by how many the owner holds.
const expectedRailroads = [
  { boardIndex: 5, translationKey: 'boardSpaceReadingRailroad' },
  { boardIndex: 15, translationKey: 'boardSpacePennsylvaniaRailroad' },
  { boardIndex: 25, translationKey: 'boardSpaceBAndORailroad' },
  { boardIndex: 35, translationKey: 'boardSpaceShortLine' },
];
const expectedRailroadRents: (number | null)[] = [25, 50, 100, 200, null, null];

// Utility rent is the dice total times the board multiplier, so no level is stored.
const expectedUtilities = [
  { boardIndex: 12, translationKey: 'boardSpaceElectricCompany' },
  { boardIndex: 28, translationKey: 'boardSpaceWaterWorks' },
];

const expectedStreetGroupSizes: Record<string, number> = {
  BROWN: 2,
  LIGHT_BLUE: 3,
  PINK: 3,
  ORANGE: 3,
  RED: 3,
  YELLOW: 3,
  GREEN: 3,
  DARK_BLUE: 2,
};

describe('0018 board catalog migration', () => {
  it('creates the board definition dictionary with bounded board parameters', () => {
    expect(source).toContain('CREATE TABLE board_definitions');
    expect(source).toContain('owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE');
    expect(source).toContain('source_board_id TEXT REFERENCES board_definitions(id)');
    expect(source).toContain('jail_fee INTEGER NOT NULL CHECK (jail_fee > 0)');
    expect(source).toContain('CHECK (unmortgage_interest_percent BETWEEN 0 AND 100)');
    expect(source).toContain('house_bank_limit INTEGER NOT NULL');
    expect(source).toContain('hotel_bank_limit INTEGER NOT NULL');
    expect(source).toContain('utility_multiplier_single INTEGER NOT NULL');
    expect(source).toContain('utility_multiplier_pair INTEGER NOT NULL');
  });

  it('creates board spaces keyed for the composite ownership foreign key', () => {
    expect(source).toContain('CREATE TABLE board_spaces');
    expect(source).toContain('board_id TEXT NOT NULL REFERENCES board_definitions(id) ON DELETE CASCADE');
    expect(source).toContain('CHECK (board_index BETWEEN 0 AND 39)');
    expect(source).toContain("CHECK (kind IN ('STREET', 'RAILROAD', 'UTILITY'))");
    expect(source).toContain('price INTEGER NOT NULL CHECK (price > 0)');
    expect(source).toContain('mortgage_value INTEGER NOT NULL CHECK (mortgage_value > 0)');
    expect(source).toContain('custom_name TEXT');
    expect(source).toContain('UNIQUE (board_id, board_index)');
    expect(source).toContain('UNIQUE (id, board_id)');
    expect(source).toContain('CREATE INDEX board_spaces_by_board ON board_spaces(board_id, board_index)');
    for (const column of ['rent_base', 'rent_house_1', 'rent_house_2', 'rent_house_3', 'rent_house_4', 'rent_hotel']) {
      expect(source).toContain(`${column} INTEGER CHECK (${column} IS NULL OR ${column} > 0)`);
    }
  });

  it('seeds the canonical board as an unowned fixed identifier', () => {
    expect(source).toContain('INSERT INTO board_definitions');
    expect(source).toContain("VALUES ('board-classic', 'Classic', NULL, NULL, 50, 10, 32, 12, 4, 10)");
  });

  it('inserts the seed columns in the order the expected table assumes', () => {
    expect(source).toContain(
      'id, board_id, board_index, kind, color_group, translation_key, custom_name,\n'
        + '  price, mortgage_value, house_cost,\n'
        + '  rent_base, rent_house_1, rent_house_2, rent_house_3, rent_house_4, rent_hotel',
    );
  });

  it('seeds exactly 28 ownable spaces priced at 5690 in total', () => {
    expect(seededSpaces).toHaveLength(28);
    expect(seededSpaces.reduce((total, space) => total + space.price, 0)).toBe(5690);
    for (const space of seededSpaces) {
      expect(space.mortgageValue * 2).toBe(space.price);
      expect(space.price).toBeGreaterThan(0);
      expect(space.customName).toBeNull();
      expect(space.translationKey.startsWith('boardSpace')).toBe(true);
    }
  });

  it('pins every street price, house cost and six-level rent ladder to the reference board', () => {
    const seededStreets = seededSpaces.filter((space) => space.kind === 'STREET');
    expect(seededStreets).toHaveLength(expectedStreets.length);

    for (const expected of expectedStreets) {
      const space = spaceByIndex.get(expected.boardIndex);
      expect(space, `no seeded space at board index ${expected.boardIndex}`).toBeDefined();
      expect({
        boardIndex: space?.boardIndex,
        kind: space?.kind,
        colorGroup: space?.colorGroup,
        translationKey: space?.translationKey,
        price: space?.price,
        mortgageValue: space?.mortgageValue,
        houseCost: space?.houseCost,
        rents: space?.rents,
      }).toEqual({
        boardIndex: expected.boardIndex,
        kind: 'STREET',
        colorGroup: expected.colorGroup,
        translationKey: expected.translationKey,
        price: expected.price,
        mortgageValue: expected.price / 2,
        houseCost: expected.houseCost,
        rents: expected.rents,
      });
    }
  });

  it('pins the four railroads to one price and the shared four-level rent ladder', () => {
    const seededRailroads = seededSpaces.filter((space) => space.kind === 'RAILROAD');
    expect(seededRailroads).toHaveLength(expectedRailroads.length);

    for (const expected of expectedRailroads) {
      const space = spaceByIndex.get(expected.boardIndex);
      expect(space, `no seeded space at board index ${expected.boardIndex}`).toBeDefined();
      expect({
        boardIndex: space?.boardIndex,
        kind: space?.kind,
        colorGroup: space?.colorGroup,
        translationKey: space?.translationKey,
        price: space?.price,
        mortgageValue: space?.mortgageValue,
        houseCost: space?.houseCost,
        rents: space?.rents,
      }).toEqual({
        boardIndex: expected.boardIndex,
        kind: 'RAILROAD',
        colorGroup: 'RAILROAD',
        translationKey: expected.translationKey,
        price: 200,
        mortgageValue: 100,
        houseCost: null,
        rents: expectedRailroadRents,
      });
    }
  });

  it('leaves every utility rent level NULL because utility rent is dice driven', () => {
    const seededUtilities = seededSpaces.filter((space) => space.kind === 'UTILITY');
    expect(seededUtilities).toHaveLength(expectedUtilities.length);

    for (const expected of expectedUtilities) {
      const space = spaceByIndex.get(expected.boardIndex);
      expect(space, `no seeded space at board index ${expected.boardIndex}`).toBeDefined();
      expect({
        boardIndex: space?.boardIndex,
        kind: space?.kind,
        colorGroup: space?.colorGroup,
        translationKey: space?.translationKey,
        price: space?.price,
        mortgageValue: space?.mortgageValue,
        houseCost: space?.houseCost,
        rents: space?.rents,
      }).toEqual({
        boardIndex: expected.boardIndex,
        kind: 'UTILITY',
        colorGroup: 'UTILITY',
        translationKey: expected.translationKey,
        price: 150,
        mortgageValue: 75,
        houseCost: null,
        rents: [null, null, null, null, null, null],
      });
    }
  });

  it('keeps rent ladders monotonically increasing so no level is transposed', () => {
    for (const space of seededSpaces) {
      const levels = space.rents.filter((rent): rent is number => rent !== null);
      for (let level = 1; level < levels.length; level += 1) {
        expect(levels[level], `${space.translationKey} rent level ${level} is not above the level below it`)
          .toBeGreaterThan(levels[level - 1]);
      }
    }
  });

  it('seeds 22 streets, 4 railroads and 2 utilities on distinct board indexes', () => {
    expect(seededSpaces.filter((space) => space.kind === 'STREET')).toHaveLength(22);
    expect(seededSpaces.filter((space) => space.kind === 'RAILROAD')).toHaveLength(4);
    expect(seededSpaces.filter((space) => space.kind === 'UTILITY')).toHaveLength(2);

    const boardIndexes = seededSpaces.map((space) => space.boardIndex);
    expect(new Set(boardIndexes).size).toBe(28);
    expect(Math.min(...boardIndexes)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...boardIndexes)).toBeLessThanOrEqual(39);

    const streetGroups: Record<string, number> = {};
    for (const space of seededSpaces.filter((candidate) => candidate.kind === 'STREET')) {
      streetGroups[space.colorGroup] = (streetGroups[space.colorGroup] ?? 0) + 1;
    }
    expect(streetGroups).toEqual(expectedStreetGroupSizes);
  });

  it('adds games.board_id additively so existing games stay valid with NULL', () => {
    expect(source).toContain('ALTER TABLE games ADD COLUMN board_id TEXT REFERENCES board_definitions(id);');
    expect(source).not.toMatch(/ADD COLUMN board_id[^;]*NOT NULL/i);
    expect(source).not.toMatch(/ADD COLUMN board_id[^;]*DEFAULT/i);
  });
});
