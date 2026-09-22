import type { PropertyStateResponse } from '../../shared/contracts/api.js';
import type { BoardDefinition, BoardSpace, BoardSpaceKind, BuildingBank, ColorGroup, GameProperty } from '../../shared/types/monopoly.js';
import { DatabaseError } from '../services/errors.js';

interface BoardRow {
  id: string;
  name: string;
  owner_user_id: string | null;
  source_board_id: string | null;
  jail_fee: number;
  unmortgage_interest_percent: number;
  house_bank_limit: number;
  hotel_bank_limit: number;
  utility_multiplier_single: number;
  utility_multiplier_pair: number;
  created_at: string;
}

interface BoardWithBankRow extends BoardRow {
  houses_available: number | null;
  hotels_available: number | null;
}

interface BoardSpaceRow {
  id: string;
  board_index: number;
  kind: BoardSpaceKind;
  color_group: ColorGroup;
  translation_key: string;
  custom_name: string | null;
  price: number;
  mortgage_value: number;
  house_cost: number | null;
  rent_base: number | null;
  rent_house_1: number | null;
  rent_house_2: number | null;
  rent_house_3: number | null;
  rent_house_4: number | null;
  rent_hotel: number | null;
}

interface GamePropertyRow {
  board_space_id: string;
  owner_player_id: string | null;
  houses: number;
  mortgaged: number;
}

interface BuildingBankRow {
  houses_available: number;
  hotels_available: number;
}

/** A catalogue row with the ownership columns the board service needs and the wire shape leaves out. */
export interface StoredBoard extends BoardDefinition {
  ownerUserId: string | null;
  sourceBoardId: string | null;
  createdAt: string;
}

export interface CreateBoardSpaceInput {
  id: string;
  boardIndex: number;
  kind: BoardSpaceKind;
  colorGroup: ColorGroup;
  translationKey: string;
  customName: string | null;
  price: number;
  mortgageValue: number;
  houseCost: number | null;
  rents: readonly number[];
}

export interface CreateBoardInput {
  board: Omit<StoredBoard, 'createdAt'>;
  spaces: readonly CreateBoardSpaceInput[];
}

/**
 * Reads the board catalogue and a game's ownership rows. Ownership is written
 * only by `D1BankingOperationRepository.persist`, inside the same batch as the
 * transaction it belongs to; this repository never updates `game_properties`.
 * Board copies are the one thing it creates, because they are catalogue rows,
 * not game state.
 */
export interface PropertyRepository {
  getBoard(boardId: string): Promise<StoredBoard | null>;
  listSpaces(boardId: string): Promise<BoardSpace[]>;
  listProperties(gameId: string): Promise<GameProperty[]>;
  getBuildingBank(gameId: string): Promise<BuildingBank | null>;
  /** Board, spaces, ownership and bank in one batch; `null` when the game has no board. */
  loadPropertySlice(gameId: string): Promise<PropertyStateResponse | null>;
  listBoardsForUser(userId: string): Promise<StoredBoard[]>;
  countBoardsOwnedBy(userId: string): Promise<number>;
  createBoard(input: CreateBoardInput): Promise<void>;
  /** Whether `userId` is a member of any game that plays on `boardId`. */
  isBoardVisibleThroughGame(boardId: string, userId: string): Promise<boolean>;
  countGamesUsingBoard(boardId: string): Promise<number>;
  deleteBoard(boardId: string, ownerUserId: string): Promise<boolean>;
}

const boardColumns = 'id, name, owner_user_id, source_board_id, jail_fee, unmortgage_interest_percent, house_bank_limit, hotel_bank_limit, utility_multiplier_single, utility_multiplier_pair, created_at';
const spaceColumns = 'id, board_index, kind, color_group, translation_key, custom_name, price, mortgage_value, house_cost, rent_base, rent_house_1, rent_house_2, rent_house_3, rent_house_4, rent_hotel';
const rentColumns = ['rent_base', 'rent_house_1', 'rent_house_2', 'rent_house_3', 'rent_house_4', 'rent_hotel'] as const;

