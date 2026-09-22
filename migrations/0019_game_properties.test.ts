import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'migrations/0019_game_properties.sql'), 'utf8');

const legacyTransactionTypes = [
  'PLAYER_TO_PLAYER',
  'PLAYER_TO_BANK',
  'BANK_TO_PLAYER',
  'PLAYER_TO_ALL',
  'ALL_TO_PLAYER',
  'PAY_RENT',
  'PASS_GO',
  'BANKRUPTCY_TRANSFER',
];

const propertyTransactionTypes = [
  'PROPERTY_PURCHASE',
  'PROPERTY_RENT',
  'PROPERTY_BUILD',
  'PROPERTY_SELL_BUILDINGS',
  'PROPERTY_MORTGAGE',
  'PROPERTY_UNMORTGAGE',
  'PROPERTY_AUCTION',
  'PROPERTY_TRADE',
  'JAIL_BAIL',
];

describe('0019 game properties migration', () => {
  it('creates per-game ownership bound to the catalogued space of the same board', () => {
    expect(source).toContain('CREATE TABLE game_properties');
    expect(source).toContain('PRIMARY KEY (game_id, board_space_id)');
    expect(source).toContain('FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE');
    expect(source).toContain('FOREIGN KEY (board_space_id, board_id) REFERENCES board_spaces(id, board_id) ON DELETE RESTRICT');
    expect(source).toContain('FOREIGN KEY (owner_player_id, game_id) REFERENCES players(id, game_id) ON DELETE RESTRICT');
    expect(source).toContain('CREATE INDEX game_properties_by_owner ON game_properties(game_id, owner_player_id)');
  });

  it('bounds buildings at five and forbids them on unowned or mortgaged spaces', () => {
    expect(source).toContain('houses INTEGER NOT NULL DEFAULT 0 CHECK (houses BETWEEN 0 AND 5)');
    expect(source).toContain('mortgaged INTEGER NOT NULL DEFAULT 0 CHECK (mortgaged IN (0, 1))');
    expect(source).toContain('CHECK (houses = 0 OR (owner_player_id IS NOT NULL AND mortgaged = 0))');
  });

  it('tracks the finite house and hotel pool per game', () => {
    expect(source).toContain('CREATE TABLE game_building_banks');
    expect(source).toContain('game_id TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE');
    expect(source).toContain('houses_available INTEGER NOT NULL CHECK (houses_available >= 0)');
    expect(source).toContain('hotels_available INTEGER NOT NULL CHECK (hotels_available >= 0)');
  });

  it('stores no updated_at column, because nothing keeps one current', () => {
    expect(source).not.toContain('updated_at');
  });

  it('links a payment request to the space it was raised for', () => {
    expect(source).toContain('ALTER TABLE payment_requests ADD COLUMN board_space_id TEXT REFERENCES board_spaces(id);');
    expect(source).not.toMatch(/ADD COLUMN board_space_id[^;]*NOT NULL/i);
  });

  it('rebuilds transactions so every legacy and property type is accepted', () => {
    expect(source).toContain('PRAGMA defer_foreign_keys = ON;');
    expect(source).toContain('CREATE TABLE transactions_new');
    for (const type of [...legacyTransactionTypes, ...propertyTransactionTypes]) {
      expect(source).toContain(`'${type}'`);
    }

    const checkClause = /CHECK \(type IN \(([^)]+)\)\)/.exec(source);
    expect(checkClause).not.toBeNull();
    const declaredTypes = (checkClause?.[1] ?? '')
      .split(',')
      .map((entry) => entry.trim().replaceAll("'", ''))
      .filter((entry) => entry.length > 0);
    expect(declaredTypes.sort()).toEqual([...legacyTransactionTypes, ...propertyTransactionTypes].sort());
  });

  it('copies the existing ledger verbatim instead of rewriting history', () => {
    expect(source).toContain('INSERT INTO transactions_new (id, game_id, type, amount, total_amount, comment, created_at)');
    expect(source).toContain('FROM transactions;');
    expect(source).toContain('INSERT INTO transaction_participants_new (transaction_id, game_id, player_id, balance_delta)');
    expect(source).toContain('FROM transaction_participants;');
    expect(source).toContain('ALTER TABLE transactions_new RENAME TO transactions;');
    expect(source).toContain('ALTER TABLE transaction_participants_new RENAME TO transaction_participants;');
  });

  it('restores every index the rebuilt ledger tables carried', () => {
    for (const index of [
      'transactions_by_game_id_created_at_id',
      'transactions_by_game_id_created_id',
      'transaction_participants_by_player_id',
      'transaction_participants_by_game_player_transaction',
    ]) {
      expect(source).toContain(`CREATE INDEX ${index} ON`);
    }
  });
});
