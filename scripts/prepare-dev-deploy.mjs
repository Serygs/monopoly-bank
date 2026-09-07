import { readFile, writeFile } from 'node:fs/promises'

const configPath = 'dist/monopoly_bank/wrangler.json'
const outputPath = 'dist/monopoly_bank/wrangler.dev.json'
const databaseId = process.env.CLOUDFLARE_DEV_D1_DATABASE_ID
const databaseName = process.env.CLOUDFLARE_DEV_D1_DATABASE_NAME
const databaseIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

if (!databaseId || !databaseIdPattern.test(databaseId)) {
  throw new Error('CLOUDFLARE_DEV_D1_DATABASE_ID must be a D1 database UUID.')
}

if (!databaseName) {
  throw new Error('CLOUDFLARE_DEV_D1_DATABASE_NAME is required.')
}

const configuration = JSON.parse(await readFile(configPath, 'utf8'))
const database = configuration.d1_databases?.find(
  (binding) => binding.binding === 'MONOPOLY_BANK_DB',
)

if (!database) {
  throw new Error('The built Worker configuration is missing the MONOPOLY_BANK_DB binding.')
}

configuration.name = 'monopoly-bank-dev'
database.database_name = databaseName
database.database_id = databaseId
// Analytics Engine is an account-level optional service. Keep production and
// staging observability strict, but allow the isolated development Worker to
// deploy in accounts where it has not been enabled.
delete configuration.analytics_engine_datasets
configuration.vars = { ...configuration.vars, ENVIRONMENT: 'development' }

await writeFile(outputPath, `${JSON.stringify(configuration, null, 2)}\n`)
