# Monopoly Bank

A responsive English/Ukrainian banking companion for an in-person Monopoly game. It stores games, player wallets, and explicit banking history in Cloudflare D1; it does not implement board or game-engine rules. The UI language switch is available in the header and the preference is retained in the browser.

## Database setup

`wrangler.jsonc` contains the production `MONOPOLY_BANK_DB` binding and the separate `monopoly-bank-dev` development database. A D1 database is created only once. If Wrangler reports that a database name already exists, that is expected: verify and reuse it instead of creating another database.

```bash
# Verify an existing database in the authenticated Cloudflare account.
npx wrangler d1 info monopoly-bank-dev

# Create a database only when `d1 info` reports that it does not exist.
npx wrangler d1 create monopoly-bank-dev --location eeur
```

If a new **production** D1 database is intentionally created, update the production binding's `database_id` in `wrangler.jsonc` before applying remote migrations or deploying. Never point the production Worker at `monopoly-bank-dev`.

## Local development

```bash
npm install
npx wrangler d1 migrations apply MONOPOLY_BANK_DB --local
npm run dev
```

The Vite Cloudflare plugin runs the React UI and Worker together. Local D1 data is held in `.wrangler/`, which is ignored by Git.

## Validation

```bash
npm test
npm run lint
npm run build
```

`npm run build` includes the TypeScript project build; there is no separate typecheck script.

## API errors and request correlation

Every API response includes `X-Request-ID`. Error responses use one contract: `{ "error": { "code", "message", "requestId", "details?" } }`. Codes are stable machine identifiers (for example `VALIDATION_ERROR`, `UNAUTHORIZED`, `INSUFFICIENT_FUNDS`, `GAME_FINISHED`, and `INTERNAL_ERROR`); the HTTP status carries the error category. `details` is present only for safe, structured information such as an invalid field or a required balance.

The same request ID is included in structured Worker logs. Client responses never include stacks, D1/SQL diagnostics, credentials, cookies, or other internals. For a 5xx, use the request ID to find the server-side log, where the original cause chain is retained and sensitive fields are redacted.

## Production deployment

After the database setup above:

```bash
npx wrangler d1 migrations apply MONOPOLY_BANK_DB --remote
npm run deploy
```

Run the migration command before every deployment that introduces a new file in `migrations/`. Do not commit account credentials or Cloudflare API tokens.

## GitHub Actions deployments

### Cloudflare credentials

Create a Cloudflare API token scoped to the account that owns the Worker. It needs `Workers Scripts: Edit` and `D1: Edit` account permissions. Copy the account ID from the Cloudflare dashboard.

In GitHub, open **Settings → Environments** and create both `development` and `production`. Add these environment secrets to each environment:

- `CLOUDFLARE_API_TOKEN` — the Cloudflare API token;
- `CLOUDFLARE_ACCOUNT_ID` — the Cloudflare account ID.

Environment secrets are separate: adding credentials to `production` does not make them available to `development`. Do not store either value in source code or as a plain GitHub variable.

### Automatic development deployment

Pushes to `dev` deploy automatically to the separate `monopoly-bank-dev` Worker and D1 database. First verify that the database exists; reuse it if it does:

```bash
npx wrangler d1 info monopoly-bank-dev
```

Only if that command says the database does not exist, create it once:

```bash
npx wrangler d1 create monopoly-bank-dev --location eeur
```

- secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`;
- optionally, the `CLOUDFLARE_DEV_D1_DATABASE_NAME` variable when the database is not named `monopoly-bank-dev`.

The workflow resolves the development D1 database UUID from its name, so no database ID needs to be stored in GitHub. The database must identify the development database, not `monopoly-bank`. Pending migrations are applied to that development database before each deployment.

After committing the workflow to `dev`, push or merge a change into `dev`. The `CI` workflow validates the revision, resolves the existing development D1 database, applies migrations, and deploys `monopoly-bank-dev`. Do not apply the same migrations manually immediately before this workflow; it applies pending migration files safely.

Use the GitHub Actions path for development deployments: it builds the separate development Worker configuration, applies pending migrations to `monopoly-bank-dev`, and avoids accidentally deploying development changes to production.

### Manual production release

Production releases are manual only:

1. Merge the release PR from `dev` into `main` after its required checks and review.
2. Open **Actions → Deploy → Run workflow**.
3. Select `main`, enable `confirm_production_release`, and run the workflow.

The workflow re-runs lint, tests, and the production build, applies production D1 migrations, and then deploys `monopoly-bank`. Configure required reviewers on the GitHub `production` environment if an additional approval gate is desired.
