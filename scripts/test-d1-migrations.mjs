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
const wranglerEntry = fileURLToPath(
  new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url),
);
const legacyConfig = join(legacyMigrations, 'wrangler.json');
const legacyMigrationBoundary = '0010_bankruptcy_transaction_type_and_history_index.sql';

async function command(args, allowFailure = false) {
  try {
    const { stdout, stderr } = await execFile(process.execPath, [wranglerEntry, ...args], {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
    });
    return `${stdout}\n${stderr}`;
  } catch (error) {
    if (allowFailure) return `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
    throw error;
  }
}

async function sql(statement, allowFailure = false) {
  return command(
    [
      'd1',
      'execute',
      'MONOPOLY_BANK_DB',
      '--local',
      '--persist-to',
      persistence,
      '--json',
      '--command',
      statement,
    ],
    allowFailure,
  );
}

async function legacySql(statement, allowFailure = false) {
  return command(
    [
      'd1',
      'execute',
      'MONOPOLY_BANK_DB',
      '--local',
      '--config',
      legacyConfig,
      '--persist-to',
      legacyPersistence,
      '--json',
      '--command',
      statement,
    ],
    allowFailure,
  );
}

try {
  await command([
    'd1',
    'migrations',
    'apply',
    'MONOPOLY_BANK_DB',
    '--local',
    '--persist-to',
    persistence,
  ]);

  const schema = await sql(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('player_controllers', 'payment_requests', 'command_ledger', 'security_rate_limits', 'game_final_snapshots', 'dice_rolls') ORDER BY name",
  );
  for (const table of [
    'player_controllers',
    'payment_requests',
    'command_ledger',
    'security_rate_limits',
    'game_final_snapshots',
    'dice_rolls',
  ]) {
    if (!schema.includes(table)) throw new Error(`Migration did not create ${table}.`);
  }

  if (
    !(await sql("SELECT name FROM pragma_table_info('games') WHERE name = 'deleted_at'")).includes(
      'deleted_at',
    )
  )
    throw new Error('Migration did not add games.deleted_at.');

  await sql(
    "INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status, payment_mode) VALUES ('game-1', 'D1 constraints', 1500, 200, 'K', 'LOBBY', 'FAST'); INSERT INTO players (id, game_id, name, color, balance) VALUES ('player-1', 'game-1', 'Ada', '#123456', 1500);",
  );
  const negativeBalance = await sql("UPDATE players SET balance = -1 WHERE id = 'player-1'", true);
  if (!/CHECK constraint failed/i.test(negativeBalance))
    throw new Error('players.balance accepts a negative value.');

  await sql(
    "INSERT INTO command_ledger (game_id, command_id, actor_id, command_type, payload_hash, status) VALUES ('game-1', 'command-1', 'actor-1', 'CREATE_TRANSACTION', 'hash-1', 'PENDING')",
  );
  const duplicateCommand = await sql(
    "INSERT INTO command_ledger (game_id, command_id, actor_id, command_type, payload_hash, status) VALUES ('game-1', 'command-1', 'actor-2', 'CREATE_TRANSACTION', 'hash-2', 'PENDING')",
    true,
  );
  if (!/UNIQUE constraint failed/i.test(duplicateCommand))
    throw new Error('command_ledger accepts duplicate command IDs per game.');

  const foreignKeyProblems = await sql('PRAGMA foreign_key_check');
  if (/"results"\s*:\s*\[\s*\{/.test(foreignKeyProblems))
    throw new Error(`Foreign-key check failed: ${foreignKeyProblems}`);

  const migrationFiles = (await readdir('migrations'))
    .filter((migration) => migration.endsWith('.sql'))
    .sort();
  for (const migration of migrationFiles) {
    if (migration <= legacyMigrationBoundary)
      await cp(join('migrations', migration), join(legacyMigrations, migration));
  }
  await writeFile(
    legacyConfig,
    `${JSON.stringify({ name: 'migration-upgrade-fixture', d1_databases: [{ binding: 'MONOPOLY_BANK_DB', database_name: 'migration-upgrade-fixture', database_id: '00000000-0000-4000-8000-000000000001', migrations_dir: legacyMigrations }] })}\n`,
  );
  await command([
    'd1',
    'migrations',
    'apply',
    'MONOPOLY_BANK_DB',
    '--local',
    '--config',
    legacyConfig,
    '--persist-to',
    legacyPersistence,
  ]);
  await legacySql(
    "INSERT INTO users (id, nickname, avatar, password_hash, password_salt) VALUES ('user-upgrade-1', 'Existing player', '😀', 'fixture-password-hash', 'fixture-password-salt'); INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status) VALUES ('game-upgrade-1', 'Existing game', 1500, 200, 'K', 'ACTIVE'); INSERT INTO players (id, game_id, name, color, balance) VALUES ('player-upgrade-1', 'game-upgrade-1', 'Existing player', '#123456', 1500); INSERT INTO game_members (game_id, user_id, role, player_id) VALUES ('game-upgrade-1', 'user-upgrade-1', 'PLAYER', 'player-upgrade-1');",
  );
  // Migration 0021 rebuilds `transactions` while payment_requests references it, so it is applied
  // last, on top of rows that exercise that reference.
  const rebuildMigration = '0021_transaction_reversals.sql';
  for (const migration of migrationFiles) {
    if (migration > legacyMigrationBoundary && migration < rebuildMigration)
      await cp(join('migrations', migration), join(legacyMigrations, migration));
  }
  const applyLegacy = () =>
    command([
      'd1',
      'migrations',
      'apply',
      'MONOPOLY_BANK_DB',
      '--local',
      '--config',
      legacyConfig,
      '--persist-to',
      legacyPersistence,
    ]);
  await applyLegacy();
  await legacySql(
    "INSERT INTO players (id, game_id, name, color, balance) VALUES ('player-upgrade-2', 'game-upgrade-1', 'Second player', '#654321', 1500); INSERT INTO transactions (id, game_id, type, amount, total_amount) VALUES ('transaction-upgrade-1', 'game-upgrade-1', 'PLAYER_TO_PLAYER', 10, 10); INSERT INTO transaction_participants (transaction_id, game_id, player_id, balance_delta) VALUES ('transaction-upgrade-1', 'game-upgrade-1', 'player-upgrade-1', -10), ('transaction-upgrade-1', 'game-upgrade-1', 'player-upgrade-2', 10); INSERT INTO payment_requests (id, game_id, payer_player_id, recipient_player_id, creator_player_id, approver_player_id, amount, state, expires_at, transaction_id) VALUES ('request-upgrade-1', 'game-upgrade-1', 'player-upgrade-1', 'player-upgrade-2', 'player-upgrade-2', 'player-upgrade-1', 10, 'ACCEPTED', '2099-01-01T00:00:00.000Z', 'transaction-upgrade-1');",
  );
  await cp(join('migrations', rebuildMigration), join(legacyMigrations, rebuildMigration));
  await applyLegacy();
  // Migration 0022 rebuilds `transactions` again, this time over a reversal that links to another row.
  await legacySql(
    "INSERT INTO transactions (id, game_id, type, amount, total_amount, reverses_transaction_id) VALUES ('reversal-upgrade-1', 'game-upgrade-1', 'REVERSAL', 10, 10, 'transaction-upgrade-1'); INSERT INTO transaction_participants (transaction_id, game_id, player_id, balance_delta) VALUES ('reversal-upgrade-1', 'game-upgrade-1', 'player-upgrade-1', 10), ('reversal-upgrade-1', 'game-upgrade-1', 'player-upgrade-2', -10);",
  );
  const loansMigration = '0023_player_loans.sql';
  for (const migration of migrationFiles) {
    if (migration > rebuildMigration && migration < loansMigration)
      await cp(join('migrations', migration), join(legacyMigrations, migration));
  }
  await applyLegacy();
  const rebuilt = await legacySql(
    "SELECT (SELECT COUNT(*) FROM transactions) AS transactions, (SELECT COUNT(*) FROM transaction_participants) AS participants, (SELECT transaction_id FROM payment_requests WHERE id = 'request-upgrade-1') AS linked, (SELECT reverses_transaction_id FROM transactions WHERE id = 'reversal-upgrade-1') AS reverses, (SELECT COUNT(*) FROM mortgages) AS mortgages",
  );
  const rebuiltRow = JSON.parse(
    rebuilt.slice(rebuilt.indexOf('['), rebuilt.lastIndexOf(']') + 1),
  )[0]?.results?.[0];
  if (
    rebuiltRow?.transactions !== 2 ||
    rebuiltRow.participants !== 4 ||
    rebuiltRow.linked !== 'transaction-upgrade-1' ||
    rebuiltRow.reverses !== 'transaction-upgrade-1' ||
    rebuiltRow.mortgages !== 0
  )
    throw new Error(`The transactions rebuilds lost or changed rows: ${rebuilt}`);
  // Migration 0023 adds payment_requests.kind and the loan tables on top of the existing rows.
  const bankLoansMigration = '0024_bank_loans.sql';
  for (const migration of migrationFiles) {
    if (migration >= loansMigration && migration < bankLoansMigration)
      await cp(join('migrations', migration), join(legacyMigrations, migration));
  }
  await applyLegacy();
  const loansStage = await legacySql(
    "SELECT (SELECT kind FROM payment_requests WHERE id = 'request-upgrade-1') AS kind, (SELECT COUNT(*) FROM transactions) AS transactions, (SELECT COUNT(*) FROM loans) AS loans, (SELECT COUNT(*) FROM loan_repayments) AS repayments",
  );
  const loansRow = JSON.parse(
    loansStage.slice(loansStage.indexOf('['), loansStage.lastIndexOf(']') + 1),
  )[0]?.results?.[0];
  if (
    loansRow?.kind !== 'PAYMENT' ||
    loansRow.transactions !== 2 ||
    loansRow.loans !== 0 ||
    loansRow.repayments !== 0
  )
    throw new Error(`The loans migration lost or changed rows: ${loansStage}`);
  // Migration 0024 adds the bank-loan columns and index on top of an existing player loan and repayment.
  await legacySql(
    "INSERT INTO transactions (id, game_id, type, amount, total_amount) VALUES ('loan-upgrade-1', 'game-upgrade-1', 'LOAN_ISSUE', 50, 50), ('loan-upgrade-2', 'game-upgrade-1', 'LOAN_REPAYMENT', 20, 20); INSERT INTO loans (id, game_id, lender_kind, lender_player_id, borrower_player_id, principal, repaid_amount) VALUES ('loan-upgrade-1', 'game-upgrade-1', 'PLAYER', 'player-upgrade-1', 'player-upgrade-2', 50, 20); INSERT INTO loan_repayments (transaction_id, game_id, loan_id, amount) VALUES ('loan-upgrade-2', 'game-upgrade-1', 'loan-upgrade-1', 20);",
  );
  await cp(join('migrations', bankLoansMigration), join(legacyMigrations, bankLoansMigration));
  await applyLegacy();
  const bankLoansStage = await legacySql(
    "SELECT (SELECT cooldown_acknowledged FROM loans WHERE id = 'loan-upgrade-1') AS cooldown, (SELECT interest_amount FROM loan_repayments WHERE transaction_id = 'loan-upgrade-2') AS interest, (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'loans_one_active_bank_loan') AS idx",
  );
  const bankLoansRow = JSON.parse(
    bankLoansStage.slice(bankLoansStage.indexOf('['), bankLoansStage.lastIndexOf(']') + 1),
  )[0]?.results?.[0];
  if (bankLoansRow?.cooldown !== 0 || bankLoansRow.interest !== 0 || bankLoansRow.idx !== 1)
    throw new Error(`The bank loans migration lost or changed rows: ${bankLoansStage}`);
  await legacySql(
    "INSERT INTO transactions (id, game_id, type, amount, total_amount) VALUES ('bank-loan-1', 'game-upgrade-1', 'LOAN_ISSUE', 30, 30), ('bank-loan-2', 'game-upgrade-1', 'LOAN_ISSUE', 30, 30); INSERT INTO loans (id, game_id, lender_kind, borrower_player_id, principal) VALUES ('bank-loan-1', 'game-upgrade-1', 'BANK', 'player-upgrade-1', 30);",
  );
  const secondActiveBankLoan = await legacySql(
    "INSERT INTO loans (id, game_id, lender_kind, borrower_player_id, principal) VALUES ('bank-loan-2', 'game-upgrade-1', 'BANK', 'player-upgrade-1', 30)",
    true,
  );
  if (!/UNIQUE constraint failed/i.test(secondActiveBankLoan))
    throw new Error('loans accepts a second active bank loan for one player.');
  // Migration 0025 adds games.jackpot_balance; the existing game must start with an empty pot.
  const jackpotMigration = '0025_free_parking_jackpot.sql';
  await cp(join('migrations', jackpotMigration), join(legacyMigrations, jackpotMigration));
  await applyLegacy();
  const jackpotStage = await legacySql(
    "SELECT jackpot_balance FROM games WHERE id = 'game-upgrade-1'",
  );
  const jackpotRow = JSON.parse(
    jackpotStage.slice(jackpotStage.indexOf('['), jackpotStage.lastIndexOf(']') + 1),
  )[0]?.results?.[0];
  if (jackpotRow?.jackpot_balance !== 0)
    throw new Error(`The jackpot migration did not default the pot to 0: ${jackpotStage}`);
  const negativeJackpot = await legacySql(
    "UPDATE games SET jackpot_balance = -1 WHERE id = 'game-upgrade-1'",
    true,
  );
  if (!/CHECK constraint failed/i.test(negativeJackpot))
    throw new Error('games.jackpot_balance accepts a negative value.');
  // Migration 0026 adds the auctions table: one ACTIVE auction per game, SOLD needs a settling transaction.
  const auctionsMigration = '0026_auctions.sql';
  await cp(join('migrations', auctionsMigration), join(legacyMigrations, auctionsMigration));
  await applyLegacy();
  const auctionInsert = (id, state) =>
    `INSERT INTO auctions (id, game_id, lot_name, initiator_player_id, state, started_at, ends_at) VALUES ('${id}', 'game-upgrade-1', 'Lot', 'player-upgrade-1', '${state}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:30.000Z')`;
  await legacySql(auctionInsert('auction-upgrade-1', 'ACTIVE'));
  const secondActiveAuction = await legacySql(auctionInsert('auction-upgrade-2', 'ACTIVE'), true);
  if (!/UNIQUE constraint failed/i.test(secondActiveAuction))
    throw new Error('auctions accepts a second active auction for one game.');
  const soldWithoutPayment = await legacySql(auctionInsert('auction-upgrade-3', 'SOLD'), true);
  if (!/CHECK constraint failed/i.test(soldWithoutPayment))
    throw new Error('auctions accepts a SOLD auction without a settling transaction.');
  await legacySql(auctionInsert('auction-upgrade-4', 'NO_SALE'));
  const upgradedFixture = await legacySql(
    "SELECT pc.player_id, pc.user_id FROM player_controllers pc JOIN users u ON u.id = pc.user_id WHERE pc.game_id = 'game-upgrade-1' AND pc.player_id = 'player-upgrade-1' AND pc.controller_kind = 'PRIMARY'",
  );
  if (!upgradedFixture.includes('player-upgrade-1') || !upgradedFixture.includes('user-upgrade-1'))
    throw new Error('Upgrade migrations did not preserve the production-like player fixture.');
  const upgradedForeignKeys = await legacySql('PRAGMA foreign_key_check');
  if (/"results"\s*:\s*\[\s*\{/.test(upgradedForeignKeys))
    throw new Error(`Upgrade fixture foreign-key check failed: ${upgradedForeignKeys}`);
  console.log(
    'D1 migrations and core financial constraints verified against an isolated local database.',
  );
} finally {
  await rm(persistence, { recursive: true, force: true });
  await rm(legacyMigrations, { recursive: true, force: true });
  await rm(legacyPersistence, { recursive: true, force: true });
}
