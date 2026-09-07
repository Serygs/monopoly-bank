import { readFile } from 'node:fs/promises';

const configPath = process.env.WRANGLER_CONFIG_PATH;
const expectedDatabaseId = process.env.EXPECTED_D1_DATABASE_ID;
const expectedDatabaseName = process.env.EXPECTED_D1_DATABASE_NAME;
const expectedWorkerName = process.env.EXPECTED_WORKER_NAME;

if (!configPath || !expectedDatabaseId || !expectedDatabaseName || !expectedWorkerName) throw new Error('WRANGLER_CONFIG_PATH, EXPECTED_D1_DATABASE_ID, EXPECTED_D1_DATABASE_NAME, and EXPECTED_WORKER_NAME are required.');
const configuration = JSON.parse(await readFile(configPath, 'utf8'));
const databases = configuration.d1_databases ?? [];
const database = databases.find((binding) => binding.binding === 'MONOPOLY_BANK_DB');
if (configuration.name !== expectedWorkerName) throw new Error('Worker name does not match the approved deployment target.');
if (databases.length !== 1 || !database || database.database_id !== expectedDatabaseId || database.database_name !== expectedDatabaseName) throw new Error('D1 binding does not match the approved deployment target.');
if (!configuration.durable_objects?.bindings?.some((binding) => binding.name === 'GAME_SESSIONS' && binding.class_name === 'GameSession')) throw new Error('GAME_SESSIONS Durable Object binding is missing.');
console.log('Worker, D1, and Durable Object bindings match the approved deployment target.');
