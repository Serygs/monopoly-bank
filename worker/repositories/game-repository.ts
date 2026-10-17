import {
  DELETED_GAME_RETENTION_DAYS,
  type DeletedGameSummary,
  type GameSummary,
} from '../../shared/contracts/api.js';
import { normalizeGameRules } from '../../shared/domain/game-rules.js';
import type {
  Currency,
  Game,
  GameRules,
  GameSettings,
  GameStatus,
  PaymentMode,
} from '../../shared/types/monopoly.js';
import type { CreatePlayerInput } from './player-repository.js';

/** The stored house-rule flags and the derived-amounts snapshot, selected with every game. */
const RULE_COLUMNS =
  'rule_double_go, rule_player_loans, rule_bank_loans, rule_jackpot, rule_auctions, settings_snapshot';

interface GameRow {
  id: string;
  name: string;
  starting_balance: number;
  pass_go_reward: number;
  currency: Currency;
  payment_mode: PaymentMode;
  rule_double_go: number;
  rule_player_loans: number;
  rule_bank_loans: number;
  rule_jackpot: number;
  rule_auctions: number;
  settings_snapshot: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface CreateGameInput {
  id: string;
  name: string;
  startingBalance: number;
  passGoReward: number;
  currency: Currency;
  paymentMode?: PaymentMode;
  rules?: GameRules;
  settings?: GameSettings;
  status?: GameStatus;
  ownerUserId: string;
  joinCode: string;
  isPublic?: boolean;
  gameAccessPasswordHash: string | null;
  gameAccessPasswordSalt: string | null;
}

export interface UpdateGameMetadataInput {
  id: string;
  name?: string;
  status?: GameStatus;
}

export interface GameRepository {
  createWithPlayers(input: CreateGameInput, players: CreatePlayerInput[]): Promise<void>;
  getById(id: string): Promise<Game | null>;
  /** The Free Parking pot (jackpot rule); the only place it is read from. */
  getJackpot(id: string): Promise<number>;
  list(): Promise<Game[]>;
  listSummaries(): Promise<GameSummary[]>;
  listSummariesForUser(userId: string): Promise<GameSummary[]>;
  listDeletedSummariesForUser(userId: string): Promise<DeletedGameSummary[]>;
  updateMetadata(input: UpdateGameMetadataInput): Promise<Game | null>;
  transitionStatus(id: string, from: GameStatus, to: GameStatus): Promise<Game | null>;
  /**
   * Gives a lobby or running game a new join code. False when the game is not the owner's, is
   * finished or deleted. Throws the unique-index error when the code is taken by another game.
   */
  replaceJoinCode(id: string, ownerUserId: string, joinCode: string): Promise<boolean>;
  delete(id: string): Promise<boolean>;
  softDelete(id: string): Promise<boolean>;
  restore(id: string, userId: string): Promise<boolean>;
  purgeExpiredDeleted(): Promise<void>;
  listFavoriteAmounts(gameId: string): Promise<number[]>;
  toggleFavoriteAmount(gameId: string, amount: number): Promise<number[]>;
  listRecentAmounts(gameId: string): Promise<number[]>;
  recordRecentAmount(gameId: string, amount: number): Promise<void>;
}

export class D1GameRepository implements GameRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async createWithPlayers(input: CreateGameInput, players: CreatePlayerInput[]): Promise<void> {
    const rules = input.rules ?? normalizeGameRules(null);
    const gameStatement = this.database
      .prepare(
        `INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, payment_mode, ${RULE_COLUMNS}, status, owner_user_id, join_code, is_public, game_access_password_hash, game_access_password_salt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.id,
        input.name,
        input.startingBalance,
        input.passGoReward,
        input.currency,
        input.paymentMode ?? 'FAST',
        rules.doubleRewardOnExactGo ? 1 : 0,
        rules.playerLoans ? 1 : 0,
        rules.bankLoans ? 1 : 0,
        rules.freeParkingJackpot ? 1 : 0,
        rules.auctions ? 1 : 0,
        input.settings === undefined ? null : JSON.stringify(input.settings),
        input.status ?? 'LOBBY',
        input.ownerUserId,
        input.joinCode,
        input.isPublic === true ? 1 : 0,
        input.gameAccessPasswordHash,
        input.gameAccessPasswordSalt,
      );
    const playerStatements = players.map((player) =>
      this.database
        .prepare(
          `INSERT INTO players (id, game_id, name, color, balance)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(player.id, player.gameId, player.name, player.color, player.balance),
    );

