import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile as execFileCallback } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCallback);
const persistence = await mkdtemp(join(tmpdir(), 'monopoly-bank-d1-'));
const legacyMigrations = await mkdtemp(join(tmpdir(), 'monopoly-bank-d1-legacy-migrations-'));
const legacyPersistence = await mkdtemp(join(tmpdir(), 'monopoly-bank-d1-upgrade-'));
const wranglerEntry = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const legacyConfig = join(legacyMigrations, 'wrangler.json');
const legacyMigrationBoundary = '0010_bankruptcy_transaction_type_and_history_index.sql';

async function command(args, allowFailure = false) {
  try {
    const { stdout, stderr } = await execFile(process.execPath, [wranglerEntry, ...args], { cwd: process.cwd(), maxBuffer: 10 * 1024 * 1024 });
    return `${stdout}\n${stderr}`;
  } catch (error) {
    if (allowFailure) return `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
    throw error;
  }
}

async function sql(statement, allowFailure = false) {
  return command(['d1', 'execute', 'MONOPOLY_BANK_DB', '--local', '--persist-to', persistence, '--json', '--command', statement], allowFailure);
}

async function legacySql(statement, allowFailure = false) {
  return command(['d1', 'execute', 'MONOPOLY_BANK_DB', '--local', '--config', legacyConfig, '--persist-to', legacyPersistence, '--json', '--command', statement], allowFailure);
}

try {
  await command(['d1', 'migrations', 'apply', 'MONOPOLY_BANK_DB', '--local', '--persist-to', persistence]);

  const expectedTables = ['player_controllers', 'payment_requests', 'command_ledger', 'security_rate_limits', 'game_final_snapshots', 'board_definitions', 'board_spaces', 'game_properties', 'game_building_banks', 'property_trades', 'property_trade_items'];
  const schema = await sql(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${expectedTables.map((table) => `'${table}'`).join(', ')}) ORDER BY name`);
  for (const table of expectedTables) {
    if (!schema.includes(table)) throw new Error(`Migration did not create ${table}.`);
  }

  await sql("INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status, payment_mode) VALUES ('game-1', 'D1 constraints', 1500, 200, 'K', 'LOBBY', 'FAST'); INSERT INTO players (id, game_id, name, color, balance) VALUES ('player-1', 'game-1', 'Ada', '#123456', 1500);");
  const negativeBalance = await sql("UPDATE players SET balance = -1 WHERE id = 'player-1'", true);
  if (!/CHECK constraint failed/i.test(negativeBalance)) throw new Error('players.balance accepts a negative value.');

  await sql("INSERT INTO command_ledger (game_id, command_id, actor_id, command_type, payload_hash, status) VALUES ('game-1', 'command-1', 'actor-1', 'CREATE_TRANSACTION', 'hash-1', 'PENDING')");
  const duplicateCommand = await sql("INSERT INTO command_ledger (game_id, command_id, actor_id, command_type, payload_hash, status) VALUES ('game-1', 'command-1', 'actor-2', 'CREATE_TRANSACTION', 'hash-2', 'PENDING')", true);
  if (!/UNIQUE constraint failed/i.test(duplicateCommand)) throw new Error('command_ledger accepts duplicate command IDs per game.');

  const boardSeed = await sql("SELECT COUNT(*) AS space_count, SUM(price) AS price_total, SUM(CASE WHEN mortgage_value * 2 = price THEN 1 ELSE 0 END) AS halved_mortgages FROM board_spaces WHERE board_id = 'board-classic'");
  if (!/"space_count"\s*:\s*28\b/.test(boardSeed)) throw new Error(`The classic board seed does not contain exactly 28 ownable spaces: ${boardSeed}`);
  if (!/"price_total"\s*:\s*5690\b/.test(boardSeed)) throw new Error(`The classic board seed price total is not 5690: ${boardSeed}`);
  if (!/"halved_mortgages"\s*:\s*28\b/.test(boardSeed)) throw new Error(`A seeded space has a mortgage value that is not half of its price: ${boardSeed}`);

  const ledgerIndexes = await sql("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('transactions', 'transaction_participants') ORDER BY name");
  for (const index of ['transactions_by_game_id_created_at_id', 'transactions_by_game_id_created_id', 'transaction_participants_by_player_id', 'transaction_participants_by_game_player_transaction']) {
    if (!ledgerIndexes.includes(index)) throw new Error(`The transactions rebuild did not restore ${index}.`);
  }

  const transactionTypes = ['PLAYER_TO_PLAYER', 'PLAYER_TO_BANK', 'BANK_TO_PLAYER', 'PLAYER_TO_ALL', 'ALL_TO_PLAYER', 'PAY_RENT', 'PASS_GO', 'BANKRUPTCY_TRANSFER', 'PROPERTY_PURCHASE', 'PROPERTY_RENT', 'PROPERTY_BUILD', 'PROPERTY_SELL_BUILDINGS', 'PROPERTY_MORTGAGE', 'PROPERTY_UNMORTGAGE', 'PROPERTY_AUCTION', 'PROPERTY_TRADE', 'JAIL_BAIL'];
  await sql(transactionTypes.map((type, index) => `INSERT INTO transactions (id, game_id, type, amount, total_amount) VALUES ('transaction-${index}', 'game-1', '${type}', 10, 10);`).join(' '));
  const acceptedTypes = await sql("SELECT COUNT(DISTINCT type) AS type_count FROM transactions WHERE game_id = 'game-1'");
  if (!new RegExp(`"type_count"\\s*:\\s*${transactionTypes.length}\\b`).test(acceptedTypes)) throw new Error(`transactions.type did not store every legacy and property type: ${acceptedTypes}`);
  const unknownType = await sql("INSERT INTO transactions (id, game_id, type, amount, total_amount) VALUES ('transaction-unknown', 'game-1', 'NOT_A_TRANSACTION_TYPE', 10, 10)", true);
  if (!/CHECK constraint failed/i.test(unknownType)) throw new Error('transactions.type accepts an unknown type.');

  await sql("UPDATE games SET board_id = 'board-classic' WHERE id = 'game-1'; INSERT INTO game_building_banks (game_id, houses_available, hotels_available) VALUES ('game-1', 32, 12); INSERT INTO game_properties (game_id, board_space_id, board_id, owner_player_id) VALUES ('game-1', 'board-classic-space-01', 'board-classic', 'player-1');");
  const tooManyBuildings = await sql("INSERT INTO game_properties (game_id, board_space_id, board_id, owner_player_id, houses) VALUES ('game-1', 'board-classic-space-03', 'board-classic', 'player-1', 6)", true);
  if (!/CHECK constraint failed/i.test(tooManyBuildings)) throw new Error('game_properties accepts more than five buildings on a space.');
  const mortgagedWithBuildings = await sql("UPDATE game_properties SET houses = 3, mortgaged = 1 WHERE game_id = 'game-1' AND board_space_id = 'board-classic-space-01'", true);
  if (!/CHECK constraint failed/i.test(mortgagedWithBuildings)) throw new Error('game_properties accepts buildings on a mortgaged space.');
  const unownedWithBuildings = await sql("INSERT INTO game_properties (game_id, board_space_id, board_id, owner_player_id, houses) VALUES ('game-1', 'board-classic-space-06', 'board-classic', NULL, 1)", true);
  if (!/CHECK constraint failed/i.test(unownedWithBuildings)) throw new Error('game_properties accepts buildings on an unowned space.');

  await sql("INSERT INTO players (id, game_id, name, color, balance) VALUES ('player-2', 'game-1', 'Grace', '#654321', 1500); INSERT INTO property_trades (id, game_id, proposer_player_id, responder_player_id, cash_from_proposer, cash_from_responder, state, expires_at) VALUES ('trade-1', 'game-1', 'player-1', 'player-2', 100, 0, 'PENDING', '2999-01-01T00:00:00.000Z'); INSERT INTO property_trade_items (trade_id, game_id, board_space_id, board_id, from_player_id, mortgage_resolution) VALUES ('trade-1', 'game-1', 'board-classic-space-01', 'board-classic', 'player-1', NULL);");
  const storedTrade = await sql("SELECT COUNT(*) AS item_count FROM property_trade_items i JOIN property_trades t ON t.id = i.trade_id WHERE t.id = 'trade-1' AND t.state = 'PENDING' AND i.from_player_id = 'player-1'");
  if (!/"item_count"\s*:\s*1\b/.test(storedTrade)) throw new Error(`A valid trade and its deed item were not stored: ${storedTrade}`);

  const selfTrade = await sql("INSERT INTO property_trades (id, game_id, proposer_player_id, responder_player_id, state, expires_at) VALUES ('trade-self', 'game-1', 'player-1', 'player-1', 'PENDING', '2999-01-01T00:00:00.000Z')", true);
  if (!/CHECK constraint failed/i.test(selfTrade)) throw new Error('property_trades accepts a trade a player proposes to themselves.');
  const negativeTradeCash = await sql("INSERT INTO property_trades (id, game_id, proposer_player_id, responder_player_id, cash_from_proposer, state, expires_at) VALUES ('trade-negative', 'game-1', 'player-1', 'player-2', -1, 'PENDING', '2999-01-01T00:00:00.000Z')", true);
  if (!/CHECK constraint failed/i.test(negativeTradeCash)) throw new Error('property_trades accepts a negative cash leg.');

  await sql("INSERT INTO board_definitions (id, name, owner_user_id, source_board_id, jail_fee, unmortgage_interest_percent, house_bank_limit, hotel_bank_limit, utility_multiplier_single, utility_multiplier_pair) VALUES ('board-alt', 'Alternate', NULL, 'board-classic', 50, 10, 32, 12, 4, 10); INSERT INTO board_spaces (id, board_id, board_index, kind, color_group, translation_key, custom_name, price, mortgage_value, house_cost, rent_base, rent_house_1, rent_house_2, rent_house_3, rent_house_4, rent_hotel) VALUES ('board-alt-space-01', 'board-alt', 1, 'STREET', 'BROWN', 'boardSpaceMediterraneanAvenue', NULL, 60, 30, 50, 2, 10, 30, 90, 160, 250);");
  const crossBoardItem = await sql("INSERT INTO property_trade_items (trade_id, game_id, board_space_id, board_id, from_player_id) VALUES ('trade-1', 'game-1', 'board-alt-space-01', 'board-classic', 'player-1')", true);
  if (!/FOREIGN KEY constraint failed/i.test(crossBoardItem)) throw new Error(`property_trade_items accepts a board space belonging to a different board: ${crossBoardItem}`);
  await sql("INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status, payment_mode) VALUES ('game-2', 'Other game', 1500, 200, 'K', 'LOBBY', 'FAST'); INSERT INTO players (id, game_id, name, color, balance) VALUES ('player-3', 'game-2', 'Alan', '#abcdef', 1500);");
  const crossGameItem = await sql("INSERT INTO property_trade_items (trade_id, game_id, board_space_id, board_id, from_player_id) VALUES ('trade-1', 'game-1', 'board-classic-space-03', 'board-classic', 'player-3')", true);
  if (!/FOREIGN KEY constraint failed/i.test(crossGameItem)) throw new Error(`property_trade_items accepts a giving player from a different game: ${crossGameItem}`);
  const crossGameTradeItem = await sql("INSERT INTO property_trade_items (trade_id, game_id, board_space_id, board_id, from_player_id) VALUES ('trade-1', 'game-2', 'board-classic-space-03', 'board-classic', 'player-3')", true);
  if (!/FOREIGN KEY constraint failed/i.test(crossGameTradeItem)) throw new Error(`property_trade_items accepts an item whose game does not match its parent trade: ${crossGameTradeItem}`);

  await sql("INSERT INTO property_trades (id, game_id, proposer_player_id, responder_player_id, state, expires_at) VALUES ('trade-cascade', 'game-1', 'player-1', 'player-2', 'PENDING', '2999-01-01T00:00:00.000Z'); INSERT INTO property_trade_items (trade_id, game_id, board_space_id, board_id, from_player_id) VALUES ('trade-cascade', 'game-1', 'board-classic-space-03', 'board-classic', 'player-1'); DELETE FROM property_trades WHERE id = 'trade-cascade';");
  const cascadedItems = await sql("SELECT COUNT(*) AS orphan_count FROM property_trade_items WHERE trade_id = 'trade-cascade'");
  if (!/"orphan_count"\s*:\s*0\b/.test(cascadedItems)) throw new Error(`Deleting a property trade did not cascade its deed items away: ${cascadedItems}`);

  const foreignKeyProblems = await sql('PRAGMA foreign_key_check');
  if (/"results"\s*:\s*\[\s*\{/.test(foreignKeyProblems)) throw new Error(`Foreign-key check failed: ${foreignKeyProblems}`);

  const migrationFiles = (await readdir('migrations'))
    .filter((migration) => migration.endsWith('.sql'))
    .sort();
  for (const migration of migrationFiles) {
    if (migration <= legacyMigrationBoundary) await cp(join('migrations', migration), join(legacyMigrations, migration));
  }
  await writeFile(legacyConfig, `${JSON.stringify({ name: 'migration-upgrade-fixture', d1_databases: [{ binding: 'MONOPOLY_BANK_DB', database_name: 'migration-upgrade-fixture', database_id: '00000000-0000-4000-8000-000000000001', migrations_dir: legacyMigrations }] })}\n`);
  await command(['d1', 'migrations', 'apply', 'MONOPOLY_BANK_DB', '--local', '--config', legacyConfig, '--persist-to', legacyPersistence]);
  await legacySql("INSERT INTO users (id, nickname, avatar, password_hash, password_salt) VALUES ('user-upgrade-1', 'Existing player', '😀', 'fixture-password-hash', 'fixture-password-salt'); INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status) VALUES ('game-upgrade-1', 'Existing game', 1500, 200, 'K', 'ACTIVE'); INSERT INTO players (id, game_id, name, color, balance) VALUES ('player-upgrade-1', 'game-upgrade-1', 'Existing player', '#123456', 1500); INSERT INTO game_members (game_id, user_id, role, player_id) VALUES ('game-upgrade-1', 'user-upgrade-1', 'PLAYER', 'player-upgrade-1'); INSERT INTO transactions (id, game_id, type, amount, total_amount, comment) VALUES ('transaction-upgrade-1', 'game-upgrade-1', 'PAY_RENT', 100, 100, 'Legacy rent'); INSERT INTO transaction_participants (transaction_id, game_id, player_id, balance_delta) VALUES ('transaction-upgrade-1', 'game-upgrade-1', 'player-upgrade-1', -100);");
  for (const migration of migrationFiles) {
    if (migration > legacyMigrationBoundary) await cp(join('migrations', migration), join(legacyMigrations, migration));
  }
  await command(['d1', 'migrations', 'apply', 'MONOPOLY_BANK_DB', '--local', '--config', legacyConfig, '--persist-to', legacyPersistence]);
  const upgradedFixture = await legacySql("SELECT pc.player_id, pc.user_id FROM player_controllers pc JOIN users u ON u.id = pc.user_id WHERE pc.game_id = 'game-upgrade-1' AND pc.player_id = 'player-upgrade-1' AND pc.controller_kind = 'PRIMARY'");
  if (!upgradedFixture.includes('player-upgrade-1') || !upgradedFixture.includes('user-upgrade-1')) throw new Error('Upgrade migrations did not preserve the production-like player fixture.');
  const upgradedBoardColumn = await legacySql("SELECT COUNT(*) AS unboarded_legacy_games FROM games WHERE id = 'game-upgrade-1' AND board_id IS NULL");
  if (!/"unboarded_legacy_games"\s*:\s*1\b/.test(upgradedBoardColumn)) throw new Error(`games.board_id was not added additively for pre-existing games: ${upgradedBoardColumn}`);
  const preservedHistory = await legacySql("SELECT t.type, t.comment, tp.balance_delta FROM transactions t JOIN transaction_participants tp ON tp.transaction_id = t.id AND tp.game_id = t.game_id WHERE t.id = 'transaction-upgrade-1'");
  if (!preservedHistory.includes('PAY_RENT') || !preservedHistory.includes('Legacy rent')) throw new Error(`The transactions rebuild did not preserve legacy history: ${preservedHistory}`);
  const upgradedForeignKeys = await legacySql('PRAGMA foreign_key_check');
  if (/"results"\s*:\s*\[\s*\{/.test(upgradedForeignKeys)) throw new Error(`Upgrade fixture foreign-key check failed: ${upgradedForeignKeys}`);
  console.log('D1 migrations and core financial constraints verified against an isolated local database.');
} finally {
  await rm(persistence, { recursive: true, force: true });
  await rm(legacyMigrations, { recursive: true, force: true });
  await rm(legacyPersistence, { recursive: true, force: true });
}