export class D1PropertyRepository implements PropertyRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async getBoard(boardId: string): Promise<StoredBoard | null> {
    const row = await this.database.prepare(`SELECT ${boardColumns} FROM board_definitions WHERE id = ?`).bind(boardId).first<BoardRow>();
    return row === null ? null : mapBoard(row);
  }

  async listSpaces(boardId: string): Promise<BoardSpace[]> {
    const result = await this.database.prepare(`SELECT ${spaceColumns} FROM board_spaces WHERE board_id = ? ORDER BY board_index ASC`).bind(boardId).all<BoardSpaceRow>();
    return result.results.map(mapSpace);
  }

  async listProperties(gameId: string): Promise<GameProperty[]> {
    const result = await this.database.prepare('SELECT board_space_id, owner_player_id, houses, mortgaged FROM game_properties WHERE game_id = ? ORDER BY board_space_id ASC').bind(gameId).all<GamePropertyRow>();
    return result.results.map(mapProperty);
  }

  async getBuildingBank(gameId: string): Promise<BuildingBank | null> {
    const row = await this.database.prepare('SELECT houses_available, hotels_available FROM game_building_banks WHERE game_id = ?').bind(gameId).first<BuildingBankRow>();
    return row === null ? null : { housesAvailable: row.houses_available, hotelsAvailable: row.hotels_available };
  }

  async loadPropertySlice(gameId: string): Promise<PropertyStateResponse | null> {
    const boardStatement = this.database.prepare(
      `SELECT ${boardColumns.split(', ').map((column) => `board_definitions.${column}`).join(', ')}, game_building_banks.houses_available, game_building_banks.hotels_available
       FROM games
       INNER JOIN board_definitions ON board_definitions.id = games.board_id
       LEFT JOIN game_building_banks ON game_building_banks.game_id = games.id
       WHERE games.id = ?`,
    ).bind(gameId);
    const spacesStatement = this.database.prepare(
      `SELECT ${spaceColumns.split(', ').map((column) => `board_spaces.${column}`).join(', ')}
       FROM games
       INNER JOIN board_spaces ON board_spaces.board_id = games.board_id
       WHERE games.id = ?
       ORDER BY board_spaces.board_index ASC`,
    ).bind(gameId);
    const propertiesStatement = this.database.prepare('SELECT board_space_id, owner_player_id, houses, mortgaged FROM game_properties WHERE game_id = ? ORDER BY board_space_id ASC').bind(gameId);

    const [boardResult, spacesResult, propertiesResult] = await this.database.batch<BoardWithBankRow | BoardSpaceRow | GamePropertyRow>([boardStatement, spacesStatement, propertiesStatement]);
    const boardRow = (boardResult.results as BoardWithBankRow[])[0];
    if (boardRow === undefined) return null;
    const board = toBoardDefinition(mapBoard(boardRow));
    return {
      board,
      boardSpaces: (spacesResult.results as BoardSpaceRow[]).map(mapSpace),
      properties: (propertiesResult.results as GamePropertyRow[]).map(mapProperty),
      buildingBank: { housesAvailable: boardRow.houses_available ?? board.houseBankLimit, hotelsAvailable: boardRow.hotels_available ?? board.hotelBankLimit },
    };
  }

  async listBoardsForUser(userId: string): Promise<StoredBoard[]> {
    const result = await this.database.prepare(
      `SELECT ${boardColumns} FROM board_definitions WHERE owner_user_id IS NULL OR owner_user_id = ?
       ORDER BY CASE WHEN owner_user_id IS NULL THEN 0 ELSE 1 END, created_at DESC, id ASC`,
    ).bind(userId).all<BoardRow>();
    return result.results.map(mapBoard);
  }

  async countBoardsOwnedBy(userId: string): Promise<number> {
    const row = await this.database.prepare('SELECT COUNT(*) AS total FROM board_definitions WHERE owner_user_id = ?').bind(userId).first<{ total: number }>();
    return row?.total ?? 0;
  }

  async createBoard(input: CreateBoardInput): Promise<void> {
    const board = input.board;
    const boardStatement = this.database.prepare(
      `INSERT INTO board_definitions (id, name, owner_user_id, source_board_id, jail_fee, unmortgage_interest_percent, house_bank_limit, hotel_bank_limit, utility_multiplier_single, utility_multiplier_pair)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(board.id, board.name, board.ownerUserId, board.sourceBoardId, board.jailFee, board.unmortgageInterestPercent, board.houseBankLimit, board.hotelBankLimit, board.utilityMultiplierSingle, board.utilityMultiplierPair);
    const spaceStatements = input.spaces.map((space) => {
      const rents = rentColumns.map((_, index) => space.rents[index] ?? null);
      return this.database.prepare(
        `INSERT INTO board_spaces (id, board_id, board_index, kind, color_group, translation_key, custom_name, price, mortgage_value, house_cost, rent_base, rent_house_1, rent_house_2, rent_house_3, rent_house_4, rent_hotel)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(space.id, board.id, space.boardIndex, space.kind, space.colorGroup, space.translationKey, space.customName, space.price, space.mortgageValue, space.houseCost, ...rents);
    });
    try {
      await this.database.batch([boardStatement, ...spaceStatements]);
    } catch (cause) {
      throw new DatabaseError({ operation: 'createBoard', cause });
    }
  }

  async isBoardVisibleThroughGame(boardId: string, userId: string): Promise<boolean> {
    const row = await this.database.prepare(
      `SELECT 1 AS value FROM games INNER JOIN game_members ON game_members.game_id = games.id
       WHERE games.board_id = ? AND game_members.user_id = ? LIMIT 1`,
    ).bind(boardId, userId).first<{ value: number }>();
    return row !== null;
  }

  async countGamesUsingBoard(boardId: string): Promise<number> {
    const row = await this.database.prepare('SELECT COUNT(*) AS total FROM games WHERE board_id = ?').bind(boardId).first<{ total: number }>();
    return row?.total ?? 0;
  }

  async deleteBoard(boardId: string, ownerUserId: string): Promise<boolean> {
    const result = await this.database.prepare('DELETE FROM board_definitions WHERE id = ? AND owner_user_id = ?').bind(boardId, ownerUserId).run();
    return result.meta.changes > 0;
  }
}

