import { readFile, writeFile } from 'node:fs/promises';

const sourcePath = 'dist/monopoly_bank/wrangler.json';
const outputPath = 'dist/monopoly_bank/wrangler.staging.json';
const databaseId = process.env.CLOUDFLARE_STAGING_D1_DATABASE_ID;
const databaseName = process.env.CLOUDFLARE_STAGING_D1_DATABASE_NAME;
const workerName = process.env.CLOUDFLARE_STAGING_WORKER_NAME ?? 'monopoly-bank-staging';
const databaseIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (!databaseId || !databaseIdPattern.test(databaseId))
  throw new Error('CLOUDFLARE_STAGING_D1_DATABASE_ID must be a D1 database UUID.');
if (!databaseName) throw new Error('CLOUDFLARE_STAGING_D1_DATABASE_NAME is required.');
if (!/^[a-z0-9-]+$/.test(workerName) || workerName === 'monopoly-bank')
  throw new Error('CLOUDFLARE_STAGING_WORKER_NAME must be a non-production Worker name.');

const configuration = JSON.parse(await readFile(sourcePath, 'utf8'));
const databases = configuration.d1_databases ?? [];
const database = databases.find((binding) => binding.binding === 'MONOPOLY_BANK_DB');
if (!database || databases.length !== 1)
  throw new Error('The build configuration must contain exactly the MONOPOLY_BANK_DB binding.');

configuration.name = workerName;
database.database_name = databaseName;
database.database_id = databaseId;
configuration.vars = { ...configuration.vars, ENVIRONMENT: 'staging' };
await writeFile(outputPath, `${JSON.stringify(configuration, null, 2)}\n`);