    const ownerPlayerId = players[0]?.id;
    const memberStatement = this.database
      .prepare(
        "INSERT INTO game_members (game_id, user_id, role, player_id) VALUES (?, ?, 'OWNER', ?)",
      )
      .bind(input.id, input.ownerUserId, ownerPlayerId ?? null);
    const controllerStatement =
      ownerPlayerId === undefined
        ? []
        : [
            this.database
              .prepare(
                "INSERT INTO player_controllers (game_id, player_id, user_id, controller_kind) VALUES (?, ?, ?, 'PRIMARY')",
              )
              .bind(input.id, ownerPlayerId, input.ownerUserId),
          ];
    // A game with a board gets one untouched property row per tile, in the same batch.
    const propertyStatements = (input.settings?.board?.tiles ?? []).map((tile) =>
      this.database
        .prepare(
          'INSERT INTO game_properties (game_id, tile_id, owner_player_id, mortgaged, houses) VALUES (?, ?, NULL, 0, 0)',
        )
        .bind(input.id, tile.id),
    );
    await this.database.batch([
      gameStatement,
      ...playerStatements,
      ...propertyStatements,
      memberStatement,
      ...controllerStatement,
    ]);
  }

  async getById(id: string): Promise<Game | null> {
    const row = await this.database
      .prepare(
        `SELECT id, name, starting_balance, pass_go_reward, currency, payment_mode, ${RULE_COLUMNS}, status, created_at, updated_at, started_at, finished_at
         FROM games
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .bind(id)
      .first<GameRow>();

    return row === null ? null : mapGame(row);
  }

  async getJackpot(id: string): Promise<number> {
    const row = await this.database
      .prepare('SELECT jackpot_balance FROM games WHERE id = ? AND deleted_at IS NULL')
      .bind(id)
      .first<{ jackpot_balance: number }>();
    return row?.jackpot_balance ?? 0;
  }

  async list(): Promise<Game[]> {
    const result = await this.database
      .prepare(
        `SELECT id, name, starting_balance, pass_go_reward, currency, payment_mode, ${RULE_COLUMNS}, status, created_at, updated_at, started_at, finished_at
         FROM games
         WHERE deleted_at IS NULL
         ORDER BY updated_at DESC, id DESC`,
      )
      .all<GameRow>();

    return result.results.map(mapGame);
  }

  async listSummaries(): Promise<GameSummary[]> {
    const result = await this.database
      .prepare(
        `SELECT games.id, games.name, games.starting_balance, games.pass_go_reward, games.currency, games.payment_mode, ${RULE_COLUMNS},
                games.status, games.created_at, games.updated_at, games.started_at, games.finished_at,
                COUNT(players.id) AS player_count
         FROM games
         LEFT JOIN players ON players.game_id = games.id
         WHERE games.deleted_at IS NULL
         GROUP BY games.id
         ORDER BY games.updated_at DESC, games.id DESC`,
      )
      .all<GameSummaryRow>();

    return result.results.map((row) => ({
      game: mapGame(row),
      playerCount: row.player_count,
    }));
  }

  async listSummariesForUser(userId: string): Promise<GameSummary[]> {
    const result = await this.database
      .prepare(
        `SELECT games.id, games.name, games.starting_balance, games.pass_go_reward, games.currency, games.payment_mode, ${RULE_COLUMNS}, games.status, games.created_at, games.updated_at, games.started_at, games.finished_at, COUNT(players.id) AS player_count,
              CASE WHEN game_members.user_id IS NULL AND games.status = 'LOBBY' AND games.is_public = 1 THEN 1 ELSE 0 END AS is_public_lobby,
              CASE WHEN game_members.user_id IS NULL AND games.status = 'LOBBY' AND games.is_public = 1 THEN games.join_code ELSE NULL END AS public_join_code
       FROM games LEFT JOIN game_members ON game_members.game_id = games.id AND game_members.user_id = ? LEFT JOIN players ON players.game_id = games.id
       WHERE games.owner_user_id IS NOT NULL AND games.deleted_at IS NULL AND (game_members.user_id IS NOT NULL OR (games.status = 'LOBBY' AND games.is_public = 1))
       GROUP BY games.id ORDER BY games.updated_at DESC, games.id DESC`,
      )
      .bind(userId)
      .all<GameSummaryRow>();
    return result.results.map((row) => ({
      game: mapGame(row),
      playerCount: row.player_count,
      ...(row.is_public_lobby === 1
        ? { isPublicLobby: true, joinCode: row.public_join_code ?? undefined }
        : {}),
    }));
  }

  async listDeletedSummariesForUser(userId: string): Promise<DeletedGameSummary[]> {
    const result = await this.database
      .prepare(
        `SELECT games.id, games.name, games.starting_balance, games.pass_go_reward, games.currency, games.payment_mode, ${RULE_COLUMNS},
                games.status, games.created_at, games.updated_at, games.started_at, games.finished_at,
                COUNT(players.id) AS player_count,
                games.deleted_at AS deleted_at,
                strftime('%Y-%m-%dT%H:%M:%fZ', games.deleted_at, '+${DELETED_GAME_RETENTION_DAYS} days') AS purge_at
         FROM games
         INNER JOIN game_members ON game_members.game_id = games.id AND game_members.user_id = ? AND game_members.role = 'OWNER'
         LEFT JOIN players ON players.game_id = games.id
         WHERE games.deleted_at IS NOT NULL
           AND games.deleted_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${DELETED_GAME_RETENTION_DAYS} days')
         GROUP BY games.id
         ORDER BY games.deleted_at DESC, games.id DESC`,
      )
      .bind(userId)
      .all<GameSummaryRow>();
    return result.results.map((row) => ({
      game: mapGame(row),
      playerCount: row.player_count,
      deletedAt: row.deleted_at ?? '',
      purgeAt: row.purge_at ?? '',
    }));
  }

  async updateMetadata(input: UpdateGameMetadataInput): Promise<Game | null> {
    const assignments: string[] = [];
    const values: (string | GameStatus)[] = [];

    if (input.name !== undefined) {
      assignments.push('name = ?');
      values.push(input.name);
    }

    if (input.status !== undefined) {
      assignments.push(
        'status = ?',
        "finished_at = CASE WHEN ? = 'FINISHED' THEN CURRENT_TIMESTAMP ELSE finished_at END",
      );
      values.push(input.status === 'FINISHED' ? 'ARCHIVED' : input.status);
      values.push(input.status);
    }

    if (assignments.length === 0) {
      return this.getById(input.id);
    }

    assignments.push('updated_at = CURRENT_TIMESTAMP');
    values.push(input.id);

    const row = await this.database
      .prepare(
        `UPDATE games
         SET ${assignments.join(', ')}
         WHERE id = ?
         RETURNING id, name, starting_balance, pass_go_reward, currency, payment_mode, ${RULE_COLUMNS}, status, created_at, updated_at, started_at, finished_at`,
      )
      .bind(...values)
      .first<GameRow>();

    return row === null ? null : mapGame(row);
  }

  async transitionStatus(id: string, from: GameStatus, to: GameStatus): Promise<Game | null> {
    const storedFrom = from === 'FINISHED' ? 'ARCHIVED' : from;
    const storedTo = to === 'FINISHED' ? 'ARCHIVED' : to;
    const row = await this.database
      .prepare(
        `UPDATE games
       SET status = ?, updated_at = CURRENT_TIMESTAMP,
           started_at = CASE WHEN ? = 'ACTIVE' THEN CURRENT_TIMESTAMP ELSE started_at END,
           finished_at = CASE WHEN ? = 'ARCHIVED' THEN CURRENT_TIMESTAMP ELSE finished_at END
       WHERE id = ? AND status = ?
       RETURNING id, name, starting_balance, pass_go_reward, currency, payment_mode, ${RULE_COLUMNS}, status, created_at, updated_at, started_at, finished_at`,
      )
      .bind(storedTo, storedTo, storedTo, id, storedFrom)
      .first<GameRow>();
    return row === null ? null : mapGame(row);
  }

  async replaceJoinCode(id: string, ownerUserId: string, joinCode: string): Promise<boolean> {
    const result = await this.database
      .prepare(
        `UPDATE games SET join_code = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND owner_user_id = ? AND status IN ('LOBBY', 'ACTIVE') AND deleted_at IS NULL`,
      )
      .bind(joinCode, id, ownerUserId)
      .run();
    return result.meta.changes === 1;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.database.prepare('DELETE FROM games WHERE id = ?').bind(id).run();
    return result.meta.changes > 0;
  }

  /**
   * Hides the game for {@link DELETED_GAME_RETENTION_DAYS} days. It is stored as finished so
   * nothing can be played in it, whatever it was before; restoring keeps it finished.
   */
  async softDelete(id: string): Promise<boolean> {
    const result = await this.database
      .prepare(
        `UPDATE games
         SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), status = 'ARCHIVED',
             finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .bind(id)
      .run();
    return result.meta.changes > 0;
  }

