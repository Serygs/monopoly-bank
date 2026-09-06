import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile as execFileCallback } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const backupPath = process.env.D1_BACKUP_FILE;
const expectedGameId = process.env.D1_RESTORE_EXPECTED_GAME_ID;
if (!backupPath || !expectedGameId) throw new Error('D1_BACKUP_FILE and D1_RESTORE_EXPECTED_GAME_ID are required; never restore production data into a shared environment.');
await access(backupPath);
const execFile = promisify(execFileCallback);
const persistence = await mkdtemp(join(tmpdir(), 'monopoly-bank-d1-restore-'));
const configPath = join(persistence, 'wrangler.json');
const wranglerEntry = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));

async function command(args) {
  const { stdout, stderr } = await execFile(process.execPath, [wranglerEntry, ...args], { cwd: process.cwd(), maxBuffer: 50 * 1024 * 1024 });
  return `${stdout}\n${stderr}`;
}

try {
  await writeFile(configPath, `${JSON.stringify({ name: 'restore-rehearsal', d1_databases: [{ binding: 'MONOPOLY_BANK_DB', database_name: 'restore-rehearsal', database_id: '00000000-0000-4000-8000-000000000002' }] })}\n`);
  await command(['d1', 'execute', 'MONOPOLY_BANK_DB', '--local', '--config', configPath, '--persist-to', persistence, '--file', backupPath]);
  const integrity = await command(['d1', 'execute', 'MONOPOLY_BANK_DB', '--local', '--config', configPath, '--persist-to', persistence, '--json', '--command', 'PRAGMA integrity_check; PRAGMA foreign_key_check;']);
  if (!integrity.includes('ok') || /"results"\s*:\s*\[\s*\{/.test(integrity)) throw new Error(`Restored D1 integrity check failed: ${integrity}`);
  const fixture = await command(['d1', 'execute', 'MONOPOLY_BANK_DB', '--local', '--config', configPath, '--persist-to', persistence, '--json', '--command', `SELECT id FROM games WHERE id = '${expectedGameId.replaceAll("'", "''")}'`]);
  if (!fixture.includes(expectedGameId)) throw new Error('The expected staging fixture is missing after restore.');
  console.log('D1 backup restore rehearsal passed in isolated local persistence.');
} finally {
  await rm(persistence, { recursive: true, force: true });
}