function mapBoard(row: BoardRow): StoredBoard {
  return {
    id: row.id,
    name: row.name,
    jailFee: row.jail_fee,
    unmortgageInterestPercent: row.unmortgage_interest_percent,
    houseBankLimit: row.house_bank_limit,
    hotelBankLimit: row.hotel_bank_limit,
    utilityMultiplierSingle: row.utility_multiplier_single,
    utilityMultiplierPair: row.utility_multiplier_pair,
    ownerUserId: row.owner_user_id,
    sourceBoardId: row.source_board_id,
    createdAt: row.created_at,
  };
}

/** The six rent columns collapse into the levels a space actually has: six for a street, four for a railroad, none for a utility. */
function mapSpace(row: BoardSpaceRow): BoardSpace {
  const rents: number[] = [];
  for (const column of rentColumns) {
    const rent = row[column];
    if (rent === null) break;
    rents.push(rent);
  }
  return {
    id: row.id,
    boardIndex: row.board_index,
    kind: row.kind,
    colorGroup: row.color_group,
    translationKey: row.translation_key,
    customName: row.custom_name,
    price: row.price,
    mortgageValue: row.mortgage_value,
    houseCost: row.house_cost,
    rents,
  };
}

function mapProperty(row: GamePropertyRow): GameProperty {
  return { boardSpaceId: row.board_space_id, ownerPlayerId: row.owner_player_id, houses: row.houses, mortgaged: row.mortgaged === 1 };
}

/** Strips the catalogue-only columns so a wire response carries exactly the `BoardDefinition` shape. */
export function toBoardDefinition(board: StoredBoard): BoardDefinition {
  return {
    id: board.id,
    name: board.name,
    jailFee: board.jailFee,
    unmortgageInterestPercent: board.unmortgageInterestPercent,
    houseBankLimit: board.houseBankLimit,
    hotelBankLimit: board.hotelBankLimit,
    utilityMultiplierSingle: board.utilityMultiplierSingle,
    utilityMultiplierPair: board.utilityMultiplierPair,
  };
}