  async restore(id: string, userId: string): Promise<boolean> {
    const result = await this.database
      .prepare(
        `UPDATE games
         SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND deleted_at IS NOT NULL
           AND deleted_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${DELETED_GAME_RETENTION_DAYS} days')
           AND EXISTS (SELECT 1 FROM game_members WHERE game_members.game_id = games.id AND game_members.user_id = ? AND game_members.role = 'OWNER')`,
      )
      .bind(id, userId)
      .run();
    return result.meta.changes > 0;
  }

  async purgeExpiredDeleted(): Promise<void> {
    await this.database
      .prepare(
        `DELETE FROM games WHERE deleted_at IS NOT NULL AND deleted_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${DELETED_GAME_RETENTION_DAYS} days')`,
      )
      .run();
  }

  async listFavoriteAmounts(gameId: string): Promise<number[]> {
    const result = await this.database
      .prepare(
        'SELECT amount FROM game_favorite_amounts WHERE game_id = ? ORDER BY created_at DESC, amount DESC',
      )
      .bind(gameId)
      .all<{ amount: number }>();
    return result.results.map((row) => row.amount);
  }

  async toggleFavoriteAmount(gameId: string, amount: number): Promise<number[]> {
    const exists = await this.database
      .prepare('SELECT 1 AS value FROM game_favorite_amounts WHERE game_id = ? AND amount = ?')
      .bind(gameId, amount)
      .first<{ value: number }>();
    if (exists === null) {
      await this.database
        .prepare('INSERT INTO game_favorite_amounts (game_id, amount) VALUES (?, ?)')
        .bind(gameId, amount)
        .run();
    } else {
      await this.database
        .prepare('DELETE FROM game_favorite_amounts WHERE game_id = ? AND amount = ?')
        .bind(gameId, amount)
        .run();
    }
    return this.listFavoriteAmounts(gameId);
  }

