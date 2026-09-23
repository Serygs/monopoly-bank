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
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('player_controllers', 'payment_requests', 'command_ledger', 'security_rate_limits', 'game_final_snapshots') ORDER BY name",
  );
  for (const table of [
    'player_controllers',
    'payment_requests',
    'command_ledger',
    'security_rate_limits',
    'game_final_snapshots',
  ]) {
    if (!schema.includes(table)) throw new Error(`Migration did not create ${table}.`);
  }

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
  for (const migration of migrationFiles) {
    if (migration > legacyMigrationBoundary)
      await cp(join('migrations', migration), join(legacyMigrations, migration));
  }
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
