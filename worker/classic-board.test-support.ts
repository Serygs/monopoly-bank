import type { BoardDefinition, BoardSpace, BuildingBank, ColorGroup, GameProperty } from '../shared/types/monopoly.js';

/**
 * The classic board exactly as `migrations/0018_board_catalog.sql` seeds it, so
 * a test that sizes a snapshot or ranks capital does it against the real
 * catalogue and not a four-space stand-in.
 */
export const classicBoard: BoardDefinition = { id: 'board-classic', name: 'Classic', jailFee: 50, unmortgageInterestPercent: 10, houseBankLimit: 32, hotelBankLimit: 12, utilityMultiplierSingle: 4, utilityMultiplierPair: 10 };

export const classicBuildingBank: BuildingBank = { housesAvailable: 32, hotelsAvailable: 12 };

type Row = [index: number, group: ColorGroup, key: string, price: number, houseCost: number | null, rents: number[]];

const streetRows: Row[] = [
  [1, 'BROWN', 'boardSpaceMediterraneanAvenue', 60, 50, [2, 10, 30, 90, 160, 250]],
  [3, 'BROWN', 'boardSpaceBalticAvenue', 60, 50, [4, 20, 60, 180, 320, 450]],
  [5, 'RAILROAD', 'boardSpaceReadingRailroad', 200, null, [25, 50, 100, 200]],
  [6, 'LIGHT_BLUE', 'boardSpaceOrientalAvenue', 100, 50, [6, 30, 90, 270, 400, 550]],
  [8, 'LIGHT_BLUE', 'boardSpaceVermontAvenue', 100, 50, [6, 30, 90, 270, 400, 550]],
  [9, 'LIGHT_BLUE', 'boardSpaceConnecticutAvenue', 120, 50, [8, 40, 100, 300, 450, 600]],
  [11, 'PINK', 'boardSpaceStCharlesPlace', 140, 100, [10, 50, 150, 450, 625, 750]],
  [12, 'UTILITY', 'boardSpaceElectricCompany', 150, null, []],
  [13, 'PINK', 'boardSpaceStatesAvenue', 140, 100, [10, 50, 150, 450, 625, 750]],
  [14, 'PINK', 'boardSpaceVirginiaAvenue', 160, 100, [12, 60, 180, 500, 700, 900]],
  [15, 'RAILROAD', 'boardSpacePennsylvaniaRailroad', 200, null, [25, 50, 100, 200]],
  [16, 'ORANGE', 'boardSpaceStJamesPlace', 180, 100, [14, 70, 200, 550, 750, 950]],
  [18, 'ORANGE', 'boardSpaceTennesseeAvenue', 180, 100, [14, 70, 200, 550, 750, 950]],
  [19, 'ORANGE', 'boardSpaceNewYorkAvenue', 200, 100, [16, 80, 220, 600, 800, 1000]],
  [21, 'RED', 'boardSpaceKentuckyAvenue', 220, 150, [18, 90, 250, 700, 875, 1050]],
  [23, 'RED', 'boardSpaceIndianaAvenue', 220, 150, [18, 90, 250, 700, 875, 1050]],
  [24, 'RED', 'boardSpaceIllinoisAvenue', 240, 150, [20, 100, 300, 750, 925, 1100]],
  [25, 'RAILROAD', 'boardSpaceBAndORailroad', 200, null, [25, 50, 100, 200]],
  [26, 'YELLOW', 'boardSpaceAtlanticAvenue', 260, 150, [22, 110, 330, 800, 975, 1150]],
  [27, 'YELLOW', 'boardSpaceVentnorAvenue', 260, 150, [22, 110, 330, 800, 975, 1150]],
  [28, 'UTILITY', 'boardSpaceWaterWorks', 150, null, []],
  [29, 'YELLOW', 'boardSpaceMarvinGardens', 280, 150, [24, 120, 360, 850, 1025, 1200]],
  [31, 'GREEN', 'boardSpacePacificAvenue', 300, 200, [26, 130, 390, 900, 1100, 1275]],
  [32, 'GREEN', 'boardSpaceNorthCarolinaAvenue', 300, 200, [26, 130, 390, 900, 1100, 1275]],
  [34, 'GREEN', 'boardSpacePennsylvaniaAvenue', 320, 200, [28, 150, 450, 1000, 1200, 1400]],
  [35, 'RAILROAD', 'boardSpaceShortLine', 200, null, [25, 50, 100, 200]],
  [37, 'DARK_BLUE', 'boardSpaceParkPlace', 350, 200, [35, 175, 500, 1100, 1300, 1500]],
  [39, 'DARK_BLUE', 'boardSpaceBoardwalk', 400, 200, [50, 200, 600, 1400, 1700, 2000]],
];

export const classicSpaces: BoardSpace[] = streetRows.map(([boardIndex, colorGroup, translationKey, price, houseCost, rents]) => ({
  id: `board-classic-space-${String(boardIndex).padStart(2, '0')}`,
  boardIndex,
  kind: colorGroup === 'RAILROAD' ? 'RAILROAD' : colorGroup === 'UTILITY' ? 'UTILITY' : 'STREET',
  colorGroup,
  translationKey,
  customName: null,
  price,
  mortgageValue: price / 2,
  houseCost,
  rents,
}));

/** Every deed free, the state a new game on the classic board starts in. */
export function emptyClassicProperties(): GameProperty[] {
  return classicSpaces.map((space) => ({ boardSpaceId: space.id, ownerPlayerId: null, houses: 0, mortgaged: false }));
}