  async listRecentAmounts(gameId: string): Promise<number[]> {
    const result = await this.database
      .prepare(
        'SELECT amount FROM game_recent_amounts WHERE game_id = ? ORDER BY used_at DESC, amount DESC LIMIT 5',
      )
      .bind(gameId)
      .all<{ amount: number }>();
    return result.results.map((row) => row.amount);
  }

  async recordRecentAmount(gameId: string, amount: number): Promise<void> {
    await this.database.batch([
      this.database
        .prepare('DELETE FROM game_recent_amounts WHERE game_id = ? AND amount = ?')
        .bind(gameId, amount),
      this.database
        .prepare(
          'INSERT INTO game_recent_amounts (game_id, amount, used_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
        )
        .bind(gameId, amount),
      this.database
        .prepare(
          'DELETE FROM game_recent_amounts WHERE game_id = ? AND amount NOT IN (SELECT amount FROM game_recent_amounts WHERE game_id = ? ORDER BY used_at DESC, amount DESC LIMIT 5)',
        )
        .bind(gameId, gameId),
    ]);
  }
}

interface GameSummaryRow extends GameRow {
  player_count: number;
  is_public_lobby?: number;
  public_join_code?: string | null;
  deleted_at?: string | null;
  purge_at?: string | null;
}

function mapGame(row: GameRow): Game {
  return {
    id: row.id,
    name: row.name,
    startingBalance: row.starting_balance,
    passGoReward: row.pass_go_reward,
    currency: row.currency,
    paymentMode: row.payment_mode ?? 'FAST',
    rules: normalizeGameRules({
      doubleRewardOnExactGo: row.rule_double_go === 1,
      playerLoans: row.rule_player_loans === 1,
      bankLoans: row.rule_bank_loans === 1,
      freeParkingJackpot: row.rule_jackpot === 1,
      auctions: row.rule_auctions === 1,
    }),
    settings: parseSettings(row.settings_snapshot),
    status: row.status === 'ARCHIVED' ? 'FINISHED' : row.status === 'LOBBY' ? 'LOBBY' : 'ACTIVE',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function parseSettings(snapshot: string | null | undefined): GameSettings | null {
  if (snapshot === null || snapshot === undefined) return null;
  try {
    return JSON.parse(snapshot) as GameSettings;
  } catch {
    return null;
  }
}
