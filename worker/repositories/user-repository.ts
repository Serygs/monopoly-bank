import type { AccountType } from '../../shared/contracts/api.js';
import { ConflictError, DatabaseError, isUniqueConstraintError } from '../services/errors.js';

export interface UserRecord {
  id: string;
  nickname: string;
  avatar: string;
  accountType: AccountType;
  email: string | null;
  normalizedEmail: string | null;
  emailVerifiedAt: string | null;
  passwordHash: string;
  passwordSalt: string;
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  createdAt: string;
  updatedAt: string;
}

interface UserRow {
  id: string;
  nickname: string;
  avatar: string;
  account_type: AccountType;
  email: string | null;
  normalized_email: string | null;
  email_verified_at: string | null;
  password_hash: string;
  password_salt: string;
  games_played: number;
  games_won: number;
  games_lost: number;
  created_at: string;
  updated_at: string;
}
export type CreateUserInput = Omit<
  UserRecord,
  'gamesPlayed' | 'gamesWon' | 'gamesLost' | 'createdAt' | 'updatedAt'
>;

export interface UserRepository {
  create(input: CreateUserInput): Promise<UserRecord>;
  findByNickname(nickname: string): Promise<UserRecord | null>;
  findByNormalizedEmail(normalizedEmail: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  updateProfile(id: string, nickname: string, avatar: string): Promise<UserRecord | null>;
  markEmailVerified(id: string): Promise<UserRecord | null>;
  changePassword(
    id: string,
    passwordHash: string,
    passwordSalt: string,
  ): Promise<UserRecord | null>;
  upgradeGuest(input: {
    id: string;
    email: string;
    normalizedEmail: string;
    passwordHash: string;
    passwordSalt: string;
  }): Promise<UserRecord | null>;
  addEmailToLegacyAccount(
    id: string,
    email: string,
    normalizedEmail: string,
  ): Promise<UserRecord | null>;
}

export class D1UserRepository implements UserRepository {
  private readonly database: D1Database;
  constructor(database: D1Database) {
    this.database = database;
  }
  async create(input: CreateUserInput): Promise<UserRecord> {
    try {
      const row = await this.database
        .prepare(
          'INSERT INTO users (id, nickname, avatar, account_type, email, normalized_email, email_verified_at, password_hash, password_salt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *',
        )
        .bind(
          input.id,
          input.nickname,
          input.avatar,
          input.accountType,
          input.email,
          input.normalizedEmail,
          input.emailVerifiedAt,
          input.passwordHash,
          input.passwordSalt,
        )
        .first<UserRow>();
      if (row === null) throw new Error('D1 did not return user.');
      return map(row);
    } catch (cause) {
      throw databaseUserError('createUser', cause);
    }
  }
  async findByNickname(nickname: string): Promise<UserRecord | null> {
    return this.findOne('SELECT * FROM users WHERE nickname = ?', nickname, 'findUserByNickname');
  }
  async findByNormalizedEmail(normalizedEmail: string): Promise<UserRecord | null> {
    return this.findOne(
      'SELECT * FROM users WHERE normalized_email = ?',
      normalizedEmail,
      'findUserByEmail',
    );
  }
  async findById(id: string): Promise<UserRecord | null> {
    return this.findOne('SELECT * FROM users WHERE id = ?', id, 'findUserById');
  }
  async updateProfile(id: string, nickname: string, avatar: string): Promise<UserRecord | null> {
    try {
      return mapNullable(
        await this.database
          .prepare(
            'UPDATE users SET nickname = ?, avatar = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING *',
          )
          .bind(nickname, avatar, id)
          .first<UserRow>(),
      );
    } catch (cause) {
      throw databaseUserError('updateUserProfile', cause);
    }
  }
  async markEmailVerified(id: string): Promise<UserRecord | null> {
    try {
      return mapNullable(
        await this.database
          .prepare(
            "UPDATE users SET email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND account_type = 'REGISTERED' RETURNING *",
          )
          .bind(id)
          .first<UserRow>(),
      );
    } catch (cause) {
      throw new DatabaseError({ operation: 'markEmailVerified', cause });
    }
  }
  async changePassword(
    id: string,
    passwordHash: string,
    passwordSalt: string,
  ): Promise<UserRecord | null> {
    try {
      return mapNullable(
        await this.database
          .prepare(
            'UPDATE users SET password_hash = ?, password_salt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING *',
          )
          .bind(passwordHash, passwordSalt, id)
          .first<UserRow>(),
      );
    } catch (cause) {
      throw new DatabaseError({ operation: 'changePassword', cause });
    }
  }
  async upgradeGuest(input: {
    id: string;
    email: string;
    normalizedEmail: string;
    passwordHash: string;
    passwordSalt: string;
  }): Promise<UserRecord | null> {
    try {
      return mapNullable(
        await this.database
          .prepare(
            "UPDATE users SET account_type = 'REGISTERED', email = ?, normalized_email = ?, email_verified_at = NULL, password_hash = ?, password_salt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND account_type = 'GUEST' RETURNING *",
          )
          .bind(
            input.email,
            input.normalizedEmail,
            input.passwordHash,
            input.passwordSalt,
            input.id,
          )
          .first<UserRow>(),
      );
    } catch (cause) {
      throw databaseUserError('upgradeGuest', cause);
    }
  }
  async addEmailToLegacyAccount(
    id: string,
    email: string,
    normalizedEmail: string,
  ): Promise<UserRecord | null> {
    try {
      return mapNullable(
        await this.database
          .prepare(
            "UPDATE users SET email = ?, normalized_email = ?, email_verified_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND account_type = 'REGISTERED' AND email IS NULL RETURNING *",
          )
          .bind(email, normalizedEmail, id)
          .first<UserRow>(),
      );
    } catch (cause) {
      throw databaseUserError('addLegacyAccountEmail', cause);
    }
  }
  private async findOne(
    query: string,
    value: string,
    operation: string,
  ): Promise<UserRecord | null> {
    try {
      return mapNullable(await this.database.prepare(query).bind(value).first<UserRow>());
    } catch (cause) {
      throw new DatabaseError({ operation, cause });
    }
  }
}

function databaseUserError(operation: string, cause: unknown): Error {
  if (isUniqueConstraintError(cause))
    return new ConflictError(
      'ACCOUNT_IDENTIFIER_UNAVAILABLE',
      'The account identifier is unavailable.',
    );
  return new DatabaseError({ operation, cause });
}
function mapNullable(row: UserRow | null): UserRecord | null {
  return row === null ? null : map(row);
}
function map(row: UserRow): UserRecord {
  return {
    id: row.id,
    nickname: row.nickname,
    avatar: row.avatar,
    accountType: row.account_type,
    email: row.email,
    normalizedEmail: row.normalized_email,
    emailVerifiedAt: row.email_verified_at,
    passwordHash: row.password_hash,
    passwordSalt: row.password_salt,
    gamesPlayed: row.games_played,
    gamesWon: row.games_won,
    gamesLost: row.games_lost,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
